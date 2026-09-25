import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export const WHEEL_RADIUS = 0.28;
export const WHEEL_BASE = 0.68;
/** Deliberately wider than the body — the exposed stance is what makes it read as a toy racer. */
export const TRACK_HALF_WIDTH = 0.58;

/** Front-right, front-left, rear-right, rear-left. Order is fixed — the controller relies on it. */
export const WHEEL_POSITIONS: readonly { x: number; z: number; front: boolean }[] = [
    { x: TRACK_HALF_WIDTH, z: WHEEL_BASE, front: true },
    { x: -TRACK_HALF_WIDTH, z: WHEEL_BASE, front: true },
    { x: TRACK_HALF_WIDTH, z: -WHEEL_BASE, front: false },
    { x: -TRACK_HALF_WIDTH, z: -WHEEL_BASE, front: false },
];

export type BodyStyle = "coupe" | "hatch" | "pickup";

export interface CarLivery {
    style: BodyStyle;
    body: number;
    /** Secondary body colour: arches and mirrors. */
    trim: number;
    /** Wing endplates, hubs and roll bars. */
    accent: number;
    stripe: number;
    number: string;
}

export const DEFAULT_LIVERY: CarLivery = {
    style: "coupe",
    body: 0xdc2f26,
    trim: 0x8f1a15,
    accent: 0xffc531,
    stripe: 0xf4f2ea,
    number: "7",
};

const BODY_WIDTH = 0.78;
const BODY_BEVEL = 0.035;
const BODY_HALF = BODY_WIDTH / 2 + BODY_BEVEL;

const DARK = 0x131418;
const CARBON = 0x1a1b1f;
const CHROME = 0xc9ced4;
const RUBBER = 0x1b1c1f;
const SIDEWALL = 0x2a2b30;
const RIM = 0xdfe3e8;

type Profile = readonly (readonly [number, number] | readonly [number, number, number, number])[];

interface StyleSpec {
    /** Side silhouette of the painted lower body, (length, height); 4-tuples are quadratic curves. */
    body: Profile;
    /** Side silhouette of the glasshouse, extruded narrower than the body. */
    cabin: Profile;
    cabinHalfWidth: number;
    roof: { y: number; front: number; back: number };
    wheelRadius: number;
    wheelWidth: number;
    sillY: number;
    headlight: { x: number; y: number; z: number };
    taillight: { x: number; y: number; z: number };
    exhaust: { y: number; z: number };
    decalY: number;
}

const STYLES: Record<BodyStyle, StyleSpec> = {
    coupe: {
        body: [
            [1.0, 0.16], [1.0, 0.32], [0.98, 0.44, 0.84, 0.45], [0.4, 0.49],
            [-0.52, 0.49], [-0.9, 0.45], [-1.0, 0.44, -1.01, 0.3], [-1.0, 0.16],
        ],
        cabin: [[0.42, 0.46], [0.3, 0.66, 0.13, 0.76], [-0.27, 0.76], [-0.45, 0.7, -0.56, 0.46]],
        cabinHalfWidth: 0.33,
        roof: { y: 0.775, front: 0.15, back: -0.29 },
        wheelRadius: WHEEL_RADIUS,
        wheelWidth: 0.22,
        sillY: 0.13,
        headlight: { x: 0.24, y: 0.36, z: 1.02 },
        taillight: { x: 0.27, y: 0.38, z: -1.04 },
        exhaust: { y: 0.19, z: -1.06 },
        decalY: 0.33,
    },
    hatch: {
        body: [
            [0.96, 0.16], [0.97, 0.36], [0.96, 0.47, 0.8, 0.48], [0.44, 0.52],
            [-0.84, 0.54], [-0.95, 0.54, -0.96, 0.42], [-0.95, 0.16],
        ],
        cabin: [[0.46, 0.5], [0.32, 0.72, 0.16, 0.84], [-0.72, 0.85], [-0.85, 0.84, -0.88, 0.5]],
        cabinHalfWidth: 0.35,
        roof: { y: 0.865, front: 0.17, back: -0.74 },
        wheelRadius: WHEEL_RADIUS,
        wheelWidth: 0.22,
        sillY: 0.13,
        headlight: { x: 0.28, y: 0.38, z: 0.99 },
        taillight: { x: 0.3, y: 0.44, z: -0.99 },
        exhaust: { y: 0.19, z: -1.0 },
        decalY: 0.35,
    },
    pickup: {
        body: [
            [1.0, 0.24], [1.01, 0.5], [1.0, 0.6, 0.9, 0.62], [0.34, 0.64],
            [-1.0, 0.64], [-1.02, 0.24],
        ],
        cabin: [[0.36, 0.62], [0.28, 0.8, 0.16, 0.96], [-0.28, 0.96], [-0.34, 0.62]],
        cabinHalfWidth: 0.36,
        roof: { y: 0.975, front: 0.18, back: -0.3 },
        wheelRadius: 0.33,
        wheelWidth: 0.26,
        sillY: 0.2,
        headlight: { x: 0.27, y: 0.5, z: 1.04 },
        taillight: { x: 0.3, y: 0.52, z: -1.06 },
        exhaust: { y: 0.24, z: -1.07 },
        decalY: 0.44,
    },
};

