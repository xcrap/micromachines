export interface CarInput {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    brake: boolean;
    drift: boolean;
}

export class CarPhysics {
    private velocity = 0;
    private steeringAngle = 0;
    private lateralVelocity = 0;
    private driftFactor = 0;
    private slideDirection = 0;
    private yawRate = 0;
    private slipAngle = 0;

    private readonly MAX_SPEED = 28;
    private readonly MAX_REVERSE_SPEED = -10;
    private readonly ACCELERATION_RATE = 18;
    private readonly REVERSE_ACCELERATION_RATE = 12;
    private readonly BRAKING_RATE = 22;
    private readonly DECELERATION_RATE = 6;
    private readonly DRIFT_DRAG = 2.4;

    private readonly MAX_STEERING_ANGLE = 0.14;
    private readonly STEERING_SPEED = 9.0;
    private readonly STEERING_RESET_SPEED = 12.0;

    private readonly DRIFT_BUILDUP = 6.0;
    private readonly DRIFT_RECOVERY = 4.2;
    private readonly DRIFT_OVERSTEER = 0.75;
    private readonly DRIFT_COUNTER_STEER = 2.2;
    private readonly COUNTER_STEER_GRIP = 4.5;
    private readonly MAX_LATERAL = 8.0;
    private readonly LATERAL_BUILDUP = 10.0;
    private readonly LATERAL_GRIP_DECAY = 7.5;
    private readonly LATERAL_DRIFT_DECAY = 2.0;
    private readonly YAW_RESPONSE = 12.0;

    private readonly OFF_TRACK_MAX_SPEED = 15;
    private readonly OFF_TRACK_TRACTION = 0.65;
    private readonly OFF_TRACK_STEERING_FACTOR = 0.72;

