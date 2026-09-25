import * as THREE from "three";
import { PHYSICS_STEP } from "../core/Config";
import type { DriveInput, DriveInputSource } from "../input/InputManager";
import type { MapBuilder } from "../map/MapBuilder";
import type { TrackPoint } from "../map/TrackPath";
import type { CarController } from "./CarController";

export interface AIPersonality {
    /** Fraction of the car's top speed this driver is willing to use. */
    pace: number;
    /** Preferred offset from the racing line, positive to the right. */
    lane: number;
    /** 0..1 — how hard it clips the apex and how late it lifts. */
    aggression: number;
    /** 0..1 — how often it throws the car into a handbrake drift on tight corners. */
    flair: number;
}

/** Lateral grip budget used to pick corner speeds: v = sqrt(grip / curvature). */
const CORNER_GRIP = 40;
const MAX_LATERAL = 4.3;
const STUCK_SPEED = 1.5;

/**
 * Drives a car round the racing line by steering at a look-ahead point. Everything is
 * derived from the track spline each step, so it copes with being bumped or respawned.
 */
export class AIDriver implements DriveInputSource {
    private car: CarController | null = null;
    private readonly map: MapBuilder;
    private readonly personality: AIPersonality;
    private readonly rivals: () => readonly CarController[];

    private readonly state: DriveInput = { throttle: 0, steer: 0, handbrake: false, boost: false };
    private readonly point: TrackPoint = { x: 0, z: 0, tangentX: 0, tangentZ: 1, curvature: 0 };
    private readonly velocity = { x: 0, z: 0 };

    private time = 0;
    private readonly wanderPhase: number;
    private paceScale = 1;
    private stuckTimer = 0;
    private reverseTimer = 0;
    private reverseSteer = 0;
    private boostHold = 0;
    private respawnRequested = false;
    private enabled = false;

    constructor(map: MapBuilder, personality: AIPersonality, rivals: () => readonly CarController[]) {
        this.map = map;
        this.personality = personality;
        this.rivals = rivals;
        this.wanderPhase = Math.random() * Math.PI * 2;
    }

    public attach(car: CarController): void {
        this.car = car;
    }

    /** Rubber band from the race director: < 1 eases off, > 1 pushes harder (clamped to the car's limits). */
    public setPaceScale(scale: number): void {
        this.paceScale = scale;
    }

    /** Off during the countdown so a parked car is not mistaken for a stuck one. */
    public setEnabled(enabled: boolean): void {
        if (enabled === this.enabled) return;
        this.enabled = enabled;
        this.stuckTimer = 0;
        this.reverseTimer = 0;
        this.boostHold = 0;
    }

    public consumeRespawnRequest(): boolean {
        const requested = this.respawnRequested;
        this.respawnRequested = false;
        return requested;
    }

