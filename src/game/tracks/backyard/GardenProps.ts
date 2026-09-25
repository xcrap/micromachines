import * as THREE from "three";
import { Rng } from "../../core/Random";
import type { Terrain } from "../../map/Terrain";
import type { Obstacle, PlacementGrid } from "../../map/Scatter";
import { FENCE_HALF, HOSE_PATH, HOSE_RADIUS, MOLEHILLS, hoseBump, loopPoint } from "./GardenLayout";
import { StaticBatch, heightRamp, jitter, paint, transform, type BatchMaterial } from "./Shapes";

export interface GardenPropsResult {
    meshes: THREE.Mesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

interface Part {
    geometry: THREE.BufferGeometry;
    material: BatchMaterial;
}

/** The tap is screwed to the back fence, between its rails. */
const TAP_HEIGHT = 6;
const TAP_Z = -FENCE_HALF + 0.5;

function sphereNormals(geometry: THREE.BufferGeometry, center = new THREE.Vector3()): void {
    const position = geometry.getAttribute("position");
    const normals = new Float32Array(position.count * 3);
    const n = new THREE.Vector3();
    for (let i = 0; i < position.count; i++) {
        n.set(position.getX(i), position.getY(i), position.getZ(i)).sub(center).normalize();
        normals[i * 3] = n.x;
        normals[i * 3 + 1] = n.y;
        normals[i * 3 + 2] = n.z;
    }
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}

/**
 * Truncated-icosahedron panels by weighted nearest-centre: pentagons sit on the icosahedron's
 * vertices, hexagons on its face centres, and the weight matches their relative sizes.
 */
function buildFootball(radius: number): Part[] {
    const source = new THREE.IcosahedronGeometry(radius, 14);
    const phi = (1 + Math.sqrt(5)) / 2;
    const pentagons = [
        [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
        [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
        [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
    ].map(([x, y, z]) => new THREE.Vector3(x, y, z).normalize());

    const faces = new THREE.IcosahedronGeometry(1, 0);
    const facePosition = faces.getAttribute("position");
    const hexagons: THREE.Vector3[] = [];
    for (let i = 0; i < facePosition.count; i += 3) {
        const center = new THREE.Vector3();
        for (let k = 0; k < 3; k++) center.add(new THREE.Vector3(facePosition.getX(i + k), facePosition.getY(i + k), facePosition.getZ(i + k)));
        hexagons.push(center.normalize());
    }
    faces.dispose();

    const black = new THREE.Color(0x121215);
    const white = new THREE.Color(0xf6f6f2);
    const seam = new THREE.Color(0x9a9a96);
    const out = new THREE.Color();
    const dir = new THREE.Vector3();

    const geometry = paint(source, (x, y, z) => {
        dir.set(x, y, z).normalize();
        let pentagon = Infinity;
        for (const p of pentagons) pentagon = Math.min(pentagon, dir.angleTo(p));
        let hexA = Infinity;
        let hexB = Infinity;
        for (const h of hexagons) {
            const angle = dir.angleTo(h);
            if (angle < hexA) {
                hexB = hexA;
                hexA = angle;
            } else if (angle < hexB) {
                hexB = angle;
            }
        }
        const pentagonEdge = pentagon - hexA * 0.79;
        if (pentagonEdge < 0) return out.copy(black).lerp(seam, THREE.MathUtils.smoothstep(pentagonEdge, -0.02, 0) * 0.4);
        const hexSeam = 1 - THREE.MathUtils.smoothstep(hexB - hexA, 0.004, 0.022);
        return out.copy(white).lerp(seam, Math.max(hexSeam, 1 - THREE.MathUtils.smoothstep(pentagonEdge, 0, 0.02)) * 0.7);
    });
    sphereNormals(geometry);
    return [{ geometry, material: "gloss" }];
}

function buildTennisBall(radius: number): Part[] {
    const source = new THREE.IcosahedronGeometry(radius, 12);
    const seamPoints: THREE.Vector3[] = [];
    const a = 0.72;
    const b = 1 - a;
    const c = 2 * Math.sqrt(a * b);
    for (let i = 0; i < 160; i++) {
        const t = (i / 160) * Math.PI * 2;
        seamPoints.push(new THREE.Vector3(a * Math.cos(t) + b * Math.cos(3 * t), a * Math.sin(t) - b * Math.sin(3 * t), c * Math.sin(2 * t)).normalize());
    }

    const felt = new THREE.Color(0xc8e02a);
    const seam = new THREE.Color(0xf2f2ea);
    const out = new THREE.Color();
    const dir = new THREE.Vector3();
    const geometry = paint(source, (x, y, z) => {
        dir.set(x, y, z).normalize();
        let nearest = Infinity;
        for (const point of seamPoints) nearest = Math.min(nearest, dir.angleTo(point));
        return out.copy(felt).lerp(seam, 1 - THREE.MathUtils.smoothstep(nearest, 0.05, 0.1));
    });
    sphereNormals(geometry);
    return [{ geometry, material: "rubber" }];
}

function buildFlowerpot(rng: Rng, plant: "geranium" | "agave"): Part[] {
    const terracotta = new THREE.Color(0xdc7a48);
    const shadowed = new THREE.Color(0xae5a36);
    const parts: Part[] = [];

    const profile = [
        new THREE.Vector2(0.01, 0),
        new THREE.Vector2(4.8, 0),
        new THREE.Vector2(6.5, 12.3),
        new THREE.Vector2(7.4, 12.5),
        new THREE.Vector2(7.5, 15.2),
        new THREE.Vector2(6.7, 15.3),
        new THREE.Vector2(6.5, 14.3),
        new THREE.Vector2(0.01, 14.3),
    ];
    const pot = new THREE.LatheGeometry(profile, 28);
    parts.push({
        geometry: paint(pot, (x, y, z) => {
            const inner = y > 14.2 && y < 14.45 && Math.hypot(x, z) < 6.55;
            if (inner) return new THREE.Color(0x3a2616);
            return terracotta.clone().lerp(shadowed, 1 - Math.min(1, y / 13)).multiplyScalar(0.94 + ((x * 3.1 + z * 1.7) % 1 + 1) % 1 * 0.08);
        }),
        material: "matte",
    });

    if (plant === "geranium") {
        const leafGreens = [0x2f6d2a, 0x3c8233, 0x4a9140];
        for (let i = 0; i < 9; i++) {
            const blob = new THREE.IcosahedronGeometry(rng.range(2.2, 3.2), 1);
            const angle = rng.next() * Math.PI * 2;
            const spread = rng.range(0, 4.2);
            blob.scale(1, 0.7, 1);
            blob.translate(Math.cos(angle) * spread, 15.5 + rng.range(0, 2.5), Math.sin(angle) * spread);
            parts.push({ geometry: paint(blob, jitter(new THREE.Color(rng.pick(leafGreens)), 0.18, i + 1)), material: "matte" });
        }
        for (let i = 0; i < 7; i++) {
            const angle = rng.next() * Math.PI * 2;
            const spread = rng.range(1, 5);
            const height = 19 + rng.range(0, 3.5);
            const stalk = new THREE.CylinderGeometry(0.16, 0.2, height - 15, 5);
            stalk.translate(Math.cos(angle) * spread, 15 + (height - 15) / 2, Math.sin(angle) * spread);
            parts.push({ geometry: paint(stalk, new THREE.Color(0x3f7a2e)), material: "matte" });
            const flower = new THREE.IcosahedronGeometry(rng.range(1.2, 1.6), 1);
            flower.translate(Math.cos(angle) * spread, height + 0.6, Math.sin(angle) * spread);
            parts.push({ geometry: paint(flower, jitter(new THREE.Color(0xe8243a), 0.25, i + 3)), material: "matte" });
        }
    } else {
        const leaf = new THREE.Color(0x5f9a6a);
        const tip = new THREE.Color(0x9cc39a);
        for (let i = 0; i < 14; i++) {
            const length = rng.range(8, 12);
            const blade = new THREE.ConeGeometry(0.9, length, 4, 1);
            blade.scale(1, 1, 0.35);
            blade.translate(0, length / 2, 0);
            const ramp = heightRamp(leaf, tip, length);
            const painted = paint(blade, ramp);
            const yaw = (i / 14) * Math.PI * 2 + rng.range(-0.2, 0.2);
            const tilt = rng.range(0.35, 0.9);
            painted.applyMatrix4(transform(0, 14.4, 0, yaw, 1, tilt, 0));
            parts.push({ geometry: painted, material: "matte" });
        }
    }

    return parts;
}

function buildWateringCan(): Part[] {
    const enamel = new THREE.Color(0x2f8f55);
    const brass = new THREE.Color(0xc9a24a);
    const parts: Part[] = [];

    const body = new THREE.CylinderGeometry(4.8, 5.1, 10, 28, 1);
    body.scale(1.2, 1, 1);
    body.translate(0, 5, 0);
    parts.push({ geometry: paint(body, jitter(enamel, 0.06)), material: "gloss" });

    const lid = new THREE.CylinderGeometry(5.4, 4.8, 0.5, 28, 1);
    lid.scale(1.2, 1, 1);
    lid.translate(0, 10.2, 0);
    parts.push({ geometry: paint(lid, enamel.clone().multiplyScalar(0.8)), material: "gloss" });

    const opening = new THREE.CylinderGeometry(2.1, 2.1, 0.6, 18);
    opening.translate(-2.2, 10.5, 0);
    parts.push({ geometry: paint(opening, new THREE.Color(0x14261a)), material: "gloss" });

    // Spout leaves low on the +X side and climbs toward the rose.
    const spoutCurve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(5.4, 2.4, 0),
        new THREE.Vector3(11, 4.5, 0),
        new THREE.Vector3(16, 9.8, 0),
    );
    const spout = new THREE.TubeGeometry(spoutCurve, 14, 0.75, 10, false);
    const spoutPosition = spout.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < spoutPosition.count; i++) {
        // Taper toward the tip.
        const x = spoutPosition.getX(i);
        const s = THREE.MathUtils.clamp((x - 5.4) / 10.6, 0, 1);
        const pointOnCurve = spoutCurve.getPoint(s);
        const shrink = 1 - s * 0.45;
        spoutPosition.setXYZ(
            i,
            pointOnCurve.x + (spoutPosition.getX(i) - pointOnCurve.x) * shrink,
            pointOnCurve.y + (spoutPosition.getY(i) - pointOnCurve.y) * shrink,
            spoutPosition.getZ(i) * shrink,
        );
    }
    parts.push({ geometry: paint(spout, enamel), material: "gloss" });

    const rose = new THREE.CylinderGeometry(1.9, 0.6, 1.4, 16, 1);
    rose.rotateZ(-Math.PI / 2 + 0.75);
    rose.translate(16.5, 10.3, 0);
    parts.push({ geometry: paint(rose, brass), material: "metal" });

    const topHandle = new THREE.TorusGeometry(4.6, 0.55, 8, 20, Math.PI);
    topHandle.translate(-0.8, 10.2, 0);
    parts.push({ geometry: paint(topHandle, enamel.clone().multiplyScalar(0.9)), material: "gloss" });

    const backHandle = new THREE.TorusGeometry(3.4, 0.5, 8, 16, Math.PI);
    backHandle.rotateZ(Math.PI / 2);
    backHandle.translate(-6.1, 5.5, 0);
    parts.push({ geometry: paint(backHandle, enamel.clone().multiplyScalar(0.9)), material: "gloss" });

    return parts;
}

function buildGnome(): Part[] {
    const parts: Part[] = [];
    const add = (geometry: THREE.BufferGeometry, color: number, material: BatchMaterial = "ceramic") => {
        parts.push({ geometry: paint(geometry, new THREE.Color(color)), material });
    };

    const plinth = new THREE.CylinderGeometry(2.6, 2.9, 0.9, 16);
    plinth.translate(0, 0.45, 0);
    parts.push({ geometry: paint(plinth, jitter(new THREE.Color(0x7c8a66), 0.2)), material: "matte" });

    for (const side of [-1, 1]) {
        const boot = new THREE.SphereGeometry(0.85, 12, 8);
        boot.scale(1, 0.7, 1.45);
        boot.translate(side * 0.8, 1.35, 0.35);
        add(boot, 0x3a2414);
    }

    const coat = new THREE.CylinderGeometry(1.35, 2.15, 4.6, 18, 1);
    coat.translate(0, 3.6, 0);
    add(coat, 0x2150b8);

    const belt = new THREE.CylinderGeometry(1.72, 1.78, 0.45, 18, 1);
    belt.translate(0, 4.15, 0);
    add(belt, 0x1a1512);

    const buckle = new THREE.BoxGeometry(0.7, 0.55, 0.2);
    buckle.translate(0, 4.15, 1.72);
    add(buckle, 0xf2c230);

    for (const side of [-1, 1]) {
        const sleeve = new THREE.CylinderGeometry(0.38, 0.48, 2.6, 10);
        sleeve.rotateX(-0.9);
        sleeve.rotateZ(side * 0.35);
        sleeve.translate(side * 1.3, 4.8, 0.9);
        add(sleeve, 0x1d46a4);

        const hand = new THREE.SphereGeometry(0.45, 10, 8);
        hand.translate(side * 0.75, 4.0, 1.85);
        add(hand, 0xf2c6a0);
    }

    const head = new THREE.SphereGeometry(1.3, 18, 14);
    head.translate(0, 6.85, 0.1);
    add(head, 0xf2c6a0);

    const nose = new THREE.SphereGeometry(0.46, 12, 10);
    nose.translate(0, 6.75, 1.4);
    add(nose, 0xf09a86);

    for (const side of [-1, 1]) {
        const eye = new THREE.SphereGeometry(0.14, 8, 6);
        eye.translate(side * 0.45, 7.2, 1.2);
        add(eye, 0x111111);
    }

    const beard = new THREE.ConeGeometry(1.45, 3.4, 16, 1);
    beard.rotateX(Math.PI);
    beard.translate(0, 4.95, 0.75);
    add(beard, 0xf6f4ee);

    const brim = new THREE.CylinderGeometry(1.55, 1.55, 0.35, 18);
    brim.translate(0, 7.75, 0);
    add(brim, 0xd6241e);

    const hat = new THREE.ConeGeometry(1.45, 4.8, 18, 3);
    hat.translate(0, 2.4, 0);
    // Bend the tip backward like a floppy gnome hat.
    const hatPosition = hat.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < hatPosition.count; i++) {
        // Base vertices land at -0.0000… after the translate, and a fractional power of that is NaN.
        const y = Math.max(0, hatPosition.getY(i));
        hatPosition.setZ(i, hatPosition.getZ(i) - Math.pow(y / 4.8, 2.2) * 1.4);
    }
    hat.translate(0, 7.8, 0);
    add(hat, 0xd6241e);

    return parts;
}

function buildTrowel(): Part[] {
    const steel = new THREE.Color(0xaeb4ba);
    const parts: Part[] = [];

    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(0, -5.2);
    bladeShape.quadraticCurveTo(1.7, -2.6, 1.45, 0);
    bladeShape.lineTo(-1.45, 0);
    bladeShape.quadraticCurveTo(-1.7, -2.6, 0, -5.2);
    const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.14, bevelEnabled: false, curveSegments: 8 });
    blade.translate(0, 0, -0.07);
    parts.push({ geometry: paint(blade, steel), material: "metal" });

    const shank = new THREE.CylinderGeometry(0.2, 0.25, 1.6, 8);
    shank.translate(0, 0.8, 0);
    parts.push({ geometry: paint(shank, steel.clone().multiplyScalar(0.8)), material: "metal" });

    const handle = new THREE.CylinderGeometry(0.55, 0.48, 4.4, 12);
    handle.translate(0, 3.8, 0);
    parts.push({ geometry: paint(handle, jitter(new THREE.Color(0x9a6232), 0.15)), material: "matte" });

    const cap = new THREE.SphereGeometry(0.58, 12, 8);
    cap.translate(0, 6.0, 0);
    parts.push({ geometry: paint(cap, new THREE.Color(0xd82a22)), material: "gloss" });

    return parts;
}

