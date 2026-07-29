import * as THREE from "three";
import type { InputManager } from "../input/InputManager";
import type { MapBuilder } from "../map/MapBuilder";
import type { ParticleSystem } from "../effects/ParticleSystem";
import { TrailSystem } from "../effects/TrailSystem";
import { CarModel, TRACK_HALF_WIDTH, WHEEL_BASE, WHEEL_POSITIONS } from "./CarModel";
import { CarPhysics, GRASS_SURFACE, TRACK_SURFACE, type CarInput, type SurfaceState } from "./CarPhysics";
import { WORLD_RADIUS } from "../core/Config";

const GRAVITY = 26;
const CAR_HALF_LENGTH = 1.0;
const CAR_HALF_WIDTH = 0.62;
const MAX_SUSPENSION_TRAVEL = 0.11;
const BOUNDARY_RADIUS = WORLD_RADIUS - 6;

const DUST_TRACK = new THREE.Color(0x9c8055);
const DUST_GRASS = new THREE.Color(0x5c6b34);
const DEBRIS_COLOR = new THREE.Color(0x6d5a3c);

export class CarController {
    private readonly root: THREE.Group;
    private readonly model: CarModel;
    private readonly physics = new CarPhysics();
    private readonly trails: TrailSystem;
    private readonly particles: ParticleSystem;
    private readonly mapBuilder: MapBuilder;
    private readonly input: InputManager;

    private readonly position = new THREE.Vector3();
    private readonly direction = new THREE.Vector3(0, 0, 1);
    private heading = 0;

    private verticalVelocity = 0;
    private grounded = true;
    private airborneTime = 0;
    private previousGroundHeight = 0;
    private hasPreviousGround = false;

    private bodyPitch = 0;
    private bodyRoll = 0;
    private dynamicPitch = 0;
    private dynamicRoll = 0;
    private previousSpeed = 0;

    private onTrack = true;
    private elapsed = 0;
    private dustAccumulator = 0;
    private trailAccumulator = 0;
    private wasTrailing = false;

    private readonly wheelGroundHeights = [0, 0, 0, 0];
    private readonly suspension = [0, 0, 0, 0];

    private readonly driveInput: CarInput = { throttle: 0, steer: 0, handbrake: false, boost: false };

    private readonly _wheelWorld = new THREE.Vector3();
    private readonly _nextPosition = new THREE.Vector3();
    private readonly _trailPoint = new THREE.Vector3();
    private readonly _euler = new THREE.Euler(0, 0, 0, "YXZ");

    constructor(
        scene: THREE.Scene,
        input: InputManager,
        mapBuilder: MapBuilder,
        particles: ParticleSystem,
    ) {
        this.input = input;
        this.mapBuilder = mapBuilder;
        this.particles = particles;

        this.root = new THREE.Group();
        this.root.rotation.order = "YXZ";
        scene.add(this.root);

        this.model = new CarModel(this.root);
        this.trails = new TrailSystem(scene);

        this.resetToStart();
    }

    public resetToStart(): void {
        const start = this.mapBuilder.getStartPosition();
        const startDirection = this.mapBuilder.getStartDirection();
        this.placeAt(start.x, start.z, Math.atan2(startDirection.x, startDirection.z));
        this.trails.clear();
    }

    /** Drops the car back onto the racing line at its current point on the lap. */
    public respawn(): number {
        const query = this.mapBuilder.queryTrack(this.position.x, this.position.z);
        const sample = this.mapBuilder.getTrackPath().sampleAt(query.t);
        this.placeAt(sample.x, sample.z, Math.atan2(sample.tangentX, sample.tangentZ));
        this.trails.breakAllTrails();
        return query.t;
    }

    private placeAt(x: number, z: number, heading: number): void {
        this.heading = heading;
        this.direction.set(Math.sin(heading), 0, Math.cos(heading));
        this.position.set(x, this.mapBuilder.getSurfaceHeightAt(x, z), z);

        this.physics.reset();
        this.verticalVelocity = 0;
        this.grounded = true;
        this.airborneTime = 0;
        this.hasPreviousGround = false;
        this.bodyPitch = 0;
        this.bodyRoll = 0;
        this.dynamicPitch = 0;
        this.dynamicRoll = 0;
        this.previousSpeed = 0;
        this.suspension.fill(0);

        this.root.position.copy(this.position);
        this.root.rotation.set(0, heading, 0);
        this.model.setSuspension(this.suspension);
        this.model.setSteering(0);
    }

