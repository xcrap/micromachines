import * as THREE from "three";
import type { DriveInputSource } from "../input/InputManager";
import type { MapBuilder } from "../map/MapBuilder";
import type { Obstacle } from "../map/Scatter";
import type { ParticleSystem } from "../effects/ParticleSystem";
import type { TrailSystem } from "../effects/TrailSystem";
import type { SurfaceKind } from "../tracks/types";
import { CarModel, TRACK_HALF_WIDTH, WHEEL_BASE, WHEEL_POSITIONS, type CarLivery } from "./CarModel";
import { CarPhysics, type CarInput } from "./CarPhysics";

const GRAVITY = 26;
const CAR_HALF_LENGTH = 1.0;
const CAR_HALF_WIDTH = 0.62;
const MAX_SUSPENSION_TRAVEL = 0.11;
/** Ground rising faster than this in one step is a wall, not a slope. */
const MAX_STEP_UP = 0.55;
/** Circles along the car's length used against box obstacles and other cars. */
export const HULL_CIRCLE_OFFSETS = [-0.58, 0, 0.58] as const;
export const HULL_CIRCLE_RADIUS = 0.64;
const RESPAWN_GHOST_SECONDS = 1.6;
/**
 * Fast over a crest the car leaves the ground for a few milliseconds at a time. Suspension,
 * body attitude and tyre effects only treat it as flying once it has been off the ground this long,
 * otherwise the wheels and body flicker between their in-air and on-ground poses.
 */
const AIRBORNE_VISUAL_DELAY = 0.12;
/** ...unless it is clearly clear of the ground, like off the end of a ramp. */
const AIRBORNE_VISUAL_GAP = 0.3;
/** Obstacles softer than this are driven through rather than bounced off. */
const SOFT_SOLIDITY = 0.3;
/** Fraction of speed a fully soft obstacle bleeds off per physics step while the car is inside it. */
const SOFT_DRAG = 0.006;

const DEBRIS_COLOR = new THREE.Color(0x6d5a3c);
const SPARK_COLOR = new THREE.Color(0xffd27a);

export interface CarControllerOptions {
    id: string;
    scene: THREE.Scene;
    mapBuilder: MapBuilder;
    particles: ParticleSystem;
    trails: TrailSystem;
    livery: CarLivery;
    driver: DriveInputSource;
}

export class CarController {
    readonly id: string;

    private readonly root: THREE.Group;
    private readonly model: CarModel;
    private readonly physics = new CarPhysics();
    private readonly scene: THREE.Scene;
    private readonly trails: TrailSystem;
    private readonly particles: ParticleSystem;
    private readonly mapBuilder: MapBuilder;
    private driver: DriveInputSource;

    private readonly position = new THREE.Vector3();
    private readonly direction = new THREE.Vector3(0, 0, 1);
    private readonly cameraAnchor = new THREE.Vector3();
    private heading = 0;

    /**
     * Physics runs on a fixed step but frames arrive whenever the display wants them, so a frame
     * can land on zero, one or three steps. Drawing the raw physics state makes the car judder;
     * instead each frame blends from the previous step's state to the current one.
     */
    private readonly previousPosition = new THREE.Vector3();
    private readonly previousAnchor = new THREE.Vector3();
    private previousHeading = 0;
    private previousPitch = 0;
    private previousRoll = 0;
    private readonly renderPosition = new THREE.Vector3();
    private readonly renderDirection = new THREE.Vector3(0, 0, 1);
    private readonly renderAnchor = new THREE.Vector3();
    private renderHeading = 0;

    private verticalVelocity = 0;
    private grounded = true;
    private airborneTime = 0;
    private groundGap = 0;
    private previousGroundHeight = 0;
    private hasPreviousGround = false;

    private bodyPitch = 0;
    private bodyRoll = 0;
    private dynamicPitch = 0;
    private dynamicRoll = 0;
    private previousSpeed = 0;
    /** Nose-down compression after a landing; eased in and out rather than snapped on. */
    private landingDip = 0;

    private onTrack = true;
    private surface: SurfaceKind;
    private elapsed = 0;
    private dustAccumulator = 0;
    private trailAccumulator = 0;
    private wasTrailing = false;
    private lastSafeT = 0;
    private ghostTimer = 0;
    private fellPending = false;
    private impactPending = 0;

