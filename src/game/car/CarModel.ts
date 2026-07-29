import * as THREE from "three";

export const WHEEL_RADIUS = 0.28;
export const WHEEL_WIDTH = 0.22;
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

const BODY_WIDTH = 0.78;
const BODY_HALF = BODY_WIDTH / 2 + 0.035;
const ROOF_Y = 0.78;

const BODY_COLOR = 0xdc2f26;
const BODY_DARK = 0x8f1a15;
const ACCENT_COLOR = 0xffc531;

export class CarModel {
    readonly chassis: THREE.Group;

    private readonly wheelPivots: THREE.Group[] = [];
    private readonly wheelSpinners: THREE.Group[] = [];

    private readonly geometries: THREE.BufferGeometry[] = [];
    private readonly materials: THREE.Material[] = [];
    private readonly textures: THREE.Texture[] = [];

    private brakeMaterial!: THREE.MeshStandardMaterial;
    private reverseMaterial!: THREE.MeshStandardMaterial;
    private headlightMaterial!: THREE.MeshStandardMaterial;
    private readonly boostFlames: THREE.Mesh[] = [];

    private steeringAngle = 0;

    constructor(root: THREE.Group) {
        this.chassis = new THREE.Group();
        root.add(this.chassis);

        this.buildShell();
        this.buildGlass();
        this.buildRunningGear();
        this.buildAero();
        this.buildLights();
        this.buildDetails();
        this.buildWheels(root);
    }

    private track<T extends THREE.BufferGeometry>(geometry: T): T {
        this.geometries.push(geometry);
        return geometry;
    }

    private material<T extends THREE.Material>(material: T): T {
        this.materials.push(material);
        return material;
    }

