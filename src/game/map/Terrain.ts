import { fbm2D, valueNoise2D } from "../core/Noise";
import { CORRIDOR_BLEND_RANGE, TRACK_WIDTH } from "../core/Config";
import type { TrackPath } from "./TrackPath";

const ROAD_EDGE = TRACK_WIDTH / 2 + 0.75;
const CORRIDOR_HALF_WIDTH = TRACK_WIDTH / 2;

function smootherstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Terrain before the road is carved into it. TrackPath samples this to build its
 * elevation profile, so it must not depend on the track.
 */
export function baseTerrainHeight(x: number, z: number): number {
    let height = (fbm2D(x * 0.0118, z * 0.0118, 4) - 0.5) * 17;
    height += (fbm2D(x * 0.041, z * 0.041, 3) - 0.5) * 3.6;
    height += (valueNoise2D(x * 0.13, z * 0.13) - 0.5) * 0.6;

    // A ring of hills closes the arena off and hides the edge of the ground plane.
    // Kept deliberately shallow — a steeper rim reads as a grey wall rather than landscape.
    const radius = Math.hypot(x, z);
    const rim = smootherstep(94, 176, radius);
    height += rim * rim * 34;
    height += rim * (fbm2D(x * 0.024, z * 0.024, 3) - 0.5) * 22;

    return height;
}

export class Terrain {
    constructor(private readonly trackPath: TrackPath) {}

    /** Final ground height with the road corridor graded and banked into it. */
    public getHeightAt(x: number, z: number): number {
        const base = baseTerrainHeight(x, z);
        const query = this.trackPath.query(x, z);

        if (query.distance >= CORRIDOR_BLEND_RANGE) return base;

        const road = this.trackPath.surfaceHeight(query, CORRIDOR_HALF_WIDTH);
        const blend = 1 - smootherstep(ROAD_EDGE, CORRIDOR_BLEND_RANGE, query.distance);

        return base + (road - base) * blend;
    }

    /** Distance from the centreline, used for shading the shoulder and for scatter masks. */
    public getTrackDistance(x: number, z: number): number {
        return this.trackPath.query(x, z).distance;
    }

    /** Height and centreline distance from a single spline lookup — used when building geometry. */
    public sampleSurface(x: number, z: number, out: { height: number; trackDistance: number }): void {
        const base = baseTerrainHeight(x, z);
        const query = this.trackPath.query(x, z);
        out.trackDistance = query.distance;

        if (query.distance >= CORRIDOR_BLEND_RANGE) {
            out.height = base;
            return;
        }

        const road = this.trackPath.surfaceHeight(query, CORRIDOR_HALF_WIDTH);
        const blend = 1 - smootherstep(ROAD_EDGE, CORRIDOR_BLEND_RANGE, query.distance);
        out.height = base + (road - base) * blend;
    }

    public getNormalAt(x: number, z: number, out: { x: number; y: number; z: number }): void {
        const step = 0.6;
        const dx = this.getHeightAt(x + step, z) - this.getHeightAt(x - step, z);
        const dz = this.getHeightAt(x, z + step) - this.getHeightAt(x, z - step);

        const nx = -dx;
        const nz = -dz;
        const ny = 2 * step;
        const length = Math.hypot(nx, ny, nz) || 1;

        out.x = nx / length;
        out.y = ny / length;
        out.z = nz / length;
    }

    /** 0 on flat ground, 1 on a wall. Cheap slope probe for scatter rules and shading. */
    public getSlopeAt(x: number, z: number): number {
        const step = 1.2;
        const dx = (this.getHeightAt(x + step, z) - this.getHeightAt(x - step, z)) / (2 * step);
        const dz = (this.getHeightAt(x, z + step) - this.getHeightAt(x, z - step)) / (2 * step);
        return Math.min(1, Math.hypot(dx, dz));
    }
}
