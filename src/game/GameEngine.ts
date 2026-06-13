import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { CarController } from "./car/CarController";
import { MapBuilder } from "./map/MapBuilder";
import { InputManager } from "./input/InputManager";

export class GameEngine {
    private scene: THREE.Scene;
    private camera: THREE.PerspectiveCamera;
    private renderer: THREE.WebGLRenderer;
    private controls: OrbitControls;
    private timer: THREE.Timer;
    private inputManager: InputManager;
    private carController: CarController;
    private mapBuilder: MapBuilder;
    private lights: THREE.Light[] = [];
    private cameraOccluders: THREE.Object3D[] = [];
    private isRunning = false;
    private cameraMode: "follow" | "free" = "follow";
    private rafId: number | null = null;
    private hasCameraState = false;
    private readonly maxPixelRatio = 1.75;

    private handleResize = () => this.onWindowResize();
    private handleKeyDown = (e: KeyboardEvent) => this.onKeyDown(e);

    constructor(container: HTMLElement) {
        // Initialize Three.js scene
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x87ceeb); // Sky blue background

        // Initialize camera with wider field of view
        this.camera = new THREE.PerspectiveCamera(
            82,
            container.clientWidth / container.clientHeight,
            0.1,
            1000,
        );
        this.camera.position.set(0, 20, 20); // Higher and further back for better overview
        this.camera.lookAt(0, 0, 0);

        // Initialize renderer
        this.renderer = new THREE.WebGLRenderer({
            antialias: true,
            alpha: false,
            stencil: false,
            powerPreference: "high-performance",
        });
        this.renderer.outputColorSpace = THREE.SRGBColorSpace;
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.05;
        this.resizeRenderer(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFShadowMap;
        container.appendChild(this.renderer.domElement);

        // Initialize orbit controls for mouse view control
        this.controls = new OrbitControls(this.camera, this.renderer.domElement);
        this.controls.enableDamping = true;
        this.controls.dampingFactor = 0.05;
        this.controls.minDistance = 3; // Allow closer zoom
        this.controls.maxDistance = 100; // Allow further zoom out for map overview
        this.controls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent going below ground
        this.controls.enabled = false; // Disabled by default in follow mode

        // Initialize timer for time-based animations
        this.timer = new THREE.Timer();
        this.timer.connect(document);

        // Initialize input manager
        this.inputManager = new InputManager();

        // Initialize map
        this.mapBuilder = new MapBuilder(this.scene);
        this.mapBuilder.buildMap();
        this.cameraOccluders = this.mapBuilder.getTerrainObjects().filter((object) => (
            object !== this.mapBuilder.getGroundMesh() &&
            object !== this.mapBuilder.getTrackMesh() &&
            object.userData.nonCollidable !== true
        ));

        // Initialize car
        this.carController = new CarController(
            this.scene,
            this.inputManager,
            this.mapBuilder,
        );

        // Add lights
        this.setupLights();

        this.updateCameraFollow(1 / 60);
        this.renderer.render(this.scene, this.camera);

        // Handle window resize
        window.addEventListener("resize", this.handleResize);

        // Handle camera mode toggle
        window.addEventListener("keydown", this.handleKeyDown);
    }

    private onKeyDown(event: KeyboardEvent): void {
        if (event.repeat) return;

        // Toggle camera mode with 'C' key
        if (event.key === "c" || event.key === "C") {
            this.toggleCameraMode();
        }
    }

    private toggleCameraMode(): void {
        this.cameraMode = this.cameraMode === "follow" ? "free" : "follow";
        this.controls.enabled = this.cameraMode === "free";

        // When switching to free mode, set the camera target to the car's position
        if (this.cameraMode === "free") {
            const carPosition = this.carController.getPosition();
            this.controls.target.copy(carPosition);
        }

        // Reset camera position when switching to follow mode
        if (this.cameraMode === "follow") {
            const carPosition = this.carController.getPosition();
            const carDirection = this.carController.getDirection();

            this._cameraTarget.set(
                carPosition.x - carDirection.x * 10,
                carPosition.y + 8,
                carPosition.z - carDirection.z * 10,
            );

            this.camera.position.copy(this._cameraTarget);
            this.camera.lookAt(carPosition);
            this.hasCameraState = false;
        }
    }