    private readonly wheelGroundHeights = [0, 0, 0, 0];
    private readonly suspension = [0, 0, 0, 0];
    private readonly trailIds: string[];

    private readonly driveInput: CarInput = { throttle: 0, steer: 0, handbrake: false, boost: false };

    private readonly _wheelWorld = new THREE.Vector3();
    private readonly _trailPoint = new THREE.Vector3();
    private readonly _euler = new THREE.Euler(0, 0, 0, "YXZ");
    private readonly _skidColor = new THREE.Color();
    private readonly _dustColor = new THREE.Color();
    private readonly _trackPoint = { x: 0, z: 0, tangentX: 0, tangentZ: 1, curvature: 0 };
    private readonly _velocity = { x: 0, z: 0 };

    constructor(options: CarControllerOptions) {
        this.id = options.id;
        this.scene = options.scene;
        this.mapBuilder = options.mapBuilder;
        this.particles = options.particles;
        this.trails = options.trails;
        this.driver = options.driver;
        this.surface = this.mapBuilder.getTheme().surfaces.track;
        this.trailIds = WHEEL_POSITIONS.map((_, index) => `${this.id}-wheel-${index}`);

        this.root = new THREE.Group();
        this.root.rotation.order = "YXZ";
        this.scene.add(this.root);

        this.model = new CarModel(this.root, options.livery);
        this.scene.add(this.model.blobShadow);
    }

    public setDriver(driver: DriveInputSource): void {
        this.driver = driver;
    }

    public getDriver(): DriveInputSource {
        return this.driver;
    }

    public placeOnGrid(slot: number): void {
        const grid = this.mapBuilder.getGridSlot(slot, { x: 0, z: 0, heading: 0 });
        this.placeAt(grid.x, grid.z, grid.heading);
        this.physics.reset(false);
        this.lastSafeT = this.mapBuilder.queryTrack(grid.x, grid.z).t;
        this.ghostTimer = 0;
        this.model.chassis.visible = true;
        this.breakTrails();
    }

    /** Drops the car back onto the racing line at a point on the lap, briefly ghosted so it cannot be rammed. */
    public respawnAt(t: number, lateral = 0): void {
        const path = this.mapBuilder.getTrackPath();
        const point = path.pointAtArc(t * path.totalLength, lateral, this._trackPoint);
        this.placeAt(point.x, point.z, Math.atan2(point.tangentX, point.tangentZ));
        this.lastSafeT = t;
        this.ghostTimer = RESPAWN_GHOST_SECONDS;
        this.breakTrails();
    }

    /** Respawn at the last point where the car was safely on the road. */
    public respawn(): number {
        this.respawnAt(this.lastSafeT);
        return this.lastSafeT;
    }

    private placeAt(x: number, z: number, heading: number): void {
        this.heading = heading;
        this.direction.set(Math.sin(heading), 0, Math.cos(heading));
        this.position.set(x, this.mapBuilder.getSurfaceHeightAt(x, z), z);
        this.cameraAnchor.copy(this.position);

        this.physics.reset();
        this.verticalVelocity = 0;
        this.grounded = true;
        this.airborneTime = 0;
        this.hasPreviousGround = false;
        this.bodyPitch = 0;
        this.bodyRoll = 0;
        this.dynamicPitch = 0;
        this.dynamicRoll = 0;
        this.landingDip = 0;
        this.previousSpeed = 0;
        this.suspension.fill(0);

        this.model.setSuspension(this.suspension);
        this.model.setSteering(0);
        this.capturePreviousState();
        this.interpolate(1);
    }

    public update(deltaTime: number, canDrive: boolean): void {
        this.elapsed += deltaTime;
        this.capturePreviousState();

        this.readInput(canDrive);
        this.onTrack = this.mapBuilder.isPointOnTrack(this.position.x, this.position.z);
        this.surface = this.mapBuilder.getSurfaceAt(this.position.x, this.position.z, this.onTrack);

        this.physics.update(deltaTime, this.driveInput, this.surface);

        const previousX = this.position.x;
        const previousZ = this.position.z;

        this.integrateHeading(deltaTime);
        this.integrateHorizontal(deltaTime);
        this.resolveObstacles();
        this.resolveWalls(previousX, previousZ);
        this.resolveBoundary();
        this.resolveDebris();
        this.integrateVertical(deltaTime);
        this.updateSuspension(deltaTime);
        this.updateBodyAttitude(deltaTime);
        this.updateCameraAnchor();
        this.updateGhost(deltaTime);
        this.checkFall();

        this.updateModelState(deltaTime);
        this.spawnEffects(deltaTime);
    }

