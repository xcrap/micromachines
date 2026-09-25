import type { Obstacle } from "../../map/Scatter";
import type { SurfaceKind, ThemeContent, TrackTheme } from "../types";
import { createCereal } from "./Cereal";
import { FLOOR_HEIGHT, isOnTable } from "./Dimensions";
import { createKitchen } from "./Kitchen";
import { isNearRamp, rampHeight } from "./Ramp";
import { setTheTable } from "./Setting";
import { createSpills } from "./Spills";

const SUN_DIRECTION: readonly [number, number, number] = [-0.45, 0.78, 0.38];

const VARNISHED_WOOD: SurfaceKind = {
    id: "table",
    grip: 1,
    drag: 0,
    speedScale: 1,
    dust: null,
    skid: 0x1c120a,
    skidAlpha: 0.5,
};

const CRUMBS: SurfaceKind = {
    id: "crumbs",
    grip: 0.84,
    drag: 3,
    speedScale: 0.8,
    dust: 0xd9b57a,
    skid: 0x2a1a0c,
    skidAlpha: 0.3,
};

/** Loose cereal never starts inside a solid prop. */
function isClear(obstacles: readonly Obstacle[], x: number, z: number): boolean {
    for (const obstacle of obstacles) {
        const dx = x - obstacle.x;
        const dz = z - obstacle.z;
        if (obstacle.box) {
            const cos = Math.cos(obstacle.box.yaw);
            const sin = Math.sin(obstacle.box.yaw);
            const localX = dx * cos - dz * sin;
            const localZ = dx * sin + dz * cos;
            if (Math.abs(localX) < obstacle.box.halfX + 0.7 && Math.abs(localZ) < obstacle.box.halfZ + 0.7) return false;
        } else if (dx * dx + dz * dz < (obstacle.radius + 0.7) ** 2) {
            return false;
        }
    }
    return true;
}

function baseHeight(x: number, z: number): number {
    return isOnTable(x, z) ? rampHeight(x, z) : FLOOR_HEIGHT;
}

export const breakfastTheme: TrackTheme = {
    id: "breakfast",
    name: "Breakfast Bends",
    location: "The kitchen table",
    description: "Cereal-lined bends, spilt milk, a chopping-board jump and a long drop off the edge.",
    laps: 3,
    layout: {
        points: [
            [0, 84], [19.4, 90.1], [37.3, 95.6], [54.2, 88.5], [67.9, 80.0],
            [90, 34], [109.9, 76.5], [123, 88.4], [141.7, 96.8], [161.2, 93.0],
            [180, 88], [199.7, 89.2], [218.7, 89.6], [238, 75.5], [249.1, 44.9],
            [282.8, 45.1], [298, 72.5], [315, 90.5], [335.8, 87.7],
        ],
        elevationFeatures: [],
        bankScale: 0,
        followTerrain: false,
    },
    environment: {
        background: 0xf1e2c9,
        fog: { color: 0xf1e2c9, density: 0.0027 },
        hemisphere: { sky: 0xfff3e0, ground: 0x7a5236, intensity: 0.7 },
        ambient: 0.06,
        sun: { color: 0xffedd2, intensity: 2.5, direction: SUN_DIRECTION },
        exposure: 1.0,
        environmentIntensity: 0.75,
    },
    surfaces: { track: VARNISHED_WOOD, offTrack: CRUMBS },
    bounds: null,
    fallHeight: -12,
    gradeRoad: false,
    roadLift: 0,
    baseHeight,

    build({ trackPath, terrain, quality }): ThemeContent {
        const kitchen = createKitchen(terrain, quality, SUN_DIRECTION);
        const setting = setTheTable(quality);
        const spills = createSpills(setting.patches, quality);
        const cereal = createCereal(
            trackPath,
            quality,
            setting.spills,
            setting.sugarSpots,
            (x, z) => isOnTable(x, z) && !isNearRamp(x, z) && isClear(setting.obstacles, x, z),
        );

        return {
            objects: [...kitchen.objects, ...setting.objects, ...spills.objects],
            obstacles: setting.obstacles,
            patches: setting.patches,
            debris: cereal.debris,
            dispose() {
                kitchen.dispose();
                setting.dispose();
                spills.dispose();
                cereal.dispose();
            },
        };
    },
};
