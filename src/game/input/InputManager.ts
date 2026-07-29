export interface DriveInput {
    /** -1 full reverse to +1 full throttle. */
    throttle: number;
    /** -1 right to +1 left. */
    steer: number;
    handbrake: boolean;
    boost: boolean;
}

export type InputAction = "toggleCamera" | "respawn" | "restart" | "togglePause";

const PREVENTED_KEYS = new Set([
    "arrowup", "arrowdown", "arrowleft", "arrowright", " ", "q", "a", "o", "p", "w", "s", "d", "shift",
]);

const ACTION_KEYS: Record<string, InputAction> = {
    c: "toggleCamera",
    r: "respawn",
    enter: "restart",
    escape: "togglePause",
    p: "togglePause",
};

export class InputManager {
    private readonly keys = new Set<string>();
    private readonly pendingActions = new Set<InputAction>();
    private gamepadIndex: number | null = null;

    private readonly state: DriveInput = { throttle: 0, steer: 0, handbrake: false, boost: false };

    private handleKeyDown = (event: KeyboardEvent): void => {
        const key = event.key.toLowerCase();

        if (PREVENTED_KEYS.has(key)) event.preventDefault();
        if (event.repeat) return;

        this.keys.add(key);

        // "p" doubles as steer-right, so only treat it as pause when nothing else claims it.
        const action = ACTION_KEYS[key];
        if (action && (key !== "p" || event.shiftKey)) {
            this.pendingActions.add(action);
        }
    };

    private handleKeyUp = (event: KeyboardEvent): void => {
        this.keys.delete(event.key.toLowerCase());
    };

    private handleBlur = (): void => {
        this.keys.clear();
    };

    private handleGamepadConnected = (event: GamepadEvent): void => {
        this.gamepadIndex = event.gamepad.index;
    };

    private handleGamepadDisconnected = (event: GamepadEvent): void => {
        if (this.gamepadIndex === event.gamepad.index) this.gamepadIndex = null;
    };

    constructor() {
        window.addEventListener("keydown", this.handleKeyDown);
        window.addEventListener("keyup", this.handleKeyUp);
        window.addEventListener("blur", this.handleBlur);
        window.addEventListener("gamepadconnected", this.handleGamepadConnected);
        window.addEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
    }

    private isDown(...keys: string[]): boolean {
        for (const key of keys) {
            if (this.keys.has(key)) return true;
        }
        return false;
    }

    public sample(): Readonly<DriveInput> {
        const forward = this.isDown("q", "w", "arrowup");
        const backward = this.isDown("a", "s", "arrowdown");
        const left = this.isDown("o", "arrowleft");
        const right = this.isDown("p", "arrowright");

        this.state.throttle = (forward ? 1 : 0) - (backward ? 1 : 0);
        this.state.steer = (left ? 1 : 0) - (right ? 1 : 0);
        this.state.handbrake = this.isDown(" ");
        this.state.boost = this.isDown("shift");

        this.applyGamepad();
        return this.state;
    }

    private applyGamepad(): void {
        if (typeof navigator === "undefined" || !navigator.getGamepads) return;

        const pads = navigator.getGamepads();
        const pad = this.gamepadIndex !== null ? pads[this.gamepadIndex] : pads.find((candidate) => candidate?.connected);
        if (!pad) return;

        const deadzone = (value: number) => (Math.abs(value) < 0.14 ? 0 : value);

        const steerAxis = deadzone(pad.axes[0] ?? 0);
        if (steerAxis !== 0) this.state.steer = -steerAxis;

        const accelerate = pad.buttons[7]?.value ?? 0;
        const brake = pad.buttons[6]?.value ?? 0;
        if (accelerate > 0.05 || brake > 0.05) {
            this.state.throttle = accelerate - brake;
        }

        if (pad.buttons[0]?.pressed) this.state.handbrake = true;
        if (pad.buttons[1]?.pressed || pad.buttons[5]?.pressed) this.state.boost = true;
    }

    /** Edge-triggered; returns true once per press. */
    public consumeAction(action: InputAction): boolean {
        if (!this.pendingActions.has(action)) return false;
        this.pendingActions.delete(action);
        return true;
    }

    public dispose(): void {
        window.removeEventListener("keydown", this.handleKeyDown);
        window.removeEventListener("keyup", this.handleKeyUp);
        window.removeEventListener("blur", this.handleBlur);
        window.removeEventListener("gamepadconnected", this.handleGamepadConnected);
        window.removeEventListener("gamepaddisconnected", this.handleGamepadDisconnected);
        this.keys.clear();
        this.pendingActions.clear();
    }
}
