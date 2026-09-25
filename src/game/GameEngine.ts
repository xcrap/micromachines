import * as THREE from "three";
import { AIDriver } from "./car/AIDriver";
import { CarController } from "./car/CarController";
import { resolveCarCollisions } from "./car/CarCollisions";
import { CameraRig, type CameraMode } from "./camera/CameraRig";
import { detectQualityTier, PHYSICS_STEP, type QualityTier } from "./core/Config";
import { ParticleSystem } from "./effects/ParticleSystem";
import { TrailSystem } from "./effects/TrailSystem";
import { InputManager } from "./input/InputManager";
import { MapBuilder } from "./map/MapBuilder";
import { RaceManager, type RaceState, type RacerSample } from "./race/RaceManager";
import { PLAYER_INDEX, ROSTER } from "./race/Roster";
import { PostFX } from "./render/PostFX";
import { SceneLighting } from "./render/SceneLighting";
import { TRACKS, type TrackId } from "./tracks";

export type GameMode = "attract" | "race";

export interface HudState {
    mode: GameMode;
    paused: boolean;
    speedKph: number;
    boost: number;
    boosting: boolean;
    drifting: boolean;
    airborne: boolean;
    onTrack: boolean;
    lap: number;
    totalLaps: number;
    lapTime: number;
    lastLap: number | null;
    bestLap: number | null;
    recordLap: number | null;
    totalTime: number;
    raceState: RaceState;
    countdown: number;
    wrongWay: boolean;
    position: number;
    racerCount: number;
    fps: number;
    quality: QualityTier["name"];
    cameraMode: CameraMode;
    /** x, z per racer in roster order — read by the minimap every frame. */
    carPositions: Float32Array;
    /** Bumps whenever the running order or a finish changes, so the UI knows to re-read standings. */
    standingsVersion: number;
}

export interface RacerStanding {
    index: number;
    name: string;
    color: string;
    isPlayer: boolean;
    position: number;
    finished: boolean;
    finishTime: number | null;
    bestLap: number | null;
    lapsCompleted: number;
}

export interface TrackOutline {
    points: Float32Array;
    minX: number;
    maxX: number;
    minZ: number;
    maxZ: number;
}

export interface HudEvents {
    onLapCompleted(lap: number, lapTime: number, isBest: boolean): void;
    onFinalLap(): void;
    onRaceFinished(position: number): void;
    onPlayerFell(): void;
}

const MAX_SUBSTEPS = 8;
const OUTLINE_STRIDE = 6;

export class GameEngine {
    private readonly scene = new THREE.Scene();
    private readonly renderer: THREE.WebGLRenderer;
    private readonly quality: QualityTier;
    private readonly lighting: SceneLighting;
    private readonly cameraRig: CameraRig;
    private readonly postFX: PostFX | null;

    private readonly inputManager = new InputManager();
    private readonly particles: ParticleSystem;
    private readonly trails: TrailSystem;

    private trackId: TrackId | null = null;
    private mapBuilder: MapBuilder | null = null;
    private raceManager: RaceManager | null = null;
    private readonly cars: CarController[] = [];
    private readonly drivers: AIDriver[] = [];
    private autopilot: AIDriver | null = null;

    private mode: GameMode = "attract";
    private paused = false;
    private isRunning = false;
    private rafId: number | null = null;
    private lastTimestamp = 0;
    private accumulator = 0;
    private elapsed = 0;

    private renderScale = 1;
    private frameTimeAverage = 16.7;
    private qualitySamples = 0;
    private failedScale = Infinity;
    private failedScaleAge = 0;
    private fpsAverage = 60;

    private hudListener: ((state: HudState) => void) | null = null;
    private hudEvents: HudEvents | null = null;
    private readonly racerSamples: RacerSample[] = ROSTER.map(() => ({
        t: 0, tangentX: 0, tangentZ: 1, directionX: 0, directionZ: 1, speed: 0, onTrack: true,
    }));

    private readonly hudState: HudState = {
        mode: "attract",
        paused: false,
        speedKph: 0,
        boost: 0,
        boosting: false,
        drifting: false,
        airborne: false,
        onTrack: true,
        lap: 1,
        totalLaps: 3,
        lapTime: 0,
        lastLap: null,
        bestLap: null,
        recordLap: null,
        totalTime: 0,
        raceState: "countdown",
        countdown: 0,
        wrongWay: false,
        position: ROSTER.length,
        racerCount: ROSTER.length,
        fps: 60,
        quality: "medium",
        cameraMode: "chase",
        carPositions: new Float32Array(ROSTER.length * 2),
        standingsVersion: 0,
    };

