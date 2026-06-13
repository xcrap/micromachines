import * as THREE from "three";
import type { InputManager } from "../input/InputManager";
import { CarModel } from "./CarModel";
import { CarPhysics, type CarInput } from "./CarPhysics";
import type { MapBuilder } from "../map/MapBuilder";
import { TrailSystem } from "../effects/TrailSystem";

export class CarController {
    private carModel: CarModel;
    private carPhysics: CarPhysics;
    private inputManager: InputManager;
    private position: THREE.Vector3;
    private direction: THREE.Vector3;
    private carGroup: THREE.Group;
    private contactShadow: THREE.Mesh;
    private contactShadowTexture: THREE.Texture;
    private contactShadowMaterial: THREE.MeshBasicMaterial;
    private mapBuilder: MapBuilder;
    private isOnTrack = true;
    private trailSystem: TrailSystem;
    private isDrifting = false;
    private lastTrailTime = 0;
    private elapsedTime = 0;
    private readonly TRAIL_SPAWN_INTERVAL: number = 0.05;
    private driftIntensity = 0;
    private wasTrailing = false;
    private heading = 0;

    // Collision detection
    private collisionRaycaster: THREE.Raycaster;
    private readonly collisionDistance = 0.8;
    private readonly collisionBroadPhasePadding = 4;
    private readonly mapRadius = 100;
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
    private readonly chassisToGroundRest = 0.15;   // Target chassis height above ground

    // Reusable temp objects to avoid per-frame allocations
    private readonly _tmpVec3A = new THREE.Vector3();
    private readonly _tmpVec3B = new THREE.Vector3();
    private readonly _tmpVec3C = new THREE.Vector3();
    private readonly _tmpQuatA = new THREE.Quaternion();
    private readonly _tmpEuler = new THREE.Euler();
    private readonly _upVector = new THREE.Vector3(0, 1, 0);
    private readonly _collisionOrigin = new THREE.Vector3();
    private readonly _collisionPoint = new THREE.Vector3();
    private readonly _collisionHits: THREE.Intersection[] = [];
    private readonly _collisionResult = {
        hasCollision: false,
        collisionPoint: this._collisionPoint,
    };
    private readonly _trailGroundPoint = new THREE.Vector3();
    private readonly _inputState: CarInput = {
        forward: false,
        backward: false,
        left: false,
        right: false,
        brake: false,
        drift: false,
    };
    private readonly _collisionDirs: THREE.Vector3[] = [
        new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()
    ];
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
        const contactShadow = this.createContactShadow(scene);
        this.contactShadow = contactShadow.mesh;
        this.contactShadowTexture = contactShadow.texture;
        this.contactShadowMaterial = contactShadow.material;

        // Initialize car physics
        this.carPhysics = new CarPhysics();

        // Get start position from the map builder
        const startPosition = mapBuilder.getStartPosition();
        const startDirection = mapBuilder.getStartDirection();

        // Set initial position and direction using the track's start position
        const startSurfaceHeight = mapBuilder.getSurfaceHeightAt(startPosition.x, startPosition.z);
        this.position = new THREE.Vector3(
            startPosition.x,
            startSurfaceHeight + this.chassisToGroundRest,
            startPosition.z
        );
        this.direction = new THREE.Vector3(startDirection.x, 0, startDirection.z).normalize();

        // Set initial car rotation to face along the track
        this.heading = Math.atan2(startDirection.x, startDirection.z);
        this.carGroup.rotation.y = this.heading;

        // Initialize raycaster for collision detection
        this.collisionRaycaster = new THREE.Raycaster();
        this.collisionRaycaster.far = this.collisionDistance;