/** Collects vertex-coloured parts that share a material so they merge into a single draw call. */
class PartBatch {
    private readonly parts: THREE.BufferGeometry[] = [];
    private readonly color = new THREE.Color();
    private readonly matrix = new THREE.Matrix4();
    private readonly euler = new THREE.Euler();

    public add(source: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0): void {
        const geometry = source.index ? source.toNonIndexed() : source;
        if (geometry !== source) source.dispose();
        geometry.deleteAttribute("uv");

        this.euler.set(rx, ry, rz);
        this.matrix.makeRotationFromEuler(this.euler).setPosition(x, y, z);
        geometry.applyMatrix4(this.matrix);

        this.color.set(color);
        const count = geometry.getAttribute("position").count;
        const colors = new Float32Array(count * 3);
        for (let i = 0; i < count; i++) {
            colors[i * 3] = this.color.r;
            colors[i * 3 + 1] = this.color.g;
            colors[i * 3 + 2] = this.color.b;
        }
        geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        this.parts.push(geometry);
    }

    public build(): THREE.BufferGeometry | null {
        if (this.parts.length === 0) return null;
        const merged = mergeGeometries(this.parts, false);
        this.parts.forEach((part) => part.dispose());
        this.parts.length = 0;
        return merged;
    }
}

export class CarModel {
    readonly chassis: THREE.Group;
    /** Soft contact shadow; the controller keeps it glued to the ground. */
    readonly blobShadow: THREE.Mesh;

    private readonly livery: CarLivery;
    private readonly style: StyleSpec;
    private readonly wheelPivots: THREE.Group[] = [];
    private readonly wheelSpinners: THREE.Group[] = [];

    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly materials: THREE.Material[] = [];
    private readonly textures: THREE.Texture[] = [];

    private readonly matte = new PartBatch();
    private readonly gloss = new PartBatch();
    private readonly metal = new PartBatch();

    private brakeMaterial!: THREE.MeshStandardMaterial;
    private reverseMaterial!: THREE.MeshStandardMaterial;
    private headlightMaterial!: THREE.MeshStandardMaterial;
    private flameMaterial!: THREE.MeshBasicMaterial;
    private flames!: THREE.Mesh;

    private steeringAngle = 0;

    constructor(root: THREE.Group, livery: CarLivery = DEFAULT_LIVERY) {
        this.livery = livery;
        this.style = STYLES[livery.style];

        this.chassis = new THREE.Group();
        root.add(this.chassis);

        this.buildShell();
        this.buildRunningGear();
        this.buildStyleExtras();
        this.buildLights();
        this.flushBatches();
        this.buildWheels(root);
        this.blobShadow = this.buildBlobShadow();
    }

    private track<T extends THREE.BufferGeometry>(geometry: T): T {
        this.geometries.push(geometry);
        return geometry;
    }

    private material<T extends THREE.Material>(material: T): T {
        this.materials.push(material);
        return material;
    }

    private mesh(geometry: THREE.BufferGeometry, material: THREE.Material, castShadow = true): THREE.Mesh {
        const mesh = new THREE.Mesh(this.track(geometry), material);
        mesh.castShadow = castShadow;
        mesh.receiveShadow = castShadow;
        this.chassis.add(mesh);
        return mesh;
    }

