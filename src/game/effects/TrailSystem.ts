import * as THREE from 'three';

const TRAIL_VERTEX_SHADER = `
attribute float alpha;
varying float vAlpha;
void main() {
    vAlpha = alpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const TRAIL_FRAGMENT_SHADER = `
uniform vec3 color;
varying float vAlpha;
void main() {
    gl_FragColor = vec4(color, vAlpha);
}
`;

const TRACK_COLOR = new THREE.Color(0x2a1a0a);
const GRASS_COLOR = new THREE.Color(0x1a3a0a);
const MAX_POINTS = 200;
const MIN_DISTANCE = 0.03;
const FADE_RATE = 0.08;

class TrailRibbon {
    private maxPoints = MAX_POINTS;
    private positions: Float32Array;
    private alphas: Float32Array;
    private head = 0;
    private count = 0;
    readonly mesh: THREE.Mesh;
    private geometry: THREE.BufferGeometry;
    private lastPosition = new THREE.Vector3();
    private hasLastPosition = false;
    private posAttr: THREE.BufferAttribute;
    private alphaAttr: THREE.BufferAttribute;
    private indexAttr: THREE.BufferAttribute;

    private _tmpRight = new THREE.Vector3();

    constructor(material: THREE.ShaderMaterial) {
        const vertexCount = this.maxPoints * 2;
        this.positions = new Float32Array(vertexCount * 3);
        this.alphas = new Float32Array(vertexCount);

        this.geometry = new THREE.BufferGeometry();
        this.posAttr = new THREE.BufferAttribute(this.positions, 3);
        this.posAttr.setUsage(THREE.DynamicDrawUsage);
        this.alphaAttr = new THREE.BufferAttribute(this.alphas, 1);
        this.alphaAttr.setUsage(THREE.DynamicDrawUsage);

        this.geometry.setAttribute('position', this.posAttr);
        this.geometry.setAttribute('alpha', this.alphaAttr);

        const indices = new Uint16Array((this.maxPoints - 1) * 6);
        for (let i = 0; i < this.maxPoints - 1; i++) {
            const ci = i * 2;
            const ni = ((i + 1) % this.maxPoints) * 2;
            const base = i * 6;
            indices[base] = ci;
            indices[base + 1] = ci + 1;
            indices[base + 2] = ni;
            indices[base + 3] = ni;
            indices[base + 4] = ci + 1;
            indices[base + 5] = ni + 1;
        }
        this.indexAttr = new THREE.BufferAttribute(indices, 1);
        this.geometry.setIndex(this.indexAttr);

        this.geometry.setDrawRange(0, 0);

        this.mesh = new THREE.Mesh(this.geometry, material);
        this.mesh.frustumCulled = false;
        this.mesh.renderOrder = -100;
    }

    addPoint(position: THREE.Vector3, forward: THREE.Vector3, width: number): void {
        if (this.hasLastPosition) {
            const dist = position.distanceTo(this.lastPosition);
            if (dist < MIN_DISTANCE) return;
        }

        this._tmpRight.set(-forward.z, 0, forward.x).normalize();

        const halfW = width * 0.5;
        const idx = this.head * 2;

        const lx = position.x - this._tmpRight.x * halfW;
        const lz = position.z - this._tmpRight.z * halfW;
        const rx = position.x + this._tmpRight.x * halfW;
        const rz = position.z + this._tmpRight.z * halfW;

        this.positions[idx * 3] = lx;
        this.positions[idx * 3 + 1] = position.y;
        this.positions[idx * 3 + 2] = lz;

        this.positions[(idx + 1) * 3] = rx;
        this.positions[(idx + 1) * 3 + 1] = position.y;
        this.positions[(idx + 1) * 3 + 2] = rz;

        this.alphas[idx] = 0.65;
        this.alphas[idx + 1] = 0.65;

        this.head = (this.head + 1) % this.maxPoints;
        if (this.count < this.maxPoints) this.count++;

        this.lastPosition.copy(position);
        this.hasLastPosition = true;

        this.updateDrawRange();
        this.posAttr.needsUpdate = true;
        this.alphaAttr.needsUpdate = true;
    }

    update(_deltaTime: number): void {
        if (this.count === 0) return;

        let anyVisible = false;
        for (let i = 0; i < this.count * 2; i++) {
            if (this.alphas[i] > 0) {
                this.alphas[i] = Math.max(0, this.alphas[i] - FADE_RATE * _deltaTime);
                if (this.alphas[i] > 0.001) anyVisible = true;
            }
        }

        if (!anyVisible && this.count > 0) {
            this.count = 0;
            this.head = 0;
            this.hasLastPosition = false;
            this.geometry.setDrawRange(0, 0);
        }

        this.alphaAttr.needsUpdate = true;
    }

    reset(): void {
        this.count = 0;
        this.head = 0;
        this.hasLastPosition = false;
        this.alphas.fill(0);
        this.geometry.setDrawRange(0, 0);
        this.alphaAttr.needsUpdate = true;
    }

    private updateDrawRange(): void {
        if (this.count < 2) {
            this.geometry.setDrawRange(0, 0);
            return;
        }

        if (this.count < this.maxPoints) {
            this.geometry.setDrawRange(0, (this.count - 1) * 6);
        } else {
            this.geometry.setDrawRange(0, (this.maxPoints - 1) * 6);
        }
    }

    dispose(): void {
        this.geometry.dispose();
    }
}

export class TrailSystem {
    private scene: THREE.Scene;
    private ribbons = new Map<string, TrailRibbon>();
    private trackMaterial: THREE.ShaderMaterial;
    private grassMaterial: THREE.ShaderMaterial;
    private raycaster = new THREE.Raycaster();
    private trackObjects: THREE.Object3D[] = [];
    private clock = new THREE.Clock();
    private trailColor: THREE.Color;

    private _tmpForward = new THREE.Vector3();
    private _tmpRayOrigin = new THREE.Vector3();
    private _downDir = new THREE.Vector3(0, -1, 0);

    constructor(scene: THREE.Scene, color?: number) {
        this.scene = scene;
        this.trailColor = new THREE.Color(color ?? 0x333333);

        this.trackMaterial = new THREE.ShaderMaterial({
            uniforms: { color: { value: TRACK_COLOR } },
            vertexShader: TRAIL_VERTEX_SHADER,
            fragmentShader: TRAIL_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending,
        });

        this.grassMaterial = new THREE.ShaderMaterial({
            uniforms: { color: { value: GRASS_COLOR } },
            vertexShader: TRAIL_VERTEX_SHADER,
            fragmentShader: TRAIL_FRAGMENT_SHADER,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
            blending: THREE.NormalBlending,
        });
    }

    setTrackObjects(trackObjects: THREE.Object3D[]): void {
        this.trackObjects = trackObjects;
    }

    addTrail(
        position: THREE.Vector3,
        rotation: number,
        color?: THREE.Color,
        wheelId: string = 'default',
        width: number = 0.08,
        intensity: number = 0.5
    ): void {
        const isOnTrack = this.isOnTrackSurface(position);
        const material = isOnTrack ? this.trackMaterial : this.grassMaterial;

        let ribbon = this.ribbons.get(wheelId);
        if (!ribbon || ribbon.mesh.material !== material) {
            if (ribbon) {
                this.scene.remove(ribbon.mesh);
                ribbon.dispose();
            }
            ribbon = new TrailRibbon(material);
            this.scene.add(ribbon.mesh);
            this.ribbons.set(wheelId, ribbon);
        }

        this._tmpForward.set(Math.sin(rotation), 0, Math.cos(rotation));

        const driftWidth = THREE.MathUtils.lerp(0.06, 0.18, THREE.MathUtils.clamp(intensity, 0, 1));
        const finalWidth = Math.max(width, driftWidth);

        ribbon.addPoint(position, this._tmpForward, finalWidth);
    }

    update(): void {
        const dt = this.clock.getDelta();
        for (const ribbon of this.ribbons.values()) {
            ribbon.update(dt);
        }
    }

    dispose(): void {
        for (const ribbon of this.ribbons.values()) {
            this.scene.remove(ribbon.mesh);
            ribbon.dispose();
        }
        this.ribbons.clear();
        this.trackMaterial.dispose();
        this.grassMaterial.dispose();
    }

    setTrailColor(color: THREE.Color | number): void {
        if (color instanceof THREE.Color) {
            this.trailColor = color;
        } else {
            this.trailColor = new THREE.Color(color);
        }
    }

    private isOnTrackSurface(position: THREE.Vector3): boolean {
        if (this.trackObjects.length === 0) return true;

        this._tmpRayOrigin.set(position.x, position.y + 1, position.z);
        this.raycaster.set(this._tmpRayOrigin, this._downDir);

        const intersects = this.raycaster.intersectObjects(this.trackObjects, true);
        return intersects.length > 0;
    }
}