        // Initialize trail system
        this.trailSystem = new TrailSystem(scene);
        this.trailSystem.setTrackSurfaceTest((x, z) => this.mapBuilder.isPointOnTrack(x, z));

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
            return obj !== this.groundMesh && obj !== this.trackMesh && obj.userData.nonCollidable !== true;
        });

        // Initial position update
        this.updatePosition();
        this.updateContactShadow();
    }

    public update(deltaTime: number): void {
        // Clamp deltaTime to avoid physics instability with large time steps
        const dt = THREE.MathUtils.clamp(deltaTime, 0, 0.03);
        this.elapsedTime += dt;

        const input = this._inputState;
        input.forward =
            this.inputManager.isKeyPressed("q") ||
            this.inputManager.isKeyPressed("ArrowUp");
        input.backward =
            this.inputManager.isKeyPressed("a") ||
            this.inputManager.isKeyPressed("ArrowDown");
        input.left =
            this.inputManager.isKeyPressed("o") ||
            this.inputManager.isKeyPressed("ArrowLeft");
        input.right =
            this.inputManager.isKeyPressed("p") ||
            this.inputManager.isKeyPressed("ArrowRight");
        input.brake = false;
        input.drift = this.inputManager.isKeyPressed(" ");

        // Check if car is on track
        this.checkIfOnTrack();

        // Update physics based on input
        this.carPhysics.update(dt, input, !this.isOnTrack);

        // Apply physics to car position and rotation
        const velocity = this.carPhysics.getVelocity();
        const lateralVelocity = this.carPhysics.getLateralVelocity();

        // Apply yaw rate to car rotation
        const yawRate = this.carPhysics.getYawRate();
        this.heading += yawRate * dt;
        this.carGroup.rotation.y = this.heading;

        // Update direction vector from current heading
        this.direction.x = Math.sin(this.heading);
        this.direction.z = Math.cos(this.heading);

        // Create a lateral direction vector (perpendicular to main direction)
        const lateralDirection = this._tmpVec3A.set(
            -this.direction.z,
            0,
            this.direction.x
        );

        // Calculate new position with both forward velocity and lateral slide
        const newPosition = this._tmpVec3B.copy(this.position);

        // Apply forward velocity
        newPosition.x += this.direction.x * velocity * dt;
        newPosition.z += this.direction.z * velocity * dt;

        // Apply lateral velocity from tire slip
        if (Math.abs(lateralVelocity) > 0.05) {
            newPosition.x += lateralDirection.x * lateralVelocity * dt;
            newPosition.z += lateralDirection.z * lateralVelocity * dt;
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
            this.position.x = THREE.MathUtils.clamp(this.position.x, -this.mapRadius, this.mapRadius);
            this.position.z = THREE.MathUtils.clamp(this.position.z, -this.mapRadius, this.mapRadius);
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
            const tiltBlend = 1 - Math.exp(-12 * dt);

            this.carGroup.rotation.z += (rollTarget - this.carGroup.rotation.z) * tiltBlend;
            this.carGroup.rotation.x += (pitchTarget - this.carGroup.rotation.x) * tiltBlend;
        } else {
            const levelBlend = 1 - Math.exp(-9 * dt);
            this.carGroup.rotation.z += (0 - this.carGroup.rotation.z) * levelBlend;
            this.carGroup.rotation.x += (0 - this.carGroup.rotation.x) * levelBlend;
        }

        // Update car wheels rotation based on velocity
        this.carModel.updateWheelRotation(velocity * dt);

        // Apply physics-based terrain following only when on ground
        if (this.isGrounded) {
            this.applyTerrainPhysics(dt);
        } else {
            // Apply airborne tilt and orientation
            this.applyAirborneRotation(dt);
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
            if (this.elapsedTime - this.lastTrailTime > this.TRAIL_SPAWN_INTERVAL) {
                this.createDriftTrails();
                this.lastTrailTime = this.elapsedTime;
            }
        } else if (this.wasTrailing) {
            this.trailSystem.breakAllTrails();
        }
        this.wasTrailing = shouldTrail;

        // Update trail system
        this.trailSystem.update(dt);
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
        const surfaceHeight = this.mapBuilder.getSurfaceHeightAt(this.position.x, this.position.z);
        return this.position.y - surfaceHeight < 0.65;
    }

    private applyAirborneRotation(dt: number): void {
        // Gradually rotate the car to be level when in air
        if (this.airborneTime > 0.2) { // Only start leveling after a short time in air
            // Calculate target rotation to level out
            const targetRotation = this._tmpQuatA.setFromEuler(
                this._tmpEuler.set(0, this.heading, 0)
            );

            // Smoothly interpolate current rotation towards level
            const smoothingFactor = 1 - Math.exp(-5 * dt);
            this.carGroup.quaternion.slerp(targetRotation, smoothingFactor);
        }
    }

    private checkCollisions(newPosition: THREE.Vector3): { hasCollision: boolean, collisionPoint: THREE.Vector3 } {
        this._collisionResult.hasCollision = false;

        if (this.collisionObjects.length === 0) {
            return this._collisionResult;
        }

        // Check collision with each object in collision list
        let nearestCollision = Infinity;

        // Check collisions in multiple directions for better coverage
        this._collisionDirs[0].copy(this.direction); // Forward
        this._collisionDirs[1].set(-this.direction.x, 0, -this.direction.z); // Backward
        this._collisionDirs[2].set(-this.direction.z, 0, this.direction.x); // Left
        this._collisionDirs[3].set(this.direction.z, 0, -this.direction.x); // Right
        this._collisionOrigin.set(newPosition.x, newPosition.y + 0.3, newPosition.z);

        for (const direction of this._collisionDirs) {
            this.collisionRaycaster.set(
                this._collisionOrigin,
                direction
            );

            for (const object of this.collisionObjects) {
                const dx = object.position.x - newPosition.x;
                const dz = object.position.z - newPosition.z;
                const userRadius = object.userData.radius;
                const radius = (typeof userRadius === "number" ? userRadius : 4) + this.collisionBroadPhasePadding;

                if (dx * dx + dz * dz > radius * radius) continue;

                this.collisionRaycaster.intersectObject(object, true, this._collisionHits);

                if (this._collisionHits.length > 0 && this._collisionHits[0].distance < nearestCollision) {
                    nearestCollision = this._collisionHits[0].distance;
                    this._collisionPoint.copy(this._collisionHits[0].point);
                    this._collisionResult.hasCollision = true;
                }

                this._collisionHits.length = 0;
            }
        }

        return this._collisionResult;
    }

    private getWorldWheelPosition(localPos: { x: number, y: number, z: number }, index: number): THREE.Vector3 {
        const wheelPos = this._worldWheelPositions[index];
        wheelPos.set(localPos.x, localPos.y, localPos.z);
        wheelPos.applyAxisAngle(this._upVector, this.heading);
        wheelPos.add(this.position);
        return wheelPos;
    }

    private applyTerrainPhysics(dt: number): void {
        let averageGroundHeight = 0;

        for (let i = 0; i < this.wheelPositions.length; i++) {
            const wheelPos = this.getWorldWheelPosition(this.wheelPositions[i], i);
            const groundHeight = this.mapBuilder.getSurfaceHeightAt(wheelPos.x, wheelPos.z);
            averageGroundHeight += groundHeight;
        }

        averageGroundHeight /= this.wheelPositions.length;
        const targetHeight = averageGroundHeight + this.chassisToGroundRest;
        const heightBlend = 1 - Math.exp(-14 * dt);
        this.position.y += (targetHeight - this.position.y) * heightBlend;
    }

    private isPositionValid(position: THREE.Vector3): boolean {
        // Check if position is within map boundaries
        return (
            position.x >= -this.mapRadius &&
            position.x <= this.mapRadius &&
            position.z >= -this.mapRadius &&
            position.z <= this.mapRadius
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
        this.updateContactShadow();
    }

    private createContactShadow(scene: THREE.Scene): {
        mesh: THREE.Mesh;
        texture: THREE.Texture;
        material: THREE.MeshBasicMaterial;
    } {
        const size = 128;
        const canvas = document.createElement("canvas");
        canvas.width = size;
        canvas.height = size;
        const ctx = canvas.getContext("2d")!;
        const gradient = ctx.createRadialGradient(
            size / 2,
            size / 2,
            size * 0.08,
            size / 2,
            size / 2,
            size * 0.5,
        );
        gradient.addColorStop(0, "rgba(0, 0, 0, 0.34)");
        gradient.addColorStop(0.55, "rgba(0, 0, 0, 0.18)");
        gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);

        const texture = new THREE.CanvasTexture(canvas);
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            transparent: true,
            depthWrite: false,
            depthTest: true,
            opacity: 0.65,
        });
        const geometry = new THREE.CircleGeometry(0.85, 48);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.scale.set(0.85, 1.25, 1);
        mesh.renderOrder = 20;
        scene.add(mesh);

        return { mesh, texture, material };
    }

    private updateContactShadow(): void {
        const surfaceHeight = this.mapBuilder.getSurfaceHeightAt(this.position.x, this.position.z);
        this.contactShadow.position.set(
            this.position.x,
            surfaceHeight + 0.04,
            this.position.z,
        );
        this.contactShadow.rotation.y = this.heading;
        this.contactShadowMaterial.opacity = this.isGrounded ? 0.65 : 0.25;
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

            this._trailGroundPoint.set(
                worldPos.x,
                this.mapBuilder.getSurfaceHeightAt(worldPos.x, worldPos.z) + 0.02,
                worldPos.z,
            );

            this.trailSystem.addTrail(
                this._trailGroundPoint,
                this.heading,
                undefined,
                wheelPos.id,
                0.08,
                this.driftIntensity,
            );
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

    public getSpeed(): number {
        return Math.abs(this.carPhysics.getVelocity());
    }

    public dispose(): void {
        this.trailSystem.dispose();
        this.carModel.dispose();
        this.contactShadow.parent?.remove(this.contactShadow);
        this.contactShadow.geometry.dispose();
        this.contactShadowTexture.dispose();
        this.contactShadowMaterial.dispose();
        this.carGroup.parent?.remove(this.carGroup);
        this.collisionObjects.length = 0;
    }
}