function buildBucket(): Part[] {
    const parts: Part[] = [];
    const red = new THREE.Color(0xe0302a);

    const profile = [
        new THREE.Vector2(0.01, 0.2),
        new THREE.Vector2(3.2, 0.2),
        new THREE.Vector2(3.35, 0),
        new THREE.Vector2(4.25, 7.2),
        new THREE.Vector2(4.6, 7.4),
        new THREE.Vector2(4.6, 7.9),
        new THREE.Vector2(4.1, 7.9),
        new THREE.Vector2(3.2, 1.0),
        new THREE.Vector2(0.01, 1.0),
    ];
    parts.push({ geometry: paint(new THREE.LatheGeometry(profile, 26), red), material: "gloss" });

    const handle = new THREE.TorusGeometry(4.45, 0.2, 6, 20, Math.PI);
    handle.rotateZ(0.25);
    handle.translate(0, 7.1, 0);
    parts.push({ geometry: paint(handle, new THREE.Color(0xf6c21c)), material: "gloss" });

    // Spade leaning against the rim.
    const spade = new THREE.Group();
    spade.position.set(6.8, 2.0, 1.2);
    spade.rotation.set(0, 0.2, 0.3);
    spade.updateMatrixWorld();

    const shaft = new THREE.CylinderGeometry(0.32, 0.32, 8.5, 10);
    shaft.translate(0, 5.8, 0);
    shaft.applyMatrix4(spade.matrixWorld);
    parts.push({ geometry: paint(shaft, new THREE.Color(0x2a6ce0)), material: "gloss" });

    const grip = new THREE.CylinderGeometry(0.3, 0.3, 2.2, 10);
    grip.rotateZ(Math.PI / 2);
    grip.translate(0, 10.1, 0);
    grip.applyMatrix4(spade.matrixWorld);
    parts.push({ geometry: paint(grip, new THREE.Color(0x2a6ce0)), material: "gloss" });

    const bladeShape = new THREE.Shape();
    bladeShape.moveTo(-1.6, 1.6);
    bladeShape.lineTo(1.6, 1.6);
    bladeShape.lineTo(1.7, -1.2);
    bladeShape.quadraticCurveTo(0, -2.2, -1.7, -1.2);
    bladeShape.closePath();
    const blade = new THREE.ExtrudeGeometry(bladeShape, { depth: 0.25, bevelEnabled: false, curveSegments: 6 });
    blade.translate(0, 0.2, -0.12);
    blade.applyMatrix4(spade.matrixWorld);
    parts.push({ geometry: paint(blade, new THREE.Color(0xf6c21c)), material: "gloss" });

    return parts;
}

