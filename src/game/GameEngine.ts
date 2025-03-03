import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CarController } from './car/CarController';
import { MapBuilder } from './map/MapBuilder';
import { InputManager } from './input/InputManager';

export class GameEngine {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private clock: THREE.Clock;
  private inputManager: InputManager;
  private carController: CarController;
  private mapBuilder: MapBuilder;
  private isRunning: boolean = false;
  private cameraMode: 'follow' | 'free' = 'follow';

  constructor(container: HTMLElement) {
    // Initialize Three.js scene
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb); // Sky blue background
    
    // Initialize camera with wider field of view
    this.camera = new THREE.PerspectiveCamera(
      100, // Even wider FOV for better visibility
      container.clientWidth / container.clientHeight, 
      0.1, 
      1000
    );
    this.camera.position.set(0, 20, 20); // Higher and further back for better overview
    this.camera.lookAt(0, 0, 0);
    
    // Initialize renderer
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setSize(container.clientWidth, container.clientHeight);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    container.appendChild(this.renderer.domElement);
    
    // Initialize orbit controls for mouse view control
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.controls.minDistance = 3;  // Allow closer zoom
    this.controls.maxDistance = 100; // Allow further zoom out for map overview
    this.controls.maxPolarAngle = Math.PI / 2 - 0.1; // Prevent going below ground
    this.controls.enabled = false; // Disabled by default in follow mode
    
    // Initialize clock for time-based animations
    this.clock = new THREE.Clock();
    
    // Initialize input manager
    this.inputManager = new InputManager();
    
    // Initialize map
    this.mapBuilder = new MapBuilder(this.scene);
    this.mapBuilder.buildMap();
    
    // Initialize car
    this.carController = new CarController(this.scene, this.inputManager, this.mapBuilder);
    
    // Add lights
    this.setupLights();
    
    // Handle window resize
    window.addEventListener('resize', this.onWindowResize.bind(this));
    
    // Handle camera mode toggle
    window.addEventListener('keydown', this.onKeyDown.bind(this));
  }

  private onKeyDown(event: KeyboardEvent): void {
    // Toggle camera mode with 'C' key
    if (event.key === 'c' || event.key === 'C') {
      this.toggleCameraMode();
    }
  }

  private toggleCameraMode(): void {
    this.cameraMode = this.cameraMode === 'follow' ? 'free' : 'follow';
    this.controls.enabled = this.cameraMode === 'free';
    
    // When switching to free mode, set the camera target to the car's position
    if (this.cameraMode === 'free') {
      const carPosition = this.carController.getPosition();
      this.controls.target.copy(carPosition);
    }
    
    // Reset camera position when switching to follow mode
    if (this.cameraMode === 'follow') {
      const carPosition = this.carController.getPosition();
      const carDirection = this.carController.getDirection();
      
      const cameraOffset = new THREE.Vector3(
        -carDirection.x * 10, // Further back
        8,                    // Higher up
        -carDirection.z * 10  // Further back
      );
      
      this.camera.position.copy(carPosition.clone().add(cameraOffset));
      this.camera.lookAt(carPosition);
    }
  }

  private setupLights(): void {
    // Ambient light
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Increased ambient light
    this.scene.add(ambientLight);
    
    // Directional light (sun)
    const directionalLight = new THREE.DirectionalLight(0xffffff, 1);
    directionalLight.position.set(50, 100, 75); // Positioned further away for larger map
    directionalLight.castShadow = true;
    
    // Configure shadow properties for larger map
    directionalLight.shadow.mapSize.width = 4096;
    directionalLight.shadow.mapSize.height = 4096;
    directionalLight.shadow.camera.near = 0.5;
    directionalLight.shadow.camera.far = 500;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    
    this.scene.add(directionalLight);
    
    // Add a hemisphere light for better ambient lighting
    const hemisphereLight = new THREE.HemisphereLight(0x87ceeb, 0x8b7355, 0.7); // Sky color, ground color
    this.scene.add(hemisphereLight);
  }

  private onWindowResize(): void {
    const container = this.renderer.domElement.parentElement;
    if (!container) return;
    
    this.camera.aspect = container.clientWidth / container.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(container.clientWidth, container.clientHeight);
  }

  public start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.clock.start();
    this.animate();
  }

  private animate(): void {
    if (!this.isRunning) return;
    
    requestAnimationFrame(this.animate.bind(this));
    
    const deltaTime = this.clock.getDelta();
    
    // Update car physics and controls
    this.carController.update(deltaTime);
    
    // Update camera to follow car if in follow mode
    if (this.cameraMode === 'follow') {
      this.updateCameraFollow();
    } else if (this.cameraMode === 'free') {
      // In free mode, update the orbit controls target to follow the car
      const carPosition = this.carController.getPosition();
      this.controls.target.lerp(carPosition, 0.05);
      this.controls.update();
    }
    
    // Render scene
    this.renderer.render(this.scene, this.camera);
  }

  private updateCameraFollow(): void {
    const carPosition = this.carController.getPosition();
    const carDirection = this.carController.getDirection();
    
    // Position camera behind and above the car
    const cameraOffset = new THREE.Vector3(
      -carDirection.x * 10, // Further back
      8,                    // Higher up
      -carDirection.z * 10  // Further back
    );
    
    const targetCameraPosition = carPosition.clone().add(cameraOffset);
    
    // Smoothly interpolate camera position
    this.camera.position.lerp(targetCameraPosition, 0.05);
    this.camera.lookAt(carPosition);
  }

  public dispose(): void {
    this.isRunning = false;
    
    // Remove event listeners
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    window.removeEventListener('keydown', this.onKeyDown.bind(this));
    this.inputManager.dispose();
    
    // Dispose Three.js resources
    this.renderer.dispose();
    
    // Remove canvas from DOM
    const canvas = this.renderer.domElement;
    canvas.parentElement?.removeChild(canvas);
  }
}