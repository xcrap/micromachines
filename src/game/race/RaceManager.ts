import * as THREE from "three";

export type RaceState = "countdown" | "racing" | "finished";

export interface RacerStatus {
    lap: number;
    lapsCompleted: number;
    /** Continuous progress within the current lap, 0..1. */
    progress: number;
    lapTime: number;
    lastLap: number | null;
    bestLap: number | null;
    totalTime: number;
    finished: boolean;
    finishTime: number | null;
    /** 1-based race position, live until the racer crosses the line and final after. */
    position: number;
}

/** What the race needs to know about each car every frame. */
export interface RacerSample {
    t: number;
    tangentX: number;
    tangentZ: number;
    directionX: number;
    directionZ: number;
    speed: number;
    onTrack: boolean;
}

export interface RaceEvents {
    /** The player finished a lap (not the last one). */
    lapCompleted: boolean;
    newBestLap: boolean;
    finalLap: boolean;
    /** The player crossed the line for the last time. */
    raceFinished: boolean;
    /** Any racer finished — the results table should refresh. */
    racerFinished: boolean;
    standingsChanged: boolean;
}

const COUNTDOWN_SECONDS = 3.6;
const SECTOR_COUNT = 8;
const BEST_LAP_STORAGE_PREFIX = "micro-machines-best-lap";

interface RacerState extends RacerStatus {
    previousT: number;
    hasPreviousT: boolean;
    sectors: Uint8Array;
}

export class RaceManager {
    readonly totalLaps: number;
    readonly playerIndex: number;

    private state: RaceState = "countdown";
    private countdown = COUNTDOWN_SECONDS;
    private clock = 0;
    private finishedCount = 0;
    private recordLap: number | null;
    private readonly storageKey: string;

    private wrongWay = false;
    private wrongWayTimer = 0;

    private readonly racers: RacerState[];
    private readonly standings: number[];

    private readonly events: RaceEvents = {
        lapCompleted: false,
        newBestLap: false,
        finalLap: false,
        raceFinished: false,
        racerFinished: false,
        standingsChanged: false,
    };

    constructor(trackId: string, totalLaps: number, racerCount: number, playerIndex: number) {
        this.totalLaps = totalLaps;
        this.playerIndex = playerIndex;
        this.storageKey = bestLapStorageKey(trackId);
        this.recordLap = readStoredLap(this.storageKey);

        this.racers = Array.from({ length: racerCount }, () => ({
            lap: 1,
            lapsCompleted: 0,
            progress: 0,
            lapTime: 0,
            lastLap: null,
            bestLap: null,
            totalTime: 0,
            finished: false,
            finishTime: null,
            position: 1,
            previousT: 0,
            hasPreviousT: false,
            sectors: new Uint8Array(SECTOR_COUNT),
        }));
        this.standings = this.racers.map((_, index) => index);
    }

    public canDrive(): boolean {
        return this.state !== "countdown";
    }

    public getState(): RaceState {
        return this.state;
    }

    public update(deltaTime: number, samples: readonly RacerSample[]): Readonly<RaceEvents> {
        const events = this.events;
        events.lapCompleted = false;
        events.newBestLap = false;
        events.finalLap = false;
        events.raceFinished = false;
        events.racerFinished = false;
        events.standingsChanged = false;

        if (this.state === "countdown") {
            this.countdown -= deltaTime;
            // On the grid the order is simply who is nearest the line.
            samples.forEach((sample, index) => this.startRacer(this.racers[index], sample.t));
            if (this.countdown <= 0) {
                this.countdown = 0;
                this.state = "racing";
            }
            this.updateStandings();
            return events;
        }

        this.clock += deltaTime;

        for (let i = 0; i < this.racers.length; i++) {
            const racer = this.racers[i];
            if (racer.finished) continue;

            racer.lapTime += deltaTime;
            racer.totalTime += deltaTime;
            this.trackProgress(racer, samples[i]);

            if (racer.progress >= 1 && allVisited(racer.sectors)) {
                this.completeLap(i);
            }
        }

        const player = samples[this.playerIndex];
        if (!this.racers[this.playerIndex].finished) this.trackDirection(deltaTime, player);
        else this.wrongWay = false;

        this.updateStandings();
        return events;
    }

    /** Cars start behind the line, so their progress starts negative and the first crossing counts from zero. */
    private startRacer(racer: RacerState, t: number): void {
        racer.progress = t > 0.5 ? t - 1 : t;
        racer.previousT = t;
        racer.hasPreviousT = true;
        racer.sectors.fill(0);
    }