    private buildShell(): void {
        const { livery, style } = this;

        const paint = this.material(new THREE.MeshPhysicalMaterial({
            color: livery.body,
            roughness: 0.3,
            metalness: 0.12,
            clearcoat: 1,
            clearcoatRoughness: 0.06,
        }));
        this.mesh(extrudeProfile(style.body, BODY_WIDTH, BODY_BEVEL), paint);

        // Opaque tinted glass: reads as windows from the chase camera and never needs sorting.
        const glass = this.material(new THREE.MeshPhysicalMaterial({
            color: 0x0e1a24,
            roughness: 0.06,
            metalness: 0.2,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
        }));
        this.mesh(extrudeProfile(style.cabin, style.cabinHalfWidth * 2 - 0.04, 0.02), glass);

        const roofLength = style.roof.front - style.roof.back;
        const roofZ = (style.roof.front + style.roof.back) / 2;
        const roof = this.track(new THREE.BoxGeometry(style.cabinHalfWidth * 2 + 0.04, 0.045, roofLength + 0.04));
        const roofMesh = new THREE.Mesh(roof, paint);
        roofMesh.position.set(0, style.roof.y, roofZ);
        roofMesh.castShadow = true;
        this.chassis.add(roofMesh);

        // Twin racing stripes over the roof: the view is mostly from above, so that is where livery counts.
        const stripeTop = style.roof.y + 0.0235;
        for (const side of [-1, 1]) {
            this.gloss.add(new THREE.BoxGeometry(0.1, 0.008, roofLength + 0.04), livery.stripe, side * 0.11, stripeTop, roofZ);
        }

        const numberTexture = createNumberTexture(livery);
        this.textures.push(numberTexture);
        const decalMaterial = this.material(new THREE.MeshStandardMaterial({
            map: numberTexture,
            transparent: true,
            roughness: 0.4,
            metalness: 0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
        }));

        const roofDecal = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.46, 0.46)), decalMaterial);
        roofDecal.position.set(0, stripeTop + 0.006, roofZ);
        roofDecal.rotation.set(-Math.PI / 2, 0, 0);
        this.chassis.add(roofDecal);

        const doorGeometry = this.track(new THREE.PlaneGeometry(0.34, 0.34));
        for (const side of [1, -1]) {
            const decal = new THREE.Mesh(doorGeometry, decalMaterial);
            decal.position.set(side * (BODY_HALF + 0.004), style.decalY, -0.08);
            decal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
            this.chassis.add(decal);
        }
    }

    /** No mudguards: the wheels stay proud of the body, which is what sells the toy-racer stance. */
    private buildRunningGear(): void {
        const { style, livery } = this;

        this.matte.add(new THREE.BoxGeometry(BODY_WIDTH, 0.1, 1.86), DARK, 0, style.sillY, 0);

        for (const side of [1, -1]) {
            this.matte.add(new THREE.BoxGeometry(0.07, 0.1, 0.82), CARBON, side * (BODY_HALF - 0.01), style.sillY + 0.02, 0);
        }

        // Stub axles bridging the sill to each hub so the wheels do not look detached.
        const armLength = TRACK_HALF_WIDTH - BODY_HALF + 0.12;
        for (const wheel of WHEEL_POSITIONS) {
            this.matte.add(
                new THREE.BoxGeometry(armLength, 0.07, 0.11),
                CARBON,
                Math.sign(wheel.x) * (BODY_HALF + armLength / 2 - 0.06),
                style.wheelRadius,
                wheel.z,
            );
        }

        // Flared lip where an arch would be, hinting at the wheel opening.
        const pickup = livery.style === "pickup";
        for (const wheel of WHEEL_POSITIONS) {
            this.gloss.add(
                new THREE.BoxGeometry(0.06, pickup ? 0.09 : 0.1, pickup ? 0.66 : 0.56),
                pickup ? CARBON : livery.trim,
                Math.sign(wheel.x) * (BODY_HALF + 0.014),
                pickup ? 0.58 : 0.42,
                wheel.z * 0.84,
                wheel.front ? -0.05 : 0.05,
            );
        }

        for (const side of [1, -1]) {
            this.gloss.add(new THREE.BoxGeometry(0.08, 0.05, 0.035), livery.trim, side * (BODY_HALF + 0.03), style.roof.y - 0.2, style.cabin[0][0] - 0.12);
        }

        this.matte.add(new THREE.BoxGeometry(0.92, 0.03, 0.22), CARBON, 0, style.sillY, 1.0);
    }

    private buildStyleExtras(): void {
        const { livery } = this;

        if (livery.style === "coupe") {
            this.matte.add(new THREE.BoxGeometry(0.92, 0.04, 0.24), CARBON, 0, 0.71, -1.0, -0.18);
            for (const side of [1, -1]) {
                this.gloss.add(new THREE.BoxGeometry(0.03, 0.11, 0.24), livery.accent, side * 0.46, 0.72, -1.0);
                this.matte.add(new THREE.BoxGeometry(0.045, 0.24, 0.05), CARBON, side * 0.26, 0.58, -0.94, -0.18);
            }
            this.matte.add(new THREE.BoxGeometry(0.76, 0.12, 0.18), CARBON, 0, 0.16, -1.0, 0.25);
            this.addHoodStripes(0.49, 0.62, 0.46, 0.09);
            this.addHoodStripes(0.48, -0.71, 0.36, -0.1);
        } else if (livery.style === "hatch") {
            this.gloss.add(new THREE.BoxGeometry(0.74, 0.035, 0.2), livery.accent, 0, this.style.roof.y + 0.03, -0.8, -0.28);
            for (const side of [1, -1]) {
                this.matte.add(new THREE.BoxGeometry(0.2, 0.18, 0.02), CARBON, side * TRACK_HALF_WIDTH, 0.14, -0.98);
            }
            this.addHoodStripes(0.515, 0.62, 0.34, 0.1);
        } else {
            // Roll bar behind the cab and a chrome bull bar up front.
            for (const side of [1, -1]) {
                this.gloss.add(new THREE.CylinderGeometry(0.032, 0.032, 0.3, 8), livery.accent, side * 0.3, 0.83, -0.42);
                this.metal.add(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8), CHROME, side * 0.3, 0.42, 1.08);
            }
            this.gloss.add(new THREE.CylinderGeometry(0.032, 0.032, 0.66, 8), livery.accent, 0, 0.98, -0.42, 0, 0, Math.PI / 2);
            this.metal.add(new THREE.CylinderGeometry(0.035, 0.035, 0.8, 8), CHROME, 0, 0.52, 1.1, 0, 0, Math.PI / 2);
            this.metal.add(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), CHROME, 0, 0.34, 1.1, 0, 0, Math.PI / 2);
            this.matte.add(new THREE.BoxGeometry(0.66, 0.02, 0.6), 0x26272b, 0, 0.676, -0.68);
            this.addHoodStripes(0.66, 0.62, 0.5, 0.03);
        }
    }

    private addHoodStripes(y: number, z: number, length: number, tilt: number): void {
        for (const side of [-1, 1]) {
            this.gloss.add(new THREE.BoxGeometry(0.1, 0.012, length), this.livery.stripe, side * 0.11, y + BODY_BEVEL, z, tilt);
        }
    }

    private buildLights(): void {
        const { style } = this;

        this.headlightMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0xfff6dd,
            emissive: 0xfff0c4,
            emissiveIntensity: 1.5,
            roughness: 0.12,
        }));
        this.brakeMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0x2a0505,
            emissive: 0xff2214,
            emissiveIntensity: 0.6,
            roughness: 0.28,
        }));
        this.reverseMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0x1b1b1b,
            emissive: 0xffffff,
            emissiveIntensity: 0,
            roughness: 0.28,
        }));

        const lenses: THREE.BufferGeometry[] = [];
        const tails: THREE.BufferGeometry[] = [];
        const reverses: THREE.BufferGeometry[] = [];
        const { headlight, taillight, exhaust } = style;

        for (const side of [1, -1]) {
            this.metal.add(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14), CHROME, side * headlight.x, headlight.y, headlight.z, Math.PI / 2);
            lenses.push(new THREE.CircleGeometry(0.082, 14).translate(side * headlight.x, headlight.y, headlight.z + 0.032));

            tails.push(new THREE.BoxGeometry(0.2, 0.08, 0.05).translate(side * taillight.x, taillight.y, taillight.z));
            reverses.push(new THREE.BoxGeometry(0.09, 0.06, 0.05).translate(side * 0.1, taillight.y, taillight.z));

            this.metal.add(new THREE.CylinderGeometry(0.048, 0.056, 0.14, 10), CHROME, side * 0.2, exhaust.y, exhaust.z, Math.PI / 2);
        }

        if (this.livery.style === "pickup") {
            for (const x of [-0.18, 0, 0.18]) {
                this.matte.add(new THREE.BoxGeometry(0.12, 0.08, 0.06), CARBON, x, style.roof.y + 0.06, style.roof.front - 0.04);
                lenses.push(new THREE.CircleGeometry(0.04, 10).translate(x, style.roof.y + 0.06, style.roof.front - 0.009));
            }
        }

        this.mesh(mergeOwned(lenses), this.headlightMaterial, false);
        this.mesh(mergeOwned(tails), this.brakeMaterial, false);
        this.mesh(mergeOwned(reverses), this.reverseMaterial, false);

        this.flameMaterial = this.material(new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        const flameParts = [1, -1].map((side) =>
            new THREE.ConeGeometry(0.075, 0.38, 8, 1, true).rotateX(-Math.PI / 2).translate(side * 0.2, 0, -0.19),
        );
        this.flames = this.mesh(mergeOwned(flameParts), this.flameMaterial, false);
        this.flames.position.set(0, exhaust.y, exhaust.z - 0.07);
        this.flames.visible = false;
    }

    private flushBatches(): void {
        const matte = this.material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.1 }));
        const gloss = this.material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.28, metalness: 0.08 }));
        const metal = this.material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.9 }));

        const pairs: [PartBatch, THREE.Material][] = [[this.matte, matte], [this.gloss, gloss], [this.metal, metal]];
        for (const [batch, material] of pairs) {
            const geometry = batch.build();
            if (geometry) this.mesh(geometry, material);
        }
    }

    private buildWheels(root: THREE.Group): void {
        const radius = this.style.wheelRadius;
        const width = this.style.wheelWidth;

        const rubber = new PartBatch();
        rubber.add(new THREE.CylinderGeometry(radius, radius, width, 22), RUBBER, 0, 0, 0, 0, 0, Math.PI / 2);
        for (const side of [1, -1]) {
            rubber.add(new THREE.TorusGeometry(radius - 0.028, 0.032, 6, 22), SIDEWALL, side * (width / 2 - 0.016), 0, 0, 0, Math.PI / 2);
        }
        const rubberGeometry = this.track(rubber.build()!);

        const hub = new PartBatch();
        hub.add(new THREE.CylinderGeometry(radius * 0.62, radius * 0.62, width + 0.01, 16), RIM, 0, 0, 0, 0, 0, Math.PI / 2);
        hub.add(new THREE.CylinderGeometry(radius * 0.22, radius * 0.22, width + 0.05, 10), this.livery.accent, 0, 0, 0, 0, 0, Math.PI / 2);
        for (let s = 0; s < 5; s++) {
            hub.add(new THREE.BoxGeometry(width + 0.03, radius * 1.12, 0.05), 0xf4f6f8, 0, 0, 0, (s / 5) * Math.PI);
        }
        const hubGeometry = this.track(hub.build()!);

        const rubberMaterial = this.material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 }));
        const hubMaterial = this.material(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0.85 }));

        for (const definition of WHEEL_POSITIONS) {
            const pivot = new THREE.Group();
            pivot.position.set(definition.x, radius, definition.z);
            root.add(pivot);

            const spinner = new THREE.Group();
            pivot.add(spinner);

            const tire = new THREE.Mesh(rubberGeometry, rubberMaterial);
            tire.castShadow = true;
            tire.receiveShadow = true;
            spinner.add(tire);
            spinner.add(new THREE.Mesh(hubGeometry, hubMaterial));

            this.wheelPivots.push(pivot);
            this.wheelSpinners.push(spinner);
        }
    }

    private buildBlobShadow(): THREE.Mesh {
        const texture = createBlobTexture();
        this.textures.push(texture);

        const geometry = this.track(new THREE.PlaneGeometry(1.8, 2.7));
        geometry.rotateX(-Math.PI / 2);
        const material = this.material(new THREE.MeshBasicMaterial({
            map: texture,
            color: 0x000000,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            polygonOffset: true,
            polygonOffsetFactor: -3,
            polygonOffsetUnits: -3,
        }));

        const mesh = new THREE.Mesh(geometry, material);
        mesh.renderOrder = 5;
        mesh.name = "car-blob-shadow";
        return mesh;
    }

    public setSteering(angle: number): void {
        this.steeringAngle = angle;
        for (let i = 0; i < this.wheelPivots.length; i++) {
            if (WHEEL_POSITIONS[i].front) this.wheelPivots[i].rotation.y = angle;
        }
    }

    public getSteering(): number {
        return this.steeringAngle;
    }

    /** `distance` is metres travelled; converting through the radius keeps the spin honest. */
    public spinWheels(distance: number): void {
        const rotation = distance / this.style.wheelRadius;
        for (const spinner of this.wheelSpinners) {
            spinner.rotation.x += rotation;
        }
    }

    /** Per-wheel vertical travel in metres. */
    public setSuspension(compression: readonly number[]): void {
        for (let i = 0; i < this.wheelPivots.length; i++) {
            this.wheelPivots[i].position.y = this.style.wheelRadius + (compression[i] ?? 0);
        }
    }

    public setBrakeLights(intensity: number): void {
        this.brakeMaterial.emissiveIntensity = 0.55 + intensity * 3.2;
    }

    public setReverseLights(on: boolean): void {
        this.reverseMaterial.emissiveIntensity = on ? 2.2 : 0;
    }

    public setHeadlights(intensity: number): void {
        this.headlightMaterial.emissiveIntensity = intensity;
    }

    public setBoost(amount: number, elapsed: number): void {
        const active = amount > 0.01;
        this.flames.visible = active;
        if (!active) return;

        const flicker = 0.75 + Math.sin(elapsed * 42) * 0.25;
        this.flameMaterial.opacity = amount * 0.85 * flicker;
        this.flames.scale.set(1, 1, 0.6 + amount * flicker * 0.9);
    }

    public getLivery(): Readonly<CarLivery> {
        return this.livery;
    }

    public dispose(): void {
        this.geometries.forEach((geometry) => geometry.dispose());
        this.materials.forEach((material) => material.dispose());
        this.textures.forEach((texture) => texture.dispose());
        this.wheelPivots.length = 0;
        this.wheelSpinners.length = 0;
    }
}

