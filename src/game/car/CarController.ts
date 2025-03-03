import * as THREE from 'three';
import { InputManager } from '../input/InputManager';
import { CarModel } from './CarModel';
import { CarPhysics } from './CarPhysics';
import { MapBuilder } from '../map/MapBuilder';

export class CarController {
  private carModel: CarModel;
  private carPhysics: CarPhysics;
  private inputManager: InputManager;
  private position: THREE.Vector3;
  private direction: THREE.Vector3;
  private carGroup: THREE.Group;
  private mapBuilder: MapBuilder;
  private isOnTrack: boolean = true;
  private offTrackSlowdown: number = 0.85; // Reduced slowdown for better off-track driving
  private raycaster: THREE.Raycaster;
  private groundNormal: THREE.Vector3;
  private groundCheckDistance: number = 10; // Increased ray distance for better ground detection

  constructor(scene: THREE.Scene, inputManager: InputManager, mapBuilder: MapBuilder) {
    this.inputManager = inputManager;
    this.mapBuilder = mapBuilder;

    // Create car group to hold all car parts
    this.carGroup = new THREE.Group();
    scene.add(this.carGroup);

    // Initialize car model
    this.carModel = new CarModel(this.carGroup);

    // Initialize car physics
    this.carPhysics = new CarPhysics();

    // Set initial position and direction
    // Position the car slightly behind the start line
    this.position = new THREE.Vector3(0, 0.5, 2);
    this.direction = new THREE.Vector3(0, 0, 1);
    this.groundNormal = new THREE.Vector3(0, 1, 0);

    // Initialize raycaster for terrain detection
    this.raycaster = new THREE.Raycaster();

    // Update car position
    this.updatePosition();
  }

  public update(deltaTime: number): void {
    // Get input values using WASD and arrow keys
    const input = {
      forward: this.inputManager.isKeyPressed('w') || this.inputManager.isKeyPressed('ArrowUp'),
      backward: this.inputManager.isKeyPressed('s') || this.inputManager.isKeyPressed('ArrowDown'),
      left: this.inputManager.isKeyPressed('a') || this.inputManager.isKeyPressed('ArrowLeft'),
      right: this.inputManager.isKeyPressed('d') || this.inputManager.isKeyPressed('ArrowRight'),
      brake: this.inputManager.isKeyPressed(' ') // Space bar
    };

    // Check if car is on track
    this.checkIfOnTrack();

    // Apply off-track physics modifications
    let effectiveDeltaTime = deltaTime;
    if (!this.isOnTrack) {
      // Slow down car when off track by reducing effective delta time
      effectiveDeltaTime *= this.offTrackSlowdown;

      // Make the car visually shake a bit when off track
      this.carGroup.position.y = 0.5 + Math.sin(Date.now() * 0.01) * 0.03;
    } else {
      this.carGroup.position.y = 0.5; // Normal height when on track
    }

    // Update physics based on input
    this.carPhysics.update(effectiveDeltaTime, input, !this.isOnTrack);

    // Apply physics to car position and rotation
    const velocity = this.carPhysics.getVelocity();
    const steeringAngle = this.carPhysics.getSteeringAngle();

    // Update direction vector based on steering
    this.direction.x = Math.sin(this.carGroup.rotation.y);
    this.direction.z = Math.cos(this.carGroup.rotation.y);

    // Calculate new position
    const newPosition = this.position.clone();
    newPosition.x += this.direction.x * velocity * deltaTime;
    newPosition.z += this.direction.z * velocity * deltaTime;

    // Check for collision with map boundaries
    if (this.isPositionValid(newPosition)) {
      this.position.copy(newPosition);
    } else {
      // Bounce back slightly if hitting boundary
      this.carPhysics.reverseVelocity(0.5);
    }

    // Update rotation based on steering
    this.carGroup.rotation.y += steeringAngle * velocity * deltaTime;

    // Update car wheels rotation based on velocity
    this.carModel.updateWheelRotation(velocity * deltaTime);

    // Adjust car to terrain height and angle
    this.adjustToTerrain();

    // Update car position and rotation
    this.updatePosition();
  }

  private adjustToTerrain(): void {
    // Cast a ray downward from the car position to detect terrain
    // Start from higher up to ensure we catch the terrain
    this.raycaster.set(
      new THREE.Vector3(this.position.x, this.groundCheckDistance, this.position.z),
      new THREE.Vector3(0, -1, 0)
    );

    // Get all objects in the scene that might be terrain
    const intersects = this.raycaster.intersectObjects(this.mapBuilder.getTerrainObjects(), true);

    if (intersects.length > 0) {
      // Get the first intersection (closest to the car)
      const intersection = intersects[0];

      // Set car height based on terrain height plus car clearance
      const terrainHeight = intersection.point.y;
      const carClearance = 0.05; // Reduced clearance to keep car closer to ground
      this.position.y = terrainHeight + carClearance;

      // Get the normal of the terrain at the intersection point
      this.groundNormal = intersection.face?.normal.clone() || new THREE.Vector3(0, 1, 0);

      // Transform the normal from local to world coordinates
      if (intersection.object.matrixWorld) {
        const normalMatrix = new THREE.Matrix3().getNormalMatrix(intersection.object.matrixWorld);
        this.groundNormal.applyMatrix3(normalMatrix).normalize();
      }

      // Adjust car rotation to match terrain slope
      if (this.groundNormal.y > 0.5) { // Only adjust if slope is not too steep
        // Calculate rotation to align with ground normal
        const alignmentQuaternion = new THREE.Quaternion();
        const up = new THREE.Vector3(0, 1, 0);
        alignmentQuaternion.setFromUnitVectors(up, this.groundNormal);

        // Preserve the car's y-rotation (steering direction)
        const carYRotation = this.carGroup.rotation.y;

        // Apply the alignment quaternion to the car group
        this.carGroup.quaternion.copy(alignmentQuaternion);

        // Re-apply the car's y-rotation
        this.carGroup.rotation.y = carYRotation;
      }
    } else {
      // If no terrain is found, set a default height
      // This should rarely happen with the increased ray distance
      this.position.y = 0.05; // Reduced default height
    }
  }

  private isPositionValid(position: THREE.Vector3): boolean {
    // Check if position is within map boundaries
    const mapRadius = 100; // Increased for larger map
    return (
      position.x >= -mapRadius &&
      position.x <= mapRadius &&
      position.z >= -mapRadius &&
      position.z <= mapRadius
    );
  }

  private checkIfOnTrack(): void {
    // Check if car is on the track
    this.isOnTrack = this.mapBuilder.isPointOnTrack(this.position.x, this.position.z);
  }

  private updatePosition(): void {
    this.carGroup.position.copy(this.position);
  }

  public getPosition(): THREE.Vector3 {
    return this.position.clone();
  }

  public getDirection(): THREE.Vector3 {
    return this.direction.clone();
  }
}