    public sample(): Readonly<DriveInput> {
        const car = this.car;
        const state = this.state;
        if (!car || !this.enabled) {
            state.throttle = 0;
            state.steer = 0;
            state.handbrake = false;
            state.boost = false;
            return state;
        }

        this.time += PHYSICS_STEP;

        const path = this.map.getTrackPath();
        const position = car.getPositionRef();
        const direction = car.getDirectionRef();
        const query = this.map.queryTrack(position.x, position.z);
        const arc = query.t * path.totalLength;
        const alignment = direction.x * query.tangentX + direction.z * query.tangentZ;
        const speed = car.getForwardSpeed();

        if (this.recover(car, speed, alignment, query.tangentX, query.tangentZ)) return state;

        const nearCurve = path.peakCurvatureAhead(arc + 4, 26);
        let lateral = this.personality.lane + Math.sin(this.time * 0.23 + this.wanderPhase) * 0.9;
        lateral += THREE.MathUtils.clamp(nearCurve * 70 * this.personality.aggression, -3.4, 3.4);
        lateral += this.avoidance(car, speed);
        lateral = THREE.MathUtils.clamp(lateral, -MAX_LATERAL, MAX_LATERAL);

        const lookAhead = 5 + Math.abs(speed) * 0.32;
        const target = path.pointAtArc(arc + lookAhead, lateral, this.point);
        const desired = Math.atan2(target.x - position.x, target.z - position.z);
        const error = wrapAngle(desired - car.getHeading());
        state.steer = THREE.MathUtils.clamp(error * 2.8, -1, 1);

        const brakeDistance = 8 + Math.abs(speed) * (0.95 - this.personality.aggression * 0.3);
        const peak = Math.abs(path.peakCurvatureAhead(arc, brakeDistance));
        const cornerSpeed = peak > 1e-3 ? Math.sqrt(CORNER_GRIP / peak) : Infinity;
        const cruise = car.getMaxSpeed() * this.personality.pace * this.paceScale;
        const targetSpeed = Math.min(cruise, cornerSpeed);

        if (speed > targetSpeed + 3) {
            state.throttle = -0.7;
        } else if (speed > targetSpeed) {
            state.throttle = 0;
        } else {
            state.throttle = 1;
        }
        if (Math.abs(error) > 0.7 && speed > 12) state.throttle = Math.min(state.throttle, 0);

        const tight = peak > 0.06 && speed > 17;
        state.handbrake = tight && this.personality.flair > 0.35 && Math.abs(error) > 0.14;

        if (this.boostHold > 0) {
            this.boostHold -= PHYSICS_STEP;
        } else if (car.getBoostCharge() > 0.4 && peak < 0.018 && car.isOnTrack() && this.paceScale >= 0.97) {
            this.boostHold = 1.2;
        }
        state.boost = this.boostHold > 0;

        return state;
    }

    /** Backs out of walls and turns around when facing the wrong way. Returns true while it owns the controls. */
    private recover(car: CarController, speed: number, alignment: number, tangentX: number, tangentZ: number): boolean {
        const state = this.state;

        if (this.reverseTimer > 0) {
            this.reverseTimer -= PHYSICS_STEP;
            state.throttle = -1;
            state.steer = this.reverseSteer;
            state.handbrake = false;
            state.boost = false;
            return true;
        }

        const stalled = Math.abs(speed) < STUCK_SPEED;
        const facingBack = alignment < -0.2;
        this.stuckTimer = stalled || facingBack ? this.stuckTimer + PHYSICS_STEP : Math.max(0, this.stuckTimer - PHYSICS_STEP * 2);

        if (this.stuckTimer > 6) {
            this.stuckTimer = 0;
            this.respawnRequested = true;
            return false;
        }

        if (this.stuckTimer > 1.1 && Math.floor(this.stuckTimer / 1.1) !== Math.floor((this.stuckTimer - PHYSICS_STEP) / 1.1)) {
            // Reverse with the wheels turned away from where the road goes, so the nose swings back round.
            const direction = car.getDirectionRef();
            const cross = direction.x * tangentZ - direction.z * tangentX;
            this.reverseSteer = cross >= 0 ? 1 : -1;
            this.reverseTimer = 0.9;
            return true;
        }

        return false;
    }

    /** Shifts the target lane away from a slower car directly ahead. */
    private avoidance(car: CarController, speed: number): number {
        const position = car.getPositionRef();
        const direction = car.getDirectionRef();
        let shift = 0;

        for (const rival of this.rivals()) {
            if (rival === car) continue;
            const other = rival.getPositionRef();
            const dx = other.x - position.x;
            const dz = other.z - position.z;
            const ahead = dx * direction.x + dz * direction.z;
            if (ahead < 0.5 || ahead > 8) continue;

            const side = dx * -direction.z + dz * direction.x;
            if (Math.abs(side) > 2.2) continue;

            rival.getWorldVelocity(this.velocity);
            const closing = speed - (this.velocity.x * direction.x + this.velocity.z * direction.z);
            if (closing < -0.5) continue;

            const urgency = (1 - ahead / 8) * (2.2 - Math.abs(side));
            shift += (side >= 0 ? -1 : 1) * urgency * 1.4;
        }

        return THREE.MathUtils.clamp(shift, -3, 3);
    }
}

function wrapAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}
