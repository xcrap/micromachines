import * as THREE from "three";

export interface TrackSample {
    x: number;
    z: number;
    elevation: number;
    tangentX: number;
    tangentZ: number;
    curvature: number;
    bank: number;
    arc: number;
}

export interface TrackQuery {
    /** Absolute XZ distance to the centreline. */
    distance: number;
    /** Signed lateral offset, positive to the right of the travel direction. */
    signedOffset: number;
    /** Normalised position along the lap, 0..1. */
    t: number;
    elevation: number;
    bank: number;
    tangentX: number;
    tangentZ: number;
    curvature: number;
}

/** Angle (deg) / radius pairs. Strictly increasing angles keep the loop star-shaped, so it can never self-intersect. */
const LAYOUT: readonly (readonly [number, number])[] = [
    [0, 80], [20, 78], [42, 70], [60, 55], [76, 47], [95, 51],
    [115, 66], [135, 74], [158, 71], [178, 59], [196, 46], [212, 44],
    [232, 55], [254, 70], [276, 80], [300, 83], [325, 85], [348, 82],
];

/** Gaussian bumps layered onto the elevation profile to give the lap real character. */
const ELEVATION_FEATURES: readonly { t: number; amplitude: number; width: number }[] = [
    { t: 0.28, amplitude: 3.0, width: 0.032 },
    { t: 0.55, amplitude: -2.4, width: 0.05 },
    { t: 0.78, amplitude: 1.9, width: 0.035 },
];

const SAMPLE_COUNT = 768;
const CELL_SIZE = 5;
const MAX_SEARCH_RINGS = 6;
const MAX_BANK_SLOPE = 0.2;
const MAX_GRADE = 0.26;

export class TrackPath {
    readonly samples: TrackSample[] = [];
    readonly totalLength: number;

    private readonly minX: number;
    private readonly minZ: number;
    private readonly cellsX: number;
    private readonly cellsZ: number;
    private readonly cellStart: Int32Array;
    private readonly cellItems: Int32Array;

    private readonly _query: TrackQuery = {
        distance: 0,
        signedOffset: 0,
        t: 0,
        elevation: 0,
        bank: 0,
        tangentX: 0,
        tangentZ: 1,
        curvature: 0,
    };

    constructor(baseHeightAt: (x: number, z: number) => number) {
        const controlPoints = LAYOUT.map(([degrees, radius]) => {
            const angle = (degrees * Math.PI) / 180;
            return new THREE.Vector3(Math.cos(angle) * radius, 0, Math.sin(angle) * radius);
        });

        const curve = new THREE.CatmullRomCurve3(controlPoints, true, "catmullrom", 0.35);
        const raw = curve.getSpacedPoints(SAMPLE_COUNT);
        raw.pop();

        for (const point of raw) {
            this.samples.push({
                x: point.x,
                z: point.z,
                elevation: 0,
                tangentX: 0,
                tangentZ: 1,
                curvature: 0,
                bank: 0,
                arc: 0,
            });
        }

        this.totalLength = this.computeTangentsAndArc();
        this.computeCurvature();
        this.computeElevation(baseHeightAt);
        this.computeBanking();

        let minX = Infinity;
        let minZ = Infinity;
        let maxX = -Infinity;
        let maxZ = -Infinity;
        for (const sample of this.samples) {
            minX = Math.min(minX, sample.x);
            minZ = Math.min(minZ, sample.z);
            maxX = Math.max(maxX, sample.x);
            maxZ = Math.max(maxZ, sample.z);
        }

        this.minX = minX - CELL_SIZE;
        this.minZ = minZ - CELL_SIZE;
        this.cellsX = Math.ceil((maxX - minX) / CELL_SIZE) + 3;
        this.cellsZ = Math.ceil((maxZ - minZ) / CELL_SIZE) + 3;

        const built = this.buildSpatialIndex();
        this.cellStart = built.cellStart;
        this.cellItems = built.cellItems;
    }

    private computeTangentsAndArc(): number {
        const count = this.samples.length;
        let arc = 0;

        for (let i = 0; i < count; i++) {
            const previous = this.samples[(i - 1 + count) % count];
            const next = this.samples[(i + 1) % count];
            const dx = next.x - previous.x;
            const dz = next.z - previous.z;
            const length = Math.hypot(dx, dz) || 1;

            this.samples[i].tangentX = dx / length;
            this.samples[i].tangentZ = dz / length;
            this.samples[i].arc = arc;

            const current = this.samples[i];
            const forward = this.samples[(i + 1) % count];
            arc += Math.hypot(forward.x - current.x, forward.z - current.z);
        }

        return arc;
    }