function buildTap(): Part[] {
    const brass = new THREE.Color(0xc9a24a);
    const parts: Part[] = [];

    const plate = new THREE.CylinderGeometry(1.3, 1.3, 0.4, 14);
    plate.rotateX(Math.PI / 2);
    parts.push({ geometry: paint(plate, brass), material: "metal" });

    const body = new THREE.CylinderGeometry(0.75, 0.75, 2.6, 12);
    body.rotateX(Math.PI / 2);
    body.translate(0, 0, 1.3);
    parts.push({ geometry: paint(body, brass), material: "metal" });

    const spout = new THREE.CylinderGeometry(0.6, 0.7, 2.2, 12);
    spout.translate(0, -1.1, 2.3);
    parts.push({ geometry: paint(spout, brass), material: "metal" });

    const stem = new THREE.CylinderGeometry(0.25, 0.25, 1.4, 8);
    stem.translate(0, 0.9, 1.5);
    parts.push({ geometry: paint(stem, brass), material: "metal" });

    const handle = new THREE.BoxGeometry(2.6, 0.35, 0.5);
    handle.translate(0, 1.7, 1.5);
    parts.push({ geometry: paint(handle, new THREE.Color(0xd82a22)), material: "gloss" });

    return parts;
}

function buildHose(terrain: Terrain): Part[] {
    const first = HOSE_PATH[0];
    const points: THREE.Vector3[] = [
        new THREE.Vector3(first.x, TAP_HEIGHT - 2.3, TAP_Z + 2.2),
        new THREE.Vector3(first.x + 0.2, TAP_HEIGHT - 4.2, TAP_Z + 2.9),
    ];
    for (let i = 1; i < HOSE_PATH.length; i++) {
        const p = HOSE_PATH[i];
        const ground = terrain.getHeightAt(p.x, p.z) - hoseBump(p.x, p.z);
        points.push(new THREE.Vector3(p.x, ground + HOSE_RADIUS * 0.92, p.z));
    }

    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    const radial = 8;
    const tube = new THREE.TubeGeometry(curve, points.length * 3, HOSE_RADIUS, radial, false);
    const tubeIndex = tube.index!;
    const green = new THREE.Color(0x2e9a3a);
    const stripe = new THREE.Color(0xf2d23a);

    // The expanded copy keeps index order, so each vertex's radial slot comes from the original index.
    const hose = paint(tube, green);
    const colors = hose.getAttribute("color") as THREE.BufferAttribute;
    for (let i = 0; i < colors.count; i++) {
        const slot = tubeIndex.getX(i) % (radial + 1);
        const c = slot === 1 || slot === 2 ? stripe : green;
        colors.setXYZ(i, c.r, c.g, c.b);
    }

    const parts: Part[] = [{ geometry: hose, material: "gloss" }];

    const last = points[points.length - 1];
    const beforeLast = points[points.length - 2];
    const nozzle = new THREE.CylinderGeometry(0.62, 0.8, 2.6, 12);
    nozzle.rotateZ(Math.PI / 2);
    nozzle.translate(1.3, 0, 0);
    const yaw = Math.atan2(-(last.z - beforeLast.z), last.x - beforeLast.x);
    nozzle.applyMatrix4(transform(last.x, last.y, last.z, yaw));
    parts.push({ geometry: paint(nozzle, new THREE.Color(0xf07a1a)), material: "gloss" });

    return parts;
}

