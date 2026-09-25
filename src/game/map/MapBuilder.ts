import * as THREE from "three";
import { TRACK_WIDTH, type QualityTier } from "../core/Config";
import { updateWind } from "../core/Wind";
import { DebrisField } from "../effects/DebrisField";
import type { SurfaceKind, SurfacePatch, ThemeContent, TrackTheme } from "../tracks/types";
import { TrackPath, type TrackQuery } from "./TrackPath";
import { Terrain } from "./Terrain";
import { createFinishLine, type FinishLineResult } from "./FinishLine";
import type { Obstacle } from "./Scatter";

const DRIVABLE_HALF_WIDTH = TRACK_WIDTH / 2 + 1.2;
const OBSTACLE_CELL_SIZE = 8;

export interface GridSlot {
    x: number;
    z: number;
    heading: number;
}

/** Everything the cars can touch: the theme's world plus the shared race furniture. */
export class MapBuilder {
    private readonly scene: THREE.Scene;
    private readonly quality: QualityTier;
    private readonly theme: TrackTheme;

    private readonly trackPath: TrackPath;
    private readonly terrain: Terrain;

    private readonly roots: THREE.Object3D[] = [];
    private readonly obstacleCells = new Map<number, Obstacle[]>();
    private readonly patches: SurfacePatch[] = [];
    private readonly debris: DebrisField[] = [];

    private content: ThemeContent | null = null;
    private finishLine: FinishLineResult | null = null;

    private readonly _surfaceSample = { height: 0, trackDistance: 0 };
    private readonly heightAt = (x: number, z: number) => this.getSurfaceHeightAt(x, z);

    constructor(scene: THREE.Scene, quality: QualityTier, theme: TrackTheme) {
        this.scene = scene;
        this.quality = quality;
        this.theme = theme;
        this.trackPath = new TrackPath(theme.layout, (x, z) => theme.baseHeight(x, z));
        this.terrain = new Terrain(this.trackPath, (x, z) => theme.baseHeight(x, z), theme.gradeRoad);
    }

    public buildMap(): void {
        this.content = this.theme.build({
            trackPath: this.trackPath,
            terrain: this.terrain,
            quality: this.quality,
        });

        for (const object of this.content.objects) this.attach(object);
        this.registerObstacles(this.content.obstacles);
        this.patches.push(...this.content.patches);

        for (const spec of this.content.debris) {
            const field = new DebrisField(spec, this.heightAt);
            this.debris.push(field);
            this.attach(field.mesh);
        }

        this.finishLine = createFinishLine(this.trackPath, this.heightAt);
        this.attach(this.finishLine.group);
        this.registerObstacles(this.finishLine.obstacles);
    }

    private attach(object: THREE.Object3D): void {
        this.scene.add(object);
        this.roots.push(object);
    }

    private registerObstacles(obstacles: readonly Obstacle[]): void {
        for (const obstacle of obstacles) {
            const cx = Math.floor(obstacle.x / OBSTACLE_CELL_SIZE);
            const cz = Math.floor(obstacle.z / OBSTACLE_CELL_SIZE);
            const key = (cx + 2048) * 4096 + (cz + 2048);
            const bucket = this.obstacleCells.get(key);

            if (bucket) {
                bucket.push(obstacle);
            } else {
                this.obstacleCells.set(key, [obstacle]);
            }
        }
    }

    /** Visits every obstacle whose cell overlaps the query disc. Hot path — no allocations. */
    public forEachObstacleNear(x: number, z: number, radius: number, visit: (obstacle: Obstacle) => void): void {
        const reach = Math.ceil((radius + OBSTACLE_CELL_SIZE) / OBSTACLE_CELL_SIZE);
        const cx = Math.floor(x / OBSTACLE_CELL_SIZE);
        const cz = Math.floor(z / OBSTACLE_CELL_SIZE);

        for (let dz = -reach; dz <= reach; dz++) {
            for (let dx = -reach; dx <= reach; dx++) {
                const key = (cx + dx + 2048) * 4096 + (cz + dz + 2048);
                const bucket = this.obstacleCells.get(key);
                if (!bucket) continue;
                for (const obstacle of bucket) visit(obstacle);
            }
        }
    }

