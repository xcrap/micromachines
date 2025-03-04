export interface CarInput {
    forward: boolean;
    backward: boolean;
    left: boolean;
    right: boolean;
    brake: boolean;
}

export class CarPhysics {
    private velocity = 0;
    private acceleration = 0;
    private steeringAngle = 0;

    // Car physics constants
    private readonly MAX_SPEED: number = 25; // Increased for larger map
    private readonly MAX_REVERSE_SPEED: number = -10;
    private readonly ACCELERATION_RATE: number = 15;
    private readonly BRAKING_RATE: number = 20;
    private readonly DECELERATION_RATE: number = 8;
    private readonly MAX_STEERING_ANGLE: number = 0.2; // Increased for better steering
    private readonly STEERING_SPEED: number = 6; // Increased for faster steering response
    private readonly STEERING_RESET_SPEED: number = 8;

    // Off-track physics modifiers
    private readonly OFF_TRACK_MAX_SPEED: number = 15; // Increased for better off-track driving
    private readonly OFF_TRACK_TRACTION: number = 0.7; // Improved traction when off track
    private readonly OFF_TRACK_STEERING_FACTOR: number = 0.8; // Better steering when off track

    public update(deltaTime: number, input: CarInput, isOffTrack = false): void {
        // Handle acceleration and braking
        if (input.forward) {
            this.acceleration = this.ACCELERATION_RATE;
        } else if (input.backward) {
            this.acceleration = -this.ACCELERATION_RATE;
        } else {
            this.acceleration = 0;
        }

        // Apply braking
        if (input.brake) {
            if (this.velocity > 0) {
                this.acceleration = -this.BRAKING_RATE;
            } else if (this.velocity < 0) {
                this.acceleration = this.BRAKING_RATE;
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

        // Handle steering
        if (input.left) {
            this.steeringAngle += this.STEERING_SPEED * deltaTime;
        } else if (input.right) {
            this.steeringAngle -= this.STEERING_SPEED * deltaTime;
        } else {
            // Reset steering when no input
            if (this.steeringAngle > 0) {
                this.steeringAngle -= this.STEERING_RESET_SPEED * deltaTime;
                if (this.steeringAngle < 0) this.steeringAngle = 0;
            } else if (this.steeringAngle < 0) {
                this.steeringAngle += this.STEERING_RESET_SPEED * deltaTime;
                if (this.steeringAngle > 0) this.steeringAngle = 0;
            }
        }

        // Clamp steering angle
        const maxSteeringAngle = isOffTrack
            ? this.MAX_STEERING_ANGLE * this.OFF_TRACK_STEERING_FACTOR
            : this.MAX_STEERING_ANGLE;

        if (this.steeringAngle > maxSteeringAngle) {
            this.steeringAngle = maxSteeringAngle;
        } else if (this.steeringAngle < -maxSteeringAngle) {
            this.steeringAngle = -maxSteeringAngle;
        }

        // Reduce steering effect at very low speeds, but allow more steering at normal speeds
        let speedFactor = Math.abs(this.velocity) / (this.MAX_SPEED * 0.3); // Reduced divisor to allow more steering at lower speeds
        speedFactor = Math.min(1, speedFactor); // Cap at 1 to prevent over-steering at high speeds

        // Apply reduced traction when off track
        if (isOffTrack) {
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
    }

    public getVelocity(): number {
        return this.velocity;
    }

    public getSteeringAngle(): number {
        return this.steeringAngle;
    }
}