    private buildShell(): void {
        const paint = this.material(new THREE.MeshPhysicalMaterial({
            color: BODY_COLOR,
            roughness: 0.26,
            metalness: 0.3,
            clearcoat: 1,
            clearcoatRoughness: 0.1,
        }));

        // Side silhouette in (length, height), extruded across the width.
        const profile = new THREE.Shape();
        profile.moveTo(1.0, 0.16);
        profile.lineTo(1.0, 0.32);
        profile.quadraticCurveTo(0.98, 0.44, 0.84, 0.45);
        profile.lineTo(0.36, 0.5);
        profile.quadraticCurveTo(0.26, 0.74, 0.12, ROOF_Y);
        profile.lineTo(-0.26, ROOF_Y);
        profile.quadraticCurveTo(-0.42, 0.72, -0.5, 0.48);
        profile.lineTo(-0.9, 0.45);
        profile.quadraticCurveTo(-1.0, 0.44, -1.01, 0.3);
        profile.lineTo(-1.0, 0.16);
        profile.closePath();

        const geometry = this.track(new THREE.ExtrudeGeometry(profile, {
            depth: BODY_WIDTH,
            bevelEnabled: true,
            bevelThickness: 0.035,
            bevelSize: 0.035,
            bevelSegments: 3,
            curveSegments: 10,
        }));
        geometry.translate(0, 0, -BODY_WIDTH / 2);
        geometry.rotateY(-Math.PI / 2);

        const shell = new THREE.Mesh(geometry, paint);
        shell.castShadow = true;
        shell.receiveShadow = true;
        this.chassis.add(shell);

        // Dark sill under the body, filling the gap down to the wheel centres.
        const sillGeometry = this.track(new THREE.BoxGeometry(0.78, 0.1, 1.86));
        const sillMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0x131418, roughness: 0.85 }));
        const sill = new THREE.Mesh(sillGeometry, sillMaterial);
        sill.position.y = 0.13;
        sill.castShadow = true;
        this.chassis.add(sill);

        const stripeMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0xf4f2ea,
            roughness: 0.35,
            metalness: 0.1,
        }));

        // Racing stripe running nose to tail, following the body line in three segments.
        const stripeSegments: readonly [number, number, number, number][] = [
            [0.62, 0.475, 0.46, -0.03],
            [0.0, ROOF_Y + 0.038, 0.38, 0],
            [-0.7, 0.482, 0.42, 0.02],
        ];
        for (const [z, y, length, tilt] of stripeSegments) {
            const stripe = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.18, 0.012, length)), stripeMaterial);
            stripe.position.set(0, y, z);
            stripe.rotation.x = tilt;
            this.chassis.add(stripe);
        }

        const doorTexture = createNumberTexture();
        this.textures.push(doorTexture);
        const doorMaterial = this.material(new THREE.MeshStandardMaterial({
            map: doorTexture,
            transparent: true,
            roughness: 0.45,
            metalness: 0.05,
        }));
        const doorGeometry = this.track(new THREE.PlaneGeometry(0.4, 0.3));
        for (const side of [1, -1]) {
            const decal = new THREE.Mesh(doorGeometry, doorMaterial);
            decal.position.set(side * (BODY_HALF + 0.004), 0.42, -0.06);
            decal.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
            this.chassis.add(decal);
        }
    }

    private buildGlass(): void {
        const glass = this.material(new THREE.MeshPhysicalMaterial({
            color: 0x101c26,
            roughness: 0.05,
            metalness: 0.2,
            transparent: true,
            opacity: 0.68,
            clearcoat: 1,
            clearcoatRoughness: 0.03,
            side: THREE.DoubleSide,
        }));

        const windscreen = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.7, 0.36)), glass);
        windscreen.position.set(0, 0.64, 0.245);
        windscreen.rotation.x = -0.62;
        this.chassis.add(windscreen);

        const rearScreen = new THREE.Mesh(this.track(new THREE.PlaneGeometry(0.7, 0.34)), glass);
        rearScreen.position.set(0, 0.63, -0.38);
        rearScreen.rotation.x = 0.71;
        this.chassis.add(rearScreen);

        const sideGlass = this.track(new THREE.PlaneGeometry(0.52, 0.2));
        for (const side of [1, -1]) {
            const window = new THREE.Mesh(sideGlass, glass);
            window.position.set(side * (BODY_HALF - 0.012), 0.655, -0.06);
            window.rotation.y = side > 0 ? Math.PI / 2 : -Math.PI / 2;
            this.chassis.add(window);
        }
    }

    /** No mudguards: the wheels stay proud of the body, which is what sells the toy-racer stance. */
    private buildRunningGear(): void {
        const darkMetal = this.material(new THREE.MeshStandardMaterial({ color: 0x1b1c20, roughness: 0.6, metalness: 0.35 }));

        const skirtGeometry = this.track(new THREE.BoxGeometry(0.07, 0.1, 0.82));
        for (const side of [1, -1]) {
            const skirt = new THREE.Mesh(skirtGeometry, darkMetal);
            skirt.position.set(side * (BODY_HALF - 0.01), 0.15, 0);
            skirt.castShadow = true;
            this.chassis.add(skirt);
        }

        // Stub axles bridging the sill to each hub so the wheels do not look detached.
        const armLength = TRACK_HALF_WIDTH - BODY_HALF + 0.12;
        const armGeometry = this.track(new THREE.BoxGeometry(armLength, 0.07, 0.11));
        for (const wheel of WHEEL_POSITIONS) {
            const arm = new THREE.Mesh(armGeometry, darkMetal);
            arm.position.set(
                Math.sign(wheel.x) * (BODY_HALF + armLength / 2 - 0.06),
                WHEEL_RADIUS,
                wheel.z,
            );
            arm.castShadow = true;
            this.chassis.add(arm);
        }

        // A flared lip on the body where an arch would be, hinting at the wheel opening.
        const flareMaterial = this.material(new THREE.MeshPhysicalMaterial({
            color: BODY_DARK,
            roughness: 0.34,
            metalness: 0.3,
            clearcoat: 0.6,
        }));
        const flareGeometry = this.track(new THREE.BoxGeometry(0.05, 0.1, 0.56));
        for (const wheel of WHEEL_POSITIONS) {
            const flare = new THREE.Mesh(flareGeometry, flareMaterial);
            flare.position.set(Math.sign(wheel.x) * (BODY_HALF + 0.012), 0.42, wheel.z * 0.82);
            flare.rotation.x = wheel.front ? -0.05 : 0.05;
            flare.castShadow = true;
            this.chassis.add(flare);
        }
    }

    private buildAero(): void {
        const carbon = this.material(new THREE.MeshStandardMaterial({ color: 0x17181c, roughness: 0.4, metalness: 0.5 }));
        const accent = this.material(new THREE.MeshStandardMaterial({ color: ACCENT_COLOR, roughness: 0.3, metalness: 0.35 }));

        const wing = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.92, 0.04, 0.24)), carbon);
        wing.position.set(0, 0.71, -1.0);
        wing.rotation.x = -0.18;
        wing.castShadow = true;
        this.chassis.add(wing);

        const endplateGeometry = this.track(new THREE.BoxGeometry(0.03, 0.1, 0.22));
        for (const side of [1, -1]) {
            const plate = new THREE.Mesh(endplateGeometry, accent);
            plate.position.set(side * 0.45, 0.72, -1.0);
            plate.castShadow = true;
            this.chassis.add(plate);
        }

        const strutGeometry = this.track(new THREE.BoxGeometry(0.045, 0.24, 0.05));
        for (const side of [1, -1]) {
            const strut = new THREE.Mesh(strutGeometry, carbon);
            strut.position.set(side * 0.26, 0.58, -0.94);
            strut.rotation.x = -0.18;
            this.chassis.add(strut);
        }

        const splitter = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.92, 0.03, 0.22)), carbon);
        splitter.position.set(0, 0.13, 1.0);
        splitter.castShadow = true;
        this.chassis.add(splitter);

        const diffuser = new THREE.Mesh(this.track(new THREE.BoxGeometry(0.76, 0.12, 0.18)), carbon);
        diffuser.position.set(0, 0.16, -1.0);
        diffuser.rotation.x = 0.25;
        this.chassis.add(diffuser);
    }

    private buildLights(): void {
        const chrome = this.material(new THREE.MeshStandardMaterial({ color: 0xbcc2c9, roughness: 0.16, metalness: 0.95 }));

        this.headlightMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0xfff6dd,
            emissive: 0xfff0c4,
            emissiveIntensity: 1.5,
            roughness: 0.12,
        }));

        const housing = this.track(new THREE.CylinderGeometry(0.1, 0.1, 0.06, 14));
        housing.rotateX(Math.PI / 2);
        const lens = this.track(new THREE.CircleGeometry(0.082, 14));

        for (const side of [1, -1]) {
            const shell = new THREE.Mesh(housing, chrome);
            shell.position.set(side * 0.24, 0.38, 1.0);
            this.chassis.add(shell);

            const light = new THREE.Mesh(lens, this.headlightMaterial);
            light.position.set(side * 0.24, 0.38, 1.035);
            this.chassis.add(light);
        }

        this.brakeMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0x2a0505,
            emissive: 0xff2214,
            emissiveIntensity: 0.6,
            roughness: 0.28,
        }));
        const tailLight = this.track(new THREE.BoxGeometry(0.2, 0.08, 0.05));
        for (const side of [1, -1]) {
            const light = new THREE.Mesh(tailLight, this.brakeMaterial);
            light.position.set(side * 0.27, 0.38, -1.03);
            this.chassis.add(light);
        }

        this.reverseMaterial = this.material(new THREE.MeshStandardMaterial({
            color: 0x1b1b1b,
            emissive: 0xffffff,
            emissiveIntensity: 0,
            roughness: 0.28,
        }));
        const reverseLight = this.track(new THREE.BoxGeometry(0.09, 0.06, 0.05));
        for (const side of [1, -1]) {
            const light = new THREE.Mesh(reverseLight, this.reverseMaterial);
            light.position.set(side * 0.1, 0.38, -1.03);
            this.chassis.add(light);
        }
    }

    private buildDetails(): void {
        const metal = this.material(new THREE.MeshStandardMaterial({ color: 0x939aa1, roughness: 0.22, metalness: 0.92 }));
        const pipe = this.track(new THREE.CylinderGeometry(0.048, 0.056, 0.14, 10));
        pipe.rotateX(Math.PI / 2);

        const flameMaterial = this.material(new THREE.MeshBasicMaterial({
            color: 0xffb347,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        }));
        const flameGeometry = this.track(new THREE.ConeGeometry(0.075, 0.38, 8, 1, true));
        flameGeometry.rotateX(Math.PI / 2);

        for (const side of [1, -1]) {
            const exhaust = new THREE.Mesh(pipe, metal);
            exhaust.position.set(side * 0.2, 0.19, -1.04);
            this.chassis.add(exhaust);

            const flame = new THREE.Mesh(flameGeometry, flameMaterial);
            flame.position.set(side * 0.2, 0.19, -1.28);
            flame.visible = false;
            this.chassis.add(flame);
            this.boostFlames.push(flame);
        }

        const scoop = new THREE.Mesh(
            this.track(new THREE.BoxGeometry(0.26, 0.07, 0.2)),
            this.material(new THREE.MeshStandardMaterial({ color: 0x0f1013, roughness: 0.55 })),
        );
        scoop.position.set(0, 0.5, 0.62);
        scoop.rotation.x = -0.04;
        scoop.castShadow = true;
        this.chassis.add(scoop);

        const mirrorGeometry = this.track(new THREE.BoxGeometry(0.08, 0.05, 0.035));
        const mirrorMaterial = this.material(new THREE.MeshStandardMaterial({ color: BODY_DARK, roughness: 0.28, metalness: 0.4 }));
        for (const side of [1, -1]) {
            const mirror = new THREE.Mesh(mirrorGeometry, mirrorMaterial);
            mirror.position.set(side * (BODY_HALF + 0.03), 0.58, 0.26);
            this.chassis.add(mirror);
        }
    }

    private buildWheels(root: THREE.Group): void {
        const tire = this.track(new THREE.CylinderGeometry(WHEEL_RADIUS, WHEEL_RADIUS, WHEEL_WIDTH, 20));
        tire.rotateZ(Math.PI / 2);
        const tireMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0x16171a, roughness: 0.95, metalness: 0.02 }));

        const shoulder = this.track(new THREE.TorusGeometry(WHEEL_RADIUS - 0.025, 0.03, 6, 18));
        shoulder.rotateY(Math.PI / 2);

        const rim = this.track(new THREE.CylinderGeometry(WHEEL_RADIUS * 0.6, WHEEL_RADIUS * 0.6, WHEEL_WIDTH + 0.012, 14));
        rim.rotateZ(Math.PI / 2);
        const rimMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0xd4d9df, roughness: 0.18, metalness: 0.94 }));

        const hub = this.track(new THREE.CylinderGeometry(WHEEL_RADIUS * 0.18, WHEEL_RADIUS * 0.18, WHEEL_WIDTH + 0.03, 10));
        hub.rotateZ(Math.PI / 2);
        const hubMaterial = this.material(new THREE.MeshStandardMaterial({ color: ACCENT_COLOR, roughness: 0.28, metalness: 0.6 }));

        const spoke = this.track(new THREE.BoxGeometry(WHEEL_WIDTH - 0.02, WHEEL_RADIUS * 0.9, 0.04));
        const spokeMaterial = this.material(new THREE.MeshStandardMaterial({ color: 0xe8ebee, roughness: 0.2, metalness: 0.88 }));

        for (const definition of WHEEL_POSITIONS) {
            const pivot = new THREE.Group();
            pivot.position.set(definition.x, WHEEL_RADIUS, definition.z);
            root.add(pivot);

            const spinner = new THREE.Group();
            pivot.add(spinner);

            const tireMesh = new THREE.Mesh(tire, tireMaterial);
            tireMesh.castShadow = true;
            tireMesh.receiveShadow = true;
            spinner.add(tireMesh);

            for (const side of [1, -1]) {
                const shoulderMesh = new THREE.Mesh(shoulder, tireMaterial);
                shoulderMesh.position.x = side * (WHEEL_WIDTH / 2 - 0.015);
                spinner.add(shoulderMesh);
            }

            spinner.add(new THREE.Mesh(rim, rimMaterial));
            spinner.add(new THREE.Mesh(hub, hubMaterial));

            for (let s = 0; s < 5; s++) {
                const spokeMesh = new THREE.Mesh(spoke, spokeMaterial);
                spokeMesh.rotation.x = (s / 5) * Math.PI;
                spinner.add(spokeMesh);
            }

            this.wheelPivots.push(pivot);
            this.wheelSpinners.push(spinner);
        }
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
        const rotation = distance / WHEEL_RADIUS;
        for (const spinner of this.wheelSpinners) {
            spinner.rotation.x += rotation;
        }
    }

    /** Per-wheel vertical travel in metres. */
    public setSuspension(compression: readonly number[]): void {
        for (let i = 0; i < this.wheelPivots.length; i++) {
            this.wheelPivots[i].position.y = WHEEL_RADIUS + (compression[i] ?? 0);
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
        for (let i = 0; i < this.boostFlames.length; i++) {
            const flame = this.boostFlames[i];
            flame.visible = active;
            if (!active) continue;

            const flicker = 0.75 + Math.sin(elapsed * 42 + i * 2.1) * 0.25;
            (flame.material as THREE.MeshBasicMaterial).opacity = amount * 0.85 * flicker;
            flame.scale.set(1, 1, 0.6 + amount * flicker * 0.9);
        }
    }

    public dispose(): void {
        this.geometries.forEach((geometry) => geometry.dispose());
        this.materials.forEach((material) => material.dispose());
        this.textures.forEach((texture) => texture.dispose());
        this.wheelPivots.length = 0;
        this.wheelSpinners.length = 0;
        this.boostFlames.length = 0;
    }
}

function createNumberTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = Math.round(size * 0.75);
    const ctx = canvas.getContext("2d")!;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    ctx.fillStyle = "#f5f3ec";
    ctx.beginPath();
    ctx.arc(canvas.width / 2, canvas.height / 2, canvas.height * 0.4, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = "#15171a";
    ctx.lineWidth = 8;
    ctx.stroke();

    ctx.fillStyle = "#15171a";
    ctx.font = "bold 104px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("7", canvas.width / 2, canvas.height / 2 + 6);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}
