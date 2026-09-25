import { CORRIDOR_BLEND_RANGE, TRACK_WIDTH } from "../core/Config";
import type { TrackPath } from "./TrackPath";

const ROAD_EDGE = TRACK_WIDTH / 2 + 0.75;
const CORRIDOR_HALF_WIDTH = TRACK_WIDTH / 2;

export function smootherstep(edge0: number, edge1: number, x: number): number {
    const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return t * t * t * (t * (t * 6 - 15) + 10);
}

export type HeightFunction = (x: number, z: number) => number;

export class Terrain {
    constructor(
        private readonly trackPath: TrackPath,
        private readonly baseHeight: HeightFunction,
        private readonly gradeRoad: boolean,
    ) {}

    /** Final ground height, with the road corridor graded and banked into it where the theme asks for it. */
    public getHeightAt(x: number, z: number): number {
        const base = this.baseHeight(x, z);
        if (!this.gradeRoad) return base;

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
        const base = this.baseHeight(x, z);
        const query = this.trackPath.query(x, z);
        out.trackDistance = query.distance;

        if (!this.gradeRoad || query.distance >= CORRIDOR_BLEND_RANGE) {
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