    public update(deltaTime: number, canDrive: boolean): void {
        this.elapsed += deltaTime;

        this.readInput(canDrive);
        this.onTrack = this.mapBuilder.isPointOnTrack(this.position.x, this.position.z);

        const surface = this.resolveSurface();
        this.physics.update(deltaTime, this.driveInput, surface);

        this.integrateHeading(deltaTime);
        this.integrateHorizontal(deltaTime);
        this.resolveObstacles();
        this.resolveBoundary();
        this.integrateVertical(deltaTime);
        this.updateSuspension(deltaTime);
        this.updateBodyAttitude(deltaTime);
        this.applyTransform();

        this.updateModelState(deltaTime);
        this.spawnEffects(deltaTime);
        this.trails.update(deltaTime);
    }

    private readInput(canDrive: boolean): void {
        const sampled = this.input.sample();

        if (canDrive) {
            this.driveInput.throttle = sampled.throttle;
            this.driveInput.steer = sampled.steer;
            this.driveInput.handbrake = sampled.handbrake;
            this.driveInput.boost = sampled.boost;
        } else {
            // During the countdown the wheels can be turned but the car stays put.
            this.driveInput.throttle = 0;
            this.driveInput.steer = sampled.steer;
            this.driveInput.handbrake = true;
            this.driveInput.boost = false;
        }
    }

    private resolveSurface(): SurfaceState {
        if (this.onTrack) return TRACK_SURFACE;
        return GRASS_SURFACE;
    }

    private integrateHeading(deltaTime: number): void {
        this.heading += this.physics.getYawRate() * deltaTime;
        this.direction.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    }

    private integrateHorizontal(deltaTime: number): void {
        const velocity = this.physics.getVelocity();
        const lateral = this.physics.getLateralVelocity();

        // Local right vector for the sideways slip component.
        const rightX = -this.direction.z;
        const rightZ = this.direction.x;

        this._nextPosition.set(
            this.position.x + (this.direction.x * velocity + rightX * lateral) * deltaTime,
            this.position.y,
            this.position.z + (this.direction.z * velocity + rightZ * lateral) * deltaTime,
        );

        this.position.x = this._nextPosition.x;
        this.position.z = this._nextPosition.z;
    }

    private resolveObstacles(): void {
        const groundHeight = this.mapBuilder.getSurfaceHeightAt(this.position.x, this.position.z);
        const carBottom = this.position.y - groundHeight;

        const cosHeading = Math.cos(this.heading);
        const sinHeading = Math.sin(this.heading);
        const speed = Math.abs(this.physics.getVelocity());

        this.mapBuilder.forEachObstacleNear(this.position.x, this.position.z, 3.5, (obstacle) => {
            // Flying over the top of something is not a collision.
            if (carBottom > obstacle.height) return;

            const dx = obstacle.x - this.position.x;
            const dz = obstacle.z - this.position.z;

            // Into car space so the hull can be treated as a rounded box.
            const localX = dx * cosHeading - dz * sinHeading;
            const localZ = dx * sinHeading + dz * cosHeading;

            const closestX = THREE.MathUtils.clamp(localX, -CAR_HALF_WIDTH, CAR_HALF_WIDTH);
            const closestZ = THREE.MathUtils.clamp(localZ, -CAR_HALF_LENGTH, CAR_HALF_LENGTH);

            const offsetX = localX - closestX;
            const offsetZ = localZ - closestZ;
            const distanceSq = offsetX * offsetX + offsetZ * offsetZ;
            const reach = obstacle.radius;

            if (distanceSq >= reach * reach) return;

            const distance = Math.sqrt(distanceSq);
            let normalLocalX: number;
            let normalLocalZ: number;

            if (distance > 1e-4) {
                normalLocalX = -offsetX / distance;
                normalLocalZ = -offsetZ / distance;
            } else {
                // Dead centre: push out along the shallower axis.
                normalLocalX = Math.abs(localX) > Math.abs(localZ) ? -Math.sign(localX) : 0;
                normalLocalZ = normalLocalX === 0 ? -Math.sign(localZ) || 1 : 0;
            }

            const penetration = reach - distance;

            // Back to world space (inverse of the rotation applied above).
            const normalX = normalLocalX * cosHeading + normalLocalZ * sinHeading;
            const normalZ = -normalLocalX * sinHeading + normalLocalZ * cosHeading;

            const push = penetration * (0.35 + obstacle.solidity * 0.65);
            this.position.x += normalX * push;
            this.position.z += normalZ * push;

            const approach = -(this.direction.x * normalX + this.direction.z * normalZ);
            const severity = THREE.MathUtils.clamp(
                Math.max(0, approach) * (speed / 26) * obstacle.solidity,
                0,
                1,
            );

            if (severity > 0.02) {
                this.physics.applyImpact(severity);
                this.emitImpactDebris(normalX, normalZ, severity);
            } else if (obstacle.solidity < 0.3) {
                this.physics.scrubSpeed(0.985);
            }
        });
    }

