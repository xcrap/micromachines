export interface CarInput {
    /** -1 full reverse to +1 full throttle. */
    throttle: number;
    /** -1 right to +1 left. */
    steer: number;
    handbrake: boolean;
    boost: boolean;
}

export interface SurfaceState {
    /** 1 on tarmac-like dirt, lower on grass. Scales acceleration, steering and lateral grip. */
    grip: number;
    /** Extra rolling resistance in m/s². */
    drag: number;
    /** Top-speed multiplier. */
    speedScale: number;
}

export const TRACK_SURFACE: SurfaceState = { grip: 1, drag: 0, speedScale: 1 };
export const GRASS_SURFACE: SurfaceState = { grip: 0.62, drag: 5.5, speedScale: 0.58 };

export class CarPhysics {
    private velocity = 0;
    private lateralVelocity = 0;
    private steeringAngle = 0;
    private driftFactor = 0;
    private slideDirection = 0;
    private yawRate = 0;
    private slipAngle = 0;
    private engineLoad = 0;

    private boostCharge = 0;
    private boostActive = false;
    private boostRemaining = 0;

    private readonly MAX_SPEED = 30;
    private readonly MAX_REVERSE_SPEED = -11;
    private readonly ACCELERATION = 20;
    private readonly REVERSE_ACCELERATION = 13;
    private readonly BRAKING = 26;
    private readonly COAST_DRAG = 5.5;
    private readonly DRIFT_DRAG = 2.6;

    private readonly MAX_STEERING = 0.16;
    private readonly STEERING_SPEED = 10;
    private readonly STEERING_RETURN = 13;

    private readonly DRIFT_BUILDUP = 6.5;
    private readonly DRIFT_RECOVERY = 4.4;
    private readonly DRIFT_OVERSTEER = 0.82;
    private readonly DRIFT_COUNTER_STEER = 2.4;
    private readonly COUNTER_STEER_GRIP = 4.8;
    private readonly MAX_LATERAL = 9;
    private readonly LATERAL_BUILDUP = 10.5;
    private readonly LATERAL_GRIP_DECAY = 8;
    private readonly LATERAL_DRIFT_DECAY = 2.1;
    private readonly YAW_RESPONSE = 13;

    private readonly BOOST_SPEED_BONUS = 10;
    private readonly BOOST_THRUST = 16;
    private readonly BOOST_DRAIN = 0.42;
    private readonly BOOST_MIN_CHARGE = 0.18;

    public update(deltaTime: number, input: CarInput, surface: SurfaceState): void {
        const absVelocity = Math.abs(this.velocity);
        const velocitySign = this.velocity >= 0 ? 1 : -1;
        const grip = surface.grip;

        this.updateBoost(deltaTime, input);

        const topSpeed = (this.MAX_SPEED + (this.boostActive ? this.BOOST_SPEED_BONUS : 0)) * surface.speedScale;
        const speedNorm = Math.min(1, absVelocity / this.MAX_SPEED);

        const throttle = clamp(input.throttle, -1, 1);
        let acceleration = 0;

        if (throttle > 0.01) {
            acceleration = this.velocity < -0.5
                ? this.BRAKING * throttle
                : this.ACCELERATION * throttle * (1 - speedNorm * 0.35);
        } else if (throttle < -0.01) {
            acceleration = this.velocity > 1
                ? this.BRAKING * throttle
                : this.REVERSE_ACCELERATION * throttle;
        }

        if (this.boostActive && this.velocity > -0.5) {
            acceleration += this.BOOST_THRUST;
        }

        if (input.handbrake && absVelocity > 4) {
            acceleration -= velocitySign * this.BRAKING * 0.16;
        }

        this.velocity += acceleration * grip * deltaTime;

        if (Math.abs(throttle) < 0.01 && !this.boostActive) {
            const coast = this.driftFactor > 0.1 ? this.DRIFT_DRAG : this.COAST_DRAG;
            this.velocity = approach(this.velocity, 0, coast * grip, deltaTime);
        }

        if (surface.drag > 0 && absVelocity > 0.1) {
            this.velocity = approach(this.velocity, 0, surface.drag, deltaTime);
        }

        this.velocity = clamp(this.velocity, this.MAX_REVERSE_SPEED, topSpeed);
        this.engineLoad = clamp(Math.abs(this.velocity) / this.MAX_SPEED + (throttle > 0 ? 0.15 : 0), 0, 1.3);

        const steerInput = clamp(input.steer, -1, 1);
        const maxSteer = this.MAX_STEERING * (1 - speedNorm * 0.34) * (0.55 + grip * 0.45);
        const steerTarget = steerInput * maxSteer;
        const steerRate = Math.abs(steerInput) < 0.02 ? this.STEERING_RETURN : this.STEERING_SPEED;
        this.steeringAngle = clamp(damp(this.steeringAngle, steerTarget, steerRate, deltaTime), -maxSteer, maxSteer);

        if (input.handbrake && absVelocity > 4) {
            this.driftFactor = damp(this.driftFactor, 1, this.DRIFT_BUILDUP, deltaTime);
        } else {
            this.driftFactor = damp(this.driftFactor, 0, this.DRIFT_RECOVERY, deltaTime);
        }

        const steeringGrip = (1 - this.driftFactor * 0.35) * grip;
        const steerYaw = this.steeringAngle * Math.abs(this.velocity) * Math.sign(this.velocity || 1) * steeringGrip;

        const lateralSign = Math.sign(this.lateralVelocity);
        const steerDir = Math.abs(steerInput) < 0.05 ? 0 : Math.sign(steerInput);
        const isCounterSteering = steerDir !== 0 && lateralSign !== 0 && steerDir !== lateralSign;

        let driftYaw = 0;
        if (this.driftFactor > 0.05) {
            driftYaw = isCounterSteering
                ? -lateralSign * this.DRIFT_COUNTER_STEER * this.driftFactor * speedNorm
                : this.steeringAngle * this.DRIFT_OVERSTEER * absVelocity * this.driftFactor;
        }

        this.yawRate = damp(this.yawRate, steerYaw + driftYaw, this.YAW_RESPONSE, deltaTime);

        if (this.driftFactor > 0.05 && absVelocity > 3) {
            if (steerDir !== 0 && !isCounterSteering) this.slideDirection = steerDir;

            const hasIntent = steerDir !== 0 || Math.abs(this.lateralVelocity) > 0.15;
            if (hasIntent) {
                const slideSign = this.slideDirection || lateralSign || steerDir;
                const counterFactor = isCounterSteering ? 0.45 : 1;
                const target = slideSign * absVelocity * 0.36 * this.driftFactor * counterFactor;
                this.lateralVelocity = damp(this.lateralVelocity, target, this.LATERAL_BUILDUP, deltaTime);
            } else {
                this.slideDirection = 0;
            }
        }

        const decay = this.driftFactor > 0.1
            ? this.LATERAL_DRIFT_DECAY * grip
            : this.LATERAL_GRIP_DECAY * grip;
        this.lateralVelocity = damp(this.lateralVelocity, 0, decay, deltaTime);

        if (isCounterSteering) {
            this.lateralVelocity = damp(this.lateralVelocity, 0, this.COUNTER_STEER_GRIP, deltaTime);
        }

        if (absVelocity < 1) this.lateralVelocity *= 0.85;
        this.lateralVelocity = clamp(this.lateralVelocity, -this.MAX_LATERAL, this.MAX_LATERAL);

        if (absVelocity > 1) {
            this.slipAngle = Math.atan2(this.lateralVelocity, absVelocity);
        } else {
            this.slipAngle *= 0.9;
        }

        if (Math.abs(this.lateralVelocity) > 0.3) {
            this.slideDirection = Math.sign(this.lateralVelocity);
        } else if (steerDir === 0 || absVelocity < 0.5) {
            this.slideDirection = 0;
        }

        // Sliding sideways at speed is what fills the boost meter — the whole loop rewards drifting.
        if (this.driftFactor > 0.2 && absVelocity > 6) {
            const quality = Math.min(1, Math.abs(this.lateralVelocity) / 5.5);
            this.boostCharge = Math.min(1, this.boostCharge + quality * 0.42 * deltaTime);
        }
    }