    private readonly groundAt = (x: number, z: number) => this.mapBuilder?.getSurfaceHeightAt(x, z) ?? 0;

    private handleResize = () => this.onResize();
    private handleVisibility = () => {
        if (document.hidden) this.accumulator = 0;
        this.lastTimestamp = 0;
    };

    constructor(container: HTMLElement) {
        this.quality = detectQualityTier();
        this.hudState.quality = this.quality.name;

        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);

        this.renderer = new THREE.WebGLRenderer({
            antialias: false,
            alpha: false,
            stencil: false,
            powerPreference: "high-performance",
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.setSize(width, height);
        this.renderer.domElement.style.display = "block";
        container.appendChild(this.renderer.domElement);

        this.cameraRig = new CameraRig(this.renderer.domElement, width / height);
        this.lighting = new SceneLighting(this.scene, this.renderer, this.quality);
        // Dense (retina) screens already sample finely enough; multisampling on top of that
        // costs hundreds of megabytes of render target for no visible gain.
        const densePixels = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio) >= 1.5;
        this.postFX = this.quality.postProcessing
            ? new PostFX(this.renderer, this.scene, this.cameraRig.camera, densePixels ? 0 : this.quality.msaaSamples)
            : null;

        this.particles = new ParticleSystem(this.quality.particleCount);
        this.scene.add(this.particles.points);
        this.trails = new TrailSystem(this.scene);

        this.applyPixelRatio();

        window.addEventListener("resize", this.handleResize);
        document.addEventListener("visibilitychange", this.handleVisibility);
    }

    public setHudListener(listener: ((state: HudState) => void) | null): void {
        this.hudListener = listener;
    }

    public setHudEvents(events: HudEvents | null): void {
        this.hudEvents = events;
    }

    public getTrackId(): TrackId | null {
        return this.trackId;
    }

    /** Builds a track and lets four AI cars race round it as a live menu backdrop. */
    public loadTrack(id: TrackId): void {
        this.unloadTrack();

        const theme = TRACKS[id];
        this.trackId = id;
        this.lighting.apply(theme.environment, this.renderer);

        this.mapBuilder = new MapBuilder(this.scene, this.quality, theme);
        this.mapBuilder.buildMap();

        const map = this.mapBuilder;
        ROSTER.forEach((profile, index) => {
            const driver = new AIDriver(map, profile.personality, () => this.cars);
            const car = new CarController({
                id: `car-${index}`,
                scene: this.scene,
                mapBuilder: map,
                particles: this.particles,
                trails: this.trails,
                livery: profile.livery,
                driver,
            });
            driver.attach(car);
            this.cars.push(car);
            this.drivers.push(driver);
        });

        this.hudState.totalLaps = theme.laps;
        this.enterAttract();
        this.renderer.compile(this.scene, this.cameraRig.camera);
    }

    private unloadTrack(): void {
        for (const car of this.cars) car.dispose();
        this.cars.length = 0;
        this.drivers.length = 0;
        this.autopilot = null;
        this.raceManager = null;

        this.mapBuilder?.dispose();
        this.mapBuilder = null;
        this.trails.clear();
        this.particles.clear();
    }

    private enterAttract(): void {
        this.mode = "attract";
        this.paused = false;
        this.raceManager = null;
        this.resetField();

        this.cars.forEach((car, index) => {
            car.setDriver(this.drivers[index]);
            this.drivers[index].setEnabled(true);
            this.drivers[index].setPaceScale(1);
        });

        this.cameraRig.setAttract(true);
        this.cameraRig.snap();
    }

    /** Lines the cars up on the grid with the player in control and starts the countdown. */
    public startRace(): void {
        if (!this.mapBuilder || !this.trackId) return;

        const theme = TRACKS[this.trackId];
        this.mode = "race";
        this.paused = false;
        this.raceManager = new RaceManager(this.trackId, theme.laps, this.cars.length, PLAYER_INDEX);
        this.resetField();

        this.cars.forEach((car, index) => {
            this.drivers[index].setEnabled(false);
            car.setDriver(index === PLAYER_INDEX ? this.inputManager : this.drivers[index]);
        });

        this.autopilot = null;
        this.hudState.standingsVersion++;
        this.cameraRig.setAttract(false);
        this.cameraRig.snap();
        this.inputManager.consumeAction("respawn");
        this.inputManager.consumeAction("toggleCamera");
    }

