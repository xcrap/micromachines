import * as THREE from "three";

export interface EmitOptions {
    color: THREE.Color;
    size: number;
    sizeGrowth: number;
    life: number;
    gravity: number;
    drag: number;
    alpha: number;
}

const VERTEX_SHADER = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;

uniform float uPixelScale;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(1.0, aSize * uPixelScale / max(-mvPosition.z, 0.1));
    gl_Position = projectionMatrix * mvPosition;
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

uniform sampler2D uMap;

varying float vAlpha;
varying vec3 vColor;

void main() {
    if (vAlpha <= 0.0) discard;
    float mask = texture2D(uMap, gl_PointCoord).a;
    float alpha = mask * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor, alpha);
}
`;

/** Pooled point sprites for dust, dirt spray and impact debris. Never allocates while running. */
export class ParticleSystem {
    readonly points: THREE.Points;

    private readonly capacity: number;
    private readonly positions: Float32Array;
    private readonly colors: Float32Array;
    private readonly sizes: Float32Array;
    private readonly alphas: Float32Array;

    private readonly velocities: Float32Array;
    private readonly life: Float32Array;
    private readonly maxLife: Float32Array;
    private readonly growth: Float32Array;
    private readonly gravity: Float32Array;
    private readonly drag: Float32Array;
    private readonly baseAlpha: Float32Array;
    private readonly baseSize: Float32Array;

    private readonly geometry: THREE.BufferGeometry;
    private readonly material: THREE.ShaderMaterial;
    private readonly texture: THREE.Texture;

    private cursor = 0;
    private liveCount = 0;

    constructor(capacity: number) {
        this.capacity = Math.max(16, capacity);

        this.positions = new Float32Array(this.capacity * 3);
        this.colors = new Float32Array(this.capacity * 3);
        this.sizes = new Float32Array(this.capacity);
        this.alphas = new Float32Array(this.capacity);
        this.velocities = new Float32Array(this.capacity * 3);
        this.life = new Float32Array(this.capacity);
        this.maxLife = new Float32Array(this.capacity);
        this.growth = new Float32Array(this.capacity);
        this.gravity = new Float32Array(this.capacity);
        this.drag = new Float32Array(this.capacity);
        this.baseAlpha = new Float32Array(this.capacity);
        this.baseSize = new Float32Array(this.capacity);

        this.geometry = new THREE.BufferGeometry();
        this.geometry.setAttribute("position", createDynamic(this.positions, 3));
        this.geometry.setAttribute("aColor", createDynamic(this.colors, 3));
        this.geometry.setAttribute("aSize", createDynamic(this.sizes, 1));
        this.geometry.setAttribute("aAlpha", createDynamic(this.alphas, 1));
        this.geometry.setDrawRange(0, 0);
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

        this.texture = createSoftTexture();
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uMap: { value: this.texture },
                uPixelScale: { value: 600 },
            },
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: true,
        });

        this.points = new THREE.Points(this.geometry, this.material);
        this.points.frustumCulled = false;
        this.points.renderOrder = 900;
        this.points.name = "particles";
        this.points.userData.nonCollidable = true;
    }

    /** Recomputes world-size-to-pixels so sprites stay a constant physical size. */
    public setViewport(height: number, verticalFovRadians: number): void {
        this.material.uniforms.uPixelScale.value = height / (2 * Math.tan(verticalFovRadians / 2));
    }

    public emit(
        x: number, y: number, z: number,
        vx: number, vy: number, vz: number,
        options: EmitOptions,
    ): void {
        const index = this.cursor;
        this.cursor = (this.cursor + 1) % this.capacity;
        if (this.liveCount < this.capacity) this.liveCount++;

        this.positions[index * 3] = x;
        this.positions[index * 3 + 1] = y;
        this.positions[index * 3 + 2] = z;

        this.velocities[index * 3] = vx;
        this.velocities[index * 3 + 1] = vy;
        this.velocities[index * 3 + 2] = vz;

        this.colors[index * 3] = options.color.r;
        this.colors[index * 3 + 1] = options.color.g;
        this.colors[index * 3 + 2] = options.color.b;

        this.life[index] = options.life;
        this.maxLife[index] = options.life;
        this.growth[index] = options.sizeGrowth;
        this.gravity[index] = options.gravity;
        this.drag[index] = options.drag;
        this.baseAlpha[index] = options.alpha;
        this.baseSize[index] = options.size;

        this.sizes[index] = options.size;
        this.alphas[index] = options.alpha;
    }

    public update(deltaTime: number): void {
        if (this.liveCount === 0) return;

        for (let i = 0; i < this.liveCount; i++) {
            if (this.life[i] <= 0) {
                this.alphas[i] = 0;
                continue;
            }

            this.life[i] -= deltaTime;

            if (this.life[i] <= 0) {
                this.alphas[i] = 0;
                continue;
            }

            const decay = Math.exp(-this.drag[i] * deltaTime);
            const base = i * 3;

            this.velocities[base] *= decay;
            this.velocities[base + 1] = this.velocities[base + 1] * decay - this.gravity[i] * deltaTime;
            this.velocities[base + 2] *= decay;

            this.positions[base] += this.velocities[base] * deltaTime;
            this.positions[base + 1] += this.velocities[base + 1] * deltaTime;
            this.positions[base + 2] += this.velocities[base + 2] * deltaTime;

            const age = 1 - this.life[i] / this.maxLife[i];
            this.sizes[i] = this.baseSize[i] * (1 + this.growth[i] * age);
            // Quick fade in, long fade out.
            this.alphas[i] = this.baseAlpha[i] * Math.min(1, age * 8) * (1 - age) * (1 - age);
        }

        this.geometry.setDrawRange(0, this.liveCount);
        (this.geometry.getAttribute("position") as THREE.BufferAttribute).needsUpdate = true;
        (this.geometry.getAttribute("aColor") as THREE.BufferAttribute).needsUpdate = true;
        (this.geometry.getAttribute("aSize") as THREE.BufferAttribute).needsUpdate = true;
        (this.geometry.getAttribute("aAlpha") as THREE.BufferAttribute).needsUpdate = true;
    }

    public dispose(): void {
        this.geometry.dispose();
        this.material.dispose();
        this.texture.dispose();
    }
}

function createDynamic(array: Float32Array, itemSize: number): THREE.BufferAttribute {
    const attribute = new THREE.BufferAttribute(array, itemSize);
    attribute.setUsage(THREE.DynamicDrawUsage);
    return attribute;
}

function createSoftTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.45, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");

    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    return texture;
}