    private computeCurvature(): void {
        const count = this.samples.length;
        const raw = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            const current = this.samples[i];
            const next = this.samples[(i + 1) % count];
            const segmentLength = Math.hypot(next.x - current.x, next.z - current.z) || 1;

            // Signed turn rate: positive means the road bends to the driver's right.
            const cross = current.tangentX * next.tangentZ - current.tangentZ * next.tangentX;
            const dot = current.tangentX * next.tangentX + current.tangentZ * next.tangentZ;
            raw[i] = Math.atan2(cross, dot) / segmentLength;
        }

        const smoothed = smoothCircular(raw, 9, 2);
        for (let i = 0; i < count; i++) {
            this.samples[i].curvature = smoothed[i];
        }
    }

    private computeElevation(baseHeightAt: (x: number, z: number) => number): void {
        const count = this.samples.length;
        const elevation = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            elevation[i] = baseHeightAt(this.samples[i].x, this.samples[i].z);
        }

        let profile = smoothCircular(elevation, 46, 3);

        for (let i = 0; i < count; i++) {
            const t = i / count;
            for (const feature of ELEVATION_FEATURES) {
                let delta = t - feature.t;
                if (delta > 0.5) delta -= 1;
                if (delta < -0.5) delta += 1;
                profile[i] += feature.amplitude * Math.exp(-(delta * delta) / (feature.width * feature.width));
            }
        }

        this.limitGrade(profile);
        profile = smoothCircular(profile, 5, 2);
        this.limitGrade(profile);

        for (let i = 0; i < count; i++) {
            this.samples[i].elevation = profile[i];
        }
    }

    private limitGrade(profile: Float32Array): void {
        const count = profile.length;

        for (let pass = 0; pass < 24; pass++) {
            let adjusted = false;

            for (let i = 0; i < count; i++) {
                const j = (i + 1) % count;
                const current = this.samples[i];
                const next = this.samples[j];
                const run = Math.hypot(next.x - current.x, next.z - current.z) || 1;
                const rise = profile[j] - profile[i];
                const maxRise = MAX_GRADE * run;
                const excess = Math.abs(rise) - maxRise;

                if (excess > 0) {
                    const correction = (Math.sign(rise) * excess) / 2;
                    profile[i] += correction;
                    profile[j] -= correction;
                    adjusted = true;
                }
            }

            if (!adjusted) break;
        }
    }

    private computeBanking(): void {
        const count = this.samples.length;
        const raw = new Float32Array(count);

        for (let i = 0; i < count; i++) {
            // Tight corners lean harder, but never past a slope the car can climb back out of.
            raw[i] = THREE.MathUtils.clamp(this.samples[i].curvature * 4.6, -MAX_BANK_SLOPE, MAX_BANK_SLOPE);
        }

        const smoothed = smoothCircular(raw, 18, 2);
        for (let i = 0; i < count; i++) {
            this.samples[i].bank = smoothed[i];
        }
    }

    private buildSpatialIndex(): { cellStart: Int32Array; cellItems: Int32Array } {
        const count = this.samples.length;
        const cellCount = this.cellsX * this.cellsZ;
        const counts = new Int32Array(cellCount + 1);
        const cellsForSegment: number[][] = new Array(count);

        for (let i = 0; i < count; i++) {
            const current = this.samples[i];
            const next = this.samples[(i + 1) % count];
            const cells: number[] = [];

            const cx0 = this.cellIndexX(Math.min(current.x, next.x));
            const cx1 = this.cellIndexX(Math.max(current.x, next.x));
            const cz0 = this.cellIndexZ(Math.min(current.z, next.z));
            const cz1 = this.cellIndexZ(Math.max(current.z, next.z));

            for (let cz = cz0; cz <= cz1; cz++) {
                for (let cx = cx0; cx <= cx1; cx++) {
                    const cell = cz * this.cellsX + cx;
                    cells.push(cell);
                    counts[cell + 1]++;
                }
            }

            cellsForSegment[i] = cells;
        }

        for (let i = 0; i < cellCount; i++) {
            counts[i + 1] += counts[i];
        }

        const cellStart = counts;
        const cellItems = new Int32Array(cellStart[cellCount]);
        const cursor = new Int32Array(cellCount);

        for (let i = 0; i < count; i++) {
            for (const cell of cellsForSegment[i]) {
                cellItems[cellStart[cell] + cursor[cell]] = i;
                cursor[cell]++;
            }
        }

        return { cellStart, cellItems };
    }

    private cellIndexX(x: number): number {
        return THREE.MathUtils.clamp(Math.floor((x - this.minX) / CELL_SIZE), 0, this.cellsX - 1);
    }

    private cellIndexZ(z: number): number {
        return THREE.MathUtils.clamp(Math.floor((z - this.minZ) / CELL_SIZE), 0, this.cellsZ - 1);
    }

    /**
     * Nearest-point lookup against the centreline. The returned object is reused between
     * calls, so copy anything you need to keep.
     */
    public query(x: number, z: number): Readonly<TrackQuery> {
        const count = this.samples.length;
        const centerX = this.cellIndexX(x);
        const centerZ = this.cellIndexZ(z);

        let bestDistSq = Infinity;
        let bestIndex = 0;
        let bestU = 0;
        let ringsAfterHit = 0;

        for (let ring = 0; ring < MAX_SEARCH_RINGS; ring++) {
            const minCx = Math.max(0, centerX - ring);
            const maxCx = Math.min(this.cellsX - 1, centerX + ring);
            const minCz = Math.max(0, centerZ - ring);
            const maxCz = Math.min(this.cellsZ - 1, centerZ + ring);

            for (let cz = minCz; cz <= maxCz; cz++) {
                const onZBorder = cz === centerZ - ring || cz === centerZ + ring;

                for (let cx = minCx; cx <= maxCx; cx++) {
                    // Only visit the newly added shell each iteration.
                    if (ring > 0 && !onZBorder && cx !== centerX - ring && cx !== centerX + ring) continue;

                    const cell = cz * this.cellsX + cx;
                    const start = this.cellStart[cell];
                    const end = this.cellStart[cell + 1];

                    for (let k = start; k < end; k++) {
                        const i = this.cellItems[k];
                        const current = this.samples[i];
                        const next = this.samples[(i + 1) % count];

                        const dx = next.x - current.x;
                        const dz = next.z - current.z;
                        const lengthSq = dx * dx + dz * dz;

                        let u = lengthSq > 0 ? ((x - current.x) * dx + (z - current.z) * dz) / lengthSq : 0;
                        u = u < 0 ? 0 : u > 1 ? 1 : u;

                        const px = current.x + dx * u;
                        const pz = current.z + dz * u;
                        const ex = x - px;
                        const ez = z - pz;
                        const distSq = ex * ex + ez * ez;

                        if (distSq < bestDistSq) {
                            bestDistSq = distSq;
                            bestIndex = i;
                            bestU = u;
                        }
                    }
                }
            }

            if (bestDistSq < Infinity) {
                ringsAfterHit++;
                // One extra shell guarantees we did not miss a closer segment in a diagonal cell.
                if (ringsAfterHit > 1) break;
            }
        }

        const result = this._query;

        if (bestDistSq === Infinity) {
            result.distance = 1e6;
            result.signedOffset = 1e6;
            result.t = 0;
            result.elevation = 0;
            result.bank = 0;
            result.tangentX = 0;
            result.tangentZ = 1;
            result.curvature = 0;
            return result;
        }

        const current = this.samples[bestIndex];
        const next = this.samples[(bestIndex + 1) % count];

        const tangentX = THREE.MathUtils.lerp(current.tangentX, next.tangentX, bestU);
        const tangentZ = THREE.MathUtils.lerp(current.tangentZ, next.tangentZ, bestU);
        const tangentLength = Math.hypot(tangentX, tangentZ) || 1;
        const tx = tangentX / tangentLength;
        const tz = tangentZ / tangentLength;

        const px = current.x + (next.x - current.x) * bestU;
        const pz = current.z + (next.z - current.z) * bestU;

        result.distance = Math.sqrt(bestDistSq);
        result.signedOffset = (x - px) * -tz + (z - pz) * tx;
        result.t = ((bestIndex + bestU) / count) % 1;
        result.elevation = THREE.MathUtils.lerp(current.elevation, next.elevation, bestU);
        result.bank = THREE.MathUtils.lerp(current.bank, next.bank, bestU);
        result.curvature = THREE.MathUtils.lerp(current.curvature, next.curvature, bestU);
        result.tangentX = tx;
        result.tangentZ = tz;

        return result;
    }

    public sampleAt(t: number): TrackSample {
        const count = this.samples.length;
        const wrapped = ((t % 1) + 1) % 1;
        return this.samples[Math.min(count - 1, Math.floor(wrapped * count))];
    }

    /** Surface height on the road at a given lateral offset, including corner banking. */
    public surfaceHeight(query: Readonly<TrackQuery>, halfWidth: number): number {
        const offset = THREE.MathUtils.clamp(query.signedOffset, -halfWidth, halfWidth);
        return query.elevation - query.bank * offset;
    }
}

function smoothCircular(values: Float32Array, radius: number, passes: number): Float32Array {
    const count = values.length;
    let source = Float32Array.from(values);
    let target = new Float32Array(count);

    for (let pass = 0; pass < passes; pass++) {
        for (let i = 0; i < count; i++) {
            let sum = 0;
            for (let k = -radius; k <= radius; k++) {
                sum += source[(i + k + count * 2) % count];
            }
            target[i] = sum / (radius * 2 + 1);
        }

        const swap = source;
        source = target;
        target = swap;
    }

    return source;
}