    private readInput(canDrive: boolean): void {
        const sampled = this.driver.sample();

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

    private integrateHeading(deltaTime: number): void {
        this.heading += this.physics.getYawRate() * deltaTime;
        this.direction.set(Math.sin(this.heading), 0, Math.cos(this.heading));
    }

    private integrateHorizontal(deltaTime: number): void {
        const velocity = this.physics.getVelocity();
        const lateral = this.physics.getLateralVelocity();

        const rightX = -this.direction.z;
        const rightZ = this.direction.x;

        this.position.x += (this.direction.x * velocity + rightX * lateral) * deltaTime;
        this.position.z += (this.direction.z * velocity + rightZ * lateral) * deltaTime;
    }

    private resolveObstacles(): void {
        const groundHeight = this.mapBuilder.getSurfaceHeightAt(this.position.x, this.position.z);
        const carBottom = this.position.y - groundHeight;

        this.mapBuilder.forEachObstacleNear(this.position.x, this.position.z, 3.5, (obstacle) => {
            // Flying over the top of something is not a collision.
            if (carBottom > obstacle.height - 0.2) return;

            if (obstacle.box) {
                this.collideBox(obstacle);
            } else {
                this.collideCircle(obstacle);
            }
        });
    }

    private collideCircle(obstacle: Obstacle): void {
        const cosHeading = Math.cos(this.heading);
        const sinHeading = Math.sin(this.heading);

        const dx = obstacle.x - this.position.x;
        const dz = obstacle.z - this.position.z;
        if (dx * dx + dz * dz > (obstacle.radius + 2) ** 2) return;

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

        // Back to world space (inverse of the rotation applied above).
        const normalX = normalLocalX * cosHeading + normalLocalZ * sinHeading;
        const normalZ = -normalLocalX * sinHeading + normalLocalZ * cosHeading;
        const contactX = this.position.x + closestX * cosHeading + closestZ * sinHeading;
        const contactZ = this.position.z - closestX * sinHeading + closestZ * cosHeading;

        this.resolveContact(normalX, normalZ, reach - distance, obstacle.solidity, contactX, contactZ);
    }

    /** Car as three circles along its length against an oriented box. */
    private collideBox(obstacle: Obstacle): void {
        const box = obstacle.box!;
        const cosYaw = Math.cos(box.yaw);
        const sinYaw = Math.sin(box.yaw);

        let bestPenetration = 0;
        let bestNormalX = 0;
        let bestNormalZ = 0;
        let bestOffset = 0;

        for (const offset of HULL_CIRCLE_OFFSETS) {
            const cx = this.position.x + this.direction.x * offset;
            const cz = this.position.z + this.direction.z * offset;
            const dx = cx - obstacle.x;
            const dz = cz - obstacle.z;

            const localX = dx * cosYaw - dz * sinYaw;
            const localZ = dx * sinYaw + dz * cosYaw;
            const closestX = THREE.MathUtils.clamp(localX, -box.halfX, box.halfX);
            const closestZ = THREE.MathUtils.clamp(localZ, -box.halfZ, box.halfZ);

            let offsetX = localX - closestX;
            let offsetZ = localZ - closestZ;
            let distance = Math.hypot(offsetX, offsetZ);
            let penetration: number;

            if (distance > 1e-4) {
                if (distance >= HULL_CIRCLE_RADIUS) continue;
                offsetX /= distance;
                offsetZ /= distance;
                penetration = HULL_CIRCLE_RADIUS - distance;
            } else {
                // Circle centre inside the box: leave through the nearest face.
                const toX = box.halfX - Math.abs(localX);
                const toZ = box.halfZ - Math.abs(localZ);
                if (toX < toZ) {
                    offsetX = Math.sign(localX) || 1;
                    offsetZ = 0;
                    distance = toX;
                } else {
                    offsetX = 0;
                    offsetZ = Math.sign(localZ) || 1;
                    distance = toZ;
                }
                penetration = HULL_CIRCLE_RADIUS + distance;
            }

            if (penetration > bestPenetration) {
                bestPenetration = penetration;
                bestNormalX = offsetX * cosYaw + offsetZ * sinYaw;
                bestNormalZ = -offsetX * sinYaw + offsetZ * cosYaw;
                bestOffset = offset;
            }
        }

        if (bestPenetration > 0) {
            const contactX = this.position.x + this.direction.x * bestOffset - bestNormalX * HULL_CIRCLE_RADIUS;
            const contactZ = this.position.z + this.direction.z * bestOffset - bestNormalZ * HULL_CIRCLE_RADIUS;
            this.resolveContact(bestNormalX, bestNormalZ, bestPenetration, obstacle.solidity, contactX, contactZ);
        }
    }

    /**
     * Contact against something solid: separate fully, then cancel only the part of the velocity
     * heading into the surface. Scraping along a wall keeps the speed parallel to it, glancing
     * blows turn the car, and a hit only registers once instead of on every physics step.
     */
    private resolveContact(
        normalX: number,
        normalZ: number,
        penetration: number,
        solidity: number,
        contactX: number,
        contactZ: number,
    ): void {
        if (solidity < SOFT_SOLIDITY) {
            // Flowers and plant labels just brush past and bleed off a little pace.
            this.physics.scrubSpeed(1 - SOFT_DRAG * (1 - solidity / SOFT_SOLIDITY));
            return;
        }

        this.position.x += normalX * penetration;
        this.position.z += normalZ * penetration;

        this.getWorldVelocity(this._velocity);
        const into = this._velocity.x * normalX + this._velocity.z * normalZ;
        if (into >= 0) return;

        const restitution = 0.12 + (1 - solidity) * 0.35;
        const impulse = -(1 + restitution) * into;
        this.applyWorldImpulse(normalX * impulse, normalZ * impulse, contactX, contactZ);

        const severity = THREE.MathUtils.clamp(-into / 22, 0, 1) * solidity;
        if (severity > 0.15) {
            this.emitImpactDebris(normalX, normalZ, severity);
            this.impactPending = Math.max(this.impactPending, severity);
        }
        if (severity > 0.5) this.physics.applyImpact(severity * 0.3);
    }

    /** A sudden rise in the ground (a book edge, a plate rim) blocks the car like a kerb-less wall. */
    private resolveWalls(previousX: number, previousZ: number): void {
        const x = this.position.x;
        const z = this.position.z;
        const ground = this.mapBuilder.getSurfaceHeightAt(x, z);
        if (ground <= this.position.y + MAX_STEP_UP) return;

        // The wall faces down the height gradient.
        const probe = 0.35;
        const gradientX = this.mapBuilder.getSurfaceHeightAt(x + probe, z) - this.mapBuilder.getSurfaceHeightAt(x - probe, z);
        const gradientZ = this.mapBuilder.getSurfaceHeightAt(x, z + probe) - this.mapBuilder.getSurfaceHeightAt(x, z - probe);
        const length = Math.hypot(gradientX, gradientZ);
        const normalX = length > 1e-4 ? -gradientX / length : -this.direction.x;
        const normalZ = length > 1e-4 ? -gradientZ / length : -this.direction.z;

        this.position.x = previousX;
        this.position.z = previousZ;
        this.resolveContact(normalX, normalZ, 0, 1, x - normalX * 0.3, z - normalZ * 0.3);
    }

    private resolveBoundary(): void {
        const bounds = this.mapBuilder.getTheme().bounds;
        if (!bounds) return;

        if (bounds.kind === "circle") {
            const distance = Math.hypot(this.position.x, this.position.z);
            if (distance <= bounds.radius) return;
            const scale = bounds.radius / distance;
            this.position.x *= scale;
            this.position.z *= scale;
        } else {
            const x = THREE.MathUtils.clamp(this.position.x, -bounds.halfX, bounds.halfX);
            const z = THREE.MathUtils.clamp(this.position.z, -bounds.halfZ, bounds.halfZ);
            if (x === this.position.x && z === this.position.z) return;
            this.position.x = x;
            this.position.z = z;
        }

        this.physics.scrubSpeed(0.82);
    }

    private resolveDebris(): void {
        const velocity = this.physics.getVelocity();
        const lateral = this.physics.getLateralVelocity();
        const vx = this.direction.x * velocity - this.direction.z * lateral;
        const vz = this.direction.z * velocity + this.direction.x * lateral;

        const drag = this.mapBuilder.collideDebris(
            this.position.x,
            this.position.z,
            this.position.y,
            Math.sin(this.heading),
            Math.cos(this.heading),
            vx,
            vz,
        );
        if (drag > 0) this.physics.scrubSpeed(1 - drag);
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
        this.groundGap = Math.max(0, this.position.y - groundHeight);

        if (this.position.y <= groundHeight) {
            if (!this.grounded && this.verticalVelocity < -6) {
                this.handleLanding(-this.verticalVelocity, groundHeight);
            }

            this.position.y = groundHeight;
            // Riding the surface: vertical speed simply matches how fast the ground rises or falls.
            this.verticalVelocity = terrainRate;
            this.grounded = true;
            this.airborneTime = 0;

            if (this.onTrack) {
                this.lastSafeT = this.mapBuilder.queryTrack(this.position.x, this.position.z).t;
            }
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
        this.physics.scrubSpeed(1 - severity * 0.1);
        this.landingDip = Math.max(this.landingDip, severity * 0.13);

        if (this.surface.dust === null) return;
        this._dustColor.set(this.surface.dust);
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
                    color: this._dustColor,
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
            const residual = !this.isFlying()
                ? THREE.MathUtils.clamp(this.wheelGroundHeights[i] - planeHeight, -MAX_SUSPENSION_TRAVEL, MAX_SUSPENSION_TRAVEL)
                : -MAX_SUSPENSION_TRAVEL * 0.55;

            this.suspension[i] += (residual - this.suspension[i]) * blend;
        }

        this.model.setSuspension(this.suspension);

        if (!this.isFlying()) {
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
        const targetPitch = THREE.MathUtils.clamp(-acceleration * 0.0022, -0.07, 0.07) + this.landingDip;
        this.landingDip *= Math.exp(-7 * deltaTime);
        const targetRoll = THREE.MathUtils.clamp(this.physics.getLateralVelocity() * 0.017, -0.16, 0.16);

        const blend = 1 - Math.exp(-9 * deltaTime);
        this.dynamicPitch += (targetPitch - this.dynamicPitch) * blend;
        this.dynamicRoll += (targetRoll - this.dynamicRoll) * blend;
    }

    private isFlying(): boolean {
        return !this.grounded && (this.airborneTime > AIRBORNE_VISUAL_DELAY || this.groundGap > AIRBORNE_VISUAL_GAP);
    }

    private capturePreviousState(): void {
        this.previousPosition.copy(this.position);
        this.previousAnchor.copy(this.cameraAnchor);
        this.previousHeading = this.heading;
        this.previousPitch = this.bodyPitch + this.dynamicPitch;
        this.previousRoll = this.bodyRoll + this.dynamicRoll;
    }

    private updateCameraAnchor(): void {
        // The camera keeps watching the edge a car went over rather than chasing it to the floor.
        if (this.grounded || this.position.y > this.cameraAnchor.y - 2) {
            this.cameraAnchor.copy(this.position);
        } else {
            this.cameraAnchor.x = this.position.x;
            this.cameraAnchor.z = this.position.z;
        }
    }

    /** Places the visible car `alpha` of the way from the previous physics step to the latest one. */
    public interpolate(alpha: number): void {
        const t = THREE.MathUtils.clamp(alpha, 0, 1);

        this.renderPosition.lerpVectors(this.previousPosition, this.position, t);
        this.renderAnchor.lerpVectors(this.previousAnchor, this.cameraAnchor, t);
        this.renderHeading = this.previousHeading + (this.heading - this.previousHeading) * t;
        this.renderDirection.set(Math.sin(this.renderHeading), 0, Math.cos(this.renderHeading));

        const pitch = this.bodyPitch + this.dynamicPitch;
        const roll = this.bodyRoll + this.dynamicRoll;
        this._euler.set(
            this.previousPitch + (pitch - this.previousPitch) * t,
            this.renderHeading,
            this.previousRoll + (roll - this.previousRoll) * t,
            "YXZ",
        );

        this.root.position.copy(this.renderPosition);
        this.root.rotation.copy(this._euler);
        this.updateBlobShadow();
    }

    private updateBlobShadow(): void {
        const shadow = this.model.blobShadow;
        const position = this.renderPosition;
        const ground = this.grounded ? position.y : this.mapBuilder.getSurfaceHeightAt(position.x, position.z);
        const lift = Math.max(0, position.y - ground);

        shadow.position.set(position.x, ground + 0.03, position.z);
        shadow.rotation.y = this.renderHeading;
        const spread = 1 + lift * 0.12;
        shadow.scale.set(spread, 1, spread);
        (shadow.material as THREE.MeshBasicMaterial).opacity = 0.55 * THREE.MathUtils.clamp(1 - lift / 7, 0, 1);
    }

    private updateGhost(deltaTime: number): void {
        if (this.ghostTimer <= 0) return;
        this.ghostTimer = Math.max(0, this.ghostTimer - deltaTime);
        this.model.chassis.visible = this.ghostTimer === 0 || Math.floor(this.ghostTimer * 12) % 2 === 0;
    }

    private checkFall(): void {
        const fallHeight = this.mapBuilder.getTheme().fallHeight;
        if (fallHeight === null || this.position.y > fallHeight) return;

        this.fellPending = true;
        this.respawn();
    }

    private updateModelState(deltaTime: number): void {
        const velocity = this.physics.getVelocity();

        this.model.setSteering(this.physics.getSteeringAngle() * 3.4);
        this.model.spinWheels(this.isFlying() ? velocity * deltaTime * 0.4 : velocity * deltaTime);

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
        const surface = this.surface;

        const laying = !this.isFlying() && surface.skid !== null && speed > 3 &&
            (drifting || slip > 0.9 || (!this.onTrack && speed > 8));

        if (laying) {
            this.trailAccumulator += deltaTime;
            if (this.trailAccumulator > 0.016) {
                this.trailAccumulator = 0;
                this.layTrails(intensity, surface);
            }
            this.wasTrailing = true;
        } else if (this.wasTrailing) {
            this.breakTrails();
            this.wasTrailing = false;
        }

        const wantsDust = !this.isFlying() && surface.dust !== null && speed > 6 &&
            (laying || !this.onTrack || this.physics.isBoosting());
        if (!wantsDust) {
            this.dustAccumulator = 0;
            return;
        }

        const rate = 40 + intensity * 90 + (this.physics.isBoosting() ? 40 : 0);
        this.dustAccumulator += deltaTime * rate;
        this._dustColor.set(surface.dust!);

        while (this.dustAccumulator >= 1) {
            this.dustAccumulator -= 1;
            this.emitWheelDust(intensity, speed);
        }
    }

    private breakTrails(): void {
        for (const id of this.trailIds) this.trails.breakTrail(id);
    }

    private layTrails(intensity: number, surface: SurfaceKind): void {
        const sin = Math.sin(this.heading);
        const cos = Math.cos(this.heading);
        this._skidColor.set(surface.skid!);

        for (let i = 2; i < WHEEL_POSITIONS.length; i++) {
            const wheel = WHEEL_POSITIONS[i];
            this.localToWorldXZ(wheel.x, wheel.z, this._wheelWorld);
            this._trailPoint.set(this._wheelWorld.x, this.wheelGroundHeights[i] + 0.02, this._wheelWorld.z);
            this.trails.addMark(this.trailIds[i], this._trailPoint, sin, cos, this._skidColor, surface.skidAlpha, intensity);
        }
    }

    private emitWheelDust(intensity: number, speed: number): void {
        const wheelIndex = 2 + (Math.random() > 0.5 ? 1 : 0);
        const wheel = WHEEL_POSITIONS[wheelIndex];
        this.localToWorldXZ(wheel.x, wheel.z, this._wheelWorld);

        const surfaceHeight = this.wheelGroundHeights[wheelIndex];
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
                color: this._dustColor,
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
        const groundHeight = this.position.y;

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

    /** Bright flecks thrown from a car-on-car bump. */
    public emitSparks(x: number, z: number, normalX: number, normalZ: number, severity: number): void {
        const count = Math.round(4 + severity * 10);
        for (let i = 0; i < count; i++) {
            const spread = 3 + Math.random() * 6 * severity;
            const side = Math.random() > 0.5 ? 1 : -1;
            this.particles.emit(
                x,
                this.position.y + 0.35 + Math.random() * 0.2,
                z,
                -normalZ * spread * side + normalX * 1.5 + (Math.random() - 0.5) * 2,
                2 + Math.random() * 3,
                normalX * spread * side + normalZ * 1.5 + (Math.random() - 0.5) * 2,
                {
                    color: SPARK_COLOR,
                    size: 0.1 + Math.random() * 0.1,
                    sizeGrowth: 0.2,
                    life: 0.25 + Math.random() * 0.25,
                    gravity: 14,
                    drag: 1.4,
                    alpha: 0.95,
                },
            );
        }
    }

    public getWorldVelocity(out: { x: number; z: number }): { x: number; z: number } {
        const velocity = this.physics.getVelocity();
        const lateral = this.physics.getLateralVelocity();
        out.x = this.direction.x * velocity - this.direction.z * lateral;
        out.z = this.direction.z * velocity + this.direction.x * lateral;
        return out;
    }

    /** World-space velocity change applied at a contact point, split into car-local push and spin. */
    public applyWorldImpulse(impulseX: number, impulseZ: number, contactX: number, contactZ: number, spin = 1): void {
        const forward = impulseX * this.direction.x + impulseZ * this.direction.z;
        const lateral = impulseX * -this.direction.z + impulseZ * this.direction.x;

        const armX = contactX - this.position.x;
        const armZ = contactZ - this.position.z;
        const torque = armZ * impulseX - armX * impulseZ;

        this.physics.applyImpulse(forward, lateral, THREE.MathUtils.clamp(torque * 0.9 * spin, -3, 3));
    }

    public nudge(dx: number, dz: number): void {
        this.position.x += dx;
        this.position.z += dz;
    }

    public getPositionRef(): Readonly<THREE.Vector3> { return this.position; }
    public getDirectionRef(): Readonly<THREE.Vector3> { return this.direction; }
    /** Smoothed, render-rate anchor for the camera to follow. */
    public getCameraAnchorRef(): Readonly<THREE.Vector3> { return this.renderAnchor; }
    /** Smoothed, render-rate facing for the camera. */
    public getViewDirectionRef(): Readonly<THREE.Vector3> { return this.renderDirection; }
    public getHeading(): number { return this.heading; }
    public getSpeed(): number { return Math.abs(this.physics.getVelocity()); }
    public getForwardSpeed(): number { return this.physics.getVelocity(); }
    public getSpeedKph(): number { return Math.abs(this.physics.getVelocity()) * 3.6; }
    public getMaxSpeed(): number { return this.physics.getMaxSpeed(); }
    public getBoostCharge(): number { return this.physics.getBoostCharge(); }
    public isBoosting(): boolean { return this.physics.isBoosting(); }
    public isDrifting(): boolean { return this.physics.isDrifting(); }
    public isAirborne(): boolean { return this.isFlying(); }
    public isOnTrack(): boolean { return this.onTrack; }
    public isGhost(): boolean { return this.ghostTimer > 0; }
    public getSurface(): SurfaceKind { return this.surface; }
    public getLivery(): Readonly<CarLivery> { return this.model.getLivery(); }

    /** True once after the car fell out of the world and was put back. */
    public consumeFall(): boolean {
        const fell = this.fellPending;
        this.fellPending = false;
        return fell;
    }

    /** Severity (0..1) of the hardest obstacle hit since the last call. */
    public consumeImpact(): number {
        const impact = this.impactPending;
        this.impactPending = 0;
        return impact;
    }

    public dispose(): void {
        this.model.dispose();
        this.scene.remove(this.root);
        this.scene.remove(this.model.blobShadow);
    }
}