    private resolveBoundary(): void {
        const distance = Math.hypot(this.position.x, this.position.z);
        if (distance <= BOUNDARY_RADIUS) return;

        const scale = BOUNDARY_RADIUS / distance;
        this.position.x *= scale;
        this.position.z *= scale;
        this.physics.scrubSpeed(0.82);
    }

    private integrateVertical(deltaTime: number): void {
        const groundHeight = this.sampleWheelGround();

        const terrainRate = this.hasPreviousGround
            ? THREE.MathUtils.clamp((groundHeight - this.previousGroundHeight) / Math.max(deltaTime, 1e-4), -34, 34)
            : 0;
        this.previousGroundHeight = groundHeight;
        this.hasPreviousGround = true;

        this.verticalVelocity -= GRAVITY * deltaTime;
        this.position.y += this.verticalVelocity * deltaTime;

        if (this.position.y <= groundHeight) {
            if (!this.grounded && this.verticalVelocity < -6) {
                this.handleLanding(-this.verticalVelocity, groundHeight);
            }

            this.position.y = groundHeight;
            // Riding the surface: vertical speed simply matches how fast the ground rises or falls.
            this.verticalVelocity = terrainRate;
            this.grounded = true;
            this.airborneTime = 0;
        } else {
            this.grounded = false;
            this.airborneTime += deltaTime;

            // A long jump is worth a sliver of boost.
            if (this.airborneTime > 0.35) {
                this.physics.addBoostCharge(deltaTime * 0.18);
            }
        }
    }