    private updateBoost(deltaTime: number, input: CarInput): void {
        if (this.boostActive) {
            this.boostRemaining -= deltaTime;
            this.boostCharge = Math.max(0, this.boostCharge - this.BOOST_DRAIN * deltaTime);

            if (this.boostRemaining <= 0 || this.boostCharge <= 0 || !input.boost) {
                this.boostActive = false;
            }
        } else if (input.boost && this.boostCharge >= this.BOOST_MIN_CHARGE) {
            this.boostActive = true;
            this.boostRemaining = 2.5;
        }
    }

    /** Airtime pays out a little boost so jumps feel worth taking. */
    public addBoostCharge(amount: number): void {
        this.boostCharge = Math.min(1, this.boostCharge + amount);
    }

    /** Head-on impacts kill speed and kick the car back; glancing blows just scrub. */
    public applyImpact(severity: number): void {
        this.velocity *= 1 - 0.75 * severity;
        this.lateralVelocity *= 1 - 0.6 * severity;
        this.yawRate *= 1 - 0.5 * severity;
        this.driftFactor *= 0.5;

        if (severity > 0.55) {
            this.velocity -= Math.sign(this.velocity) * severity * 3.5;
            this.boostActive = false;
        }
    }

    public scrubSpeed(factor: number): void {
        this.velocity *= factor;
    }

    public reset(): void {
        this.velocity = 0;
        this.lateralVelocity = 0;
        this.steeringAngle = 0;
        this.driftFactor = 0;
        this.slideDirection = 0;
        this.yawRate = 0;
        this.slipAngle = 0;
        this.boostActive = false;
        this.boostRemaining = 0;
    }

    public getVelocity(): number { return this.velocity; }
    public getLateralVelocity(): number { return this.lateralVelocity; }
    public getSteeringAngle(): number { return this.steeringAngle; }
    public getYawRate(): number { return this.yawRate; }
    public getSlipAngle(): number { return this.slipAngle; }
    public getDriftFactor(): number { return this.driftFactor; }
    public isDrifting(): boolean { return this.driftFactor > 0.1; }
    public getBoostCharge(): number { return this.boostCharge; }
    public isBoosting(): boolean { return this.boostActive; }
    public getEngineLoad(): number { return this.engineLoad; }
}

function clamp(value: number, min: number, max: number): number {
    return value < min ? min : value > max ? max : value;
}

function approach(value: number, target: number, rate: number, deltaTime: number): number {
    if (value < target) return Math.min(target, value + rate * deltaTime);
    if (value > target) return Math.max(target, value - rate * deltaTime);
    return target;
}

function damp(value: number, target: number, lambda: number, deltaTime: number): number {
    return value + (target - value) * (1 - Math.exp(-lambda * deltaTime));
}