    private trackProgress(racer: RacerState, sample: RacerSample): void {
        if (!racer.hasPreviousT) {
            racer.previousT = sample.t;
            racer.hasPreviousT = true;
            return;
        }

        let delta = sample.t - racer.previousT;
        if (delta > 0.5) delta -= 1;
        if (delta < -0.5) delta += 1;

        // A jump this large means a shortcut or a respawn, not honest progress.
        if (Math.abs(delta) < 0.2) {
            racer.progress = Math.max(-0.5, racer.progress + delta);
        }
        racer.previousT = sample.t;

        if (racer.progress >= 0) {
            const sector = Math.min(SECTOR_COUNT - 1, Math.floor(sample.t * SECTOR_COUNT));
            racer.sectors[sector] = 1;
        }
    }

    private trackDirection(deltaTime: number, sample: RacerSample): void {
        const alignment = sample.directionX * sample.tangentX + sample.directionZ * sample.tangentZ;
        const goingBackwards = sample.onTrack && sample.speed > 3 && alignment < -0.25;

        this.wrongWayTimer = goingBackwards
            ? Math.min(1.2, this.wrongWayTimer + deltaTime)
            : Math.max(0, this.wrongWayTimer - deltaTime * 2.5);

        this.wrongWay = this.wrongWayTimer > 0.45;
    }

    private completeLap(index: number): void {
        const racer = this.racers[index];
        const isPlayer = index === this.playerIndex;

        racer.lastLap = racer.lapTime;
        if (racer.bestLap === null || racer.lapTime < racer.bestLap) racer.bestLap = racer.lapTime;

        if (isPlayer && (this.recordLap === null || racer.lapTime < this.recordLap)) {
            this.recordLap = racer.lapTime;
            this.events.newBestLap = true;
            writeStoredLap(this.storageKey, racer.lapTime);
        }

        racer.lapTime = 0;
        racer.progress -= 1;
        racer.lapsCompleted++;
        racer.sectors.fill(0);

        if (racer.lapsCompleted >= this.totalLaps) {
            racer.finished = true;
            racer.finishTime = racer.totalTime;
            racer.progress = 0;
            this.finishedCount++;
            racer.position = this.finishedCount;
            this.events.racerFinished = true;

            if (isPlayer) {
                this.state = "finished";
                this.events.raceFinished = true;
            }
            return;
        }

        racer.lap++;
        if (isPlayer) {
            this.events.lapCompleted = true;
            if (racer.lap === this.totalLaps) this.events.finalLap = true;
        }
    }

    private updateStandings(): void {
        const racers = this.racers;
        const previous = this.standings.slice();

        this.standings.sort((a, b) => {
            const ra = racers[a];
            const rb = racers[b];
            if (ra.finished && rb.finished) return ra.position - rb.position;
            if (ra.finished) return -1;
            if (rb.finished) return 1;
            return (rb.lapsCompleted + rb.progress) - (ra.lapsCompleted + ra.progress);
        });

        for (let place = 0; place < this.standings.length; place++) {
            const racer = racers[this.standings[place]];
            if (!racer.finished) racer.position = place + 1;
            if (this.standings[place] !== previous[place]) this.events.standingsChanged = true;
        }
    }

    /** Called after a respawn so the teleport is not read as progress. */
    public resync(index: number, t: number): void {
        const racer = this.racers[index];
        racer.previousT = t;
        racer.hasPreviousT = true;
    }

    public getRacer(index: number): Readonly<RacerStatus> {
        return this.racers[index];
    }

    /** Racer indices from first to last. */
    public getStandings(): readonly number[] {
        return this.standings;
    }

    /** Signed gap in laps between a racer and the player; positive means ahead of the player. */
    public gapToPlayer(index: number): number {
        const racer = this.racers[index];
        const player = this.racers[this.playerIndex];
        return (racer.lapsCompleted + racer.progress) - (player.lapsCompleted + player.progress);
    }

    public getCountdown(): number {
        return this.countdown;
    }

    public getClock(): number {
        return this.clock;
    }

    public getRecordLap(): number | null {
        return this.recordLap;
    }

    public isWrongWay(): boolean {
        return this.wrongWay;
    }

    public allFinished(): boolean {
        return this.finishedCount === this.racers.length;
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

function allVisited(sectors: Uint8Array): boolean {
    for (let i = 0; i < sectors.length; i++) {
        if (!sectors[i]) return false;
    }
    return true;
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

export function readStoredLap(key: string): number | null {
    try {
        const raw = window.localStorage.getItem(key);
        if (!raw) return null;
        const value = Number.parseFloat(raw);
        return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
        return null;
    }
}

export function bestLapStorageKey(trackId: string): string {
    return `${BEST_LAP_STORAGE_PREFIX}-${trackId}`;
}

function writeStoredLap(key: string, value: number): void {
    try {
        window.localStorage.setItem(key, value.toFixed(3));
    } catch {
        // Storage can be unavailable in private browsing — best lap just will not persist.
    }
}
