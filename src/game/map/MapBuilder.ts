import * as THREE from "three";
import { createGround } from "./Ground";
import { createTrack, TRACK_WIDTH } from "./Track";
import { createHills } from "./Hills";
import { createTrees } from "./Trees";
import { createRocks } from "./Rocks";
import { createFinishLine } from "./FinishLine";

export interface GroundMeshWithHeight extends THREE.Mesh {
    getHeightAt(x: number, z: number): number;
}

export class MapBuilder {
    private scene: THREE.Scene;
    private trackPath: THREE.Shape;
    private trackWidth = TRACK_WIDTH;
    private startPointIndex = 0;
    private terrainObjects: THREE.Object3D[] = [];
    private trackPoints: THREE.Vector2[] = [];
    private groundMesh: GroundMeshWithHeight | null = null;
    private trackMesh: THREE.Mesh | null = null;
    private groundResize: ((width: number, height: number) => void) | null = null;
    private trackResize: ((width: number, height: number) => void) | null = null;

    constructor(scene: THREE.Scene) {
        this.scene = scene;
        this.trackPath = new THREE.Shape();
        this.initializeTrackPath();
    }

    private initializeTrackPath(): void {
        // Create a larger track with smoother curves and a better start/finish line approach
        this.trackPath.moveTo(0, 0);

        // Adjust the first curve to create a straighter approach to start/finish line
        this.trackPath.bezierCurveTo(
            20,
            0, // First control point - straighter approach
            40,
            -10, // Second control point
            40,
            -40, // End point
        );
        this.trackPath.bezierCurveTo(40, -60, 20, -70, 0, -60);
        this.trackPath.bezierCurveTo(-20, -50, -40, -20, -40, 0);
        this.trackPath.bezierCurveTo(-40, 20, -20, 40, 0, 40);
        this.trackPath.bezierCurveTo(20, 40, 20, 20, 0, 0); // Smoother approach to finish
    }

    public buildMap(): void {
        this.createGround();
        this.createTrack();
        this.addDecorations();
    }

    private createGround(): void {
        const { mesh, onResize } = createGround(this.scene, this.terrainObjects);
        this.groundMesh = mesh as GroundMeshWithHeight;
        this.groundResize = onResize;
    }

    private createTrack(): void {
        if (!this.groundMesh) return;
        const { trackPoints, trackMesh, onResize } = createTrack(this.scene, this.terrainObjects, this.groundMesh);
        this.trackPoints = trackPoints;
        this.trackMesh = trackMesh;
        this.trackResize = onResize;
    }

    private createHills(): void {
        if (!this.groundMesh) return;
        createHills(this.scene, this.terrainObjects, this.isPointOnTrack.bind(this), this.groundMesh);
    }

    private addDecorations(): void {
        this.addFinishLine();
        this.addTrees();
        this.addRocks();
        this.createHills();
    }

    private addTrees(): void {
        if (!this.groundMesh) return;
        createTrees(this.scene, this.terrainObjects, this.isPointOnTrack.bind(this), this.groundMesh);
    }

    private addRocks(): void {
        if (!this.groundMesh) return;
        createRocks(this.scene, this.terrainObjects, this.isPointOnTrack.bind(this), this.groundMesh);
    }

    private addFinishLine(): void {
        if (!this.groundMesh || this.trackPoints.length === 0) return;
        createFinishLine(this.scene, this.trackPoints, this.groundMesh, this.getStartPointIndex());
    }

    private getStartPointIndex(): number {
        if (this.trackPoints.length === 0) return 0;
        return ((this.startPointIndex % this.trackPoints.length) + this.trackPoints.length) % this.trackPoints.length;
    }

    private getStartDirection2D(): THREE.Vector2 {
        if (this.trackPoints.length < 2) {
            return new THREE.Vector2(0, 1);
        }

        const pointCount = this.trackPoints.length;
        const startIdx = this.getStartPointIndex();
        const sampleOffset = 1;
        const previousPoint = this.trackPoints[(startIdx - sampleOffset + pointCount) % pointCount];
        const nextPoint = this.trackPoints[(startIdx + sampleOffset) % pointCount];

        return new THREE.Vector2()
            .subVectors(nextPoint, previousPoint)
            .normalize();
    }

