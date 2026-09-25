import * as THREE from "three";
import { fbm2D, valueNoise2D } from "../../core/Noise";
import { smootherstep } from "../../map/Terrain";

/** Angle (deg) / radius pairs for the lap; shared with the theme layout. */
export const LAYOUT_POINTS: readonly (readonly [number, number])[] = [
    [0, 80], [20, 78], [42, 70], [60, 55], [76, 47], [95, 51],
    [115, 66], [135, 74], [158, 71], [178, 59], [196, 46], [212, 44],
    [232, 55], [254, 70], [276, 80], [300, 83], [325, 85], [348, 82],
];

/** The garden fence is a square this far from the centre on each side. */
export const FENCE_HALF = 150;
/** Cars are kept inside this radius, so the chase camera never ends up behind the fence. */
export const PLAY_RADIUS = 112;
/** Half-size of the lawn mesh; it runs a little under the fence so its edge is never seen. */
export const GROUND_HALF = 166;
/** Raised flower beds start this far from the centre (square distance). */
export const BED_START = 127;
export const HOSE_RADIUS = 0.55;

interface Mound {
    x: number;
    z: number;
    radius: number;
    height: number;
}

interface HoseChunk {
    points: Float32Array;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

/**
 * The lap is rebuilt here from the same spline TrackPath uses, because `baseHeight` must not
 * depend on the TrackPath instance, yet molehills and the hose need to sit relative to the road.
 */
const loop = new THREE.CatmullRomCurve3(
    LAYOUT_POINTS.map(([degrees, radius]) => {
        const angle = (degrees * Math.PI) / 180;
        return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
    }),
    true,
    "catmullrom",
    0.35,
);
loop.arcLengthDivisions = 600;

const _point = new THREE.Vector3();
const _tangent = new THREE.Vector3();

/** Point `outward` units off the centreline at lap position t; negative values go into the infield. */
export function loopPoint(t: number, outward: number): { x: number; z: number; tx: number; tz: number } {
    const u = ((t % 1) + 1) % 1;
    loop.getPointAt(u, _point);
    loop.getTangentAt(u, _tangent);

    let nx = -_tangent.z;
    let nz = _tangent.x;
    if (nx * _point.x + nz * _point.z < 0) {
        nx = -nx;
        nz = -nz;
    }

    return { x: _point.x + nx * outward, z: _point.z + nz * outward, tx: _tangent.x, tz: _tangent.z };
}

function mound(t: number, outward: number, radius: number, height: number): Mound {
    const point = loopPoint(t, outward);
    return { x: point.x, z: point.z, radius, height };
}

export const MOLEHILLS: readonly Mound[] = [
    mound(0.07, 19, 3.6, 2.0),
    mound(0.2, -17, 3.2, 1.7),
    mound(0.215, -23, 2.6, 1.3),
    mound(0.37, 18, 4.0, 2.3),
    mound(0.5, 17, 3.4, 1.9),
    mound(0.66, -18, 3.8, 2.1),
    mound(0.74, 21, 3.0, 1.6),
    mound(0.96, -19, 3.5, 2.0),
    { x: -12, z: -18, radius: 4.2, height: 2.4 },
    { x: 20, z: 12, radius: 3.4, height: 1.8 },
];

function buildHosePath(): { x: number; z: number }[] {
    const points: { x: number; z: number }[] = [];
    const push = (x: number, z: number) => points.push({ x, z });

    // From the tap on the back fence down across the lawn…
    const tapX = 30;
    const tapZ = -FENCE_HALF + 3.2;
    const join = loopPoint(0.785, 14);
    for (let i = 0; i <= 14; i++) {
        const s = i / 14;
        const wobble = Math.sin(s * Math.PI * 2.2) * 4 * s * (1 - s);
        push(
            THREE.MathUtils.lerp(tapX, join.x - 6, s) + wobble,
            THREE.MathUtils.lerp(tapZ, join.z - 3, s),
        );
    }

    // …alongside the back straight…
    for (let i = 0; i <= 30; i++) {
        const t = 0.79 + (i / 30) * 0.1;
        const point = loopPoint(t, 13.5 + Math.sin(i * 0.32) * 0.8);
        push(point.x, point.z);
    }

    // …then off into a loose coil out on the lawn, entering the spiral on the side it arrives from.
    const last = points[points.length - 1];
    const coilX = 102;
    const coilZ = -54;
    const outerRadius = 8.5;
    const startAngle = Math.atan2(last.z - coilZ, last.x - coilX);
    const entryX = coilX + Math.cos(startAngle) * outerRadius;
    const entryZ = coilZ + Math.sin(startAngle) * outerRadius;
    for (let i = 1; i <= 6; i++) {
        const s = i / 6;
        push(THREE.MathUtils.lerp(last.x, entryX, s), THREE.MathUtils.lerp(last.z, entryZ, s));
    }
    const turns = 2.3;
    const steps = 70;
    for (let i = 1; i <= steps; i++) {
        const s = i / steps;
        const angle = startAngle + s * turns * Math.PI * 2;
        const radius = outerRadius - s * 4.8;
        push(coilX + Math.cos(angle) * radius, coilZ + Math.sin(angle) * radius);
    }

    return points;
}

export const HOSE_PATH: readonly { x: number; z: number }[] = buildHosePath();

const HOSE_CHUNKS: readonly HoseChunk[] = (() => {
    const chunks: HoseChunk[] = [];
    const size = 8;
    for (let start = 0; start < HOSE_PATH.length - 1; start += size) {
        const end = Math.min(HOSE_PATH.length - 1, start + size);
        const points = new Float32Array((end - start + 1) * 2);
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;
        for (let i = start; i <= end; i++) {
            const p = HOSE_PATH[i];
            points[(i - start) * 2] = p.x;
            points[(i - start) * 2 + 1] = p.z;
            minX = Math.min(minX, p.x);
            maxX = Math.max(maxX, p.x);
            minZ = Math.min(minZ, p.z);
            maxZ = Math.max(maxZ, p.z);
        }
        const pad = HOSE_RADIUS * 2;
        chunks.push({ points, minX: minX - pad, maxX: maxX + pad, minZ: minZ - pad, maxZ: maxZ + pad });
    }
    return chunks;
})();

/** Ridge where the hose lies on the lawn — cars that run wide bump over it. */
export function hoseBump(x: number, z: number): number {
    let best = Infinity;

    for (const chunk of HOSE_CHUNKS) {
        if (x < chunk.minX || x > chunk.maxX || z < chunk.minZ || z > chunk.maxZ) continue;
        const points = chunk.points;
        for (let i = 0; i + 3 < points.length; i += 2) {
            const ax = points[i];
            const az = points[i + 1];
            const dx = points[i + 2] - ax;
            const dz = points[i + 3] - az;
            const lengthSq = dx * dx + dz * dz || 1;
            const u = Math.min(1, Math.max(0, ((x - ax) * dx + (z - az) * dz) / lengthSq));
            const ex = x - (ax + dx * u);
            const ez = z - (az + dz * u);
            const distSq = ex * ex + ez * ez;
            if (distSq < best) best = distSq;
        }
    }

    if (best === Infinity) return 0;
    const reach = HOSE_RADIUS * 1.6;
    const distance = Math.sqrt(best);
    if (distance >= reach) return 0;
    const s = distance / reach;
    return HOSE_RADIUS * 2 * Math.cos(s * Math.PI * 0.5) ** 1.4;
}

function moundHeight(x: number, z: number): number {
    let height = 0;
    for (const hill of MOLEHILLS) {
        const dx = x - hill.x;
        const dz = z - hill.z;
        const distSq = dx * dx + dz * dz;
        const reach = hill.radius * 1.35;
        if (distSq >= reach * reach) continue;
        const s = Math.sqrt(distSq) / reach;
        height += hill.height * (1 - smootherstep(0, 1, s)) * (0.92 + valueNoise2D(x * 0.9, z * 0.9) * 0.16);
    }
    return height;
}

/** 0 on open lawn, 1 on bare soil — molehills and the raised beds along the fence. */
export function soilAmount(x: number, z: number): number {
    let soil = 0;
    for (const hill of MOLEHILLS) {
        const d = Math.hypot(x - hill.x, z - hill.z);
        soil = Math.max(soil, 1 - smootherstep(hill.radius * 0.8, hill.radius * 1.3, d));
    }
    const edge = Math.max(Math.abs(x), Math.abs(z));
    soil = Math.max(soil, smootherstep(BED_START - 1.5, BED_START + 2.5, edge));
    return soil;
}

/** Garden ground before the road is graded in, without the hose ridge. */
export function lawnHeight(x: number, z: number): number {
    let height = (fbm2D(x * 0.011, z * 0.011, 3) - 0.5) * 7.5;
    height += (valueNoise2D(x * 0.047, z * 0.047) - 0.5) * 1.1;

    const edge = Math.max(Math.abs(x), Math.abs(z));
    height += smootherstep(BED_START - 2, BED_START + 3, edge) * 2.2;
    // Lift the far corners a touch so the lawn never dips below the bottom rail of the fence.
    height += smootherstep(FENCE_HALF - 8, FENCE_HALF + 6, edge) * 1.5;

    return height + moundHeight(x, z);
}

export function gardenHeight(x: number, z: number): number {
    return lawnHeight(x, z) + hoseBump(x, z);
}
