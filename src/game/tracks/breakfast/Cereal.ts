import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TRACK_WIDTH, type QualityTier } from "../../core/Config";
import { Rng } from "../../core/Random";
import type { TrackPath } from "../../map/TrackPath";
import type { DebrisItem, DebrisSpec } from "../types";

const BORDER_OFFSET = TRACK_WIDTH / 2 + 0.7;
const SECOND_ROW_GAP = 1.25;
const TIGHT_CORNER_RADIUS = 42;

/** Fruity hoops pop against honey oak far better than plain ones would. */
const FRUITY = [0xe0342b, 0xff8a1f, 0xffd23a, 0x5cbf3a, 0x8e4fd1, 0xff5f98].map((hex) => new THREE.Color(hex));
const HONEY = [0xd99a3a, 0xe8b04e, 0xcf8a2c].map((hex) => new THREE.Color(hex));

export interface CerealSpill {
    x: number;
    z: number;
    /** Direction the cereal pours out, radians (0 = +X). */
    direction: number;
    count: number;
}

export interface CerealResult {
    debris: DebrisSpec[];
    dispose(): void;
}

/**
 * Places hoops along a line offset from the centreline at even spacing measured on the
 * offset line itself, so the inside of tight bends does not bunch up.
 */
function lineHoops(
    trackPath: TrackPath,
    lateral: (index: number) => number | null,
    spacing: number,
    rng: Rng,
    keep: (x: number, z: number) => boolean,
    out: DebrisItem[],
): void {
    const samples = trackPath.samples;
    const count = samples.length;
    let carried = rng.next() * spacing;
    let previousX = 0;
    let previousZ = 0;
    let hasPrevious = false;

    for (let i = 0; i <= count; i++) {
        const sample = samples[i % count];
        const offset = lateral(i % count);
        if (offset === null) {
            hasPrevious = false;
            continue;
        }

        const x = sample.x - sample.tangentZ * offset;
        const z = sample.z + sample.tangentX * offset;

        if (hasPrevious) {
            const dx = x - previousX;
            const dz = z - previousZ;
            const length = Math.hypot(dx, dz);
            let travelled = spacing - carried;

            while (travelled <= length) {
                const t = travelled / length;
                const hx = previousX + dx * t + (rng.next() - 0.5) * 0.22;
                const hz = previousZ + dz * t + (rng.next() - 0.5) * 0.22;
                if (keep(hx, hz)) {
                    out.push({ x: hx, z: hz, yaw: rng.next() * Math.PI, scale: rng.range(0.92, 1.1), color: rng.pick(FRUITY) });
                }
                travelled += spacing;
            }
            carried = length - (travelled - spacing);
        }

        previousX = x;
        previousZ = z;
        hasPrevious = true;
    }
}

export function createCereal(
    trackPath: TrackPath,
    quality: QualityTier,
    spills: readonly CerealSpill[],
    sugarSpots: readonly { x: number; z: number; radius: number; count: number }[],
    keep: (x: number, z: number) => boolean,
): CerealResult {
    const rng = new Rng(4242);
    const low = quality.name === "low";
    const spacing = low ? 1.75 : 1.3;

    const hoops: DebrisItem[] = [];
    const samples = trackPath.samples;

    for (const side of [1, -1]) {
        lineHoops(trackPath, () => side * BORDER_OFFSET, spacing, rng, keep, hoops);
    }

    if (!low) {
        // A second row on the outside of the tight corners, where cars actually hit the wall.
        for (const side of [1, -1]) {
            lineHoops(
                trackPath,
                (index) => {
                    const curvature = samples[index].curvature;
                    const outside = -Math.sign(curvature);
                    return Math.abs(curvature) > 1 / TIGHT_CORNER_RADIUS && outside === side
                        ? side * (BORDER_OFFSET + SECOND_ROW_GAP)
                        : null;
                },
                spacing,
                rng,
                keep,
                hoops,
            );
        }
    }

    const spilled: DebrisItem[] = [];
    for (const spill of spills) {
        const count = low ? Math.round(spill.count * 0.5) : spill.count;
        for (let i = 0; i < count; i++) {
            const distance = Math.pow(rng.next(), 0.7) * 14;
            const angle = spill.direction + (rng.next() - 0.5) * (0.5 + distance * 0.05);
            spilled.push({
                x: spill.x + Math.cos(angle) * distance,
                z: spill.z + Math.sin(angle) * distance,
                yaw: rng.next() * Math.PI,
                scale: rng.range(0.9, 1.1),
                color: rng.pick(HONEY),
            });
        }
    }

    const hoopGeometry = new THREE.TorusGeometry(0.44, 0.17, low ? 4 : 5, low ? 8 : 10);
    hoopGeometry.rotateX(Math.PI / 2);
    const hoopMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.72, metalness: 0 });

    const cubes: DebrisItem[] = [];
    for (const spot of sugarSpots) {
        for (let i = 0; i < spot.count; i++) {
            const angle = rng.next() * Math.PI * 2;
            const distance = Math.sqrt(rng.next()) * spot.radius;
            cubes.push({
                x: spot.x + Math.cos(angle) * distance,
                z: spot.z + Math.sin(angle) * distance,
                yaw: rng.next() * Math.PI,
                scale: rng.range(0.9, 1.05),
            });
        }
    }

    const cubeGeometry = new RoundedBoxGeometry(1.5, 1.5, 1.5, 1, 0.18);
    const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0xfbfaf6, roughness: 0.85, metalness: 0 });

    const debris: DebrisSpec[] = [
        {
            name: "cereal-border",
            geometry: hoopGeometry,
            material: hoopMaterial,
            items: [...hoops, ...spilled],
            radius: 0.62,
            restHeight: 0.17,
            mass: 0.12,
            castShadow: true,
        },
        {
            name: "sugar-cubes",
            geometry: cubeGeometry,
            material: cubeMaterial,
            items: cubes,
            radius: 0.95,
            restHeight: 0.75,
            mass: 0.4,
            castShadow: true,
        },
    ];

    return {
        debris,
        dispose() {
            hoopGeometry.dispose();
            hoopMaterial.dispose();
            cubeGeometry.dispose();
            cubeMaterial.dispose();
        },
    };
}
