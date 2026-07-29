import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CarController } from "./car/CarController";
import { MapBuilder } from "./map/MapBuilder";
import { InputManager } from "./input/InputManager";
import { ParticleSystem } from "./effects/ParticleSystem";
import { RaceManager, type RaceState } from "./race/RaceManager";
import { detectQualityTier, FOG_COLOR, FOG_DENSITY, SUN_DIRECTION, type QualityTier } from "./core/Config";

export interface HudState {
    speedKph: number;
    boost: number;
    drifting: boolean;
    airborne: boolean;
    onTrack: boolean;
    lap: number;
    totalLaps: number;
    lapTime: number;
    lastLap: number | null;
    bestLap: number | null;
    totalTime: number;
    raceState: RaceState;
    countdown: number;
    wrongWay: boolean;
    fps: number;
    quality: QualityTier["name"];
}

export interface HudEvents {
    onLapCompleted(lap: number, lapTime: number, isBest: boolean): void;
    onRaceFinished(totalTime: number): void;
}

const PHYSICS_STEP = 1 / 120;
const MAX_SUBSTEPS = 8;
const SUN_DISTANCE = 90;

/**
 * High and far back on purpose. The whole appeal of Micro Machines is that the cars are
 * tiny specks on a big track, so the camera sits well above and the field of view stays put.
 */
const CAMERA_DISTANCE = 26;
const CAMERA_HEIGHT = 20;
const CAMERA_LOOK_AHEAD = 9;
const CAMERA_FOV = 44;

export class GameEngine {
    private readonly scene = new THREE.Scene();
    private readonly camera: THREE.PerspectiveCamera;
    private readonly renderer: THREE.WebGLRenderer;
    private readonly controls: OrbitControls;
    private readonly quality: QualityTier;

    private readonly inputManager: InputManager;
    private readonly mapBuilder: MapBuilder;
    private readonly particles: ParticleSystem;
    private readonly carController: CarController;
    private readonly raceManager = new RaceManager();

    private readonly sunLight: THREE.DirectionalLight;
    private readonly lights: THREE.Object3D[] = [];

    private cameraMode: "follow" | "free" = "follow";
    private isRunning = false;
    private rafId: number | null = null;
    private lastTimestamp = 0;
    private accumulator = 0;
    private elapsed = 0;

    private renderScale = 1;
    private frameTimeAverage = 16.7;
    private qualitySamples = 0;
    private fpsAverage = 60;

    private hudListener: ((state: HudState) => void) | null = null;
    private hudEvents: HudEvents | null = null;

    private hasCameraState = false;

    private readonly hudState: HudState = {
        speedKph: 0,
        boost: 0,
        drifting: false,
        airborne: false,
        onTrack: true,
        lap: 1,
        totalLaps: 3,
        lapTime: 0,
        lastLap: null,
        bestLap: null,
        totalTime: 0,
        raceState: "countdown",
        countdown: 0,
        wrongWay: false,
        fps: 60,
        quality: "medium",
    };

    private readonly _sunOffset = new THREE.Vector3(...SUN_DIRECTION).normalize().multiplyScalar(SUN_DISTANCE);
    private readonly _cameraGoal = new THREE.Vector3();
    private readonly _cameraLook = new THREE.Vector3();
    private readonly _cameraLookCurrent = new THREE.Vector3();

    private handleResize = () => this.onResize();
    private handleVisibility = () => {
        if (document.hidden) this.accumulator = 0;
        this.lastTimestamp = 0;
    };

