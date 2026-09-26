import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

export type CameraMode = "chase" | "classic" | "free";

export const CAMERA_MODES: readonly CameraMode[] = ["chase", "classic", "free"];

export interface CameraTarget {
    getCameraAnchorRef(): Readonly<THREE.Vector3>;
    getViewDirectionRef(): Readonly<THREE.Vector3>;
    getWorldVelocity(out: { x: number; z: number }): { x: number; z: number };
}

const FOV = 44;

/**
 * High and far back on purpose: the appeal of Mini Machines is tiny cars on a big track.
 * Every mode is deliberately static — fixed distance, height and field of view. The camera only
 * tracks the car's position and heading; it never zooms, dollies or shakes on its own, because
 * a camera that moves by itself reads as the game glitching.
 */
const CHASE_DISTANCE = 18;
const CHASE_HEIGHT = 20.5;
const CHASE_LOOK_AHEAD = 9;
/** How quickly the chase view swings round to a new heading (1/s). */
const CHASE_TURN_RATE = 4.5;
/** 0 = look where the nose points, 1 = look where the car is travelling. */
const CHASE_TRAVEL_BIAS = 0.5;
/** How quickly the chase view follows the car up and down (1/s); slow enough to ignore small bumps. */
const CHASE_RISE_RATE = 3.5;

/** Classic top-down: the world never rotates, the camera leads the car in the direction it travels. */
const CLASSIC_HEIGHT = 44;
const CLASSIC_TILT_BACK = 13;
const CLASSIC_LEAD = 0.42;
const CLASSIC_MAX_LEAD = 12;

const ATTRACT_RADIUS = 30;
const ATTRACT_HEIGHT = 19;
const ATTRACT_SPEED = 0.16;

export class CameraRig {
    readonly camera: THREE.PerspectiveCamera;

    private readonly controls: OrbitControls;
    private mode: CameraMode = "chase";
    private attract = false;
    private hasState = false;
    private attractAngle = 0.6;
    private viewYaw = 0;
    /** Height the chase view rides at: follows hills, but not every bump the wheels go over. */
    private viewHeight = 0;

    private readonly goal = new THREE.Vector3();
    private readonly look = new THREE.Vector3();
    private readonly lookCurrent = new THREE.Vector3();
    private readonly focus = new THREE.Vector3();
    private readonly lead = new THREE.Vector3();
    private readonly velocity = { x: 0, z: 0 };

