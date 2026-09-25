import type * as THREE from "three";
import { TRACK_SURFACE_OFFSET } from "../../core/Config";
import { createTrack } from "../../map/Track";
import { PlacementGrid } from "../../map/Scatter";
import type { SurfaceKind, ThemeContent, TrackTheme } from "../types";
import { createFence } from "./Fence";
import { createFlora } from "./Flora";
import { createGardenProps } from "./GardenProps";
import { LAYOUT_POINTS, PLAY_RADIUS, gardenHeight } from "./GardenLayout";
import { createLawn } from "./Lawn";
import { createLeaves } from "./Leaves";
import { createPebbles } from "./Pebbles";
import { createPuddles } from "./Puddles";
import { createRaceProps } from "./RaceProps";
import { createSky } from "./Sky";

const SUN_DIRECTION: readonly [number, number, number] = [0.52, 0.76, 0.38];

const DIRT: SurfaceKind = {
    id: "dirt",
    grip: 1,
    drag: 0,
    speedScale: 1,
    dust: 0xa88a5c,
    skid: 0x2b1d0e,
    skidAlpha: 0.62,
};

const LAWN: SurfaceKind = {
    id: "lawn",
    grip: 0.62,
    drag: 5.5,
    speedScale: 0.58,
    dust: 0x5f7a32,
    skid: 0x2f3a14,
    skidAlpha: 0.3,
};

export const backyardTheme: TrackTheme = {
    id: "backyard",
    name: "Backyard Rally",
    location: "The back garden",
    description: "A dirt path through a giant lawn: molehills, a hose to hop and a watering-can spill.",
    laps: 4,
    layout: {
        points: LAYOUT_POINTS,
        elevationFeatures: [
            { t: 0.28, amplitude: 3.0, width: 0.032 },
            { t: 0.55, amplitude: -2.4, width: 0.05 },
            { t: 0.78, amplitude: 1.9, width: 0.035 },
        ],
        bankScale: 1,
        followTerrain: true,
    },
    environment: {
        background: 0xbfe0f4,
        fog: { color: 0xc6e3f4, density: 0.0022 },
        hemisphere: { sky: 0xcfe6ff, ground: 0x4d6a24, intensity: 0.7 },
        ambient: 0.05,
        sun: { color: 0xfff0d2, intensity: 2.7, direction: SUN_DIRECTION },
        exposure: 1.0,
        environmentIntensity: 0.38,
    },
    surfaces: { track: DIRT, offTrack: LAWN },
    bounds: { kind: "circle", radius: PLAY_RADIUS },
    fallHeight: null,
    gradeRoad: true,
    roadLift: TRACK_SURFACE_OFFSET,
    baseHeight: gardenHeight,

    build({ trackPath, terrain, quality }): ThemeContent {
        const grid = new PlacementGrid(8);

        // Big props claim their ground first; the flora then grows around them.
        const garden = createGardenProps(terrain, grid);
        const race = createRaceProps(trackPath, terrain, quality, grid);
        const puddles = createPuddles(terrain, TRACK_SURFACE_OFFSET);
        const pebbles = createPebbles(terrain, Math.round(quality.rockCount * 1.6), grid);
        const flora = createFlora(trackPath, terrain, quality, grid);
        const fence = createFence(terrain);
        const leaves = createLeaves(trackPath, terrain, quality, grid);

        const sky = createSky({ top: 0x3d86d6, horizon: 0xcfe7f6, sunDirection: SUN_DIRECTION });
        // The lawn is gentle; ~1.6-unit spacing still resolves the molehills.
        const lawn = createLawn(terrain, Math.min(quality.groundSegments, 204));
        const road = createTrack(trackPath, terrain);

        const objects: THREE.Object3D[] = [
            sky.mesh,
            lawn.mesh,
            road.roadMesh,
            ...garden.meshes,
            ...race.meshes,
            ...puddles.meshes,
            ...pebbles.meshes,
            ...flora.meshes,
            ...fence.meshes,
        ];
        if (road.kerbMesh) objects.push(road.kerbMesh);

        return {
            objects,
            obstacles: [...garden.obstacles, ...race.obstacles, ...pebbles.obstacles, ...flora.obstacles],
            patches: puddles.patches,
            debris: [leaves.spec],
            update(elapsed) {
                sky.update(elapsed);
            },
            dispose() {
                sky.dispose();
                lawn.dispose();
                road.dispose();
                garden.dispose();
                race.dispose();
                puddles.dispose();
                pebbles.dispose();
                flora.dispose();
                fence.dispose();
                leaves.dispose();
            },
        };
    },
};