    private setupLights(): void {
        // Ambient light
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Increased ambient light
        this.scene.add(ambientLight);
        this.lights.push(ambientLight);

        // Directional light (sun)
        const directionalLight = new THREE.DirectionalLight(0xffffff, 1.15);
        directionalLight.position.set(50, 100, 75); // Positioned further away for larger map
        directionalLight.castShadow = true;

        // Configure shadow properties for larger map
        directionalLight.shadow.mapSize.width = 4096;
        directionalLight.shadow.mapSize.height = 4096;
        directionalLight.shadow.bias = -0.00005;
        directionalLight.shadow.normalBias = 0.08;
        directionalLight.shadow.camera.near = 0.5;
        directionalLight.shadow.camera.far = 500;
        directionalLight.shadow.camera.left = -100;
        directionalLight.shadow.camera.right = 100;
        directionalLight.shadow.camera.top = 100;
        directionalLight.shadow.camera.bottom = -100;

        this.scene.add(directionalLight);
        this.lights.push(directionalLight);

        // Add a hemisphere light for better ambient lighting
        const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.7); // Sky color, ground color
        this.scene.add(hemisphereLight);
        this.lights.push(hemisphereLight);
    }

    private onWindowResize(): void {
        const container = this.renderer.domElement.parentElement;
        if (!container) return;

        const width = Math.max(1, container.clientWidth);
        const height = Math.max(1, container.clientHeight);

        this.camera.aspect = width / height;
        this.camera.updateProjectionMatrix();
        this.resizeRenderer(width, height);
        this.mapBuilder.onResize(width, height);
    }

    private resizeRenderer(width: number, height: number): void {
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.maxPixelRatio));
        this.renderer.setSize(Math.max(1, width), Math.max(1, height));
    }

    public start(): void {
        if (this.isRunning) return;

        this.isRunning = true;
        this.timer.reset();
        this.rafId = requestAnimationFrame(this.animate);
    }

    private animate = (timestamp?: number): void => {
        if (!this.isRunning) return;

        this.rafId = requestAnimationFrame(this.animate);

        this.timer.update(timestamp);
        const deltaTime = THREE.MathUtils.clamp(this.timer.getDelta(), 0, 0.05);
        const elapsedTime = this.timer.getElapsed();

        // Update car physics and controls
        this.carController.update(deltaTime);

        // Update shader uniforms
        this.mapBuilder.updateShaderTime(elapsedTime);

        // Update camera to follow car if in follow mode
        if (this.cameraMode === "follow") {
            this.updateCameraFollow(deltaTime);
        } else if (this.cameraMode === "free") {
            // In free mode, update the orbit controls target to follow the car
            const carPosition = this.carController.getPositionRef();
            const targetBlend = 1 - Math.exp(-4 * deltaTime);
            this.controls.target.lerp(carPosition, targetBlend);
            this.controls.update();
        }

        // Render scene
        this.renderer.render(this.scene, this.camera);
    }

    private readonly _cameraTarget = new THREE.Vector3();
    private readonly _cameraResolvedTarget = new THREE.Vector3();
    private readonly _cameraLookAt = new THREE.Vector3();
    private readonly _cameraLookAtCurrent = new THREE.Vector3();
    private readonly _cameraRaycaster = new THREE.Raycaster();
    private readonly _cameraRayDirection = new THREE.Vector3();
    private readonly _cameraHits: THREE.Intersection[] = [];

    private updateCameraFollow(deltaTime: number): void {
        const carPosition = this.carController.getPositionRef();
        const carDirection = this.carController.getDirectionRef();
        const speedNorm = Math.min(1, this.carController.getSpeed() / 28);
        const portraitFactor = THREE.MathUtils.clamp((0.85 - this.camera.aspect) / 0.4, 0, 1);
        const distance = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(7, 11, speedNorm),
            THREE.MathUtils.lerp(6, 9, speedNorm),
            portraitFactor,
        );
        const height = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(11, 13, speedNorm),
            THREE.MathUtils.lerp(14, 16, speedNorm),
            portraitFactor,
        );
        const lookAhead = THREE.MathUtils.lerp(
            THREE.MathUtils.lerp(1, 4, speedNorm),
            THREE.MathUtils.lerp(0.5, 2.5, speedNorm),
            portraitFactor,
        );
        const lookHeight = THREE.MathUtils.lerp(0.45, 0.25, portraitFactor);

        // Position camera behind and above the car
        this._cameraTarget.set(
            carPosition.x - carDirection.x * distance,
            carPosition.y + height,
            carPosition.z - carDirection.z * distance,
        );
        this._cameraLookAt.set(
            carPosition.x + carDirection.x * lookAhead,
            carPosition.y + lookHeight,
            carPosition.z + carDirection.z * lookAhead,
        );
        this._cameraResolvedTarget.copy(this._cameraTarget);
        this.resolveCameraOcclusion(this._cameraLookAt, this._cameraResolvedTarget);

        if (!this.hasCameraState) {
            this.camera.position.copy(this._cameraResolvedTarget);
            this._cameraLookAtCurrent.copy(this._cameraLookAt);
            this.hasCameraState = true;
        }

        // Smoothly interpolate camera position
        const positionBlend = 1 - Math.exp(-5 * deltaTime);
        const lookBlend = 1 - Math.exp(-7 * deltaTime);
        this.camera.position.lerp(this._cameraResolvedTarget, positionBlend);
        this._cameraLookAtCurrent.lerp(this._cameraLookAt, lookBlend);
        this.camera.lookAt(this._cameraLookAtCurrent);
    }

    private resolveCameraOcclusion(origin: THREE.Vector3, target: THREE.Vector3): void {
        if (this.cameraOccluders.length === 0) return;

        this._cameraRayDirection.subVectors(target, origin);
        const desiredDistance = this._cameraRayDirection.length();
        if (desiredDistance < 0.001) return;

        this._cameraRayDirection.divideScalar(desiredDistance);
        this._cameraRaycaster.set(origin, this._cameraRayDirection);
        this._cameraRaycaster.near = 1.5;
        this._cameraRaycaster.far = desiredDistance;
        this._cameraRaycaster.intersectObjects(this.cameraOccluders, true, this._cameraHits);

        if (this._cameraHits.length > 0) {
            const safeDistance = Math.max(3.5, this._cameraHits[0].distance - 0.6);
            target.copy(origin).addScaledVector(this._cameraRayDirection, safeDistance);
        }

        this._cameraHits.length = 0;
    }

    public dispose(): void {
        this.isRunning = false;

        if (this.rafId != null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }

        // Remove event listeners
        window.removeEventListener("resize", this.handleResize);
        window.removeEventListener("keydown", this.handleKeyDown);
        this.inputManager.dispose();

        // Dispose of car controller resources
        this.carController.dispose();

        // Dispose Three.js resources
        this.mapBuilder.dispose();
        this.cameraOccluders.length = 0;
        for (const light of this.lights) {
            this.scene.remove(light);
            light.dispose();
        }
        this.lights.length = 0;
        this.controls.dispose();
        this.timer.dispose();
        this.renderer.dispose();

        // Remove canvas from DOM
        const canvas = this.renderer.domElement;
        canvas.parentElement?.removeChild(canvas);
    }
}