    constructor(domElement: HTMLElement, aspect: number) {
        this.camera = new THREE.PerspectiveCamera(FOV, aspect, 0.3, 1600);

        this.controls = new OrbitControls(this.camera, domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.minDistance = 4;
        this.controls.maxDistance = 160;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.enabled = false;
    }

    public getMode(): CameraMode {
        return this.mode;
    }

    public setMode(mode: CameraMode, target: CameraTarget): void {
        this.mode = mode;
        this.controls.enabled = mode === "free" && !this.attract;
        if (mode === "free") {
            this.controls.target.copy(target.getCameraAnchorRef());
            this.controls.update();
        }
        this.hasState = false;
    }

    public cycleMode(target: CameraTarget): CameraMode {
        const next = CAMERA_MODES[(CAMERA_MODES.indexOf(this.mode) + 1) % CAMERA_MODES.length];
        this.setMode(next, target);
        return next;
    }

    /** Menu backdrop: a slow orbit around whichever car is leading. */
    public setAttract(attract: boolean): void {
        this.attract = attract;
        this.controls.enabled = this.mode === "free" && !attract;
        this.hasState = false;
    }

    public snap(): void {
        this.hasState = false;
    }

    /** The point the shadow map should be centred on — the middle of what is on screen. */
    public getFocus(): Readonly<THREE.Vector3> {
        return this.focus;
    }

    public update(deltaTime: number, target: CameraTarget, groundAt: (x: number, z: number) => number): void {
        const anchor = target.getCameraAnchorRef();
        const direction = target.getViewDirectionRef();

        if (this.attract) {
            this.updateAttract(deltaTime, anchor);
        } else if (this.mode === "free") {
            const blend = 1 - Math.exp(-5 * deltaTime);
            this.controls.target.lerp(anchor as THREE.Vector3, blend);
            this.controls.update();
            this.focus.copy(this.controls.target);
            return;
        } else if (this.mode === "classic") {
            this.updateClassic(deltaTime, target, anchor);
        } else {
            this.updateChase(deltaTime, target, anchor, direction);
        }

        // Safety net only: the eye must never end up buried inside a hill or a cereal box.
        const floor = groundAt(this.camera.position.x, this.camera.position.z) + 1.5;
        if (this.camera.position.y < floor) this.camera.position.y = floor;

        this.camera.lookAt(this.lookCurrent);
    }

    /**
     * The view turns on its own smoothed yaw while its position tracks the car tightly, so
     * steering corrections do not whip the whole world round. The yaw leans toward the direction
     * of travel, which keeps the road ahead in view and lets a drift read as the car sliding.
     */
    private updateChase(deltaTime: number, target: CameraTarget, anchor: Readonly<THREE.Vector3>, direction: Readonly<THREE.Vector3>): void {
        // Portrait screens see less width, so lift a little higher to keep the road in frame.
        const portrait = THREE.MathUtils.clamp((1.0 - this.camera.aspect) / 0.45, 0, 1);
        const distance = THREE.MathUtils.lerp(CHASE_DISTANCE, CHASE_DISTANCE * 0.85, portrait);
        const height = THREE.MathUtils.lerp(CHASE_HEIGHT, CHASE_HEIGHT * 1.15, portrait);

        let yaw = Math.atan2(direction.x, direction.z);
        target.getWorldVelocity(this.velocity);
        const forward = this.velocity.x * direction.x + this.velocity.z * direction.z;
        if (forward > 4) {
            yaw += wrapAngle(Math.atan2(this.velocity.x, this.velocity.z) - yaw) * CHASE_TRAVEL_BIAS;
        }

        if (!this.hasState) {
            this.viewYaw = yaw;
            this.viewHeight = anchor.y;
        } else {
            this.viewYaw += wrapAngle(yaw - this.viewYaw) * (1 - Math.exp(-CHASE_TURN_RATE * deltaTime));
            this.viewHeight += (anchor.y - this.viewHeight) * (1 - Math.exp(-CHASE_RISE_RATE * deltaTime));
        }

        const dx = Math.sin(this.viewYaw);
        const dz = Math.cos(this.viewYaw);
        const y = this.viewHeight;
        this.goal.set(anchor.x - dx * distance, y + height, anchor.z - dz * distance);
        this.look.set(anchor.x + dx * CHASE_LOOK_AHEAD, y + 0.9, anchor.z + dz * CHASE_LOOK_AHEAD);
        this.focus.set(anchor.x + dx * 16, y, anchor.z + dz * 16);

        this.blendTowardGoal(deltaTime, 10, 14);
    }

    private updateClassic(deltaTime: number, target: CameraTarget, anchor: Readonly<THREE.Vector3>): void {
        target.getWorldVelocity(this.velocity);
        this.lead.set(this.velocity.x * CLASSIC_LEAD, 0, this.velocity.z * CLASSIC_LEAD);
        if (this.lead.length() > CLASSIC_MAX_LEAD) this.lead.setLength(CLASSIC_MAX_LEAD);

        this.look.set(anchor.x + this.lead.x, anchor.y, anchor.z + this.lead.z);
        this.goal.set(this.look.x, anchor.y + CLASSIC_HEIGHT, this.look.z - CLASSIC_TILT_BACK);
        this.focus.copy(this.look);

        this.blendTowardGoal(deltaTime, 4.5, 4.5);
    }

    private updateAttract(deltaTime: number, anchor: Readonly<THREE.Vector3>): void {
        this.attractAngle += deltaTime * ATTRACT_SPEED;
        this.goal.set(
            anchor.x + Math.sin(this.attractAngle) * ATTRACT_RADIUS,
            anchor.y + ATTRACT_HEIGHT,
            anchor.z + Math.cos(this.attractAngle) * ATTRACT_RADIUS,
        );
        this.look.set(anchor.x, anchor.y + 1, anchor.z);
        this.focus.copy(anchor);

        this.blendTowardGoal(deltaTime, 2.2, 3);
    }

    private blendTowardGoal(deltaTime: number, positionRate: number, lookRate: number): void {
        if (!this.hasState) {
            this.camera.position.copy(this.goal);
            this.lookCurrent.copy(this.look);
            this.hasState = true;
            return;
        }

        this.camera.position.lerp(this.goal, 1 - Math.exp(-positionRate * deltaTime));
        this.lookCurrent.lerp(this.look, 1 - Math.exp(-lookRate * deltaTime));
    }

    public resize(aspect: number): void {
        this.camera.aspect = aspect;
        this.camera.updateProjectionMatrix();
    }

    public dispose(): void {
        this.controls.dispose();
    }
}

function wrapAngle(angle: number): number {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
}