    public restartRace(): void {
        this.startRace();
    }

    public exitToMenu(): void {
        if (!this.mapBuilder) return;
        this.enterAttract();
    }

    private resetField(): void {
        this.mapBuilder?.resetDynamic();
        this.trails.clear();
        this.particles.clear();
        this.accumulator = 0;
        this.cars.forEach((car, index) => car.placeOnGrid(ROSTER[index].gridSlot));
    }

    public setPaused(paused: boolean): void {
        if (this.mode !== "race") return;
        this.paused = paused;
        this.lastTimestamp = 0;
    }

    public isPaused(): boolean {
        return this.paused;
    }

    public getMode(): GameMode {
        return this.mode;
    }

    public cycleCamera(): CameraMode {
        const player = this.cars[PLAYER_INDEX];
        if (!player) return this.cameraRig.getMode();
        return this.cameraRig.cycleMode(player);
    }

    public getStandings(): RacerStanding[] {
        const race = this.raceManager;
        const order = race ? race.getStandings() : ROSTER.map((_, index) => index);

        return order.map((index) => {
            const status = race?.getRacer(index);
            return {
                index,
                name: ROSTER[index].name,
                color: ROSTER[index].color,
                isPlayer: index === PLAYER_INDEX,
                position: status?.position ?? index + 1,
                finished: status?.finished ?? false,
                finishTime: status?.finishTime ?? null,
                bestLap: status?.bestLap ?? null,
                lapsCompleted: status?.lapsCompleted ?? 0,
            };
        });
    }

    public getTrackOutline(): TrackOutline | null {
        if (!this.mapBuilder) return null;
        const samples = this.mapBuilder.getTrackPath().samples;
        const count = Math.ceil(samples.length / OUTLINE_STRIDE);
        const points = new Float32Array(count * 2);
        let minX = Infinity;
        let maxX = -Infinity;
        let minZ = Infinity;
        let maxZ = -Infinity;

        for (let i = 0; i < count; i++) {
            const sample = samples[i * OUTLINE_STRIDE];
            points[i * 2] = sample.x;
            points[i * 2 + 1] = sample.z;
            minX = Math.min(minX, sample.x);
            maxX = Math.max(maxX, sample.x);
            minZ = Math.min(minZ, sample.z);
            maxZ = Math.max(maxZ, sample.z);
        }

        return { points, minX, maxX, minZ, maxZ };
    }

    public start(): void {
        if (this.isRunning) return;
        this.isRunning = true;
        this.lastTimestamp = 0;
        this.rafId = requestAnimationFrame(this.animate);
    }

    private animate = (timestamp: number): void => {
        if (!this.isRunning) return;
        this.rafId = requestAnimationFrame(this.animate);

        if (this.lastTimestamp === 0) {
            this.lastTimestamp = timestamp;
            return;
        }

        const frameMs = timestamp - this.lastTimestamp;
        this.lastTimestamp = timestamp;
        const deltaTime = Math.min(frameMs / 1000, 0.1);

        if (this.paused || !this.mapBuilder) {
            this.publishHud();
            return;
        }

        this.elapsed += deltaTime;
        this.trackPerformance(frameMs);
        this.handleActions();
        this.stepSimulation(deltaTime);
        this.updateRace(deltaTime);

        this.mapBuilder.update(this.elapsed, deltaTime);
        this.particles.update(deltaTime);
        this.trails.update(deltaTime);
        this.updateCamera(deltaTime);
        this.publishHud();
        this.render(deltaTime);
    };

    private canDrive(): boolean {
        return this.mode === "attract" || (this.raceManager?.canDrive() ?? false);
    }