    private handleLanding(impactSpeed: number, groundHeight: number): void {
        const severity = THREE.MathUtils.clamp((impactSpeed - 6) / 16, 0, 1);
        this.physics.scrubSpeed(1 - severity * 0.22);
        this.dynamicPitch += severity * 0.16;

        const color = this.onTrack ? DUST_TRACK : DUST_GRASS;
        const count = Math.round(6 + severity * 14);

        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2;
            const spread = 1.4 + Math.random() * 2.4;
            this.particles.emit(
                this.position.x + Math.cos(angle) * 0.5,
                groundHeight + 0.08,
                this.position.z + Math.sin(angle) * 0.5,
                Math.cos(angle) * spread,
                1 + Math.random() * 1.6,
                Math.sin(angle) * spread,
                {
                    color,
                    size: 0.4 + Math.random() * 0.4,
                    sizeGrowth: 2.4,
                    life: 0.5 + Math.random() * 0.5,
                    gravity: 2.2,
                    drag: 2.4,
                    alpha: 0.4 + severity * 0.25,
                },
            );
        }
    }

    private sampleWheelGround(): number {
        let total = 0;

        for (let i = 0; i < WHEEL_POSITIONS.length; i++) {
            const wheel = WHEEL_POSITIONS[i];
            this.localToWorldXZ(wheel.x, wheel.z, this._wheelWorld);
            const height = this.mapBuilder.getSurfaceHeightAt(this._wheelWorld.x, this._wheelWorld.z);
            this.wheelGroundHeights[i] = height;
            total += height;
        }

        return total / WHEEL_POSITIONS.length;
    }

    private localToWorldXZ(localX: number, localZ: number, out: THREE.Vector3): void {
        const cos = Math.cos(this.heading);
        const sin = Math.sin(this.heading);
        out.set(
            this.position.x + localX * cos + localZ * sin,
            0,
            this.position.z - localX * sin + localZ * cos,
        );
    }

    private updateSuspension(deltaTime: number): void {
        const [frontRight, frontLeft, rearRight, rearLeft] = this.wheelGroundHeights;
        const average = (frontRight + frontLeft + rearRight + rearLeft) / 4;

        const pitchSlope = (frontRight + frontLeft - rearRight - rearLeft) / (4 * WHEEL_BASE);
        const rollSlope = (frontRight + rearRight - frontLeft - rearLeft) / (4 * TRACK_HALF_WIDTH);

        const blend = 1 - Math.exp(-16 * deltaTime);

        for (let i = 0; i < WHEEL_POSITIONS.length; i++) {
            const wheel = WHEEL_POSITIONS[i];
            const planeHeight = average + pitchSlope * wheel.z + rollSlope * wheel.x;
            const residual = this.grounded
                ? THREE.MathUtils.clamp(this.wheelGroundHeights[i] - planeHeight, -MAX_SUSPENSION_TRAVEL, MAX_SUSPENSION_TRAVEL)
                : -MAX_SUSPENSION_TRAVEL * 0.55;

            this.suspension[i] += (residual - this.suspension[i]) * blend;
        }

        this.model.setSuspension(this.suspension);

        if (this.grounded) {
            // Nose up when climbing, nose down when descending.
            const targetPitch = -Math.atan(pitchSlope);
            const targetRoll = Math.atan(rollSlope);
            const terrainBlend = 1 - Math.exp(-12 * deltaTime);
            this.bodyPitch += (targetPitch - this.bodyPitch) * terrainBlend;
            this.bodyRoll += (targetRoll - this.bodyRoll) * terrainBlend;
        } else {
            const airBlend = 1 - Math.exp(-2.6 * deltaTime);
            this.bodyPitch += (-0.12 - this.bodyPitch) * airBlend;
            this.bodyRoll += (0 - this.bodyRoll) * airBlend;
        }
    }

    private updateBodyAttitude(deltaTime: number): void {
        const speed = this.physics.getVelocity();
        const acceleration = (speed - this.previousSpeed) / Math.max(deltaTime, 1e-4);
        this.previousSpeed = speed;

        // Weight transfer: squat under power, dive under braking, lean out of corners.
        const targetPitch = THREE.MathUtils.clamp(-acceleration * 0.0022, -0.07, 0.07);
        const targetRoll = THREE.MathUtils.clamp(this.physics.getLateralVelocity() * 0.017, -0.16, 0.16);

        const blend = 1 - Math.exp(-9 * deltaTime);
        this.dynamicPitch += (targetPitch - this.dynamicPitch) * blend;
        this.dynamicRoll += (targetRoll - this.dynamicRoll) * blend;
    }

    private applyTransform(): void {
        this.root.position.copy(this.position);
        this._euler.set(
            this.bodyPitch + this.dynamicPitch,
            this.heading,
            this.bodyRoll + this.dynamicRoll,
            "YXZ",
        );
        this.root.rotation.copy(this._euler);
    }

    private updateModelState(deltaTime: number): void {
        const velocity = this.physics.getVelocity();

        this.model.setSteering(this.physics.getSteeringAngle() * 3.4);
        this.model.spinWheels(this.grounded ? velocity * deltaTime : velocity * deltaTime * 0.4);

        const braking = this.driveInput.throttle < -0.05 && velocity > 1;
        const handbraking = this.driveInput.handbrake && Math.abs(velocity) > 1;
        this.model.setBrakeLights(braking || handbraking ? 1 : 0);
        this.model.setReverseLights(velocity < -0.5);
        this.model.setBoost(this.physics.isBoosting() ? 1 : 0, this.elapsed);
        this.model.setHeadlights(1.4 + this.physics.getEngineLoad() * 0.6);
    }

    private spawnEffects(deltaTime: number): void {
        const speed = Math.abs(this.physics.getVelocity());
        const slip = Math.abs(this.physics.getLateralVelocity());
        const drifting = this.physics.isDrifting();
        const intensity = THREE.MathUtils.clamp(Math.max(this.physics.getDriftFactor(), slip / 6), 0, 1);

        const laying = this.grounded && speed > 3 && (drifting || slip > 0.9 || (!this.onTrack && speed > 8));

        if (laying) {
            this.trailAccumulator += deltaTime;
            if (this.trailAccumulator > 0.016) {
                this.trailAccumulator = 0;
                this.layTrails(intensity);
            }
            this.wasTrailing = true;
        } else if (this.wasTrailing) {
            this.trails.breakAllTrails();
            this.wasTrailing = false;
        }

        const wantsDust = this.grounded && speed > 6 && (laying || !this.onTrack || this.physics.isBoosting());
        if (!wantsDust) {
            this.dustAccumulator = 0;
            return;
        }

        const rate = 40 + intensity * 90 + (this.physics.isBoosting() ? 40 : 0);
        this.dustAccumulator += deltaTime * rate;

        while (this.dustAccumulator >= 1) {
            this.dustAccumulator -= 1;
            this.emitWheelDust(intensity, speed);
        }
    }

    private layTrails(intensity: number): void {
        const sin = Math.sin(this.heading);
        const cos = Math.cos(this.heading);

        for (let i = 2; i < WHEEL_POSITIONS.length; i++) {
            const wheel = WHEEL_POSITIONS[i];
            this.localToWorldXZ(wheel.x, wheel.z, this._wheelWorld);

            const onTrack = this.mapBuilder.isPointOnTrack(this._wheelWorld.x, this._wheelWorld.z);
            this._trailPoint.set(
                this._wheelWorld.x,
                this.mapBuilder.getSurfaceHeightAt(this._wheelWorld.x, this._wheelWorld.z) + 0.02,
                this._wheelWorld.z,
            );

            this.trails.addMark(`wheel-${i}`, this._trailPoint, sin, cos, onTrack, intensity);
        }
    }

    private emitWheelDust(intensity: number, speed: number): void {
        const wheelIndex = 2 + (Math.random() > 0.5 ? 1 : 0);
        const wheel = WHEEL_POSITIONS[wheelIndex];
        this.localToWorldXZ(wheel.x, wheel.z, this._wheelWorld);

        const surfaceHeight = this.mapBuilder.getSurfaceHeightAt(this._wheelWorld.x, this._wheelWorld.z);
        const onTrack = this.mapBuilder.isPointOnTrack(this._wheelWorld.x, this._wheelWorld.z);

        const backX = -this.direction.x;
        const backZ = -this.direction.z;
        const spray = 1.5 + intensity * 5 + speed * 0.09;

        this.particles.emit(
            this._wheelWorld.x + (Math.random() - 0.5) * 0.2,
            surfaceHeight + 0.1,
            this._wheelWorld.z + (Math.random() - 0.5) * 0.2,
            backX * spray + (Math.random() - 0.5) * 2.2,
            0.8 + Math.random() * 1.5 + intensity * 1.2,
            backZ * spray + (Math.random() - 0.5) * 2.2,
            {
                color: onTrack ? DUST_TRACK : DUST_GRASS,
                size: 0.34 + Math.random() * 0.4 + intensity * 0.35,
                sizeGrowth: 3.4,
                life: 0.5 + Math.random() * 0.6,
                gravity: 1.1,
                drag: 2.1,
                alpha: 0.3 + intensity * 0.35,
            },
        );
    }

    private emitImpactDebris(normalX: number, normalZ: number, severity: number): void {
        const count = Math.round(3 + severity * 12);
        const groundHeight = this.mapBuilder.getSurfaceHeightAt(this.position.x, this.position.z);

        for (let i = 0; i < count; i++) {
            const spread = 2 + Math.random() * 5 * severity;
            this.particles.emit(
                this.position.x - normalX * 0.8,
                groundHeight + 0.3 + Math.random() * 0.3,
                this.position.z - normalZ * 0.8,
                -normalX * spread + (Math.random() - 0.5) * 3,
                1.5 + Math.random() * 3,
                -normalZ * spread + (Math.random() - 0.5) * 3,
                {
                    color: DEBRIS_COLOR,
                    size: 0.14 + Math.random() * 0.22,
                    sizeGrowth: 1.2,
                    life: 0.4 + Math.random() * 0.5,
                    gravity: 9,
                    drag: 1.1,
                    alpha: 0.55,
                },
            );
        }
    }

    public getPositionRef(): Readonly<THREE.Vector3> { return this.position; }
    public getDirectionRef(): Readonly<THREE.Vector3> { return this.direction; }
    public getSpeed(): number { return Math.abs(this.physics.getVelocity()); }
    public getSpeedKph(): number { return Math.abs(this.physics.getVelocity()) * 3.6; }
    public getBoostCharge(): number { return this.physics.getBoostCharge(); }
    public isBoosting(): boolean { return this.physics.isBoosting(); }
    public isDrifting(): boolean { return this.physics.isDrifting(); }
    public isAirborne(): boolean { return !this.grounded; }
    public isOnTrack(): boolean { return this.onTrack; }
    public getDriftIntensity(): number {
        return THREE.MathUtils.clamp(Math.abs(this.physics.getLateralVelocity()) / 6, 0, 1);
    }

    public dispose(): void {
        this.trails.dispose();
        this.model.dispose();
        this.root.parent?.remove(this.root);
    }
}
