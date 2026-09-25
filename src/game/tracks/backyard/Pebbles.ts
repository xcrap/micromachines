import * as THREE from "three";
import { Rng } from "../../core/Random";
import { fbm2D } from "../../core/Noise";
import { TRACK_WIDTH } from "../../core/Config";
import type { Terrain } from "../../map/Terrain";
import type { PlacementGrid, Obstacle } from "../../map/Scatter";
import { BED_START, FENCE_HALF, PLAY_RADIUS } from "./GardenLayout";

export interface PebblesResult {
    meshes: THREE.InstancedMesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

/** River pebbles: warmer and lighter than quarry rock, with the odd pink or slate one. */
const STONE_COLORS = [0x9a948a, 0xa89f90, 0x7f7a72, 0xb3a18c, 0x8c8f94, 0xa58a7c];
const MOSS_COLOR = new THREE.Color(0x4f7a3a);
const IRON_TINT = new THREE.Color(0x8a6a4c);

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

    // Displace (and colour) by direction so duplicated vertices of a shared corner stay together.
    const displaced = new Map<string, [number, number, number, number, number, number]>();

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

            temp.copy(base).lerp(IRON_TINT, rng.next() * 0.22);
            if (mossy && ny > 0.15) {
                temp.lerp(MOSS_COLOR, Math.pow(ny, 1.6) * rng.range(0.3, 0.6));
            }
            const shade = 0.92 + rng.next() * 0.14;

            point = [nx * amount, ny * amount * 0.62, nz * amount, temp.r * shade, temp.g * shade, temp.b * shade];
            displaced.set(key, point);
        }

        position.setXYZ(i, point[0], point[1], point[2]);
        colors[i * 3] = point[3];
        colors[i * 3 + 1] = point[4];
        colors[i * 3 + 2] = point[5];
    }

    position.needsUpdate = true;
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));

    // Tumbled smooth: normals from the rounded shape rather than the facets.
    const normals = new Float32Array(count * 3);
    const n = new THREE.Vector3();
    for (let i = 0; i < count; i++) {
        n.set(position.getX(i), position.getY(i) / 0.62 / 0.62, position.getZ(i)).normalize();
        normals[i * 3] = n.x;
        normals[i * 3 + 1] = n.y;
        normals[i * 3 + 2] = n.z;
    }
    geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
    return geometry;
}

export function createPebbles(terrain: Terrain, count: number, grid: PlacementGrid, seed = 6421): PebblesResult {
    const rng = new Rng(seed);

    const templates = [
        buildRockGeometry(rng, 1, 0.12, false),
        buildRockGeometry(rng, 1, 0.1, false),
        buildRockGeometry(rng, 2, 0.14, true),
        buildRockGeometry(rng, 1, 0.16, true),
    ];

    const transforms: THREE.Matrix4[][] = templates.map(() => []);
    const obstacles: Obstacle[] = [];
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const positionVec = new THREE.Vector3();
    const scaleVec = new THREE.Vector3();

    const halfWidth = TRACK_WIDTH / 2;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 50;

    while (placed < count && attempts < maxAttempts) {
        attempts++;

        // Most pebbles collect in the loose gravel just off the path; the rest are strewn about.
        const verge = rng.next() < 0.55;
        const x = rng.range(-FENCE_HALF + 6, FENCE_HALF - 6);
        const z = rng.range(-FENCE_HALF + 6, FENCE_HALF - 6);
        const trackDistance = terrain.getTrackDistance(x, z);

        if (trackDistance < halfWidth + 3.2) continue;
        if (verge && trackDistance > halfWidth + 7) continue;
        if (!verge && rng.next() > 0.25 + fbm2D(x * 0.03 - 11, z * 0.03 + 7, 2) * 0.5) continue;

        const inBed = Math.max(Math.abs(x), Math.abs(z)) > BED_START;
        const isStone = (inBed || trackDistance > 16) && rng.next() > 0.75;
        const scale = isStone ? rng.range(1.6, 2.8) : rng.range(0.35, 1.1);
        if (!grid.canPlace(x, z, scale * 1.1)) continue;
        grid.place(x, z, scale * 1.1);

        const templateIndex = rng.int(templates.length);
        const sink = scale * rng.range(0.12, 0.25);
        const y = terrain.getHeightAt(x, z) - sink;

        euler.set(rng.range(-0.15, 0.15), rng.next() * Math.PI * 2, rng.range(-0.15, 0.15));
        quaternion.setFromEuler(euler);
        positionVec.set(x, y, z);
        scaleVec.set(scale * rng.range(0.9, 1.25), scale * rng.range(0.85, 1.1), scale * rng.range(0.9, 1.25));
        matrix.compose(positionVec, quaternion, scaleVec);
        transforms[templateIndex].push(matrix.clone());

        if (scale > 0.9 && Math.hypot(x, z) < PLAY_RADIUS + 3) {
            obstacles.push({
                x,
                z,
                radius: scale * 0.95,
                height: scale * 0.7 - sink,
                solidity: 0.85,
            });
        }

        placed++;
    }

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.7,
        metalness: 0.02,
    });

    const meshes: THREE.InstancedMesh[] = [];

    templates.forEach((geometry, index) => {
        const instanceCount = transforms[index].length;
        if (instanceCount === 0) return;

        const mesh = new THREE.InstancedMesh(geometry, material, instanceCount);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `pebbles-${index}`;
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