    private stepSimulation(deltaTime: number): void {
        const canDrive = this.canDrive();
        for (const driver of this.drivers) driver.setEnabled(canDrive);
        this.autopilot?.setEnabled(true);

        this.accumulator += deltaTime;
        let steps = 0;
        while (this.accumulator >= PHYSICS_STEP && steps < MAX_SUBSTEPS) {
            for (const car of this.cars) car.update(PHYSICS_STEP, canDrive);
            resolveCarCollisions(this.cars);
            this.accumulator -= PHYSICS_STEP;
            steps++;
        }
        if (steps === MAX_SUBSTEPS) this.accumulator = 0;

        this.handleRespawns();

        const alpha = this.accumulator / PHYSICS_STEP;
        for (const car of this.cars) car.interpolate(alpha);
    }

    private handleRespawns(): void {
        this.cars.forEach((car, index) => {
            const driver = car.getDriver();
            const requested = driver instanceof AIDriver && driver.consumeRespawnRequest();
            if (requested) car.respawn();

            const fell = car.consumeFall();
            if (fell && index === PLAYER_INDEX && this.mode === "race") this.hudEvents?.onPlayerFell();

            if ((requested || fell) && this.raceManager) {
                const position = car.getPositionRef();
                this.raceManager.resync(index, this.mapBuilder!.queryTrack(position.x, position.z).t);
            }
        });
    }

    private updateRace(deltaTime: number): void {
        const race = this.raceManager;
        const map = this.mapBuilder!;
        if (!race) {
            map.setStartLights(0, true);
            return;
        }

        this.cars.forEach((car, index) => {
            const position = car.getPositionRef();
            const direction = car.getDirectionRef();
            const query = map.queryTrack(position.x, position.z);
            const sample = this.racerSamples[index];
            sample.t = query.t;
            sample.tangentX = query.tangentX;
            sample.tangentZ = query.tangentZ;
            sample.directionX = direction.x;
            sample.directionZ = direction.z;
            sample.speed = car.getSpeed();
            sample.onTrack = car.isOnTrack();
        });

        const events = race.update(deltaTime, this.racerSamples);
        map.setStartLights(race.getStartLights(), race.isGo());

        if (events.standingsChanged || events.racerFinished) this.hudState.standingsVersion++;

        const player = race.getRacer(PLAYER_INDEX);
        if (events.lapCompleted) this.hudEvents?.onLapCompleted(player.lap, player.lastLap ?? 0, events.newBestLap);
        if (events.finalLap) this.hudEvents?.onFinalLap();
        if (events.raceFinished) {
            this.handOverToAutopilot();
            this.hudEvents?.onRaceFinished(player.position);
        }

        this.applyRubberBand(race);
    }

    /** After the flag the player's car keeps circulating on its own while the others finish. */
    private handOverToAutopilot(): void {
        const map = this.mapBuilder;
        const player = this.cars[PLAYER_INDEX];
        if (!map || !player) return;

        this.autopilot = new AIDriver(map, { pace: 0.7, lane: 0, aggression: 0.3, flair: 0 }, () => this.cars);
        this.autopilot.attach(player);
        this.autopilot.setEnabled(true);
        player.setDriver(this.autopilot);
    }

    /** Rivals ease off when well clear of the player and push when behind, which keeps the pack together. */
    private applyRubberBand(race: RaceManager): void {
        if (race.getState() === "countdown") return;
        for (let i = 0; i < this.drivers.length; i++) {
            if (i === PLAYER_INDEX) continue;
            const gap = race.gapToPlayer(i);
            this.drivers[i].setPaceScale(THREE.MathUtils.clamp(1 - gap * 0.45, 0.88, 1.045));
        }
    }

    private handleActions(): void {
        if (this.mode !== "race") {
            this.inputManager.consumeAction("toggleCamera");
            this.inputManager.consumeAction("respawn");
            return;
        }

        if (this.inputManager.consumeAction("toggleCamera")) {
            this.cycleCamera();
        }

        if (this.inputManager.consumeAction("respawn") && this.raceManager?.canDrive()) {
            const player = this.cars[PLAYER_INDEX];
            const t = player.respawn();
            this.raceManager.resync(PLAYER_INDEX, t);
        }
    }

    private updateCamera(deltaTime: number): void {
        const target = this.mode === "attract" ? this.leadCar() : this.cars[PLAYER_INDEX];
        if (!target) return;

        this.cameraRig.update(deltaTime, target, this.groundAt);
        this.lighting.follow(this.cameraRig.getFocus());

        if (this.postFX) {
            const mode = this.mode === "attract" ? "attract" : this.cameraRig.getMode();
            if (mode === "classic") this.postFX.setFocus(0.5, 0.26);
            else if (mode === "free") this.postFX.setFocus(0.5, 0.5);
            else if (mode === "attract") this.postFX.setFocus(0.45, 0.17);
            else this.postFX.setFocus(0.42, 0.2);
        }
    }