    /** Pushes loose debris out of a car's way and returns the fraction of speed the car loses. */
    public collideDebris(
        x: number,
        z: number,
        y: number,
        headingSin: number,
        headingCos: number,
        vx: number,
        vz: number,
    ): number {
        let drag = 0;
        for (const field of this.debris) {
            drag += field.collideCar(x, z, y, headingSin, headingCos, vx, vz);
        }
        return drag;
    }

    public getSurfaceHeightAt(x: number, z: number): number {
        // Ungraded worlds have no road to blend in, so skip the centreline lookup on this hot path.
        if (!this.theme.gradeRoad && this.theme.roadLift === 0) return this.theme.baseHeight(x, z);

        this.terrain.sampleSurface(x, z, this._surfaceSample);
        if (this.theme.roadLift === 0) return this._surfaceSample.height;

        const fade = 1 - THREE.MathUtils.smoothstep(this._surfaceSample.trackDistance, DRIVABLE_HALF_WIDTH, DRIVABLE_HALF_WIDTH + 2);
        return this._surfaceSample.height + this.theme.roadLift * fade;
    }

    public isPointOnTrack(x: number, z: number): boolean {
        return this.trackPath.query(x, z).distance <= DRIVABLE_HALF_WIDTH;
    }

    /** Patches win over the track, which wins over the open ground. */
    public getSurfaceAt(x: number, z: number, onTrack: boolean): SurfaceKind {
        for (const patch of this.patches) {
            const dx = x - patch.x;
            const dz = z - patch.z;
            const cos = Math.cos(patch.rotation);
            const sin = Math.sin(patch.rotation);
            const u = (dx * cos + dz * sin) / patch.radiusX;
            const v = (-dx * sin + dz * cos) / patch.radiusZ;
            if (u * u + v * v <= 1) return patch.surface;
        }
        return onTrack ? this.theme.surfaces.track : this.theme.surfaces.offTrack;
    }

    public queryTrack(x: number, z: number): Readonly<TrackQuery> {
        return this.trackPath.query(x, z);
    }

    public getTrackPath(): TrackPath {
        return this.trackPath;
    }

    public getTerrain(): Terrain {
        return this.terrain;
    }

    public getTheme(): TrackTheme {
        return this.theme;
    }

    /** Staggered two-wide grid behind the line; slot 0 is pole position. */
    public getGridSlot(slot: number, out: GridSlot): GridSlot {
        const back = 6 + slot * 3.4;
        const lateral = (slot % 2 === 0 ? -1 : 1) * 2.6;
        const sample = this.trackPath.sampleAt(-back / this.trackPath.totalLength);

        out.x = sample.x - sample.tangentZ * lateral;
        out.z = sample.z + sample.tangentX * lateral;
        out.heading = Math.atan2(sample.tangentX, sample.tangentZ);
        return out;
    }

    public setStartLights(lit: number, go: boolean): void {
        this.finishLine?.setStartLights(lit, go);
    }

    public update(elapsed: number, deltaTime: number): void {
        updateWind(elapsed);
        this.content?.update?.(elapsed);
        for (const field of this.debris) field.update(deltaTime);
    }

    /** Puts knocked-about clutter back for a fresh race. */
    public resetDynamic(): void {
        for (const field of this.debris) field.reset();
    }

    public dispose(): void {
        for (const root of this.roots) this.scene.remove(root);
        this.roots.length = 0;

        for (const field of this.debris) field.dispose();
        this.debris.length = 0;

        this.content?.dispose();
        this.content = null;
        this.finishLine?.dispose();
        this.finishLine = null;

        this.obstacleCells.clear();
        this.patches.length = 0;
    }
}
