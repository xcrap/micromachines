import * as THREE from "three";
import type { TrackQuery } from "../map/TrackPath";

export type RaceState = "countdown" | "racing" | "finished";

export interface RaceSnapshot {
    state: RaceState;
    lap: number;
    totalLaps: number;
    lapTime: number;
    lastLap: number | null;
    bestLap: number | null;
    totalTime: number;
    countdown: number;
    /** 0-5 red lights during the countdown. */
    startLights: number;
    wrongWay: boolean;
    lapProgress: number;
}

export interface RaceEvents {
    lapCompleted: boolean;
    raceFinished: boolean;
    newBestLap: boolean;
}

const TOTAL_LAPS = 3;
const COUNTDOWN_SECONDS = 3.6;
const SECTOR_COUNT = 8;
const BEST_LAP_STORAGE_KEY = "micro-machines-best-lap";

export class RaceManager {
    private state: RaceState = "countdown";
    private countdown = COUNTDOWN_SECONDS;
    private lap = 1;
    private lapTime = 0;
    private totalTime = 0;
    private lastLap: number | null = null;
    private bestLap: number | null = null;
    private wrongWay = false;
    private wrongWayTimer = 0;

    private progress = 0;
    private previousT = 0;
    private hasPreviousT = false;
    private readonly sectorsVisited = new Uint8Array(SECTOR_COUNT);

    private readonly events: RaceEvents = { lapCompleted: false, raceFinished: false, newBestLap: false };
    private readonly snapshot: RaceSnapshot = {
        state: "countdown",
        lap: 1,
        totalLaps: TOTAL_LAPS,
        lapTime: 0,
        lastLap: null,
        bestLap: null,
        totalTime: 0,
        countdown: COUNTDOWN_SECONDS,
        startLights: 0,
        wrongWay: false,
        lapProgress: 0,
    };

    constructor() {
        this.bestLap = readStoredBestLap();
    }

    public isRunning(): boolean {
        return this.state === "racing";
    }

    public canDrive(): boolean {
        return this.state !== "countdown";
    }

    public update(
        deltaTime: number,
        query: Readonly<TrackQuery>,
        direction: THREE.Vector3,
        speed: number,
        onTrack: boolean,
    ): Readonly<RaceEvents> {
        this.events.lapCompleted = false;
        this.events.raceFinished = false;
        this.events.newBestLap = false;

        if (this.state === "countdown") {
            this.countdown -= deltaTime;
            if (this.countdown <= 0) {
                this.countdown = 0;
                this.state = "racing";
                this.previousT = query.t;
                this.hasPreviousT = true;
            }
            return this.events;
        }

        if (this.state === "finished") {
            return this.events;
        }

        this.lapTime += deltaTime;
        this.totalTime += deltaTime;

        this.trackProgress(query);
        this.trackDirection(deltaTime, query, direction, speed, onTrack);

        if (this.progress >= 1 && this.allSectorsVisited()) {
            this.completeLap();
        }

        return this.events;
    }

    private trackProgress(query: Readonly<TrackQuery>): void {
        if (!this.hasPreviousT) {
            this.previousT = query.t;
            this.hasPreviousT = true;
            return;
        }

        let delta = query.t - this.previousT;
        if (delta > 0.5) delta -= 1;
        if (delta < -0.5) delta += 1;

        // A jump this large means a shortcut or a respawn, not honest progress.
        if (Math.abs(delta) < 0.2) {
            this.progress = Math.max(0, this.progress + delta);
        }

        this.previousT = query.t;

        const sector = Math.min(SECTOR_COUNT - 1, Math.floor(query.t * SECTOR_COUNT));
        this.sectorsVisited[sector] = 1;
    }

    private trackDirection(
        deltaTime: number,
        query: Readonly<TrackQuery>,
        direction: THREE.Vector3,
        speed: number,
        onTrack: boolean,
    ): void {
        const alignment = direction.x * query.tangentX + direction.z * query.tangentZ;
        const goingBackwards = onTrack && speed > 3 && alignment < -0.25;

        this.wrongWayTimer = goingBackwards
            ? Math.min(1.2, this.wrongWayTimer + deltaTime)
            : Math.max(0, this.wrongWayTimer - deltaTime * 2.5);

        this.wrongWay = this.wrongWayTimer > 0.45;
    }

    private allSectorsVisited(): boolean {
        for (let i = 0; i < SECTOR_COUNT; i++) {
            if (!this.sectorsVisited[i]) return false;
        }
        return true;
    }

    private completeLap(): void {
        this.lastLap = this.lapTime;
        this.events.lapCompleted = true;

        if (this.bestLap === null || this.lapTime < this.bestLap) {
            this.bestLap = this.lapTime;
            this.events.newBestLap = true;
            writeStoredBestLap(this.lapTime);
        }

        this.lapTime = 0;
        this.progress -= 1;
        this.sectorsVisited.fill(0);

        if (this.lap >= TOTAL_LAPS) {
            this.state = "finished";
            this.events.raceFinished = true;
        } else {
            this.lap++;
        }
    }

    /** Called after a respawn so the teleport is not read as progress. */
    public resyncTo(t: number): void {
        this.previousT = t;
        this.hasPreviousT = true;
    }

    public restart(): void {
        this.state = "countdown";
        this.countdown = COUNTDOWN_SECONDS;
        this.lap = 1;
        this.lapTime = 0;
        this.totalTime = 0;
        this.lastLap = null;
        this.progress = 0;
        this.hasPreviousT = false;
        this.wrongWay = false;
        this.wrongWayTimer = 0;
        this.sectorsVisited.fill(0);
    }

    public getSnapshot(): Readonly<RaceSnapshot> {
        const snapshot = this.snapshot;
        snapshot.state = this.state;
        snapshot.lap = this.lap;
        snapshot.lapTime = this.lapTime;
        snapshot.lastLap = this.lastLap;
        snapshot.bestLap = this.bestLap;
        snapshot.totalTime = this.totalTime;
        snapshot.countdown = this.countdown;
        snapshot.startLights = this.getStartLights();
        snapshot.wrongWay = this.wrongWay;
        snapshot.lapProgress = THREE.MathUtils.clamp(this.progress, 0, 1);
        return snapshot;
    }

    /** Lights come on one at a time, then all go out at zero. */
    public getStartLights(): number {
        if (this.state !== "countdown") return 0;
        const elapsed = COUNTDOWN_SECONDS - this.countdown;
        return THREE.MathUtils.clamp(Math.floor(elapsed / (COUNTDOWN_SECONDS / 5)) + 1, 0, 5);
    }

    public isGo(): boolean {
        return this.state !== "countdown";
    }
}

export function formatTime(seconds: number | null): string {
    if (seconds === null) return "--:--.---";

    const clamped = Math.max(0, seconds);
    const minutes = Math.floor(clamped / 60);
    const remaining = clamped - minutes * 60;
    const whole = Math.floor(remaining);
    const millis = Math.floor((remaining - whole) * 1000);

    return `${minutes}:${whole.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

function readStoredBestLap(): number | null {
    try {
        const raw = window.localStorage.getItem(BEST_LAP_STORAGE_KEY);
        if (!raw) return null;
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

function writeStoredBestLap(value: number): void {
    try {
        window.localStorage.setItem(BEST_LAP_STORAGE_KEY, value.toFixed(3));
    } catch {
        // Storage can be unavailable in private browsing — best lap just will not persist.
    }
}