    private leadCar(): CarController | undefined {
        return this.cars[PLAYER_INDEX];
    }

    private render(deltaTime: number): void {
        if (this.postFX) {
            this.postFX.render(deltaTime);
        } else {
            this.renderer.render(this.scene, this.cameraRig.camera);
        }
    }

    /**
     * Adaptive resolution: drop the render scale when frames run long, and creep back up while
     * the frame rate holds — but never straight back to a scale that just failed.
     */
    private trackPerformance(frameMs: number): void {
        this.frameTimeAverage += (frameMs - this.frameTimeAverage) * 0.06;
        this.fpsAverage += (1000 / Math.max(frameMs, 1) - this.fpsAverage) * 0.06;
        this.qualitySamples++;
        this.failedScaleAge += frameMs;

        if (this.failedScaleAge > 30000) this.failedScale = Infinity;
        if (this.qualitySamples < 90) return;
        this.qualitySamples = 0;

        if (this.frameTimeAverage > 20 && this.renderScale > 0.6) {
            this.failedScale = this.renderScale;
            this.failedScaleAge = 0;
            this.renderScale = Math.max(0.6, this.renderScale - 0.1);
            this.applyPixelRatio();
        } else if (this.frameTimeAverage < 17.6 && this.renderScale < 1) {
            const next = Math.min(1, this.renderScale + 0.05);
            if (next < this.failedScale - 0.01) {
                this.renderScale = next;
                this.applyPixelRatio();
            }
        }
    }

    private applyPixelRatio(): void {
        const devicePixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
        const ratio = devicePixelRatio * this.renderScale;
        this.renderer.setPixelRatio(ratio);

        const size = this.renderer.getSize(new THREE.Vector2());
        this.postFX?.setSize(size.x, size.y, ratio);
        this.particles.setViewport(this.renderer.domElement.height, THREE.MathUtils.degToRad(this.cameraRig.camera.fov));
    }

    private publishHud(): void {
        if (!this.hudListener) return;

        const state = this.hudState;
        const player = this.cars[PLAYER_INDEX];
        const race = this.raceManager;

        state.mode = this.mode;
        state.paused = this.paused;
        state.fps = this.fpsAverage;
        state.cameraMode = this.cameraRig.getMode();

        this.cars.forEach((car, index) => {
            const position = car.getPositionRef();
            state.carPositions[index * 2] = position.x;
            state.carPositions[index * 2 + 1] = position.z;
        });

        if (player) {
            state.speedKph = player.getSpeedKph();
            state.boost = player.getBoostCharge();
            state.boosting = player.isBoosting();
            state.drifting = player.isDrifting();
            state.airborne = player.isAirborne();
            state.onTrack = player.isOnTrack();
        }

        if (race) {
            const status = race.getRacer(PLAYER_INDEX);
            state.lap = Math.min(status.lap, race.totalLaps);
            state.totalLaps = race.totalLaps;
            state.lapTime = status.lapTime;
            state.lastLap = status.lastLap;
            state.bestLap = status.bestLap;
            state.recordLap = race.getRecordLap();
            state.totalTime = status.totalTime;
            state.raceState = race.getState();
            state.countdown = race.getCountdown();
            state.wrongWay = race.isWrongWay();
            state.position = status.position;
        }

        this.hudListener(state);
    }

    private onResize(): void {
        const container = this.renderer.domElement.parentElement;
        if (!container) return;

        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);

        this.cameraRig.resize(width / height);
        this.renderer.setSize(width, height);
        this.applyPixelRatio();
    }

    public dispose(): void {
        this.isRunning = false;

        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        window.removeEventListener("resize", this.handleResize);
        document.removeEventListener("visibilitychange", this.handleVisibility);

        this.hudListener = null;
        this.hudEvents = null;

        this.unloadTrack();
        this.inputManager.dispose();

        this.scene.remove(this.particles.points);
        this.particles.dispose();
        this.trails.dispose();
        this.lighting.dispose();
        this.cameraRig.dispose();
        this.postFX?.dispose();
        this.renderer.dispose();
        this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
    }
}