    public isPointOnTrack(x: number, z: number): boolean {
        let minDistSq = Number.POSITIVE_INFINITY;
        const threshold = this.trackWidth * 0.6;
        const thresholdSq = threshold * threshold;

        for (let i = 0; i < this.trackPoints.length; i++) {
            const current = this.trackPoints[i];
            const next = this.trackPoints[(i + 1) % this.trackPoints.length];

            // Point-to-segment distance using pure math (no allocations)
            const dx = next.x - current.x;
            const dz = next.y - current.y;
            const lenSq = dx * dx + dz * dz;

            let t = 0;
            if (lenSq > 0) {
                t = ((x - current.x) * dx + (z - current.y) * dz) / lenSq;
                if (t < 0) t = 0;
                else if (t > 1) t = 1;
            }

            const closestX = current.x + t * dx;
            const closestZ = current.y + t * dz;
            const ex = x - closestX;
            const ez = z - closestZ;
            const distSq = ex * ex + ez * ez;

            if (distSq < minDistSq) {
                minDistSq = distSq;
                if (minDistSq <= thresholdSq) return true;
            }
        }

        return minDistSq <= thresholdSq;
    }

    public getTerrainObjects(): THREE.Object3D[] {
        return this.terrainObjects;
    }

    public getStartPosition(): THREE.Vector3 {
        if (this.trackPoints.length > 0 && this.groundMesh) {
            const startPoint = this.trackPoints[this.getStartPointIndex()];
            const height = this.groundMesh.getHeightAt(startPoint.x, startPoint.y) + 0.5;
            return new THREE.Vector3(startPoint.x, height, startPoint.y);
        }
        return new THREE.Vector3(0, 0, -80);
    }

    public getStartDirection(): THREE.Vector3 {
        if (this.trackPoints.length > 1) {
            const direction = this.getStartDirection2D();
            return new THREE.Vector3(direction.x, 0, direction.y);
        }
        return new THREE.Vector3(0, 0, 1);
    }

    public getGroundMesh(): THREE.Mesh | null {
        return this.groundMesh;
    }

    // This method helps adjust the terrain height at specific points, useful for debugging
    public getHeightAt(x: number, z: number): number {
        if (this.groundMesh) {
            return this.groundMesh.getHeightAt(x, z);
        }
        return 0;
    }

    public getTrackMesh(): THREE.Mesh | null {
        return this.trackMesh;
    }

    public updateShaderTime(elapsedTime: number): void {
        if (this.groundMesh) {
            const groundMat = this.groundMesh.material as THREE.ShaderMaterial;
            if (groundMat.uniforms?.u_time) {
                groundMat.uniforms.u_time.value = elapsedTime;
            }
        }
        if (this.trackMesh) {
            const trackMat = this.trackMesh.material as THREE.ShaderMaterial;
            if (trackMat.uniforms?.u_time) {
                trackMat.uniforms.u_time.value = elapsedTime;
            }
        }
    }

    public onResize(width: number, height: number): void {
        this.groundResize?.(width, height);
        this.trackResize?.(width, height);
    }

    public dispose(): void {
        for (const obj of this.terrainObjects) {
            this.scene.remove(obj);
            obj.traverse((child) => {
                if (child instanceof THREE.Mesh) {
                    child.geometry?.dispose();
                    if (Array.isArray(child.material)) {
                        child.material.forEach((m) => m.dispose());
                    } else {
                        child.material?.dispose();
                    }
                }
            });
        }
        this.terrainObjects.length = 0;
        this.trackPoints.length = 0;
        this.groundMesh = null;
        this.trackMesh = null;
        this.groundResize = null;
        this.trackResize = null;
    }
}
