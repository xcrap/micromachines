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
    private offTrackSlowdown = 0.85;
    private raycaster: THREE.Raycaster;
    private groundNormal: THREE.Vector3 = new THREE.Vector3(0, 1, 0);
    private clock: THREE.Clock;
    private trailSystem: TrailSystem;
    private isDrifting = false;
    private lastTrailTime = 0;
    private readonly TRAIL_SPAWN_INTERVAL: number = 0.05;

    // Physics-based terrain following
    private readonly wheelPositions = [
        { x: 0.45, y: 0, z: 0.6 },   // Front right
        { x: -0.45, y: 0, z: 0.6 },  // Front left
        { x: 0.45, y: 0, z: -0.6 },  // Rear right
        { x: -0.45, y: 0, z: -0.6 }, // Rear left
    ];
    private wheelRayResults: THREE.Vector3[] = [];
    private suspensionValues: {
        compression: number;
        velocity: number;
        targetHeight: number;
        currentHeight: number;
    }[] = [];
    private readonly restLength = 0.3;             // Rest length of suspension
    private readonly springConstant = 80.0;        // Spring stiffness
    private readonly damperConstant = 10.0;        // Damping coefficient
    private carMass = 1.0;                         // Car mass
    private readonly minSuspension = 0.05;         // Min suspension compression
    private readonly maxSuspension = 0.4;          // Max suspension extension
    private readonly chassisToGroundRest = 0.15;   // Target chassis height above ground

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
        this.position = new THREE.Vector3(startPosition.x, startPosition.y + 0.5, startPosition.z);
        this.direction = new THREE.Vector3(startDirection.x, 0, startDirection.z).normalize();

        // Set initial car rotation to face along the track
        const angle = Math.atan2(startDirection.x, startDirection.z);
        this.carGroup.rotation.y = angle;

        // Initialize raycaster for terrain detection
        this.raycaster = new THREE.Raycaster();

        // Initialize trail system
        this.trailSystem = new TrailSystem(scene);

        // Initialize clock
        this.clock = new THREE.Clock();
        this.clock.start();

        // Initialize suspension for each wheel
        for (let i = 0; i < this.wheelPositions.length; i++) {
            this.wheelRayResults.push(new THREE.Vector3());
            this.suspensionValues.push({
                compression: 0,
                velocity: 0,
                targetHeight: 0,
                currentHeight: this.restLength
            });
        }

        // Initial position update
        this.updatePosition();
    }

    public update(deltaTime: number): void {
        // Clamp deltaTime to avoid physics instability with large time steps
        const dt = Math.min(deltaTime, 0.03);

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

        // Check if car is on track
        this.checkIfOnTrack();

        // Apply off-track physics modifications
        let effectiveDeltaTime = dt;
        if (!this.isOnTrack) {
            effectiveDeltaTime *= this.offTrackSlowdown;
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
        newPosition.x += this.direction.x * velocity * dt;
        newPosition.z += this.direction.z * velocity * dt;

        // Check for collision with map boundaries
        if (this.isPositionValid(newPosition)) {
            this.position.copy(newPosition);
        } else {
            // Bounce back slightly if hitting boundary
            this.carPhysics.reverseVelocity(0.5);
        }

        // Update rotation based on steering
        this.carGroup.rotation.y += carSteeringAngle * velocity * dt;

        // Update car wheels rotation based on velocity
        this.carModel.updateWheelRotation(velocity * dt);

        // Apply physics-based terrain following
        this.applyTerrainPhysics(dt);

        // Update car position and rotation
        this.updatePosition();

        // Handle drifting effects
        const speed = Math.abs(velocity);
        const steeringAngle = Math.abs(carSteeringAngle);
        this.isDrifting = speed > 10 && steeringAngle > 0.1;

        if (this.isDrifting) {
            const currentTime = this.clock.getElapsedTime();
            if (currentTime - this.lastTrailTime > this.TRAIL_SPAWN_INTERVAL) {
                this.createDriftTrails();
                this.lastTrailTime = currentTime;
            }
        }

        // Update trail system
        this.trailSystem.update();
    }

    private applyTerrainPhysics(dt: number): void {
        // Calculate world position for each wheel
        const worldWheelPositions = this.wheelPositions.map(localPos => {
            // Create a vector for this wheel's position
            const wheelPos = new THREE.Vector3(localPos.x, localPos.y, localPos.z);

            // Apply car rotation to wheel position
            wheelPos.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.carGroup.rotation.y);

            // Add car position to get world position
            wheelPos.add(this.position);

            return wheelPos;
        });

        // Do raycasts to find ground height at each wheel
        for (let i = 0; i < this.wheelPositions.length; i++) {
            const wheelPos = worldWheelPositions[i];

            // Cast ray downward from wheel position
            this.raycaster.set(
                new THREE.Vector3(wheelPos.x, wheelPos.y + 2, wheelPos.z), // Start from above wheel
                new THREE.Vector3(0, -1, 0) // Cast downward
            );

            const intersects = this.raycaster.intersectObjects(
                this.mapBuilder.getTerrainObjects().filter(obj => obj !== this.carGroup),
                true
            );

            if (intersects.length > 0) {
                // Store ground point and normal
                this.wheelRayResults[i].copy(intersects[0].point);

                // Calculate spring length - distance from wheel to ground
                const wheelHeight = wheelPos.y;
                const groundHeight = intersects[0].point.y;
                const currentLength = wheelHeight - groundHeight;

                // Store ground normal for car orientation
                if (i === 0) { // Just use first wheel's normal for orientation
                    this.groundNormal = intersects[0].face?.normal.clone() || new THREE.Vector3(0, 1, 0);
                    // Transform normal to world space
                    if (intersects[0].object.matrixWorld) {
                        const normalMatrix = new THREE.Matrix3().getNormalMatrix(
                            intersects[0].object.matrixWorld
                        );
                        this.groundNormal.applyMatrix3(normalMatrix).normalize();
                    }
                }

                // Update suspension physics
                const susp = this.suspensionValues[i];

                // Calculate suspension compression
                susp.compression = this.restLength - currentLength;

                // Calculate spring force
                const springForce = this.springConstant * susp.compression;

                // Calculate damping force
                const damperForce = this.damperConstant * susp.velocity;

                // Calculate total force
                const force = springForce - damperForce;

                // Calculate acceleration (F = ma)
                const acceleration = force / this.carMass;

                // Update velocity
                susp.velocity += acceleration * dt;

                // Update suspension height
                susp.currentHeight += susp.velocity * dt;

                // Clamp suspension height
                if (susp.currentHeight < this.minSuspension) {
                    susp.currentHeight = this.minSuspension;
                    susp.velocity = 0;
                } else if (susp.currentHeight > this.maxSuspension) {
                    susp.currentHeight = this.maxSuspension;
                    susp.velocity = 0;
                }

                // Apply suspension offset to car height
                if (i === 0) { // Just use average for the car height
                    // Adjust car height based on suspension compression
                    const targetHeight = groundHeight + this.chassisToGroundRest;
                    this.position.y = targetHeight;
                }
            }
        }

        // Apply car orientation based on suspension geometry
        if (this.wheelRayResults.length >= 3) {
            // Calculate plane from three points
            const v1 = new THREE.Vector3().subVectors(
                this.wheelRayResults[1], this.wheelRayResults[0]
            );
            const v2 = new THREE.Vector3().subVectors(
                this.wheelRayResults[2], this.wheelRayResults[0]
            );

            // Calculate normal of the plane using cross product
            const normal = new THREE.Vector3().crossVectors(v1, v2).normalize();

            // Only apply rotation if normal is mostly upward
            if (normal.y > 0.6) {
                // Create quaternion to align with ground normal
                const alignQuat = new THREE.Quaternion();
                alignQuat.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal);

                // Preserve car's steering direction (y-rotation)
                const carYRotation = this.carGroup.rotation.y;

                // Apply orientation with smoothing
                const smoothingFactor = 0.15;
                const targetQuat = new THREE.Quaternion().setFromEuler(
                    new THREE.Euler(0, carYRotation, 0)
                );
                targetQuat.premultiply(alignQuat);

                // Smoothly interpolate current rotation to target
                this.carGroup.quaternion.slerp(targetQuat, smoothingFactor);

                // Extract and ensure correct Y rotation for steering
                this.carGroup.rotation.y = carYRotation;
            }
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

    public getPosition(): THREE.Vector3 {
        return this.position.clone();
    }

    public getDirection(): THREE.Vector3 {
        return this.direction.clone();
    }

    public dispose(): void {
        this.trailSystem.dispose();
    }
}
