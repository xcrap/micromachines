import type * as THREE from "three";
import type { QualityTier } from "../core/Config";
import type { SurfaceState } from "../car/CarPhysics";
import type { Obstacle } from "../map/Scatter";
import type { Terrain } from "../map/Terrain";
import type { TrackPath } from "../map/TrackPath";

export type TrackId = "breakfast" | "backyard";

/** Physical and visual response of whatever the tyres are touching. */
export interface SurfaceKind extends SurfaceState {
    readonly id: string;
    /** Colour of the dust or spray the wheels kick up; null means the surface stays clean. */
    readonly dust: number | null;
    /** Colour of tyre marks; null means the surface takes no marks. */
    readonly skid: number | null;
    /** Peak opacity of a full-intensity skid mark. */
    readonly skidAlpha: number;
}

/** An elliptical patch that overrides the surface underneath it — puddles, spills, mud. */
export interface SurfacePatch {
    x: number;
    z: number;
    radiusX: number;
    radiusZ: number;
    /** Yaw of the ellipse's X axis, radians. */
    rotation: number;
    surface: SurfaceKind;
}

export interface DebrisItem {
    x: number;
    z: number;
    yaw: number;
    scale?: number;
    color?: THREE.Color;
}

/**
 * Loose, pushable clutter such as cereal hoops or sugar cubes. The engine owns the
 * simulation and the instanced mesh; the theme owns (and disposes) geometry and material.
 */
export interface DebrisSpec {
    name: string;
    geometry: THREE.BufferGeometry;
    material: THREE.Material;
    items: DebrisItem[];
    /** Collision radius at scale 1. */
    radius: number;
    /** Height of the item's origin above the ground when it lies at rest, at scale 1. */
    restHeight: number;
    /** 0 = feather light and flies everywhere, 1 = heavy and barely shifts. */
    mass: number;
    castShadow: boolean;
}

export type WorldBounds =
    | { kind: "circle"; radius: number }
    | { kind: "rect"; halfX: number; halfZ: number };

export interface ThemeEnvironment {
    /** Clear colour behind everything. */
    background: number;
    fog: { color: number; density: number };
    hemisphere: { sky: number; ground: number; intensity: number };
    ambient: number;
    sun: { color: number; intensity: number; direction: readonly [number, number, number] };
    exposure: number;
    /** Strength of the image-based lighting used for reflections on paint, ceramics and metal. */
    environmentIntensity: number;
}

export interface TrackLayout {
    /** Angle (deg) / radius pairs. Strictly increasing angles keep the loop star-shaped, so it can never self-intersect. */
    points: readonly (readonly [number, number])[];
    /** Gaussian bumps layered onto the elevation profile. */
    elevationFeatures: readonly { t: number; amplitude: number; width: number }[];
    /** Multiplier on curvature-driven corner banking. 0 keeps the road level. */
    bankScale: number;
    /** When true the centreline elevation follows the smoothed base terrain; otherwise it only carries the features. */
    followTerrain: boolean;
}

export interface ThemeBuildContext {
    trackPath: TrackPath;
    terrain: Terrain;
    quality: QualityTier;
}

export interface ThemeContent {
    objects: THREE.Object3D[];
    obstacles: Obstacle[];
    patches: SurfacePatch[];
    debris: DebrisSpec[];
    update?(elapsed: number): void;
    dispose(): void;
}

export interface TrackTheme {
    readonly id: TrackId;
    readonly name: string;
    readonly location: string;
    readonly description: string;
    readonly laps: number;
    readonly layout: TrackLayout;
    readonly environment: ThemeEnvironment;
    readonly surfaces: { track: SurfaceKind; offTrack: SurfaceKind };
    /** Hard edge of the playable area; null lets cars roam (and fall) freely. */
    readonly bounds: WorldBounds | null;
    /** A car below this height has fallen out of the world and is respawned. Null disables falling. */
    readonly fallHeight: number | null;
    /**
     * When true the road corridor is graded and banked into `baseHeight`; when false the
     * drivable surface is exactly `baseHeight` everywhere.
     */
    readonly gradeRoad: boolean;
    /** How far a drawn road ribbon floats above the graded ground; the physics surface follows it on the road. */
    readonly roadLift: number;
    /** Height of the world before the road is graded in. Must not depend on the track. */
    baseHeight(x: number, z: number): number;
    build(context: ThemeBuildContext): ThemeContent;
}
