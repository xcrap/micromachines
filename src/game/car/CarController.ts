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
    private driftTrailColor = new THREE.Color(0x333333);
    private driftIntensity = 0;

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
                this.inputManager.isKeyPressed("q") ||
                this.inputManager.isKeyPressed("ArrowUp"),
            backward:
                this.inputManager.isKeyPressed("a") ||
                this.inputManager.isKeyPressed("ArrowDown"),
            left:
                this.inputManager.isKeyPressed("o") ||
                this.inputManager.isKeyPressed("ArrowLeft"),
            right:
                this.inputManager.isKeyPressed("p") ||
                this.inputManager.isKeyPressed("ArrowRight"),
            brake: false, // Changed: brake is no longer spacebar
            drift: this.inputManager.isKeyPressed(" "), // Spacebar is now for drifting
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
        const lateralVelocity = this.carPhysics.getLateralVelocity();

        // Update direction vector based on steering
        this.direction.x = Math.sin(this.carGroup.rotation.y);
        this.direction.z = Math.cos(this.carGroup.rotation.y);

        // Create a lateral direction vector (perpendicular to main direction)
        const lateralDirection = new THREE.Vector3(
            -this.direction.z,  // perpendicular to forward direction
            0,
            this.direction.x
        );

        // Calculate new position with both forward velocity and lateral slide
        const newPosition = this.position.clone();

        // Apply forward velocity
        newPosition.x += this.direction.x * velocity * dt;
        newPosition.z += this.direction.z * velocity * dt;

        // Apply lateral velocity for drift sliding effect - amplified for more obvious slide
        const amplifiedLateralVelocity = lateralVelocity * (velocity > 10 ? 1.2 : 1.0); // Amplify slide at higher speeds
        if (Math.abs(amplifiedLateralVelocity) > 0.1) {
            newPosition.x += lateralDirection.x * amplifiedLateralVelocity * dt;
            newPosition.z += lateralDirection.z * amplifiedLateralVelocity * dt;
        }

        // Check for collision with map boundaries
        if (this.isPositionValid(newPosition)) {
            this.position.copy(newPosition);
        } else {
            // Bounce back slightly if hitting boundary
            this.carPhysics.reverseVelocity(0.5);
        }

        // Update rotation based on steering and apply a drift effect
        const isDrifting = this.carPhysics.isDrifting();
        const driftFactor = this.carPhysics.getDriftFactor();

        // With strong lateral sliding, reduce the steering effect on rotation
        // This makes the car appear to slide more and turn less during drift
        const lateralSlideFactor = Math.min(1.0, Math.max(0, 1.0 - Math.abs(lateralVelocity) * 0.08));
        const steeringEffectiveness = isDrifting ? lateralSlideFactor : 1.0;

        // Apply rotation based on steering and velocity
        this.carGroup.rotation.y += carSteeringAngle * velocity * dt * steeringEffectiveness;

        // Apply visual tilt effects for drifting and lateral movement
        if (isDrifting && Math.abs(velocity) > 5) {
            // Tilt the car based on lateral velocity for more realistic leaning into drift
            const lateralTilt = -Math.sign(lateralVelocity) * Math.min(Math.abs(lateralVelocity * 0.06), 0.25);

            // Tilt front end slightly down during drift for dynamic effect
            this.carGroup.rotation.x = 0.025 * driftFactor;

            // Apply z-axis tilt based on lateral movement (lean effect)
            this.carGroup.rotation.z = lateralTilt;
        } else {
            // Smoothly reset tilts
            this.carGroup.rotation.z *= 0.9;
            this.carGroup.rotation.x *= 0.9;
        }

        // Update car wheels rotation based on velocity
        this.carModel.updateWheelRotation(velocity * dt);

        // Apply physics-based terrain following
        this.applyTerrainPhysics(dt);

        // Update car position and rotation
        this.updatePosition();

        // Handle drifting effects
        const speed = Math.abs(velocity);
        const steeringAngle = Math.abs(carSteeringAngle);

        // Update drift state
        this.isDrifting = isDrifting && speed > 8;
        this.driftIntensity = driftFactor;

        // Create drift trails when drifting or with significant lateral velocity
        const hasLateralSlide = Math.abs(lateralVelocity) > 1.5;
        if (this.isDrifting || (hasLateralSlide && speed > 8)) {
            const currentTime = this.clock.getElapsedTime();
            if (currentTime - this.lastTrailTime > this.TRAIL_SPAWN_INTERVAL) {
                this.createDriftTrails();
                this.lastTrailTime = currentTime;
            }

            // Make trail intensity depend on both drift factor and lateral velocity
            const slideIntensity = Math.abs(lateralVelocity) / 4.0;
            const trailIntensity = Math.max(slideIntensity, this.driftIntensity * 0.15);
            const colorIntensity = 0.2 + trailIntensity;
            this.driftTrailColor.setRGB(colorIntensity, colorIntensity, colorIntensity);
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
            { x: 0.45, y: 0.05, z: -0.6 }, // Rear right
            { x: -0.45, y: 0.05, z: -0.6 }, // Rear left
        ];

        // Get just the main ground/track mesh from the map builder
        // This is more reliable than filtering by name
        const groundMesh = this.mapBuilder.getGroundMesh();

        if (!groundMesh) return;

        // Only create trails for rear wheels (where drift marks would appear)
        for (const wheelPos of wheelPositions) {
            // Convert local wheel position to world position
            const worldPos = this.carGroup.localToWorld(
                new THREE.Vector3(wheelPos.x, wheelPos.y, wheelPos.z),
            );

            // Cast ray downward from slightly above the wheel position
            this.raycaster.set(
                new THREE.Vector3(worldPos.x, worldPos.y + 2, worldPos.z),
                new THREE.Vector3(0, -1, 0)
            );

            // Only check intersection with the ground mesh specifically
            const intersects = this.raycaster.intersectObject(groundMesh, true);

            if (intersects.length > 0) {
                // Use the exact intersection point on the ground
                const groundPoint = intersects[0].point.clone();

                // Trails should be rendered right at ground level
                // Add a tiny offset to prevent z-fighting with the ground
                groundPoint.y += 0.005;

                // Add trail at the exact ground point with car's rotation
                this.trailSystem.addTrail(groundPoint, this.carGroup.rotation.y, this.driftTrailColor);
            }
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
