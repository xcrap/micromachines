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
    private readonly BRAKING_RATE = 22;
    private readonly DECELERATION_RATE = 6;

    private readonly MAX_STEERING_ANGLE = 0.12;
    private readonly STEERING_SPEED = 4.0;
    private readonly STEERING_RESET_SPEED = 10.0;

    private readonly DRIFT_BUILDUP = 3.5;
    private readonly DRIFT_RECOVERY = 2.5;
    private readonly DRIFT_OVERSTEER = 0.6;
    private readonly DRIFT_COUNTER_STEER = 1.8;
    private readonly MAX_LATERAL = 8.0;
    private readonly LATERAL_BUILDUP = 12.0;
    private readonly LATERAL_GRIP_DECAY = 6.0;
    private readonly LATERAL_DRIFT_DECAY = 1.8;

    private readonly OFF_TRACK_MAX_SPEED = 15;
    private readonly OFF_TRACK_TRACTION = 0.7;
    private readonly OFF_TRACK_STEERING_FACTOR = 0.8;

    public update(deltaTime: number, input: CarInput, isOffTrack = false): void {
        const absVelocity = Math.abs(this.velocity);
        const speedNorm = Math.min(1.0, absVelocity / this.MAX_SPEED);
        const velocitySign = this.velocity >= 0 ? 1 : -1;

        // --- Acceleration ---
        let acceleration = 0;
        if (input.forward) acceleration = this.ACCELERATION_RATE;
        else if (input.backward) acceleration = -this.ACCELERATION_RATE;

        if (!input.drift && input.brake) {
            acceleration = this.velocity > 0 ? -this.BRAKING_RATE : this.velocity < 0 ? this.BRAKING_RATE : 0;
        }

        if (input.drift && absVelocity > 5) {
            acceleration -= this.BRAKING_RATE * 0.08;
        }

        this.velocity += acceleration * deltaTime;

        if (!input.forward && !input.backward && !input.brake) {
            if (this.velocity > 0) this.velocity = Math.max(0, this.velocity - this.DECELERATION_RATE * deltaTime);
            else if (this.velocity < 0) this.velocity = Math.min(0, this.velocity + this.DECELERATION_RATE * deltaTime);
        }

        const maxSpeed = isOffTrack ? this.OFF_TRACK_MAX_SPEED : this.MAX_SPEED;
        this.velocity = Math.max(this.MAX_REVERSE_SPEED, Math.min(maxSpeed, this.velocity));

        // --- Steering ---
        let steerDir = 0;
        if (input.left) steerDir = 1;
        else if (input.right) steerDir = -1;

        if (steerDir !== 0) {
            this.steeringAngle += steerDir * this.STEERING_SPEED * deltaTime;
        } else {
            if (this.steeringAngle > 0) {
                this.steeringAngle = Math.max(0, this.steeringAngle - this.STEERING_RESET_SPEED * deltaTime);
            } else {
                this.steeringAngle = Math.min(0, this.steeringAngle + this.STEERING_RESET_SPEED * deltaTime);
            }
        }

        let maxSteer = this.MAX_STEERING_ANGLE;
        if (isOffTrack) maxSteer *= this.OFF_TRACK_STEERING_FACTOR;
        this.steeringAngle = Math.max(-maxSteer, Math.min(maxSteer, this.steeringAngle));

        // --- Yaw rate: direct steering + drift oversteer ---
        const steerYaw = this.steeringAngle * absVelocity * velocitySign;

        if (input.drift && absVelocity > 3) {
            this.driftFactor = Math.min(1.0, this.driftFactor + this.DRIFT_BUILDUP * deltaTime);
        } else {
            this.driftFactor = Math.max(0, this.driftFactor - this.DRIFT_RECOVERY * deltaTime);
        }

        let driftYaw = 0;
        if (this.driftFactor > 0.05) {
            const isCounterSteering = (steerDir !== 0) && (Math.sign(steerDir) !== Math.sign(this.lateralVelocity));

            if (isCounterSteering) {
                driftYaw = -Math.sign(this.lateralVelocity) * this.DRIFT_COUNTER_STEER * this.driftFactor * speedNorm;
            } else {
                driftYaw = this.steeringAngle * this.DRIFT_OVERSTEER * absVelocity * this.driftFactor;
            }
        }

        this.yawRate = steerYaw + driftYaw;

        // --- Lateral velocity (tire slide) ---
        if (this.driftFactor > 0.05 && absVelocity > 3) {
            if (steerDir !== 0) {
                this.slideDirection = steerDir;
            }

            const lateralTarget = this.slideDirection * absVelocity * 0.35 * this.driftFactor;
            const buildRate = this.LATERAL_BUILDUP * deltaTime;
            this.lateralVelocity += (lateralTarget - this.lateralVelocity) * Math.min(1.0, buildRate);
        }

        const decayRate = this.driftFactor > 0.1 ? this.LATERAL_DRIFT_DECAY : this.LATERAL_GRIP_DECAY;
        this.lateralVelocity -= this.lateralVelocity * decayRate * deltaTime;

        if (absVelocity < 1) this.lateralVelocity *= 0.85;

        this.lateralVelocity = Math.max(-this.MAX_LATERAL, Math.min(this.MAX_LATERAL, this.lateralVelocity));

        // --- Slip angle (for visuals) ---
        if (absVelocity > 1) {
            this.slipAngle = Math.atan2(this.lateralVelocity, absVelocity);
        } else {
            this.slipAngle *= 0.9;
        }

        if (Math.abs(this.lateralVelocity) > 0.3) {
            this.slideDirection = Math.sign(this.lateralVelocity);
        } else if (absVelocity < 0.5) {
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
}
