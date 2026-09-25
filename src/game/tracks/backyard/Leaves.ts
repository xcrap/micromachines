import * as THREE from "three";
import { Rng } from "../../core/Random";
import { TRACK_WIDTH, type QualityTier } from "../../core/Config";
import type { TrackPath } from "../../map/TrackPath";
import type { Terrain } from "../../map/Terrain";
import type { PlacementGrid } from "../../map/Scatter";
import type { DebrisItem, DebrisSpec } from "../types";

const AUTUMN = [0xd9822b, 0xc2451e, 0xe8b23a, 0x9a5c2a, 0xb8372a, 0xa9a83c, 0xe06a24];

/** A fallen leaf lying flat along +X: pointed tip, stalk, edges curled up and a lighter midrib. */
function buildLeaf(): THREE.BufferGeometry {
    const stations = 9;
    const length = 3.9;
    const halfWidth = 1.1;
    const positions: number[] = [];
    const colors: number[] = [];

    const edge = (s: number, side: number) => {
        const width = halfWidth * Math.pow(Math.sin(Math.PI * s), 0.75) * (1 - 0.2 * s);
        const x = -length / 2 + length * s;
        const z = side * width;
        const y = 0.2 * Math.pow(Math.abs(z) / halfWidth, 2) + 0.12 * s * (1 - s);
        return [x, y, z];
    };
    const rib = (s: number) => [-length / 2 + length * s, 0.12 * s * (1 - s) - 0.02, 0];

    const push = (p: number[], shade: number) => {
        positions.push(p[0], p[1], p[2]);
        colors.push(shade, shade, shade);
    };

    for (let i = 0; i < stations; i++) {
        const s0 = i / stations;
        const s1 = (i + 1) / stations;
        for (const side of [-1, 1]) {
            const a = rib(s0);
            const b = rib(s1);
            const c = edge(s0, side);
            const d = edge(s1, side);
            const flip = side > 0;
            // Midrib lighter, blade slightly darker toward the edge.
            if (flip) {
                push(a, 1.08); push(d, 0.86); push(b, 1.08);
                push(a, 1.08); push(c, 0.86); push(d, 0.86);
            } else {
                push(a, 1.08); push(b, 1.08); push(d, 0.86);
                push(a, 1.08); push(d, 0.86); push(c, 0.86);
            }
        }
    }

    // Short stalk poking out behind the blade.
    const stalkColor = 0.7;
    push([-length / 2, 0.02, -0.07], stalkColor);
    push([-length / 2 - 0.7, 0.05, 0], stalkColor);
    push([-length / 2, 0.02, 0.07], stalkColor);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    // Leaves read as flat things lit from above, whichever way up they land.
    const normal = geometry.getAttribute("normal") as THREE.BufferAttribute;
    for (let i = 0; i < normal.count; i++) {
        const ny = Math.abs(normal.getY(i));
        normal.setXYZ(i, normal.getX(i) * 0.4, ny + 0.6, normal.getZ(i) * 0.4);
    }
    geometry.normalizeNormals();
    geometry.computeBoundingSphere();
    return geometry;
}

export function createLeaves(
    trackPath: TrackPath,
    terrain: Terrain,
    quality: QualityTier,
    grid: PlacementGrid,
    seed = 3131,
): { spec: DebrisSpec; dispose(): void } {
    const rng = new Rng(seed);
    const geometry = buildLeaf();
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.72,
        metalness: 0,
        side: THREE.DoubleSide,
    });

    const target = quality.name === "low" ? 60 : quality.name === "medium" ? 100 : 130;
    const items: DebrisItem[] = [];
    const samples = trackPath.samples;
    const start = samples[0];

    for (let attempt = 0; items.length < target && attempt < target * 30; attempt++) {
        const sample = samples[rng.int(samples.length)];
        // A fifth land on the path itself, where cars will kick them up.
        const onRoad = rng.next() < 0.22;
        const lateral = onRoad
            ? rng.range(-TRACK_WIDTH / 2 + 0.8, TRACK_WIDTH / 2 - 0.8)
            : (rng.next() > 0.5 ? 1 : -1) * rng.range(TRACK_WIDTH / 2 + 1.5, TRACK_WIDTH / 2 + 20);
        const x = sample.x - sample.tangentZ * lateral + rng.range(-1, 1);
        const z = sample.z + sample.tangentX * lateral + rng.range(-1, 1);

        if (Math.hypot(x - start.x, z - start.z) < 22) continue;
        if (!onRoad && !grid.canPlace(x, z, 1)) continue;
        if (terrain.getSlopeAt(x, z) > 0.35) continue;

        items.push({
            x,
            z,
            yaw: rng.next() * Math.PI * 2,
            scale: rng.range(0.9, 1.4),
            color: new THREE.Color(rng.pick(AUTUMN)).multiplyScalar(rng.range(0.85, 1.05)),
        });
    }

    return {
        spec: {
            name: "leaves",
            geometry,
            material,
            items,
            radius: 1.6,
            restHeight: 0.06,
            mass: 0.02,
            castShadow: true,
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