    constructor(container: HTMLElement) {
        this.quality = detectQualityTier();
        this.hudState.quality = this.quality.name;

        this.scene.background = new THREE.Color(FOG_COLOR);
        this.scene.fog = new THREE.FogExp2(FOG_COLOR, FOG_DENSITY);

        this.camera = new THREE.PerspectiveCamera(
            CAMERA_FOV,
            Math.max(1, container.clientWidth) / Math.max(1, container.clientHeight),
            0.3,
            1400,
        );

        this.renderer = new THREE.WebGLRenderer({
            antialias: this.quality.name !== "low",
            alpha: false,
            stencil: false,
            powerPreference: "high-performance",
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.12;
        this.renderer.shadowMap.enabled = true;
        // PCFSoftShadowMap is deprecated in current three and silently falls back to this anyway.
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        this.renderer.setSize(Math.max(1, container.clientWidth), Math.max(1, container.clientHeight));
        this.renderer.domElement.style.display = "block";
        container.appendChild(this.renderer.domElement);

        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.06;
        this.controls.minDistance = 4;
        this.controls.maxDistance = 140;
        this.controls.maxPolarAngle = Math.PI / 2 - 0.05;
        this.controls.enabled = false;

        this.inputManager = new InputManager();

        this.mapBuilder = new MapBuilder(this.scene, this.quality);
        this.mapBuilder.buildMap();

        this.particles = new ParticleSystem(this.quality.particleCount);
        this.scene.add(this.particles.points);

        this.carController = new CarController(this.scene, this.inputManager, this.mapBuilder, this.particles);

        this.sunLight = this.setupLights();

        this.applyPixelRatio();
        this.particles.setViewport(this.renderer.domElement.height, THREE.MathUtils.degToRad(CAMERA_FOV));
        this.updateCameraFollow(1 / 60, true);
        this.updateSun();
        this.renderer.render(this.scene, this.camera);

        window.addEventListener("resize", this.handleResize);
        document.addEventListener("visibilitychange", this.handleVisibility);
    }

    private setupLights(): THREE.DirectionalLight {
        const hemisphere = new THREE.HemisphereLight(0xbcd9f2, 0x50543a, 1.05);
        this.scene.add(hemisphere);
        this.lights.push(hemisphere);

        const ambient = new THREE.AmbientLight(0xffffff, 0.18);
        this.scene.add(ambient);
        this.lights.push(ambient);

        const sun = new THREE.DirectionalLight(0xfff2d8, 2.6);
        sun.castShadow = true;

        const radius = this.quality.shadowRadius;
        sun.shadow.mapSize.set(this.quality.shadowMapSize, this.quality.shadowMapSize);
        sun.shadow.camera.left = -radius;
        sun.shadow.camera.right = radius;
        sun.shadow.camera.top = radius;
        sun.shadow.camera.bottom = -radius;
        sun.shadow.camera.near = 1;
        sun.shadow.camera.far = SUN_DISTANCE * 2.4;
        sun.shadow.bias = -0.0006;
        sun.shadow.normalBias = 0.035;

        this.scene.add(sun);
        this.scene.add(sun.target);
        this.lights.push(sun, sun.target);

        return sun;
    }

    public setHudListener(listener: ((state: HudState) => void) | null): void {
        this.hudListener = listener;
    }

    public setHudEvents(events: HudEvents | null): void {
        this.hudEvents = events;
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
        this.elapsed += deltaTime;

        this.trackPerformance(frameMs);
        this.handleActions();
        this.stepSimulation(deltaTime);
        this.updateRace(deltaTime);

        this.mapBuilder.update(this.elapsed);
        this.particles.update(deltaTime);
        this.updateCamera(deltaTime);
        this.updateSun();
        this.publishHud();

        this.renderer.render(this.scene, this.camera);
    };

    /** Physics runs on a fixed step so handling is frame-rate independent. */
    private stepSimulation(deltaTime: number): void {
        const canDrive = this.raceManager.canDrive();
        this.accumulator += deltaTime;

        let steps = 0;
        while (this.accumulator >= PHYSICS_STEP && steps < MAX_SUBSTEPS) {
            this.carController.update(PHYSICS_STEP, canDrive);
            this.accumulator -= PHYSICS_STEP;
            steps++;
        }

        if (steps === MAX_SUBSTEPS) this.accumulator = 0;
    }

    private updateRace(deltaTime: number): void {
        const position = this.carController.getPositionRef();
        const query = this.mapBuilder.queryTrack(position.x, position.z);

        const events = this.raceManager.update(
            deltaTime,
            query,
            this.carController.getDirectionRef() as THREE.Vector3,
            this.carController.getSpeed(),
            this.carController.isOnTrack(),
        );

        this.mapBuilder.setStartLights(this.raceManager.getStartLights(), this.raceManager.isGo());

        if (events.lapCompleted) {
            const snapshot = this.raceManager.getSnapshot();
            this.hudEvents?.onLapCompleted(snapshot.lap, snapshot.lastLap ?? 0, events.newBestLap);
        }

        if (events.raceFinished) {
            this.hudEvents?.onRaceFinished(this.raceManager.getSnapshot().totalTime);
        }
    }

    private handleActions(): void {
        if (this.inputManager.consumeAction("toggleCamera")) {
            this.toggleCameraMode();
        }

        if (this.inputManager.consumeAction("respawn")) {
            const t = this.carController.respawn();
            this.raceManager.resyncTo(t);
            this.hasCameraState = false;
        }

        if (this.inputManager.consumeAction("restart")) {
            this.restart();
        }
    }

    public restart(): void {
        this.carController.resetToStart();
        this.raceManager.restart();
        this.hasCameraState = false;
    }

    private toggleCameraMode(): void {
        this.cameraMode = this.cameraMode === "follow" ? "free" : "follow";
        this.controls.enabled = this.cameraMode === "free";

        if (this.cameraMode === "free") {
            this.controls.target.copy(this.carController.getPositionRef());
            this.controls.update();
        } else {
            this.hasCameraState = false;
        }
    }

    private updateCamera(deltaTime: number): void {
        if (this.cameraMode === "free") {
            const targetBlend = 1 - Math.exp(-5 * deltaTime);
            this.controls.target.lerp(this.carController.getPositionRef() as THREE.Vector3, targetBlend);
            this.controls.update();
            return;
        }

        this.updateCameraFollow(deltaTime, false);
    }

    /**
     * Deliberately static: fixed distance, height, look-ahead and field of view. The camera
     * only ever tracks the car's position and heading — it never zooms, dollies or shakes on
     * its own, because a chase cam that moves by itself reads as the game glitching.
     */
    private updateCameraFollow(deltaTime: number, snap: boolean): void {
        const position = this.carController.getPositionRef();
        const direction = this.carController.getDirectionRef();

        // Portrait screens see less width, so lift a little higher to keep the road in frame.
        const portrait = THREE.MathUtils.clamp((1.0 - this.camera.aspect) / 0.45, 0, 1);
        const distance = THREE.MathUtils.lerp(CAMERA_DISTANCE, CAMERA_DISTANCE * 0.82, portrait);
        const height = THREE.MathUtils.lerp(CAMERA_HEIGHT, CAMERA_HEIGHT * 1.12, portrait);

        this._cameraGoal.set(
            position.x - direction.x * distance,
            position.y + height,
            position.z - direction.z * distance,
        );
        this._cameraLook.set(
            position.x + direction.x * CAMERA_LOOK_AHEAD,
            position.y + 0.9,
            position.z + direction.z * CAMERA_LOOK_AHEAD,
        );

        if (snap || !this.hasCameraState) {
            this.camera.position.copy(this._cameraGoal);
            this._cameraLookCurrent.copy(this._cameraLook);
            this.hasCameraState = true;
        }

        const positionBlend = 1 - Math.exp(-7 * deltaTime);
        const lookBlend = 1 - Math.exp(-9 * deltaTime);
        this.camera.position.lerp(this._cameraGoal, positionBlend);
        this._cameraLookCurrent.lerp(this._cameraLook, lookBlend);

        // Safety net only: from this height terrain almost never intrudes, but the eye must
        // never end up buried inside a hill.
        this.liftAboveGround(this.camera.position, 1.5);

        this.camera.lookAt(this._cameraLookCurrent);
    }

    private liftAboveGround(point: THREE.Vector3, clearance: number): void {
        const floor = this.mapBuilder.getSurfaceHeightAt(point.x, point.z) + clearance;
        if (point.y < floor) point.y = floor;
    }

    private updateSun(): void {
        const position = this.carController.getPositionRef();

        // Snapping the shadow frustum to texel boundaries stops shadow edges crawling as the car moves.
        const texel = (this.quality.shadowRadius * 2) / this.quality.shadowMapSize;
        const targetX = Math.round(position.x / texel) * texel;
        const targetZ = Math.round(position.z / texel) * texel;
        const targetY = Math.round(position.y / texel) * texel;

        this.sunLight.target.position.set(targetX, targetY, targetZ);
        this.sunLight.target.updateMatrixWorld();
        this.sunLight.position.set(
            targetX + this._sunOffset.x,
            targetY + this._sunOffset.y,
            targetZ + this._sunOffset.z,
        );
        this.sunLight.updateMatrixWorld();
    }

    private trackPerformance(frameMs: number): void {
        this.frameTimeAverage += (frameMs - this.frameTimeAverage) * 0.06;
        this.fpsAverage += (1000 / Math.max(frameMs, 1) - this.fpsAverage) * 0.06;
        this.qualitySamples++;

        if (this.qualitySamples < 90) return;
        this.qualitySamples = 0;

        // Trade resolution for frame rate before anything else — it is the least visible knob.
        if (this.frameTimeAverage > 23 && this.renderScale > 0.62) {
            this.renderScale = Math.max(0.62, this.renderScale - 0.12);
            this.applyPixelRatio();
        } else if (this.frameTimeAverage < 13.5 && this.renderScale < 1) {
            this.renderScale = Math.min(1, this.renderScale + 0.08);
            this.applyPixelRatio();
        }
    }

    private applyPixelRatio(): void {
        const devicePixelRatio = Math.min(window.devicePixelRatio || 1, this.quality.maxPixelRatio);
        this.renderer.setPixelRatio(devicePixelRatio * this.renderScale);
    }

    private publishHud(): void {
        if (!this.hudListener) return;

        const race = this.raceManager.getSnapshot();
        const state = this.hudState;

        state.speedKph = this.carController.getSpeedKph();
        state.boost = this.carController.getBoostCharge();
        state.drifting = this.carController.isDrifting();
        state.airborne = this.carController.isAirborne();
        state.onTrack = this.carController.isOnTrack();
        state.lap = race.lap;
        state.totalLaps = race.totalLaps;
        state.lapTime = race.lapTime;
        state.lastLap = race.lastLap;
        state.bestLap = race.bestLap;
        state.totalTime = race.totalTime;
        state.raceState = race.state;
        state.countdown = race.countdown;
        state.wrongWay = race.wrongWay;
        state.fps = this.fpsAverage;

        this.hudListener(state);
    }

    private onResize(): void {
        const container = this.renderer.domElement.parentElement;
        if (!container) return;

        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.applyPixelRatio();
        this.renderer.setSize(width, height);
        this.particles.setViewport(
            this.renderer.domElement.height,
            THREE.MathUtils.degToRad(this.camera.fov),
        );
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

        this.inputManager.dispose();
        this.carController.dispose();
        this.mapBuilder.dispose();

        this.scene.remove(this.particles.points);
        this.particles.dispose();

        for (const light of this.lights) {
            this.scene.remove(light);
            if (light instanceof THREE.Light) light.dispose();
        }
        this.lights.length = 0;

        this.controls.dispose();
        this.renderer.dispose();
        this.renderer.domElement.parentElement?.removeChild(this.renderer.domElement);
    }
}
