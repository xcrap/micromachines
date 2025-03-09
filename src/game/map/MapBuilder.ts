import * as THREE from "three";
import { createGround } from "./Ground";
import { createTrack } from "./Track";
import { createHills } from "./Hills";
import { createTrees } from "./Trees";
import { createRocks } from "./Rocks";
import { createFinishLine } from "./FinishLine";

export class MapBuilder {
    private scene: THREE.Scene;
    private trackPath: THREE.Shape;
    private trackWidth = 10; // Increased track width
    private terrainObjects: THREE.Object3D[] = [];
    private trackPoints: THREE.Vector2[] = [];
    private groundMesh: THREE.Mesh | null = null;

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
        this.groundMesh = createGround(this.scene, this.terrainObjects);
    }

    private createTrack(): void {
        if (!this.groundMesh) return;
        const { trackPoints } = createTrack(this.scene, this.terrainObjects, this.groundMesh);
        this.trackPoints = trackPoints;
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
        createFinishLine(this.scene, this.trackPoints, this.groundMesh);
    }

    public isPointOnTrack(x: number, z: number): boolean {
        // Point we're checking
        const testPoint = new THREE.Vector2(x, z);

        // Find minimum distance to any track segment
        let minDistance = Number.POSITIVE_INFINITY;

        for (let i = 0; i < this.trackPoints.length; i++) {
            const current = this.trackPoints[i];
            const next = this.trackPoints[(i + 1) % this.trackPoints.length];

            // Calculate distance from point to this line segment
            const lineSegment = new THREE.Line3(
                new THREE.Vector3(current.x, 0, current.y),
                new THREE.Vector3(next.x, 0, next.y)
            );

            const closestPoint = new THREE.Vector3();
            lineSegment.closestPointToPoint(
                new THREE.Vector3(x, 0, z),
                true, // clamp to segment
                closestPoint
            );

            const distance = new THREE.Vector2(closestPoint.x, closestPoint.z)
                .distanceTo(testPoint);

            if (distance < minDistance) {
                minDistance = distance;
            }
        }

        // Consider point on track if within buffer width
        return minDistance <= this.trackWidth * 0.6;
    }

    public getTerrainObjects(): THREE.Object3D[] {
        return this.terrainObjects;
    }

    public getStartPosition(): THREE.Vector3 {
        // Use the first track point
        if (this.trackPoints.length > 0 && this.groundMesh) {
            const startPoint = this.trackPoints[0];
            const height = (this.groundMesh as any).getHeightAt(startPoint.x, startPoint.y) + 0.5;
            return new THREE.Vector3(startPoint.x, height, startPoint.y);
        }
        return new THREE.Vector3(0, 0, -80); // Fallback to the first control point
    }

    public getStartDirection(): THREE.Vector3 {
        // Use direction from first to second point
        if (this.trackPoints.length > 1) {
            const firstPoint = this.trackPoints[0];
            const secondPoint = this.trackPoints[1];
            const direction = new THREE.Vector2()
                .subVectors(secondPoint, firstPoint)
                .normalize();
            return new THREE.Vector3(direction.x, 0, direction.y);
        }
        return new THREE.Vector3(0, 0, 1); // Default forward direction
    }

    public getGroundMesh(): THREE.Mesh | null {
        return this.groundMesh;
    }

    // This method helps adjust the terrain height at specific points, useful for debugging
    public getHeightAt(x: number, z: number): number {
        if (this.groundMesh) {
            return (this.groundMesh as any).getHeightAt(x, z);
        }
        return 0;
    }
}
