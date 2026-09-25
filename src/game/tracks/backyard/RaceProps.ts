import * as THREE from "three";
import { Rng } from "../../core/Random";
import { TRACK_WIDTH, type QualityTier } from "../../core/Config";
import type { TrackPath } from "../../map/TrackPath";
import type { Terrain } from "../../map/Terrain";
import type { Obstacle, PlacementGrid } from "../../map/Scatter";
import { loopPoint } from "./GardenLayout";
import { merge, paint } from "./Shapes";

export interface RacePropsResult {
    meshes: THREE.InstancedMesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

const HALF_WIDTH = TRACK_WIDTH / 2;

/** Toy brick module: one stud pitch. A 2×4 brick is 4 × 2 modules. */
const BRICK_UNIT = 0.95;
const BRICK_LENGTH = BRICK_UNIT * 4;
const BRICK_WIDTH = BRICK_UNIT * 2;
const BRICK_HEIGHT = BRICK_UNIT * 1.2;
const BRICK_COLORS = [0xd8231f, 0xf5c518, 0x1f5fd1, 0x2a9d3f, 0xf4f4f0, 0xf07a1a];

function buildBrick(): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const white = new THREE.Color(1, 1, 1);

    const body = new THREE.BoxGeometry(BRICK_LENGTH - 0.04, BRICK_HEIGHT, BRICK_WIDTH - 0.04);
    body.translate(0, BRICK_HEIGHT / 2, 0);
    parts.push(paint(body, white));

    for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 2; j++) {
            const stud = new THREE.CylinderGeometry(BRICK_UNIT * 0.3, BRICK_UNIT * 0.3, BRICK_UNIT * 0.2, 9, 1, false);
            stud.translate((i - 1.5) * BRICK_UNIT, BRICK_HEIGHT + BRICK_UNIT * 0.1, (j - 0.5) * BRICK_UNIT);
            parts.push(paint(stud, white));
        }
    }

    return merge(parts);
}

function buildTyreStack(): THREE.BufferGeometry {
    const rubber = new THREE.Color(0x1f2023);
    const rubberWorn = new THREE.Color(0x33343a);
    const cap = new THREE.Color(0xc23a2c);
    const parts: THREE.BufferGeometry[] = [];

    for (let i = 0; i < 3; i++) {
        const tyre = new THREE.TorusGeometry(0.34, 0.14, 5, 11);
        tyre.rotateX(Math.PI / 2);
        tyre.translate(0, 0.16 + i * 0.26, 0);
        const isTop = i === 2;
        parts.push(paint(tyre, (x, y, z) => {
            if (isTop && y > 0.66) return cap;
            return Math.hypot(x, z) > 0.44 ? rubberWorn : rubber;
        }));
    }

    const merged = merge(parts);
    merged.computeVertexNormals();
    return merged;
}

function buildCone(): THREE.BufferGeometry {
    const orange = new THREE.Color(0xf06a1c);
    const white = new THREE.Color(0xf4f4ef);
    const body = new THREE.ConeGeometry(0.24, 0.62, 10);
    body.translate(0, 0.31, 0);
    const base = new THREE.BoxGeometry(0.46, 0.05, 0.46);
    base.translate(0, 0.025, 0);
    const merged = merge([
        paint(body, (_x, y) => (y > 0.32 && y < 0.45 ? white : orange)),
        paint(base, orange),
    ]);
    merged.computeVertexNormals();
    return merged;
}

/** White plastic plant label on a stake, the garden's answer to marker posts. */
function buildPlantLabel(): THREE.BufferGeometry {
    const white = new THREE.Color(0xf6f5ef);
    const band = new THREE.Color(0x3aa845);

    const shape = new THREE.Shape();
    shape.moveTo(-0.16, -0.9);
    shape.lineTo(0, -1.25);
    shape.lineTo(0.16, -0.9);
    shape.lineTo(0.16, 1.5);
    shape.lineTo(0.55, 1.68);
    shape.lineTo(0.55, 3.05);
    shape.quadraticCurveTo(0.55, 3.35, 0, 3.4);
    shape.quadraticCurveTo(-0.55, 3.35, -0.55, 3.05);
    shape.lineTo(-0.55, 1.68);
    shape.lineTo(-0.16, 1.5);
    shape.closePath();

    const label = new THREE.ExtrudeGeometry(shape, { depth: 0.08, bevelEnabled: false, curveSegments: 4 });
    label.translate(0, 0, -0.04);
    const parts = [paint(label, (_x, y) => (y > 2.95 ? band : white))];

    // A printed flower on each face, so it reads as a seed label from the chase camera.
    const petalColor = new THREE.Color(0xe0306a);
    const middleColor = new THREE.Color(0xf2b01e);
    for (const side of [-1, 1]) {
        const face = side * 0.045;
        for (let petal = 0; petal < 5; petal++) {
            const angle = (petal / 5) * Math.PI * 2;
            const disc = new THREE.CircleGeometry(0.13, 6);
            if (side < 0) disc.rotateY(Math.PI);
            disc.translate(Math.cos(angle) * 0.17, 2.35 + Math.sin(angle) * 0.17, face);
            parts.push(paint(disc, petalColor));
        }
        const middle = new THREE.CircleGeometry(0.1, 6);
        if (side < 0) middle.rotateY(Math.PI);
        middle.translate(0, 2.35, face * 1.1);
        parts.push(paint(middle, middleColor));

        const stem = new THREE.PlaneGeometry(0.05, 0.5);
        if (side < 0) stem.rotateY(Math.PI);
        stem.translate(0, 1.95, face);
        parts.push(paint(stem, band));
    }

    return merge(parts);
}