function mergeOwned(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const normalized = parts.map((part) => {
        const flat = part.index ? part.toNonIndexed() : part;
        if (flat !== part) part.dispose();
        flat.deleteAttribute("uv");
        return flat;
    });
    const merged = mergeGeometries(normalized, false);
    normalized.forEach((part) => part.dispose());
    return merged;
}

/** Extrudes a side profile across the car's width, centred on the car's length axis. */
function extrudeProfile(profile: Profile, width: number, bevel: number): THREE.ExtrudeGeometry {
    const shape = new THREE.Shape();
    profile.forEach((point, index) => {
        if (index === 0) {
            shape.moveTo(point[0], point[1]);
        } else if (point.length === 4) {
            shape.quadraticCurveTo(point[0], point[1], point[2], point[3]);
        } else {
            shape.lineTo(point[0], point[1]);
        }
    });
    shape.closePath();

    const geometry = new THREE.ExtrudeGeometry(shape, {
        depth: width,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 3,
        curveSegments: 10,
    });
    geometry.translate(0, 0, -width / 2);
    geometry.rotateY(-Math.PI / 2);
    return geometry;
}

function createNumberTexture(livery: CarLivery): THREE.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#f7f5ee";
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.44, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = `#${new THREE.Color(livery.accent).getHexString()}`;
    ctx.lineWidth = 16;
    ctx.stroke();

    ctx.fillStyle = "#15171a";
    ctx.font = "150px Bungee, Impact, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(livery.number, size / 2, size / 2 + 10);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}

function createBlobTexture(): THREE.Texture {
    const size = 64;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.55, "rgba(255,255,255,0.6)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);

    return new THREE.CanvasTexture(canvas);
}
