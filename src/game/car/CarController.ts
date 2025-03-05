import * as THREE from "three";
import type { InputManager } from "../input/InputManager";
import { CarModel } from "./CarModel";
import { CarPhysics } from "./CarPhysics";
import type { MapBuilder } from "../map/MapBuilder";
import { TrailSystem } from "../effects/TrailSystem";

export class CarController {
    private carModel: CarModel;
    private carPhysics: CarPhysics;
    private inputManager: InputManager;
    private position: THREE.Vector3;
    private direction: THREE.Vector3;
    private carGroup: THREE.Group;
    private mapBuilder: MapBuilder;
    private isOnTrack = true;
    private offTrackSlowdown = 0.85; // Reduced slowdown for better off-track driving
    private raycaster: THREE.Raycaster;
    private groundNormal: THREE.Vector3;
    private groundCheckDistance = 10; // Increased ray distance for better ground detection
    private clock: THREE.Clock;

    // Add these properties to your class
    private trailSystem: TrailSystem;
    private isDrifting = false;
    private lastTrailTime = 0;
    private readonly TRAIL_SPAWN_INTERVAL: number = 0.05; // Spawn trails every 50ms during drift

    constructor(
        scene: THREE.Scene,
        inputManager: InputManager,
        mapBuilder: MapBuilder,
    ) {
        this.inputManager = inputManager;
        this.mapBuilder = mapBuilder;

        // Create car group to hold all car parts
        this.carGroup = new THREE.Group();
        scene.add(this.carGroup);

        // Initialize car model
        this.carModel = new CarModel(this.carGroup);

        // Initialize car physics
        this.carPhysics = new CarPhysics();

        // Get start position from the map builder
        const startPosition = mapBuilder.getStartPosition();
        const startDirection = mapBuilder.getStartDirection();

        // Set initial position and direction using the track's start position
        this.position = new THREE.Vector3(startPosition.x, 0.5, startPosition.z);
        this.direction = new THREE.Vector3(startDirection.x, 0, startDirection.z).normalize();

        // Set initial car rotation to face along the track
        const angle = Math.atan2(startDirection.x, startDirection.z);
        this.carGroup.rotation.y = angle;

        // Initialize raycaster for terrain detection
        this.raycaster = new THREE.Raycaster();

        // Update car position
        this.updatePosition();

        this.clock = new THREE.Clock();
        this.clock.start();

        // Initialize trail system
        this.trailSystem = new TrailSystem(scene);
    }

    public update(deltaTime: number): void {
        // Get input values using WASD and arrow keys
        const input = {
            forward:
                this.inputManager.isKeyPressed("w") ||
                this.inputManager.isKeyPressed("ArrowUp"),
            backward:
                this.inputManager.isKeyPressed("s") ||
                this.inputManager.isKeyPressed("ArrowDown"),
            left:
                this.inputManager.isKeyPressed("a") ||
                this.inputManager.isKeyPressed("ArrowLeft"),
            right:
                this.inputManager.isKeyPressed("d") ||
                this.inputManager.isKeyPressed("ArrowRight"),
            brake: this.inputManager.isKeyPressed(" "), // Space bar
        };

        // Check for drift conditions:
        // 1. Car is moving at a decent speed
        // 2. There's significant steering input
        // 3. The car is turning sharply
        const speed = Math.abs(this.carPhysics.getVelocity());
        const steeringAngle = Math.abs(this.carPhysics.getSteeringAngle());

        // Detect drifting - when car is moving fast enough and turning sharply
        this.isDrifting = speed > 10 && steeringAngle > 0.1;

        // Create trail particles during drift
        if (this.isDrifting) {
            const currentTime = this.clock.getElapsedTime();

            // Only spawn new trails at certain intervals to control density
            if (currentTime - this.lastTrailTime > this.TRAIL_SPAWN_INTERVAL) {
                this.createDriftTrails();
                this.lastTrailTime = currentTime;
            }
        }

        // Update trail system
        this.trailSystem.update();

        // Check if car is on track
        this.checkIfOnTrack();

        // Apply off-track physics modifications
        let effectiveDeltaTime = deltaTime;
        if (!this.isOnTrack) {
            // Slow down car when off track by reducing effective delta time
            effectiveDeltaTime *= this.offTrackSlowdown;

            // Make the car visually shake a bit when off track
            this.carGroup.position.y = 0.5 + Math.sin(Date.now() * 0.01) * 0.03;
        } else {
            this.carGroup.position.y = 0.5; // Normal height when on track
        }

        // Update physics based on input
        this.carPhysics.update(effectiveDeltaTime, input, !this.isOnTrack);

        // Apply physics to car position and rotation
        const velocity = this.carPhysics.getVelocity();
        const carSteeringAngle = this.carPhysics.getSteeringAngle();

        // Update direction vector based on steering
        this.direction.x = Math.sin(this.carGroup.rotation.y);
        this.direction.z = Math.cos(this.carGroup.rotation.y);

        // Calculate new position
        const newPosition = this.position.clone();
        newPosition.x += this.direction.x * velocity * deltaTime;
        newPosition.z += this.direction.z * velocity * deltaTime;

        // Check for collision with map boundaries
        if (this.isPositionValid(newPosition)) {
            this.position.copy(newPosition);
        } else {
            // Bounce back slightly if hitting boundary
            this.carPhysics.reverseVelocity(0.5);
        }

        // Update rotation based on steering
        this.carGroup.rotation.y += carSteeringAngle * velocity * deltaTime;

        // Update car wheels rotation based on velocity
        this.carModel.updateWheelRotation(velocity * deltaTime);

        // Adjust car to terrain height and angle
        this.adjustToTerrain();

        // Update car position and rotation
        this.updatePosition();
    }

