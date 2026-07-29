import * as THREE from "three";
import { TRACK_SURFACE_OFFSET, TRACK_WIDTH, type QualityTier } from "../core/Config";
import { updateWind } from "../core/Wind";
import { TrackPath, type TrackQuery } from "./TrackPath";
import { Terrain, baseTerrainHeight } from "./Terrain";
import { createGround } from "./Ground";
import { createTrack } from "./Track";
import { createTrees } from "./Trees";
import { createRocks } from "./Rocks";
import { createProps } from "./Props";
import { createFinishLine, type FinishLineResult } from "./FinishLine";
import { createSky } from "./Sky";
import type { Obstacle } from "./Scatter";

const DRIVABLE_HALF_WIDTH = TRACK_WIDTH / 2 + 1.2;
const OBSTACLE_CELL_SIZE = 8;

export class MapBuilder {
    private readonly scene: THREE.Scene;
    private readonly quality: QualityTier;

    private readonly trackPath: TrackPath;
    private readonly terrain: Terrain;

    private readonly disposables: { dispose(): void }[] = [];
    private readonly roots: THREE.Object3D[] = [];
    private readonly obstacles: Obstacle[] = [];
    private readonly obstacleCells = new Map<number, Obstacle[]>();

    private sky: ReturnType<typeof createSky> | null = null;
    private finishLine: FinishLineResult | null = null;

    private readonly _surfaceSample = { height: 0, trackDistance: 0 };

    constructor(scene: THREE.Scene, quality: QualityTier) {
        this.scene = scene;
        this.quality = quality;
        this.trackPath = new TrackPath(baseTerrainHeight);
        this.terrain = new Terrain(this.trackPath);
    }

    public buildMap(): void {
        this.sky = createSky();
        this.add(this.sky.mesh, this.sky);

        const ground = createGround(this.terrain, this.quality.groundSegments);
        this.add(ground.mesh, ground);

        const track = createTrack(this.trackPath, this.terrain);
        this.add(track.roadMesh, track);
        if (track.kerbMesh) this.roots.push(this.attach(track.kerbMesh));

        this.finishLine = createFinishLine(this.trackPath, this.terrain);
        this.add(this.finishLine.group, this.finishLine);
        this.registerObstacles(this.finishLine.obstacles);

        const trees = createTrees(this.terrain, this.quality.treeCount);
        trees.meshes.forEach((mesh) => this.roots.push(this.attach(mesh)));
        this.disposables.push(trees);
        this.registerObstacles(trees.obstacles);

        const rocks = createRocks(this.terrain, this.quality.rockCount);
        rocks.meshes.forEach((mesh) => this.roots.push(this.attach(mesh)));
        this.disposables.push(rocks);
        this.registerObstacles(rocks.obstacles);

        const props = createProps(this.trackPath, this.terrain);
        props.meshes.forEach((mesh) => this.roots.push(this.attach(mesh)));
        this.disposables.push(props);
        this.registerObstacles(props.obstacles);
    }

    private add(object: THREE.Object3D, disposable: { dispose(): void }): void {
        this.roots.push(this.attach(object));
        this.disposables.push(disposable);
    }

    private attach(object: THREE.Object3D): THREE.Object3D {
        this.scene.add(object);
        return object;
    }

    private registerObstacles(obstacles: readonly Obstacle[]): void {
        for (const obstacle of obstacles) {
            this.obstacles.push(obstacle);

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

    public getSurfaceHeightAt(x: number, z: number): number {
        this.terrain.sampleSurface(x, z, this._surfaceSample);
        const fade = 1 - THREE.MathUtils.smoothstep(this._surfaceSample.trackDistance, DRIVABLE_HALF_WIDTH, DRIVABLE_HALF_WIDTH + 2);
        return this._surfaceSample.height + TRACK_SURFACE_OFFSET * fade;
    }

    public isPointOnTrack(x: number, z: number): boolean {
        return this.trackPath.query(x, z).distance <= DRIVABLE_HALF_WIDTH;
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

    public getStartPosition(): THREE.Vector3 {
        const start = this.trackPath.samples[0];
        // Line up a couple of car lengths behind the painted line.
        const backOff = 6;
        const x = start.x - start.tangentX * backOff;
        const z = start.z - start.tangentZ * backOff;
        return new THREE.Vector3(x, this.getSurfaceHeightAt(x, z), z);
    }

    public getStartDirection(): THREE.Vector3 {
        const start = this.trackPath.samples[0];
        return new THREE.Vector3(start.tangentX, 0, start.tangentZ).normalize();
    }

    public setStartLights(lit: number, go: boolean): void {
        this.finishLine?.setStartLights(lit, go);
    }

    public update(elapsed: number): void {
        updateWind(elapsed);
        this.sky?.update(elapsed);
    }

    public dispose(): void {
        for (const root of this.roots) {
            this.scene.remove(root);
        }
        this.roots.length = 0;

        for (const disposable of this.disposables) {
            disposable.dispose();
        }
        this.disposables.length = 0;

        this.obstacles.length = 0;
        this.obstacleCells.clear();
        this.finishLine = null;
        this.sky = null;
    }
}
