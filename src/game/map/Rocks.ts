import * as THREE from "three";
import { Rng } from "../core/Random";
import { fbm2D } from "../core/Noise";
import { TRACK_WIDTH, WORLD_RADIUS } from "../core/Config";
import type { Terrain } from "./Terrain";
import { PlacementGrid, type Obstacle } from "./Scatter";

export interface RocksResult {
    meshes: THREE.InstancedMesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

const STONE_COLORS = [0x6f6c66, 0x807d75, 0x5c5952, 0x6b6558, 0x565248];
const MOSS_COLOR = new THREE.Color(0x44643a);
const IRON_TINT = new THREE.Color(0x6d5a44);

function buildRockGeometry(rng: Rng, detail: number, roughness: number, mossy: boolean): THREE.BufferGeometry {
    const source = new THREE.IcosahedronGeometry(1, detail);
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    geometry.deleteAttribute("uv");

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const count = position.count;
    const colors = new Float32Array(count * 3);
    const temp = new THREE.Color();
    const base = new THREE.Color(rng.pick(STONE_COLORS));

    // Displace by direction so duplicated vertices of a shared corner still move together.
    const displaced = new Map<string, [number, number, number]>();

    for (let i = 0; i < count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const length = Math.hypot(x, y, z) || 1;
        const nx = x / length;
        const ny = y / length;
        const nz = z / length;

        const key = `${nx.toFixed(3)},${ny.toFixed(3)},${nz.toFixed(3)}`;
        let point = displaced.get(key);

        if (!point) {
            const lobe = Math.sin(nx * 5.3 + ny * 3.7) * Math.cos(nz * 4.1 + nx * 2.9);
            const bump = Math.sin(ny * 7.1 + nz * 5.3) * 0.5;
            const amount = 1 + (lobe + bump) * roughness + (rng.next() - 0.5) * roughness * 0.5;
            point = [nx * amount, ny * amount * 0.85, nz * amount];
            displaced.set(key, point);
        }

        position.setXYZ(i, point[0], point[1], point[2]);

        temp.copy(base).lerp(IRON_TINT, rng.next() * 0.28);
        if (mossy && ny > 0.15) {
            temp.lerp(MOSS_COLOR, Math.pow(ny, 1.6) * rng.range(0.3, 0.65));
        }

        const shade = 0.88 + rng.next() * 0.22;
        colors[i * 3] = temp.r * shade;
        colors[i * 3 + 1] = temp.g * shade;
        colors[i * 3 + 2] = temp.b * shade;
    }

    position.needsUpdate = true;
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();
    return geometry;
}

export function createRocks(terrain: Terrain, count: number, seed = 6421): RocksResult {
    const rng = new Rng(seed);

    const templates = [
        buildRockGeometry(rng, 1, 0.3, false),
        buildRockGeometry(rng, 1, 0.24, true),
        buildRockGeometry(rng, 2, 0.32, false),
        buildRockGeometry(rng, 2, 0.2, true),
    ];

    const transforms: THREE.Matrix4[][] = templates.map(() => []);
    const obstacles: Obstacle[] = [];
    const grid = new PlacementGrid(4);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const positionVec = new THREE.Vector3();
    const scaleVec = new THREE.Vector3();

    const minTrackClearance = TRACK_WIDTH / 2 + 3.2;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 40;

    while (placed < count && attempts < maxAttempts) {
        attempts++;

        const radius = Math.sqrt(rng.next()) * (WORLD_RADIUS - 4) + 4;
        const angle = rng.next() * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        const trackDistance = terrain.getTrackDistance(x, z);
        if (trackDistance < minTrackClearance) continue;

        // Rocks gather on the steeper, more eroded ground.
        const slope = terrain.getSlopeAt(x, z);
        const affinity = 0.25 + slope * 0.9 + fbm2D(x * 0.03 - 11, z * 0.03 + 7, 3) * 0.6;
        if (rng.next() > affinity) continue;

        const isBoulder = trackDistance > 14 && rng.next() > 0.72;
        const scale = isBoulder ? rng.range(1.6, 3.4) : rng.range(0.35, 1.3);
        if (!grid.canPlace(x, z, scale * 1.2)) continue;
        grid.place(x, z, scale * 1.2);

        const templateIndex = rng.int(templates.length);
        const sink = scale * rng.range(0.2, 0.4);
        const y = terrain.getHeightAt(x, z) - sink;

        euler.set(rng.range(-0.4, 0.4), rng.next() * Math.PI * 2, rng.range(-0.4, 0.4));
        quaternion.setFromEuler(euler);
        positionVec.set(x, y, z);
        // Keep the vertical scale close to the horizontal — squashed rocks read as flat plates.
        scaleVec.set(
            scale * rng.range(0.85, 1.2),
            scale * rng.range(0.8, 1.15),
            scale * rng.range(0.85, 1.2),
        );
        matrix.compose(positionVec, quaternion, scaleVec);
        transforms[templateIndex].push(matrix.clone());

        // Only rocks big enough to actually stop a micro machine are solid.
        if (scale > 0.85) {
            obstacles.push({
                x,
                z,
                radius: scale * 0.85,
                height: scale * 1.1 - sink,
                solidity: 0.85,
            });
        }

        placed++;
    }

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.93,
        metalness: 0.04,
        flatShading: true,
    });

    const meshes: THREE.InstancedMesh[] = [];

    templates.forEach((geometry, index) => {
        const instanceCount = transforms[index].length;
        if (instanceCount === 0) return;

        const mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `rocks-${index}`;
        mesh.userData.nonCollidable = true;

        for (let i = 0; i < instanceCount; i++) {
            mesh.setMatrixAt(i, transforms[index][i]);
        }

        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
    });

    return {
        meshes,
        obstacles,
        dispose() {
            templates.forEach((geometry) => geometry.dispose());
            material.dispose();
            meshes.forEach((mesh) => mesh.dispose());
        },
    };
}