    public update(deltaTime: number, input: CarInput, isOffTrack = false): void {
        const absVelocity = Math.abs(this.velocity);
        const speedNorm = Math.min(1.0, absVelocity / this.MAX_SPEED);
        const velocitySign = this.velocity >= 0 ? 1 : -1;
        const traction = isOffTrack ? this.OFF_TRACK_TRACTION : 1.0;

        let acceleration = 0;
        const throttle = input.forward === input.backward ? 0 : input.forward ? 1 : -1;

        if (throttle > 0) {
            acceleration = this.velocity < -0.5
                ? this.BRAKING_RATE
                : this.ACCELERATION_RATE * (1.0 - speedNorm * 0.12);
        } else if (throttle < 0) {
            acceleration = this.velocity > 1.0
                ? -this.BRAKING_RATE
                : -this.REVERSE_ACCELERATION_RATE;
        }

        if (input.brake && absVelocity > 0.25) {
            acceleration = -velocitySign * this.BRAKING_RATE;
        }

        if (input.drift && absVelocity > 5) {
            acceleration -= velocitySign * this.BRAKING_RATE * 0.12;
        }

        this.velocity += acceleration * traction * deltaTime;

        if (throttle === 0 && !input.brake) {
            const coastRate = this.driftFactor > 0.1 ? this.DRIFT_DRAG : this.DECELERATION_RATE;
            this.velocity = this.approach(this.velocity, 0, coastRate * traction, deltaTime);
        }

        const maxSpeed = isOffTrack ? this.OFF_TRACK_MAX_SPEED : this.MAX_SPEED;
        this.velocity = Math.max(this.MAX_REVERSE_SPEED, Math.min(maxSpeed, this.velocity));

        let steerDir = 0;
        if (input.left) steerDir = 1;
        else if (input.right) steerDir = -1;

        let maxSteer = this.MAX_STEERING_ANGLE * (1.0 - speedNorm * 0.28);
        if (isOffTrack) maxSteer *= this.OFF_TRACK_STEERING_FACTOR;

        const steeringTarget = steerDir * maxSteer;
        const steeringRate = steerDir === 0 ? this.STEERING_RESET_SPEED : this.STEERING_SPEED;
        this.steeringAngle = this.damp(this.steeringAngle, steeringTarget, steeringRate, deltaTime);
        this.steeringAngle = this.clamp(this.steeringAngle, -maxSteer, maxSteer);

        if (input.drift && absVelocity > 4) {
            this.driftFactor = this.damp(this.driftFactor, 1.0, this.DRIFT_BUILDUP, deltaTime);
        } else {
            this.driftFactor = this.damp(this.driftFactor, 0, this.DRIFT_RECOVERY, deltaTime);
        }

        const steeringGrip = (1.0 - this.driftFactor * 0.35) * traction;
        const steerYaw = this.steeringAngle * absVelocity * velocitySign * steeringGrip;
        let driftYaw = 0;
        const lateralSign = Math.sign(this.lateralVelocity);
        const isCounterSteering = steerDir !== 0 && lateralSign !== 0 && Math.sign(steerDir) !== lateralSign;

        if (this.driftFactor > 0.05) {
            if (isCounterSteering) {
                driftYaw = -lateralSign * this.DRIFT_COUNTER_STEER * this.driftFactor * speedNorm;
            } else {
                driftYaw = this.steeringAngle * this.DRIFT_OVERSTEER * absVelocity * this.driftFactor;
            }
        }

        this.yawRate = this.damp(this.yawRate, steerYaw + driftYaw, this.YAW_RESPONSE, deltaTime);

        if (this.driftFactor > 0.05 && absVelocity > 3) {
            if (steerDir !== 0 && !isCounterSteering) {
                this.slideDirection = steerDir;
            }

            const hasSlideIntent = steerDir !== 0 || Math.abs(this.lateralVelocity) > 0.15;
            if (hasSlideIntent) {
                const slideSign = this.slideDirection || lateralSign || steerDir;
                const counterSteerFactor = isCounterSteering ? 0.45 : 1.0;
                const lateralTarget = slideSign * absVelocity * 0.35 * this.driftFactor * counterSteerFactor;
                this.lateralVelocity = this.damp(this.lateralVelocity, lateralTarget, this.LATERAL_BUILDUP, deltaTime);
            } else {
                this.slideDirection = 0;
            }
        }

        const decayRate = this.driftFactor > 0.1
            ? this.LATERAL_DRIFT_DECAY * traction
            : this.LATERAL_GRIP_DECAY * traction;
        this.lateralVelocity = this.damp(this.lateralVelocity, 0, decayRate, deltaTime);

        if (isCounterSteering) {
            this.lateralVelocity = this.damp(this.lateralVelocity, 0, this.COUNTER_STEER_GRIP, deltaTime);
        }

        if (absVelocity < 1) this.lateralVelocity *= 0.85;

        this.lateralVelocity = this.clamp(this.lateralVelocity, -this.MAX_LATERAL, this.MAX_LATERAL);

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
    }

    public reverseVelocity(factor = 0.5): void {
        this.velocity = -this.velocity * factor;
        this.lateralVelocity *= -0.3;
        this.yawRate *= 0.2;
    }

    public getVelocity(): number { return this.velocity; }
    public getSteeringAngle(): number { return this.steeringAngle; }
    public getLateralVelocity(): number { return this.lateralVelocity; }
    public isDrifting(): boolean { return this.driftFactor > 0.1; }
    public getDriftFactor(): number { return this.driftFactor; }
    public getSlideDirection(): number { return this.slideDirection; }
    public getYawRate(): number { return this.yawRate; }
    public getSlipAngle(): number { return this.slipAngle; }

    private clamp(value: number, min: number, max: number): number {
        return Math.max(min, Math.min(max, value));
    }

    private approach(value: number, target: number, rate: number, deltaTime: number): number {
        if (value < target) return Math.min(target, value + rate * deltaTime);
        if (value > target) return Math.max(target, value - rate * deltaTime);
        return target;
    }

    private damp(value: number, target: number, lambda: number, deltaTime: number): number {
        return value + (target - value) * (1 - Math.exp(-lambda * deltaTime));
    }
}