    private adjustToTerrain(): void {
        // Cast a ray downward from the car position to detect terrain
        // Start from higher up to ensure we catch the terrain
        this.raycaster.set(
            new THREE.Vector3(
                this.position.x,
                this.groundCheckDistance,
                this.position.z,
            ),
            new THREE.Vector3(0, -1, 0),
        );

        // Get all objects in the scene that might be terrain
        const intersects = this.raycaster.intersectObjects(
            this.mapBuilder.getTerrainObjects(),
            true,
        );

        if (intersects.length > 0) {
            // Get the first intersection (closest to the car)
            const intersection = intersects[0];

            // Set car height based on terrain height plus car clearance
            const terrainHeight = intersection.point.y;
            const carClearance = 0.05; // Reduced clearance to keep car closer to ground
            this.position.y = terrainHeight + carClearance;

            // Get the normal of the terrain at the intersection point
            this.groundNormal =
                intersection.face?.normal.clone() || new THREE.Vector3(0, 1, 0);

            // Transform the normal from local to world coordinates
            if (intersection.object.matrixWorld) {
                const normalMatrix = new THREE.Matrix3().getNormalMatrix(
                    intersection.object.matrixWorld,
                );
                this.groundNormal.applyMatrix3(normalMatrix).normalize();
            }

            // Adjust car rotation to match terrain slope
            if (this.groundNormal.y > 0.5) {
                // Only adjust if slope is not too steep
                // Calculate rotation to align with ground normal
                const alignmentQuaternion = new THREE.Quaternion();
                const up = new THREE.Vector3(0, 1, 0);
                alignmentQuaternion.setFromUnitVectors(up, this.groundNormal);

                // Preserve the car's y-rotation (steering direction)
                const carYRotation = this.carGroup.rotation.y;

                // Apply the alignment quaternion to the car group
                this.carGroup.quaternion.copy(alignmentQuaternion);

                // Re-apply the car's y-rotation
                this.carGroup.rotation.y = carYRotation;
            }
        } else {
            // If no terrain is found, set a default height
            // This should rarely happen with the increased ray distance
            this.position.y = 0.05; // Reduced default height
        }
    }

    private isPositionValid(position: THREE.Vector3): boolean {
        // Check if position is within map boundaries
        const mapRadius = 100; // Increased for larger map
        return (
            position.x >= -mapRadius &&
            position.x <= mapRadius &&
            position.z >= -mapRadius &&
            position.z <= mapRadius
        );
    }

    private checkIfOnTrack(): void {
        // Check if car is on the track
        this.isOnTrack = this.mapBuilder.isPointOnTrack(
            this.position.x,
            this.position.z,
        );
    }

    private updatePosition(): void {
        this.carGroup.position.copy(this.position);
    }

    public getPosition(): THREE.Vector3 {
        return this.position.clone();
    }

    public getDirection(): THREE.Vector3 {
        return this.direction.clone();
    }

    private createDriftTrails(): void {
        // Calculate wheel positions in world space
        const wheelPositions = [
            { x: 0.45, y: 0.2, z: -0.6 }, // Rear left
            { x: -0.45, y: 0.2, z: -0.6 }, // Rear right
        ];

        // Only create trails for rear wheels (where drift marks would appear)
        for (const wheelPos of wheelPositions) {
            // Convert local wheel position to world position
            const worldPos = this.carGroup.localToWorld(
                new THREE.Vector3(wheelPos.x, wheelPos.y, wheelPos.z),
            );

            // Add trail at wheel position with car's rotation
            this.trailSystem.addTrail(worldPos, this.carGroup.rotation.y);
        }
    }

    // Add this to your class
    public dispose(): void {
        this.trailSystem.dispose();
    }
}
