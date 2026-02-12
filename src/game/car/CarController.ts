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
    private driftIntensity = 0;
    private wasTrailing = false;

    // Collision detection
    private collisionRaycaster: THREE.Raycaster;
    private collisionDistance = 0.8; // Distance to check for collisions
    private verticalVelocity = 0; // For gravity/jumping effects
    private readonly GRAVITY = 20.0; // Gravity constant
    private isGrounded = true;
    private airborneTime = 0;
    private collisionObjects: THREE.Object3D[] = [];
    private groundMesh: THREE.Mesh | null = null;
    private trackMesh: THREE.Mesh | null = null;

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

    // Reusable temp objects to avoid per-frame allocations
    private readonly _tmpVec3A = new THREE.Vector3();
    private readonly _tmpVec3B = new THREE.Vector3();
    private readonly _tmpVec3C = new THREE.Vector3();
    private readonly _tmpVec3D = new THREE.Vector3();
    private readonly _tmpQuatA = new THREE.Quaternion();
    private readonly _tmpQuatB = new THREE.Quaternion();
    private readonly _tmpMat3 = new THREE.Matrix3();
    private readonly _upVector = new THREE.Vector3(0, 1, 0);
    private readonly _downVector = new THREE.Vector3(0, -1, 0);
    private readonly _collisionOrigin = new THREE.Vector3();
    private readonly _collisionDirs: THREE.Vector3[] = [
        new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
    ];
    private readonly _validGroundObjects: THREE.Object3D[] = [];
    private readonly _worldWheelPositions: THREE.Vector3[] = [
        new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
    ];

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

        // Initialize raycasters for terrain detection and collision detection
        this.raycaster = new THREE.Raycaster();
        this.collisionRaycaster = new THREE.Raycaster();

        // Initialize trail system
        this.trailSystem = new TrailSystem(scene);

        // Tell the TrailSystem which object is the track (for color differentiation)
        const trackMesh = mapBuilder.getTrackMesh();
        if (trackMesh) {
            this.trailSystem.setTrackObjects([trackMesh]);
            this.trackMesh = trackMesh;
        }

        // Store ground mesh for height calculations
        this.groundMesh = mapBuilder.getGroundMesh();

        // Get all objects to check collisions against (excluding ground and track)
        this.collisionObjects = mapBuilder.getTerrainObjects().filter(obj => {
            // Filter out the ground and track meshes
            return obj !== this.groundMesh && obj !== this.trackMesh;
        });

        // Build valid ground objects array once
        if (this.groundMesh) this._validGroundObjects.push(this.groundMesh);
        if (this.trackMesh) this._validGroundObjects.push(this.trackMesh);

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
        const lateralVelocity = this.carPhysics.getLateralVelocity();

        // Apply yaw rate to car rotation
        const yawRate = this.carPhysics.getYawRate();
        this.carGroup.rotation.y += yawRate * effectiveDeltaTime;

        // Update direction vector from current heading
        this.direction.x = Math.sin(this.carGroup.rotation.y);
        this.direction.z = Math.cos(this.carGroup.rotation.y);

        // Create a lateral direction vector (perpendicular to main direction)
        const lateralDirection = this._tmpVec3A.set(
            -this.direction.z,
            0,
            this.direction.x
        );

        // Calculate new position with both forward velocity and lateral slide
        const newPosition = this._tmpVec3B.copy(this.position);

        // Apply forward velocity
        newPosition.x += this.direction.x * velocity * effectiveDeltaTime;
        newPosition.z += this.direction.z * velocity * effectiveDeltaTime;

        // Apply lateral velocity from tire slip
        if (Math.abs(lateralVelocity) > 0.05) {
            newPosition.x += lateralDirection.x * lateralVelocity * effectiveDeltaTime;
            newPosition.z += lateralDirection.z * lateralVelocity * effectiveDeltaTime;
        }

        // Check for collision with obstacles
        const collisionResult = this.checkCollisions(newPosition);

        // Apply position update based on collision result
        if (!collisionResult.hasCollision) {
            // No collision, can update position
            this.position.copy(newPosition);
        } else {
            // On collision, bounce back and reduce speed
            this.carPhysics.reverseVelocity(0.5);

            // Apply a bounce effect - push away from collision point
            const pushDirection = this._tmpVec3C.subVectors(this.position, collisionResult.collisionPoint).normalize();
            pushDirection.y = 0; // Keep on horizontal plane

            // Apply push based on speed at impact
            const pushForce = Math.abs(velocity) * 0.05;
            this.position.x += pushDirection.x * pushForce;
            this.position.z += pushDirection.z * pushForce;
        }

        // Check if position is within map boundaries
        if (!this.isPositionValid(this.position)) {
            // Bounce off map boundaries
            this.carPhysics.reverseVelocity(0.5);
        }

        // Apply gravity and vertical motion
        this.applyGravity(dt);

        const isDrifting = this.carPhysics.isDrifting();
        const driftFactor = this.carPhysics.getDriftFactor();
        const slipAngle = this.carPhysics.getSlipAngle();

        // Apply visual tilt based on slip angle and lateral velocity
        if (Math.abs(slipAngle) > 0.02 && Math.abs(velocity) > 3) {
            const rollTarget = -Math.sign(lateralVelocity) * Math.min(Math.abs(lateralVelocity * 0.04), 0.18);
            const pitchTarget = driftFactor * 0.02;

            this.carGroup.rotation.z += (rollTarget - this.carGroup.rotation.z) * 0.15;
            this.carGroup.rotation.x += (pitchTarget - this.carGroup.rotation.x) * 0.15;
        } else {
            this.carGroup.rotation.z *= 0.88;
            this.carGroup.rotation.x *= 0.88;
        }

        // Update car wheels rotation based on velocity
        this.carModel.updateWheelRotation(velocity * dt);

        // Apply physics-based terrain following only when on ground
        if (this.isGrounded) {
            this.applyTerrainPhysics(dt);
        } else {
            // Apply airborne tilt and orientation
            this.applyAirborneRotation();
        }

        // Update car position and rotation
        this.updatePosition();

        // Handle drifting effects
        const speed = Math.abs(velocity);

        // Update drift state based on slip angle and lateral velocity
        this.isDrifting = isDrifting && speed > 5;
        this.driftIntensity = Math.max(
            driftFactor,
            Math.min(1.0, Math.abs(lateralVelocity) / 8.0)
        );

        const hasSlide = Math.abs(slipAngle) > 0.03 || Math.abs(lateralVelocity) > 0.8;
        const shouldTrail = (this.isDrifting || hasSlide) && speed > 3 && this.isGrounded;

        if (shouldTrail) {
            const currentTime = this.clock.getElapsedTime();
            if (currentTime - this.lastTrailTime > this.TRAIL_SPAWN_INTERVAL) {
                this.createDriftTrails();
                this.lastTrailTime = currentTime;
            }
        } else if (this.wasTrailing) {
            this.trailSystem.breakAllTrails();
        }
        this.wasTrailing = shouldTrail;

        // Update trail system
        this.trailSystem.update();
    }

    private applyGravity(dt: number): void {
        // Check if the car is on ground
        this.isGrounded = this.checkGrounded();

        if (this.isGrounded) {
            // Reset vertical velocity when grounded
            this.verticalVelocity = 0;
            this.airborneTime = 0;
        } else {
            // Apply gravity when in air
            this.verticalVelocity -= this.GRAVITY * dt;
            this.airborneTime += dt;

            // Apply vertical velocity to position
            this.position.y += this.verticalVelocity * dt;

            // Check if we've landed
            if (this.checkGrounded()) {
                this.isGrounded = true;

                // Calculate landing impact
                const impactForce = Math.abs(this.verticalVelocity);

                // If it's a hard landing, apply some bounce
                if (impactForce > 5) {
                    const bounceReduction = 0.3; // Reduce bounce for softer landing
                    this.verticalVelocity = impactForce * bounceReduction;

                    // Reduce horizontal velocity based on impact
                    const currentSpeed = this.carPhysics.getVelocity();
                    if (Math.abs(currentSpeed) > 0.5) {
                        this.carPhysics.reverseVelocity(0.2);
                    }
                } else {
                    // Soft landing
                    this.verticalVelocity = 0;
                }
            }
        }
    }

    private checkGrounded(): boolean {
        if (!this.groundMesh && !this.trackMesh) return true;

        const minDistance = 0.5;
        let lowestPoint = Infinity;

        for (let i = 0; i < this.wheelPositions.length; i++) {
            const worldWheelPos = this.getWorldWheelPosition(this.wheelPositions[i], i);

            this.raycaster.set(
                this._tmpVec3A.set(worldWheelPos.x, worldWheelPos.y + 2, worldWheelPos.z),
                this._downVector
            );

            const intersects = this.raycaster.intersectObjects(this._validGroundObjects);

            if (intersects.length > 0) {
                const distance = worldWheelPos.y - intersects[0].point.y;
                lowestPoint = Math.min(lowestPoint, distance);
            }
        }

        return lowestPoint < minDistance;
    }

    private applyAirborneRotation(): void {
        // Gradually rotate the car to be level when in air
        if (this.airborneTime > 0.2) { // Only start leveling after a short time in air
            // Calculate target rotation to level out
            const targetRotation = this._tmpQuatA.setFromEuler(
                new THREE.Euler(0, this.carGroup.rotation.y, 0)
            );

            // Smoothly interpolate current rotation towards level
            const smoothingFactor = 0.02;
            this.carGroup.quaternion.slerp(targetRotation, smoothingFactor);
        }
    }

    private checkCollisions(newPosition: THREE.Vector3): { hasCollision: boolean, collisionPoint: THREE.Vector3 } {
        if (this.collisionObjects.length === 0) {
            return { hasCollision: false, collisionPoint: new THREE.Vector3() };
        }

        // Create a box that represents the car's collision volume
        const carBox = new THREE.Box3().setFromObject(this.carGroup);

        // Update the box to the proposed new position
        const offset = new THREE.Vector3().subVectors(newPosition, this.position);
        carBox.min.add(offset);
        carBox.max.add(offset);

        // Check collision with each object in collision list
        let nearestCollision = Infinity;
        const collisionPoint = new THREE.Vector3();
        let hasCollision = false;

        // Check collisions in multiple directions for better coverage
        this._collisionDirs[0].copy(this.direction); // Forward
        this._collisionDirs[1].set(-this.direction.x, 0, -this.direction.z); // Backward
        this._collisionDirs[2].set(-this.direction.z, 0, this.direction.x); // Left
        this._collisionDirs[3].set(this.direction.z, 0, -this.direction.x); // Right

        for (const direction of this._collisionDirs) {
            // Cast a ray in this direction
            this._collisionOrigin.set(newPosition.x, newPosition.y + 0.3, newPosition.z);
            this.collisionRaycaster.set(
                this._collisionOrigin, // Start from slightly above ground
                direction
            );

            const intersects = this.collisionRaycaster.intersectObjects(this.collisionObjects, true);

            if (intersects.length > 0 && intersects[0].distance < this.collisionDistance) {
                hasCollision = true;
                if (intersects[0].distance < nearestCollision) {
                    nearestCollision = intersects[0].distance;
                    collisionPoint.copy(intersects[0].point);
                }
            }
        }

        return {
            hasCollision,
            collisionPoint
        };
    }

    private getWorldWheelPosition(localPos: { x: number, y: number, z: number }, index: number): THREE.Vector3 {
        const wheelPos = this._worldWheelPositions[index];
        wheelPos.set(localPos.x, localPos.y, localPos.z);
        wheelPos.applyAxisAngle(this._tmpVec3D.set(0, 1, 0), this.carGroup.rotation.y);
        wheelPos.add(this.position);
        return wheelPos;
    }

    private applyTerrainPhysics(dt: number): void {
        for (let i = 0; i < this.wheelPositions.length; i++) {
            const wheelPos = this.getWorldWheelPosition(this.wheelPositions[i], i);

            // Cast ray downward from wheel position
            this.raycaster.set(
                this._tmpVec3A.set(wheelPos.x, wheelPos.y + 2, wheelPos.z), // Start from above wheel
                this._downVector // Cast downward
            );

            const intersects = this.raycaster.intersectObjects(this._validGroundObjects, true);

            if (intersects.length > 0) {
                // Store ground point and normal
                this.wheelRayResults[i].copy(intersects[0].point);

                // Calculate spring length - distance from wheel to ground
                const wheelHeight = wheelPos.y;
                const groundHeight = intersects[0].point.y;
                const currentLength = wheelHeight - groundHeight;

                // Store ground normal for car orientation
                if (i === 0) { // Just use first wheel's normal for orientation
                    if (intersects[0].face) {
                        this.groundNormal.copy(intersects[0].face.normal);
                    } else {
                        this.groundNormal.set(0, 1, 0);
                    }
                    // Transform normal to world space
                    if (intersects[0].object.matrixWorld) {
                        this._tmpMat3.getNormalMatrix(intersects[0].object.matrixWorld);
                        this.groundNormal.applyMatrix3(this._tmpMat3).normalize();
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

                    // Smoothly interpolate height for less abrupt changes
                    this.position.y += (targetHeight - this.position.y) * 0.3;
                }
            }
        }

        // Apply car orientation based on suspension geometry
        if (this.wheelRayResults.length >= 3) {
            const v1 = this._tmpVec3A.subVectors(
                this.wheelRayResults[1], this.wheelRayResults[0]
            );
            const v2 = this._tmpVec3B.subVectors(
                this.wheelRayResults[2], this.wheelRayResults[0]
            );

            const normal = this._tmpVec3C.crossVectors(v1, v2).normalize();

            if (normal.y > 0.6) {
                const alignQuat = this._tmpQuatA.setFromUnitVectors(this._upVector, normal);

                const currentYRotation = this.carGroup.rotation.y;
                const yRotationQuat = this._tmpQuatB.setFromAxisAngle(this._upVector, currentYRotation);

                const targetQuat = alignQuat.clone().premultiply(yRotationQuat);

                const smoothingFactor = 0.15;
                this.carGroup.quaternion.slerp(targetQuat, smoothingFactor);
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

    private readonly _rearWheels = [
        { x: 0.48, y: 0.05, z: -0.55, id: "rear-right" },
        { x: -0.48, y: 0.05, z: -0.55, id: "rear-left" },
    ];

    private createDriftTrails(): void {
        if (!this.isGrounded) return;

        for (const wheelPos of this._rearWheels) {
            const worldPos = this.carGroup.localToWorld(
                this._tmpVec3A.set(wheelPos.x, wheelPos.y, wheelPos.z),
            );

            this.raycaster.set(
                this._tmpVec3B.set(worldPos.x, worldPos.y + 2, worldPos.z),
                this._downVector
            );

            const intersects = this.raycaster.intersectObjects(this._validGroundObjects, true);

            if (intersects.length > 0) {
                const groundPoint = intersects[0].point.clone();
                groundPoint.y += 0.02;

                this.trailSystem.addTrail(
                    groundPoint,
                    this.carGroup.rotation.y,
                    undefined,
                    wheelPos.id,
                    0.08,
                    this.driftIntensity,
                );
            }
        }
    }

    public getPosition(): THREE.Vector3 {
        return this.position.clone();
    }

    public getDirection(): THREE.Vector3 {
        return this.direction.clone();
    }

    public getPositionRef(): Readonly<THREE.Vector3> {
        return this.position;
    }

    public getDirectionRef(): Readonly<THREE.Vector3> {
        return this.direction;
    }

    public dispose(): void {
        this.trailSystem.dispose();
    }
}