export function createGardenProps(terrain: Terrain, grid: PlacementGrid, seed = 777): GardenPropsResult {
    const rng = new Rng(seed);
    const batch = new StaticBatch();
    const obstacles: Obstacle[] = [];

    const ground = (x: number, z: number) => terrain.getHeightAt(x, z) - hoseBump(x, z);
    const facing = (fromX: number, fromZ: number, toX: number, toZ: number) => Math.atan2(toX - fromX, toZ - fromZ);

    const place = (parts: Part[], matrix: THREE.Matrix4) => {
        for (const part of parts) batch.add(part.geometry, matrix, part.material);
    };
    const release = (parts: Part[]) => parts.forEach((part) => part.geometry.dispose());

    const solid = (x: number, z: number, radius: number, height: number, footprint = radius) => {
        obstacles.push({ x, z, radius, height, solidity: 1 });
        grid.place(x, z, footprint);
    };

    // Football parked on the outside of the sharp first corner.
    const football = buildFootball(3.8);
    const ball = loopPoint(0.132, 19.5);
    place(football, transform(ball.x, ground(ball.x, ball.z) + 3.8 - 0.35, ball.z, 0.7, 1, 0.4, 0.2));
    solid(ball.x, ball.z, 3.6, 7.3, 4.2);
    release(football);

    const tennis = buildTennisBall(1.9);
    const tennisSpot = loopPoint(0.705, 15);
    place(tennis, transform(tennisSpot.x, ground(tennisSpot.x, tennisSpot.z) + 1.8, tennisSpot.z, 1.2, 1, 0.3, 0.8));
    solid(tennisSpot.x, tennisSpot.z, 1.85, 3.7, 2.2);
    release(tennis);

    // A group of flowerpots on the outside of the infield hairpin, plus a big one by the start straight.
    const pots: { t: number; outward: number; scale: number; plant: "geranium" | "agave" }[] = [
        { t: 0.325, outward: 25, scale: 1.25, plant: "geranium" },
        { t: 0.36, outward: 30, scale: 0.95, plant: "agave" },
        { t: 0.3, outward: 36, scale: 0.8, plant: "geranium" },
        { t: 0.048, outward: 25, scale: 1.3, plant: "agave" },
    ];
    for (const pot of pots) {
        const spot = loopPoint(pot.t, pot.outward);
        const parts = buildFlowerpot(rng, pot.plant);
        place(parts, transform(spot.x, ground(spot.x, spot.z) - 0.4, spot.z, rng.next() * Math.PI * 2, pot.scale));
        solid(spot.x, spot.z, 7.4 * pot.scale, 15.2 * pot.scale, 7.8 * pot.scale);
        release(parts);
    }

    // More pots standing in the beds by the fence — scenery only, beyond where the cars can reach.
    const bedPots: [number, number, number, "geranium" | "agave"][] = [
        [128, 124, 1.4, "geranium"],
        [-126, -128, 1.3, "agave"],
        [-130, 96, 1.1, "geranium"],
    ];
    for (const [x, z, scale, plant] of bedPots) {
        const parts = buildFlowerpot(rng, plant);
        place(parts, transform(x, ground(x, z) - 0.4, z, rng.next() * Math.PI * 2, scale));
        grid.place(x, z, 7.8 * scale);
        release(parts);
    }

    // Watering can by the far hairpin, spout pointed at the puddle it has left on the road.
    const can = buildWateringCan();
    const canSpot = loopPoint(0.43, 22);
    const spill = loopPoint(0.438, 0);
    const canYaw = Math.atan2(-(spill.z - canSpot.z), spill.x - canSpot.x);
    place(can, transform(canSpot.x, ground(canSpot.x, canSpot.z) - 0.2, canSpot.z, canYaw));
    solid(canSpot.x, canSpot.z, 6.2, 11, 7.5);
    release(can);

    // Garden gnome keeping watch over the infield straight.
    const gnome = buildGnome();
    const gnomeSpot = loopPoint(0.19, -21);
    const gnomeLook = loopPoint(0.2, 0);
    place(gnome, transform(gnomeSpot.x, ground(gnomeSpot.x, gnomeSpot.z) - 0.2, gnomeSpot.z, facing(gnomeSpot.x, gnomeSpot.z, gnomeLook.x, gnomeLook.z)));
    solid(gnomeSpot.x, gnomeSpot.z, 2.7, 12.5, 3);
    release(gnome);

    // Trowel stabbed into a molehill.
    const trowel = buildTrowel();
    const hill = MOLEHILLS[5];
    place(trowel, transform(hill.x, ground(hill.x, hill.z) + 1.4, hill.z, 0.9, 1, 0.45, 0.15));
    solid(hill.x, hill.z, 1.2, 7.5, 1.5);
    release(trowel);

    const bucket = buildBucket();
    const bucketSpot = loopPoint(0.605, 20);
    place(bucket, transform(bucketSpot.x, ground(bucketSpot.x, bucketSpot.z) - 0.2, bucketSpot.z, rng.next() * Math.PI * 2));
    solid(bucketSpot.x, bucketSpot.z, 4.6, 8, 6);
    release(bucket);

    const tap = buildTap();
    const tapSpot = HOSE_PATH[0];
    place(tap, transform(tapSpot.x, TAP_HEIGHT, TAP_Z, 0));
    release(tap);

    const hose = buildHose(terrain);
    for (const part of hose) batch.add(part.geometry, new THREE.Matrix4(), part.material);
    release(hose);
    for (let i = 0; i < HOSE_PATH.length; i += 6) grid.place(HOSE_PATH[i].x, HOSE_PATH[i].z, 1.2);

    // Stepping stones across the infield lawn.
    const stoneColor = new THREE.Color(0x9a948a);
    for (let i = 0; i < 7; i++) {
        const s = i / 6;
        const x = THREE.MathUtils.lerp(-26, 22, s) + Math.sin(s * 5) * 4;
        const z = THREE.MathUtils.lerp(12, -22, s) + Math.cos(s * 4) * 3;
        const radius = rng.range(2.6, 3.4);
        const stone = new THREE.CylinderGeometry(radius, radius * 1.05, 1, 12, 1);
        const position = stone.getAttribute("position") as THREE.BufferAttribute;
        for (let k = 0; k < position.count; k++) {
            const angle = Math.atan2(position.getZ(k), position.getX(k));
            const wobble = 1 + Math.sin(angle * 3 + i) * 0.08 + Math.sin(angle * 5 + i * 2) * 0.05;
            position.setX(k, position.getX(k) * wobble);
            position.setZ(k, position.getZ(k) * wobble);
        }
        const painted = paint(stone, jitter(stoneColor, 0.22, i + 5));
        painted.computeVertexNormals();
        batch.add(painted, transform(x, ground(x, z) - 0.28, z, rng.next() * Math.PI), "matte");
        painted.dispose();
        grid.place(x, z, radius);
    }

    const built = batch.build();

    return {
        meshes: built.meshes,
        obstacles,
        dispose() {
            built.dispose();
        },
    };
}
