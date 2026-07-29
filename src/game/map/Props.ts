import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../core/Random";
import { TRACK_WIDTH } from "../core/Config";
import type { TrackPath } from "./TrackPath";
import type { Terrain } from "./Terrain";
import type { Obstacle } from "./Scatter";

export interface PropsResult {
    meshes: THREE.InstancedMesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

const HALF_WIDTH = TRACK_WIDTH / 2;

function tint(source: THREE.BufferGeometry, colorAt: (y: number, x: number, z: number) => THREE.Color): THREE.BufferGeometry {
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();
    geometry.deleteAttribute("uv");

    const position = geometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);

    for (let i = 0; i < position.count; i++) {
        const color = colorAt(position.getY(i), position.getX(i), position.getZ(i));
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
}

function buildMarkerPost(): THREE.BufferGeometry {
    const white = new THREE.Color(0xf0efe9);
    const red = new THREE.Color(0xcf2222);
    const post = new THREE.CylinderGeometry(0.075, 0.09, 1.05, 6);
    post.translate(0, 0.525, 0);
    return tint(post, (y) => (y > 0.72 ? red : y > 0.46 ? white : red));
}

function buildTyreStack(): THREE.BufferGeometry {
    const rubber = new THREE.Color(0x1f2023);
    const rubberWorn = new THREE.Color(0x33343a);
    // Only the top tyre carries paint — a fully striped stack reads as candy, not a barrier.
    const cap = new THREE.Color(0xc23a2c);
    const parts: THREE.BufferGeometry[] = [];

    for (let i = 0; i < 3; i++) {
        const tyre = new THREE.TorusGeometry(0.34, 0.14, 6, 12);
        tyre.rotateX(Math.PI / 2);
        tyre.translate(0, 0.16 + i * 0.26, 0);
        const isTop = i === 2;
        parts.push(tint(tyre, (y, x, z) => {
            if (isTop && y > 0.66) return cap;
            return Math.hypot(x, z) > 0.44 ? rubberWorn : rubber;
        }));
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    merged.computeVertexNormals();
    return merged;
}

function buildHayBale(rng: Rng): THREE.BufferGeometry {
    const straw = new THREE.Color(0xc4a44e);
    const shadowed = new THREE.Color(0x8a6f2c);
    const bale = new THREE.CylinderGeometry(0.55, 0.55, 1.1, 10, 1);
    bale.rotateZ(Math.PI / 2);
    bale.translate(0, 0.55, 0);
    return tint(bale, (y) => straw.clone().lerp(shadowed, 1 - y / 1.1).multiplyScalar(rng.range(0.92, 1.08)));
}

function buildCone(): THREE.BufferGeometry {
    const orange = new THREE.Color(0xe8621f);
    const white = new THREE.Color(0xf2f2ee);
    const parts: THREE.BufferGeometry[] = [];

    const body = new THREE.ConeGeometry(0.22, 0.56, 8);
    body.translate(0, 0.28, 0);
    parts.push(tint(body, (y) => (y > 0.3 && y < 0.42 ? white : orange)));

    const base = new THREE.BoxGeometry(0.42, 0.05, 0.42);
    base.translate(0, 0.025, 0);
    parts.push(tint(base, () => orange));

    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    merged.computeVertexNormals();
    return merged;
}

interface PropBatch {
    geometry: THREE.BufferGeometry;
    transforms: THREE.Matrix4[];
    castShadow: boolean;
    name: string;
}

export function createProps(trackPath: TrackPath, terrain: Terrain, seed = 20482): PropsResult {
    const rng = new Rng(seed);
    const samples = trackPath.samples;
    const obstacles: Obstacle[] = [];

    const markers: PropBatch = { geometry: buildMarkerPost(), transforms: [], castShadow: true, name: "markers" };
    const tyres: PropBatch = { geometry: buildTyreStack(), transforms: [], castShadow: true, name: "tyre-stacks" };
    const bales: PropBatch = { geometry: buildHayBale(rng), transforms: [], castShadow: true, name: "hay-bales" };
    const cones: PropBatch = { geometry: buildCone(), transforms: [], castShadow: true, name: "cones" };

    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const positionVec = new THREE.Vector3();
    const scaleVec = new THREE.Vector3(1, 1, 1);

    const place = (
        batch: PropBatch,
        x: number,
        z: number,
        yaw: number,
        scale: number,
        obstacle: Omit<Obstacle, "x" | "z"> | null,
    ) => {
        euler.set(0, yaw, 0);
        quaternion.setFromEuler(euler);
        positionVec.set(x, terrain.getHeightAt(x, z) - 0.03, z);
        scaleVec.set(scale, scale, scale);
        matrix.compose(positionVec, quaternion, scaleVec);
        batch.transforms.push(matrix.clone());

        if (obstacle) {
            obstacles.push({ x, z, radius: obstacle.radius, height: obstacle.height, solidity: obstacle.solidity });
        }
    };

    let nextMarkerArc = 0;
    let nextTyreArc = 0;
    let nextConeArc = 0;

    for (const sample of samples) {
        const normalX = -sample.tangentZ;
        const normalZ = sample.tangentX;
        const yaw = Math.atan2(sample.tangentX, sample.tangentZ);
        const curvature = sample.curvature;
        const absCurvature = Math.abs(curvature);

        if (sample.arc >= nextMarkerArc) {
            nextMarkerArc = sample.arc + 13;
            for (const side of [1, -1]) {
                const lateral = side * (HALF_WIDTH + 2.1);
                const x = sample.x + normalX * lateral;
                const z = sample.z + normalZ * lateral;
                place(markers, x, z, yaw, rng.range(0.9, 1.1), {
                    radius: 0.2,
                    height: 1.05,
                    solidity: 0.12,
                });
            }
        }

        // Tyre walls line the outside of the quick corners.
        if (absCurvature > 0.032 && sample.arc >= nextTyreArc) {
            nextTyreArc = sample.arc + 1.35;
            const side = curvature > 0 ? -1 : 1;
            const lateral = side * (HALF_WIDTH + 3.0);
            const x = sample.x + normalX * lateral;
            const z = sample.z + normalZ * lateral;
            place(tyres, x, z, yaw + rng.range(-0.3, 0.3), rng.range(0.92, 1.06), {
                radius: 0.55,
                height: 0.85,
                solidity: 0.55,
            });
        }

        // Hay bales guard the inside apex of the slower corners.
        if (absCurvature > 0.04 && rng.next() > 0.955) {
            const side = curvature > 0 ? 1 : -1;
            const lateral = side * (HALF_WIDTH + rng.range(2.4, 3.4));
            const x = sample.x + normalX * lateral;
            const z = sample.z + normalZ * lateral;
            place(bales, x, z, yaw + rng.range(-0.25, 0.25), rng.range(0.9, 1.15), {
                radius: 0.7,
                height: 1.1,
                solidity: 0.45,
            });
        }

        // Cones mark the crests and dips so the jumps read from a distance.
        if (sample.arc >= nextConeArc && absCurvature < 0.008 && rng.next() > 0.8) {
            nextConeArc = sample.arc + 6;
            const side = rng.next() > 0.5 ? 1 : -1;
            const lateral = side * (HALF_WIDTH + rng.range(1.6, 2.0));
            const x = sample.x + normalX * lateral;
            const z = sample.z + normalZ * lateral;
            place(cones, x, z, yaw, rng.range(0.85, 1.15), null);
        }
    }

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0.05,
        flatShading: true,
    });

    const meshes: THREE.InstancedMesh[] = [];
    const batches = [markers, tyres, bales, cones];

    for (const batch of batches) {
        if (batch.transforms.length === 0) continue;

        const mesh = new THREE.InstancedMesh(batch.geometry, material, batch.transforms.length);
        mesh.castShadow = batch.castShadow;
        mesh.receiveShadow = true;
        mesh.name = batch.name;
        mesh.userData.nonCollidable = true;

        batch.transforms.forEach((transform, index) => mesh.setMatrixAt(index, transform));
        mesh.instanceMatrix.needsUpdate = true;
        mesh.computeBoundingSphere();
        meshes.push(mesh);
    }

    return {
        meshes,
        obstacles,
        dispose() {
            batches.forEach((batch) => batch.geometry.dispose());
            material.dispose();
            meshes.forEach((mesh) => mesh.dispose());
        },
    };
}
