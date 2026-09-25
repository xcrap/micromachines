import * as THREE from "three";

const VERTEX_SHADER = /* glsl */ `
attribute float aAlpha;
attribute float aBirth;
attribute vec3 aColor;

uniform float uTime;
uniform float uFadeRate;

varying float vAlpha;
varying vec3 vColor;

void main() {
    vAlpha = aAlpha - (uTime - aBirth) * uFadeRate;
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

/**
 * One continuous ribbon per wheel, backed by a sliding buffer so the whole skid history is a
 * single draw call. Fading happens on the GPU from each point's birth time, so a frame only
 * uploads the points that were just laid.
 */
class TrailRibbon {
    readonly mesh: THREE.Mesh;

    private readonly positions = new Float32Array(CAPACITY * 2 * 3);
    private readonly colors = new Float32Array(CAPACITY * 2 * 3);
    private readonly alphas = new Float32Array(CAPACITY * 2);
    private readonly births = new Float32Array(CAPACITY * 2);

    private readonly geometry: THREE.BufferGeometry;
    private readonly attributes: THREE.BufferAttribute[];

    private count = 0;
    private dirtyFrom = Infinity;
    private fullUpload = false;
    private pendingBreak = true;
    private readonly lastPosition = new THREE.Vector3();
    private hasLast = false;

    constructor(material: THREE.ShaderMaterial) {
        this.geometry = new THREE.BufferGeometry();

        const position = new THREE.BufferAttribute(this.positions, 3);
        const color = new THREE.BufferAttribute(this.colors, 3);
        const alpha = new THREE.BufferAttribute(this.alphas, 1);
        const birth = new THREE.BufferAttribute(this.births, 1);
        this.attributes = [position, color, alpha, birth];
        for (const attribute of this.attributes) attribute.setUsage(THREE.DynamicDrawUsage);

        this.geometry.setAttribute("position", position);
        this.geometry.setAttribute("aColor", color);
        this.geometry.setAttribute("aAlpha", alpha);
        this.geometry.setAttribute("aBirth", birth);

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
        time: number,
    ): void {
        if (this.hasLast && position.distanceToSquared(this.lastPosition) < MIN_STEP_SQ) return;

        if (this.count >= CAPACITY) this.recycle();

        // Zero-alpha seams on both sides of the gap stop a resumed skid from being joined to the previous one.
        if (this.pendingBreak) {
            if (this.count > 0) {
                const tail = (this.count - 1) * 2;
                this.alphas[tail] = 0;
                this.alphas[tail + 1] = 0;
                this.dirtyFrom = Math.min(this.dirtyFrom, this.count - 1);
            }
            this.writePoint(position, rightX, rightZ, halfWidth, color, 0, time);
            this.pendingBreak = false;
            if (this.count >= CAPACITY) this.recycle();
        }

        this.writePoint(position, rightX, rightZ, halfWidth, color, alpha, time);
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
        time: number,
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
        this.births[index] = time;
        this.births[index + 1] = time;

        if (this.count < this.dirtyFrom) this.dirtyFrom = this.count;
        this.count++;
    }

    private recycle(): void {
        const keep = CAPACITY - RECYCLE_BLOCK;
        this.positions.copyWithin(0, RECYCLE_BLOCK * 2 * 3, CAPACITY * 2 * 3);
        this.colors.copyWithin(0, RECYCLE_BLOCK * 2 * 3, CAPACITY * 2 * 3);
        this.alphas.copyWithin(0, RECYCLE_BLOCK * 2, CAPACITY * 2);
        this.births.copyWithin(0, RECYCLE_BLOCK * 2, CAPACITY * 2);
        this.count = keep;
        this.fullUpload = true;
    }

    /** Pushes only the freshly written points to the GPU. */
    public flush(): void {
        if (!this.fullUpload && this.dirtyFrom === Infinity) return;

        const from = this.fullUpload ? 0 : this.dirtyFrom;
        const points = this.count - from;
        const itemSizes = [3, 3, 1, 1];

        for (let a = 0; a < this.attributes.length; a++) {
            const attribute = this.attributes[a];
            const size = itemSizes[a] * 2;
            attribute.clearUpdateRanges();
            if (!this.fullUpload) attribute.addUpdateRange(from * size, points * size);
            attribute.needsUpdate = true;
        }

        this.geometry.setDrawRange(0, Math.max(0, (this.count - 1) * 6));
        this.dirtyFrom = Infinity;
        this.fullUpload = false;
    }

    public clear(): void {
        this.count = 0;
        this.pendingBreak = true;
        this.hasLast = false;
        this.dirtyFrom = Infinity;
        this.fullUpload = false;
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
    private time = 0;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.material = new THREE.ShaderMaterial({
            uniforms: {
                uTime: { value: 0 },
                uFadeRate: { value: FADE_RATE },
            },
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

    private ribbon(id: string): TrailRibbon {
        let ribbon = this.ribbons.get(id);
        if (!ribbon) {
            ribbon = new TrailRibbon(this.material);
            this.scene.add(ribbon.mesh);
            this.ribbons.set(id, ribbon);
        }
        return ribbon;
    }

    /** Lays a mark perpendicular to travel. `peakAlpha` is the opacity of a full-intensity skid on this surface. */
    public addMark(
        id: string,
        position: THREE.Vector3,
        headingSin: number,
        headingCos: number,
        color: THREE.Color,
        peakAlpha: number,
        intensity: number,
    ): void {
        const rightX = -headingCos;
        const rightZ = headingSin;

        const clamped = THREE.MathUtils.clamp(intensity, 0, 1);
        const halfWidth = THREE.MathUtils.lerp(0.06, 0.13, clamped);
        const alpha = peakAlpha * THREE.MathUtils.lerp(0.36, 1, clamped);

        this.ribbon(id).addPoint(position, rightX, rightZ, halfWidth, color, alpha, this.time);
    }

    public breakTrail(id: string): void {
        this.ribbons.get(id)?.breakTrail();
    }

    public clear(): void {
        for (const ribbon of this.ribbons.values()) ribbon.clear();
    }

    public update(deltaTime: number): void {
        this.time += deltaTime;
        this.material.uniforms.uTime.value = this.time;
        for (const ribbon of this.ribbons.values()) ribbon.flush();
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
