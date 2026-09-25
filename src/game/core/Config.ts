/** Physics runs on this fixed step so handling is frame-rate independent. */
export const PHYSICS_STEP = 1 / 120;

/** Drivable width of the dirt road. */
export const TRACK_WIDTH = 11;

/** Extra geometry on each side of the road used for the ragged, noise-eaten edge. */
export const TRACK_EDGE_BLEED = 3.2;

/** The road mesh floats this far above the graded terrain corridor. */
export const TRACK_SURFACE_OFFSET = 0.06;

/** How far from the centreline the terrain is still pulled toward the road elevation. */
export const CORRIDOR_BLEND_RANGE = 15;

export interface QualityTier {
    readonly name: "low" | "medium" | "high";
    readonly maxPixelRatio: number;
    /** Tilt-shift and colour grading; off on the low tier, which renders straight to the canvas. */
    readonly postProcessing: boolean;
    readonly msaaSamples: number;
    readonly shadowMapSize: number;
    readonly shadowRadius: number;
    readonly rockCount: number;
    readonly groundSegments: number;
    readonly particleCount: number;
}

export const QUALITY_TIERS: Record<QualityTier["name"], QualityTier> = {
    low: {
        name: "low",
        maxPixelRatio: 1,
        postProcessing: false,
        msaaSamples: 0,
        shadowMapSize: 1024,
        shadowRadius: 34,
        rockCount: 40,
        groundSegments: 160,
        particleCount: 360,
    },
    medium: {
        name: "medium",
        maxPixelRatio: 1.5,
        postProcessing: true,
        msaaSamples: 4,
        shadowMapSize: 2048,
        shadowRadius: 40,
        rockCount: 70,
        groundSegments: 220,
        particleCount: 640,
    },
    high: {
        name: "high",
        maxPixelRatio: 2,
        postProcessing: true,
        msaaSamples: 4,
        shadowMapSize: 2048,
        shadowRadius: 46,
        rockCount: 95,
        groundSegments: 288,
        particleCount: 900,
    },
};

export function detectQualityTier(): QualityTier {
    if (typeof navigator === "undefined") return QUALITY_TIERS.medium;

    const cores = navigator.hardwareConcurrency ?? 4;
    // Only Chromium exposes device memory; elsewhere judge by cores alone rather than assume a weak machine.
    const deviceMemory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
    const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

    if (isMobile || cores <= 4 || (deviceMemory !== undefined && deviceMemory <= 4)) return QUALITY_TIERS.low;
    if (cores >= 8 && (deviceMemory === undefined || deviceMemory >= 8)) return QUALITY_TIERS.high;
    return QUALITY_TIERS.medium;
}