interface Batch {
    name: string;
    geometry: THREE.BufferGeometry;
    matrices: THREE.Matrix4[];
    colors: THREE.Color[];
    material: THREE.Material;
}

export function createRaceProps(
    trackPath: TrackPath,
    terrain: Terrain,
    quality: QualityTier,
    grid: PlacementGrid,
    seed = 20482,
): RacePropsResult {
    const rng = new Rng(seed);
    const samples = trackPath.samples;
    const obstacles: Obstacle[] = [];

    const plastic = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0 });
    const matte = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.02, flatShading: true });

    const bricks: Batch = { name: "toy-bricks", geometry: buildBrick(), matrices: [], colors: [], material: plastic };
    const tyres: Batch = { name: "tyre-stacks", geometry: buildTyreStack(), matrices: [], colors: [], material: matte };
    const cones: Batch = { name: "cones", geometry: buildCone(), matrices: [], colors: [], material: matte };
    const labels: Batch = { name: "plant-labels", geometry: buildPlantLabel(), matrices: [], colors: [], material: plastic };

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3(1, 1, 1);

    const put = (batch: Batch, x: number, y: number, z: number, yaw: number, size: number, color?: THREE.Color, tilt = 0) => {
        euler.set(0, yaw, tilt);
        quaternion.setFromEuler(euler);
        position.set(x, y, z);
        scale.setScalar(size);
        matrix.compose(position, quaternion, scale);
        batch.matrices.push(matrix.clone());
        batch.colors.push(color ?? new THREE.Color(1, 1, 1));
    };

    const ground = (x: number, z: number) => terrain.getHeightAt(x, z);

    /** Bricks laid lengthways along a direction, stacked in a running bond. */
    const brickWall = (cx: number, cz: number, dirX: number, dirZ: number, count: number, layers: number) => {
        const yaw = Math.atan2(-dirZ, dirX);
        for (let layer = 0; layer < layers; layer++) {
            const layerCount = count - (layer % 2);
            for (let i = 0; i < layerCount; i++) {
                const offset = (i - (layerCount - 1) / 2) * (BRICK_LENGTH + 0.02);
                const x = cx + dirX * offset;
                const z = cz + dirZ * offset;
                put(bricks, x, ground(x, z) - 0.08 + layer * BRICK_HEIGHT, z, yaw, 1, new THREE.Color(rng.pick(BRICK_COLORS)));
            }
        }
        for (let i = 0; i < count; i++) {
            const offset = (i - (count - 1) / 2) * (BRICK_LENGTH + 0.02);
            obstacles.push({
                x: cx + dirX * offset,
                z: cz + dirZ * offset,
                radius: Math.hypot(BRICK_LENGTH, BRICK_WIDTH) / 2,
                box: { halfX: BRICK_LENGTH / 2, halfZ: BRICK_WIDTH / 2, yaw },
                height: layers * BRICK_HEIGHT,
                solidity: 0.9,
            });
        }
        grid.place(cx, cz, (count * BRICK_LENGTH) / 2);
    };

    let nextLabelArc = 6;
    let nextTyreArc = 0;
    let nextConeArc = 0;
    const count = samples.length;

    for (let index = 0; index < count; index++) {
        const sample = samples[index];
        const normalX = -sample.tangentZ;
        const normalZ = sample.tangentX;
        const yaw = Math.atan2(sample.tangentX, sample.tangentZ);
        const curvature = sample.curvature;
        const absCurvature = Math.abs(curvature);

        if (sample.arc >= nextLabelArc) {
            nextLabelArc = sample.arc + 13;
            for (const side of [1, -1]) {
                const lateral = side * (HALF_WIDTH + 2.1);
                const x = sample.x + normalX * lateral;
                const z = sample.z + normalZ * lateral;
                // Labels face the road so the "writing" is toward the drivers.
                put(labels, x, ground(x, z) - 0.05, z, yaw + (side > 0 ? -Math.PI / 2 : Math.PI / 2), rng.range(0.95, 1.1), undefined, rng.range(-0.08, 0.08));
                obstacles.push({ x, z, radius: 0.3, height: 3.2, solidity: 0.12 });
                grid.place(x, z, 0.6);
            }
        }

        // Tyre walls line the outside of the quick corners — the toy race set's own barriers.
        if (absCurvature > 0.032 && sample.arc >= nextTyreArc) {
            nextTyreArc = sample.arc + 1.35;
            const side = curvature > 0 ? -1 : 1;
            const lateral = side * (HALF_WIDTH + 3.0);
            const x = sample.x + normalX * lateral;
            const z = sample.z + normalZ * lateral;
            put(tyres, x, ground(x, z) - 0.03, z, yaw + rng.range(-0.3, 0.3), rng.range(0.92, 1.06));
            obstacles.push({ x, z, radius: 0.55, height: 0.85, solidity: 0.55 });
            grid.place(x, z, 0.8);
        }

        if (sample.arc >= nextConeArc && absCurvature < 0.008 && rng.next() > 0.8) {
            nextConeArc = sample.arc + 6;
            const side = rng.next() > 0.5 ? 1 : -1;
            const lateral = side * (HALF_WIDTH + rng.range(1.5, 1.9));
            const x = sample.x + normalX * lateral;
            const z = sample.z + normalZ * lateral;
            put(cones, x, ground(x, z) - 0.03, z, yaw, rng.range(0.9, 1.15));
            grid.place(x, z, 0.5);
        }
    }

    // Brick walls guard the inside apex of the tightest corners, where hay bales used to be.
    for (let index = 0; index < count; index++) {
        const curvature = samples[index].curvature;
        if (Math.abs(curvature) < 0.045) continue;
        let isPeak = true;
        for (let k = -25; k <= 25 && isPeak; k++) {
            if (Math.abs(samples[(index + k + count) % count].curvature) > Math.abs(curvature)) isPeak = false;
        }
        if (!isPeak) continue;

        const sample = samples[index];
        const side = curvature > 0 ? 1 : -1;
        const lateral = side * (HALF_WIDTH + 3.3);
        const x = sample.x - sample.tangentZ * lateral;
        const z = sample.z + sample.tangentX * lateral;
        brickWall(x, z, sample.tangentX, sample.tangentZ, 4, quality.name === "low" ? 1 : 2);
    }

    // A couple of abandoned brick builds out on the lawn — a tower and a toppled pile.
    const tower = loopPoint(0.93, -16);
    for (let layer = 0; layer < 6; layer++) {
        const yaw = layer % 2 === 0 ? 0.3 : 0.3 + Math.PI / 2;
        put(bricks, tower.x, ground(tower.x, tower.z) - 0.05 + layer * BRICK_HEIGHT, tower.z, yaw, 1, new THREE.Color(rng.pick(BRICK_COLORS)));
    }
    obstacles.push({ x: tower.x, z: tower.z, radius: 2.2, height: BRICK_HEIGHT * 6, solidity: 1 });
    grid.place(tower.x, tower.z, 2.6);

    const pile = loopPoint(0.265, 17);
    for (let i = 0; i < 7; i++) {
        const angle = rng.next() * Math.PI * 2;
        const radius = rng.range(0, 3.2);
        const x = pile.x + Math.cos(angle) * radius;
        const z = pile.z + Math.sin(angle) * radius;
        const lifted = i > 4 ? BRICK_HEIGHT : 0;
        put(bricks, x, ground(x, z) - 0.05 + lifted, z, rng.next() * Math.PI, 1, new THREE.Color(rng.pick(BRICK_COLORS)), lifted > 0 ? rng.range(-0.3, 0.3) : 0);
    }
    obstacles.push({ x: pile.x, z: pile.z, radius: 3.6, height: BRICK_HEIGHT * 2, solidity: 0.8 });
    grid.place(pile.x, pile.z, 4.5);

    const meshes: THREE.InstancedMesh[] = [];
    const batches = [bricks, tyres, cones, labels];

    for (const batch of batches) {
        if (batch.matrices.length === 0) continue;
        const mesh = new THREE.InstancedMesh(batch.geometry, batch.material, batch.matrices.length);
        batch.matrices.forEach((transform, index) => {
            mesh.setMatrixAt(index, transform);
            mesh.setColorAt(index, batch.colors[index]);
        });
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = batch.name;
        mesh.userData.nonCollidable = true;
        meshes.push(mesh);
    }

    return {
        meshes,
        obstacles,
        dispose() {
            batches.forEach((batch) => batch.geometry.dispose());
            plastic.dispose();
            matte.dispose();
            meshes.forEach((mesh) => mesh.dispose());
        },
    };
}
