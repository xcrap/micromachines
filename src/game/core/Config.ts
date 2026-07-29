/** Half-extent of the playable world. The rim hills start rising before this. */
export const WORLD_RADIUS = 118;

/** Ground plane covers a little more than the play area so the horizon is never a hard edge. */
export const GROUND_SIZE = 300;

/** Drivable width of the dirt road. */
export const TRACK_WIDTH = 11;

/** Extra geometry on each side of the road used for the ragged, noise-eaten edge. */
export const TRACK_EDGE_BLEED = 3.2;

/** The road mesh floats this far above the graded terrain corridor. */
export const TRACK_SURFACE_OFFSET = 0.06;

/** How far from the centreline the terrain is still pulled toward the road elevation. */
export const CORRIDOR_BLEND_RANGE = 15;

export const SKY_TOP_COLOR = 0x2f6ec4;
export const SKY_HORIZON_COLOR = 0xb9d9ef;
export const FOG_COLOR = 0xc2dcef;
export const FOG_DENSITY = 0.0055;

export const SUN_DIRECTION: readonly [number, number, number] = [0.55, 0.72, 0.42];

export interface QualityTier {
    readonly name: "low" | "medium" | "high";
    readonly maxPixelRatio: number;
    readonly shadowMapSize: number;
    readonly shadowRadius: number;
    readonly treeCount: number;
    readonly rockCount: number;
    readonly groundSegments: number;
    readonly particleCount: number;
}

export const QUALITY_TIERS: Record<QualityTier["name"], QualityTier> = {
    low: {
        name: "low",
        maxPixelRatio: 1,
        shadowMapSize: 1024,
        shadowRadius: 34,
        treeCount: 70,
        rockCount: 40,
        groundSegments: 160,
        particleCount: 160,
    },
    medium: {
        name: "medium",
        maxPixelRatio: 1.5,
        shadowMapSize: 2048,
        shadowRadius: 40,
        treeCount: 130,
        rockCount: 70,
        groundSegments: 220,
        particleCount: 260,
    },
    high: {
        name: "high",
        maxPixelRatio: 2,
        shadowMapSize: 2048,
        shadowRadius: 46,
        treeCount: 180,
        rockCount: 95,
        groundSegments: 288,
        particleCount: 380,
    },
};

export function detectQualityTier(): QualityTier {
    if (typeof navigator === "undefined") return QUALITY_TIERS.medium;

    const cores = navigator.hardwareConcurrency ?? 4;
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 4;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile || cores <= 4 || deviceMemory <= 4) return QUALITY_TIERS.low;
    if (cores >= 8 && deviceMemory >= 8) return QUALITY_TIERS.high;
    return QUALITY_TIERS.medium;
}
