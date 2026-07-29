import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
attribute float aAlpha;
attribute vec3 aColor;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vAlpha = aAlpha;
    vColor = aColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision mediump float;

varying float vAlpha;
varying vec3 vColor;

void main() {
    if (vAlpha < 0.004) discard;
    gl_FragColor = vec4(vColor, vAlpha);
    // Without this the marks bypass output colour management and wash out to grey.
    #include <colorspace_fragment>
}
`;

const CAPACITY = 640;
/** How many of the oldest points get recycled when a ribbon fills up. */
const RECYCLE_BLOCK = 160;
const MIN_STEP = 0.06;
const MIN_STEP_SQ = MIN_STEP * MIN_STEP;
const FADE_RATE = 0.055;

const TRACK_COLOR = new THREE.Color(0x2b1d0e);
const GRASS_COLOR = new THREE.Color(0x3b3218);

/**
 * One continuous ribbon per wheel, backed by a sliding buffer so the whole skid
 * history is a single draw call instead of a mesh per streak.
 */
class TrailRibbon {
    readonly mesh: THREE.Mesh;

    private readonly positions = new Float32Array(CAPACITY * 2 * 3);
    private readonly colors = new Float32Array(CAPACITY * 2 * 3);
    private readonly alphas = new Float32Array(CAPACITY * 2);

    private readonly geometry: THREE.BufferGeometry;
    private readonly positionAttribute: THREE.BufferAttribute;
    private readonly colorAttribute: THREE.BufferAttribute;
    private readonly alphaAttribute: THREE.BufferAttribute;

    private count = 0;
    private pendingBreak = true;
    private readonly lastPosition = new THREE.Vector3();
    private hasLast = false;

    constructor(material: THREE.ShaderMaterial) {
        this.geometry = new THREE.BufferGeometry();

        this.positionAttribute = new THREE.BufferAttribute(this.positions, 3);
        this.positionAttribute.setUsage(THREE.DynamicDrawUsage);
        this.colorAttribute = new THREE.BufferAttribute(this.colors, 3);
        this.colorAttribute.setUsage(THREE.DynamicDrawUsage);
        this.alphaAttribute = new THREE.BufferAttribute(this.alphas, 1);
        this.alphaAttribute.setUsage(THREE.DynamicDrawUsage);

        this.geometry.setAttribute("position", this.positionAttribute);
        this.geometry.setAttribute("aColor", this.colorAttribute);
        this.geometry.setAttribute("aAlpha", this.alphaAttribute);

        const indices = new Uint16Array((CAPACITY - 1) * 6);
        for (let i = 0; i < CAPACITY - 1; i++) {
            const current = i * 2;
            const next = (i + 1) * 2;
            const base = i * 6;
            indices[base] = current;
            indices[base + 1] = current + 1;
            indices[base + 2] = next;
            indices[base + 3] = next;
            indices[base + 4] = current + 1;
            indices[base + 5] = next + 1;
        }
        this.geometry.setIndex(new THREE.BufferAttribute(indices, 1));
        this.geometry.setDrawRange(0, 0);
        this.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = 4;
        this.mesh.matrixAutoUpdate = false;
        this.mesh.userData.nonCollidable = true;
    }

    public breakTrail(): void {
        this.pendingBreak = true;
        this.hasLast = false;
    }

    public addPoint(
        position: THREE.Vector3,
        rightX: number,
        rightZ: number,
        halfWidth: number,
        color: THREE.Color,
        alpha: number,
    ): void {
        if (this.hasLast && position.distanceToSquared(this.lastPosition) < MIN_STEP_SQ) return;

        if (this.count >= CAPACITY) this.recycle();

        // A zero-alpha seam stops a resumed skid from being joined to the previous one.
        if (this.pendingBreak) {
            this.writePoint(position, rightX, rightZ, halfWidth, color, 0);
            this.pendingBreak = false;
            if (this.count >= CAPACITY) this.recycle();
        }

        this.writePoint(position, rightX, rightZ, halfWidth, color, alpha);
        this.lastPosition.copy(position);
        this.hasLast = true;
    }

    private writePoint(
        position: THREE.Vector3,
        rightX: number,
        rightZ: number,
        halfWidth: number,
        color: THREE.Color,
        alpha: number,
    ): void {
        const index = this.count * 2;
        const left = index * 3;
        const right = (index + 1) * 3;

        this.positions[left] = position.x - rightX * halfWidth;
        this.positions[left + 1] = position.y;
        this.positions[left + 2] = position.z - rightZ * halfWidth;

        this.positions[right] = position.x + rightX * halfWidth;
        this.positions[right + 1] = position.y;
        this.positions[right + 2] = position.z + rightZ * halfWidth;

        this.colors[left] = color.r;
        this.colors[left + 1] = color.g;
        this.colors[left + 2] = color.b;
        this.colors[right] = color.r;
        this.colors[right + 1] = color.g;
        this.colors[right + 2] = color.b;

        this.alphas[index] = alpha;
        this.alphas[index + 1] = alpha;

        this.count++;
    }

    private recycle(): void {
        const keep = CAPACITY - RECYCLE_BLOCK;
        this.positions.copyWithin(0, RECYCLE_BLOCK * 2 * 3, CAPACITY * 2 * 3);
        this.colors.copyWithin(0, RECYCLE_BLOCK * 2 * 3, CAPACITY * 2 * 3);
        this.alphas.copyWithin(0, RECYCLE_BLOCK * 2, CAPACITY * 2);
        this.count = keep;
    }

    public update(deltaTime: number): void {
        if (this.count === 0) return;

        const fade = FADE_RATE * deltaTime;
        const vertexCount = this.count * 2;

        for (let i = 0; i < vertexCount; i++) {
            if (this.alphas[i] > 0) {
                this.alphas[i] = Math.max(0, this.alphas[i] - fade);
            }
        }

        this.geometry.setDrawRange(0, Math.max(0, (this.count - 1) * 6));
        this.positionAttribute.needsUpdate = true;
        this.colorAttribute.needsUpdate = true;
        this.alphaAttribute.needsUpdate = true;
    }

    public clear(): void {
        this.count = 0;
        this.pendingBreak = true;
        this.hasLast = false;
        this.alphas.fill(0);
        this.geometry.setDrawRange(0, 0);
    }

    public dispose(): void {
        this.geometry.dispose();
    }
}

export class TrailSystem {
    private readonly material: THREE.ShaderMaterial;
    private readonly ribbons = new Map<string, TrailRibbon>();
    private readonly scene: THREE.Scene;
    private readonly color = new THREE.Color();

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.material = new THREE.ShaderMaterial({
            uniforms: {},
            vertexShader: VERTEX_SHADER,
            fragmentShader: FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            polygonOffset: true,
            polygonOffsetFactor: -6,
            polygonOffsetUnits: -6,
        });
    }

    private ribbon(wheelId: string): TrailRibbon {
        let ribbon = this.ribbons.get(wheelId);
        if (!ribbon) {
            ribbon = new TrailRibbon(this.material);
            this.scene.add(ribbon.mesh);
            this.ribbons.set(wheelId, ribbon);
        }
        return ribbon;
    }

    public addMark(
        wheelId: string,
        position: THREE.Vector3,
        headingSin: number,
        headingCos: number,
        onTrack: boolean,
        intensity: number,
    ): void {
        // Ribbon runs perpendicular to travel.
        const rightX = -headingCos;
        const rightZ = headingSin;

        const clamped = THREE.MathUtils.clamp(intensity, 0, 1);
        const halfWidth = THREE.MathUtils.lerp(0.06, 0.13, clamped);

        this.color.copy(onTrack ? TRACK_COLOR : GRASS_COLOR);
        // Grass only gets flattened, so those marks stay far fainter than rubber on dirt.
        const alpha = onTrack
            ? THREE.MathUtils.lerp(0.22, 0.62, clamped)
            : THREE.MathUtils.lerp(0.10, 0.28, clamped);

        this.ribbon(wheelId).addPoint(position, rightX, rightZ, halfWidth, this.color, alpha);
    }

    public breakAllTrails(): void {
        for (const ribbon of this.ribbons.values()) ribbon.breakTrail();
    }

    public clear(): void {
        for (const ribbon of this.ribbons.values()) ribbon.clear();
    }

    public update(deltaTime: number): void {
        for (const ribbon of this.ribbons.values()) ribbon.update(deltaTime);
    }

    public dispose(): void {
        for (const ribbon of this.ribbons.values()) {
            this.scene.remove(ribbon.mesh);
            ribbon.dispose();
        }
        this.ribbons.clear();
        this.material.dispose();
    }
}
