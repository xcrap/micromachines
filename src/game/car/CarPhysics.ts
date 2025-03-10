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
    private acceleration = 0;
    private steeringAngle = 0;
    private lateralVelocity = 0;
    private driftFactor = 0;
    private slideDirection = 0;

    // Car physics constants
    private readonly MAX_SPEED: number = 25;
    private readonly MAX_REVERSE_SPEED: number = -10;
    private readonly ACCELERATION_RATE: number = 15;
    private readonly BRAKING_RATE: number = 20;
    private readonly DECELERATION_RATE: number = 8;
    private readonly MAX_STEERING_ANGLE: number = 0.10; // Further reduced for more realistic steering
    private readonly STEERING_SPEED: number = 3.2;      // Further reduced for more realistic response
    private readonly STEERING_RESET_SPEED: number = 8;

    // Drift physics constants
    private readonly DRIFT_TRACTION_LOSS: number = 0.7;
    private readonly DRIFT_STEERING_FACTOR: number = 1.4;  // Reduced from 2.0 to make drift less curvy
    private readonly MAX_DRIFT_FACTOR: number = 1.0;
    private readonly DRIFT_BUILDUP_RATE: number = 5.0;
    private readonly DRIFT_RECOVERY_RATE: number = 3.0;
    private readonly MAX_LATERAL_VELOCITY: number = 6.0;   // Increased for stronger sliding effect
    private readonly LATERAL_FRICTION: number = 1.5;       // Reduced to maintain slide longer
    private readonly LATERAL_TRANSFER_FACTOR: number = 0.5; // Increased for more pronounced sliding

    // Off-track physics modifiers
    private readonly OFF_TRACK_MAX_SPEED: number = 15;
    private readonly OFF_TRACK_TRACTION: number = 0.7;
    private readonly OFF_TRACK_STEERING_FACTOR: number = 0.8;

    public update(deltaTime: number, input: CarInput, isOffTrack = false): void {
        // Handle acceleration and braking
        if (input.forward) {
            this.acceleration = this.ACCELERATION_RATE;
        } else if (input.backward) {
            this.acceleration = -this.ACCELERATION_RATE;
        } else {
            this.acceleration = 0;
        }

        // Track steering direction for lateral slide effect
        let steeringDirection = 0;
        if (input.left) steeringDirection = -1;
        else if (input.right) steeringDirection = 1;

        // Handle drifting
        if (input.drift && Math.abs(this.velocity) > 5) {
            // Increase drift factor when drift button is pressed
            this.driftFactor = Math.min(this.MAX_DRIFT_FACTOR,
                this.driftFactor + (this.DRIFT_BUILDUP_RATE * deltaTime));

            // Apply minor braking during drift initiation (less than full brake)
            if (this.velocity > 5) {
                this.acceleration -= this.BRAKING_RATE * 0.15; // Reduced braking effect
            }

            // Generate lateral velocity for slide effect when drift starts
            if (steeringDirection !== 0) {
                // Set slide direction based on steering
                this.slideDirection = steeringDirection;

                // Add lateral velocity in the direction of steering - enhanced for more slide
                const lateralForce = Math.abs(this.velocity) * this.LATERAL_TRANSFER_FACTOR * this.driftFactor;
                this.lateralVelocity += this.slideDirection * lateralForce * deltaTime;

                // When drifting, add a strong initial slide impulse
                if (this.driftFactor < 0.2 && Math.abs(this.lateralVelocity) < 1.0) {
                    this.lateralVelocity += this.slideDirection * 2.0; // Initial slide impulse
                }

                // Clamp lateral velocity
                this.lateralVelocity = Math.max(
                    -this.MAX_LATERAL_VELOCITY,
                    Math.min(this.MAX_LATERAL_VELOCITY, this.lateralVelocity)
                );
            }

            // When not steering, start to normalize the slide gradually
            if (steeringDirection === 0 && Math.abs(this.lateralVelocity) > 0) {
                const normalizationRate = 0.8 * deltaTime;
                if (this.lateralVelocity > 0) {
                    this.lateralVelocity -= normalizationRate;
                } else {
                    this.lateralVelocity += normalizationRate;
                }
            }
        } else {
            // Recover from drift when drift button is released
            this.driftFactor = Math.max(0,
                this.driftFactor - (this.DRIFT_RECOVERY_RATE * deltaTime));

            // Natural lateral velocity decay (car straightening out) - more gradual
            if (Math.abs(this.lateralVelocity) > 0) {
                const frictionForce = this.LATERAL_FRICTION * deltaTime;
                if (this.lateralVelocity > 0) {
                    this.lateralVelocity = Math.max(0, this.lateralVelocity - frictionForce);
                } else {
                    this.lateralVelocity = Math.min(0, this.lateralVelocity + frictionForce);
                }
            }

            // Apply braking only when not drifting
            if (input.brake) {
                if (this.velocity > 0) {
                    this.acceleration = -this.BRAKING_RATE;
                } else if (this.velocity < 0) {
                    this.acceleration = this.BRAKING_RATE;
                }
            }
        }

        // Update velocity based on acceleration
        this.velocity += this.acceleration * deltaTime;

        // Apply natural deceleration when no input
        if (!input.forward && !input.backward && !input.brake) {
            if (this.velocity > 0) {
                this.velocity -= this.DECELERATION_RATE * deltaTime;
                if (this.velocity < 0) this.velocity = 0;
            } else if (this.velocity < 0) {
                this.velocity += this.DECELERATION_RATE * deltaTime;
                if (this.velocity > 0) this.velocity = 0;
            }
        }

        // Apply off-track physics if needed
        const maxSpeed = isOffTrack ? this.OFF_TRACK_MAX_SPEED : this.MAX_SPEED;

        // Clamp velocity to max speed
        if (this.velocity > maxSpeed) {
            this.velocity = maxSpeed;
        } else if (this.velocity < this.MAX_REVERSE_SPEED) {
            this.velocity = this.MAX_REVERSE_SPEED;
        }

        // Handle steering with modifications for drift
        // Reduce the steering effect during drift to emphasize sliding instead
        const steeringModifier = this.driftFactor > 0 ?
            this.DRIFT_STEERING_FACTOR * (1.0 - Math.min(0.6, Math.abs(this.lateralVelocity) * 0.1)) : 1.0;

        const baseSteering = this.STEERING_SPEED * steeringModifier;

        if (input.left) {
            this.steeringAngle += baseSteering * deltaTime;
        } else if (input.right) {
            this.steeringAngle -= baseSteering * deltaTime;
        } else {
            // Reset steering when no input - faster recovery when not drifting
            const resetSpeed = this.STEERING_RESET_SPEED * (this.driftFactor > 0 ? 0.5 : 1.0);
            if (this.steeringAngle > 0) {
                this.steeringAngle -= resetSpeed * deltaTime;
                if (this.steeringAngle < 0) this.steeringAngle = 0;
            } else if (this.steeringAngle < 0) {
                this.steeringAngle += resetSpeed * deltaTime;
                if (this.steeringAngle > 0) this.steeringAngle = 0;
            }
        }

        // Clamp steering angle - allow more extreme steering during drift but not too much
        let maxSteeringAngle = this.MAX_STEERING_ANGLE;

        // Apply drift steering factor - reduced effect
        if (this.driftFactor > 0) {
            // Only increase steering by up to 40% during drift instead of 80%
            maxSteeringAngle *= 1.0 + (this.driftFactor * 0.4);
        }

        // Apply off-track steering factor
        if (isOffTrack) {
            maxSteeringAngle *= this.OFF_TRACK_STEERING_FACTOR;
        }

        // Clamp steering to max angle
        if (this.steeringAngle > maxSteeringAngle) {
            this.steeringAngle = maxSteeringAngle;
        } else if (this.steeringAngle < -maxSteeringAngle) {
            this.steeringAngle = -maxSteeringAngle;
        }

        // Calculate speed factor for steering
        let speedFactor = Math.abs(this.velocity) / (this.MAX_SPEED * 0.45);
        speedFactor = Math.min(1, speedFactor);

        // Apply reduced traction when drifting or off track
        if (this.driftFactor > 0) {
            speedFactor *= (1.0 - (this.driftFactor * this.DRIFT_TRACTION_LOSS));
        } else if (isOffTrack) {
            speedFactor *= this.OFF_TRACK_TRACTION;
        }

        // Only apply speed factor if moving very slowly
        if (Math.abs(this.velocity) < 2) {
            this.steeringAngle *= speedFactor;
        }
    }

    public reverseVelocity(factor = 0.5): void {
        // Reverse velocity (used for collisions)
        this.velocity = -this.velocity * factor;
        // Also reset lateral velocity on collision
        this.lateralVelocity *= -0.3;
    }

    public getVelocity(): number {
        return this.velocity;
    }

    public getSteeringAngle(): number {
        return this.steeringAngle;
    }

    public getLateralVelocity(): number {
        return this.lateralVelocity;
    }

    public isDrifting(): boolean {
        return this.driftFactor > 0.1;
    }

    public getDriftFactor(): number {
        return this.driftFactor;
    }

    public getSlideDirection(): number {
        return this.slideDirection;
    }
}
