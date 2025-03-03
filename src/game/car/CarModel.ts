import * as THREE from 'three';

export class CarModel {
  private carBody: THREE.Group;
  private wheels: THREE.Mesh[] = [];
  private carGroup: THREE.Group;

  constructor(carGroup: THREE.Group) {
    this.carGroup = carGroup;
    this.carBody = new THREE.Group();
    this.carGroup.add(this.carBody);
    this.createCarModel();
  }

  private createCarModel(): void {
    // Create a classic sports car shape
    this.createMainBody();
    this.createWindshield();
    this.createLights();
    this.createWheels();
  }

  private createMainBody(): void {
    // Create a cute mini car body
    const bodyMaterial = new THREE.MeshStandardMaterial({
      color: 0x4a90e2, // Friendly blue color
      metalness: 0.6,
      roughness: 0.4
    });

    // Main body - create a more rounded shape using multiple segments
    const bodyWidth = 0.9;
    const bodyHeight = 0.4;
    const bodyLength = 1.4; // Shorter length for mini car look

    // Create the main body using a rounded box
    const bodyGeometry = new THREE.BoxGeometry(bodyWidth, bodyHeight, bodyLength, 8, 8, 8);
    const positionAttribute = bodyGeometry.getAttribute('position');
    const vertex = new THREE.Vector3();

    // Apply more aggressive rounding to create a bubble-like shape
    for (let i = 0; i < positionAttribute.count; i++) {
      vertex.fromBufferAttribute(positionAttribute, i);

      // Create a more rounded top
      if (vertex.y > 0) {
        const radius = Math.sqrt(vertex.x * vertex.x + vertex.y * vertex.y);
        const scale = 0.9 - (radius * 0.2);
        vertex.x *= scale;
        vertex.y *= 1.2; // Make it slightly taller
      }

      // Round the front and back
      if (Math.abs(vertex.z) > bodyLength * 0.3) {
        const zScale = 1.0 - (Math.abs(vertex.z) / bodyLength) * 0.3;
        vertex.x *= zScale;
        vertex.y *= zScale;
      }

      positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    bodyGeometry.computeVertexNormals();

    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.y = 0.45; // Slightly higher position
    body.castShadow = true;
    body.receiveShadow = true;
    this.carBody.add(body);

    // Create a more curved hood
    const hoodShape = new THREE.Shape();
    hoodShape.moveTo(-bodyWidth / 2, 0);
    hoodShape.quadraticCurveTo(0, 0.1, bodyWidth / 2, 0);
    const hoodGeometry = new THREE.ExtrudeGeometry(hoodShape, {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.05,
      bevelSegments: 3
    });

    const hood = new THREE.Mesh(hoodGeometry, bodyMaterial);
    hood.position.set(0, 0.4, 0.5);
    hood.rotation.x = -Math.PI * 0.15; // More pronounced slope
    hood.castShadow = true;
    hood.receiveShadow = true;
    this.carBody.add(hood);

    // Create a rounded trunk
    const trunkShape = new THREE.Shape();
    trunkShape.moveTo(-bodyWidth / 2, 0);
    trunkShape.quadraticCurveTo(0, 0.08, bodyWidth / 2, 0);
    const trunkGeometry = new THREE.ExtrudeGeometry(trunkShape, {
      depth: 0.3,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 3
    });

    const trunk = new THREE.Mesh(trunkGeometry, bodyMaterial);
    trunk.position.set(0, 0.4, -0.5);
    trunk.rotation.x = Math.PI * 0.1;
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    this.carBody.add(trunk);

    // Add a curved bottom plate
    const bottomGeometry = new THREE.BoxGeometry(bodyWidth, 0.05, bodyLength);
    const bottomMaterial = new THREE.MeshStandardMaterial({
      color: 0x2c3e50,
      roughness: 0.7
    });
    const bottom = new THREE.Mesh(bottomGeometry, bottomMaterial);
    bottom.position.y = 0.2;
    bottom.castShadow = true;
    bottom.receiveShadow = true;
    this.carBody.add(bottom);
  }

  private createWindshield(): void {
    // Create windshield and windows with a dark tint
    const glassMaterial = new THREE.MeshStandardMaterial({
      color: 0x333333,
      metalness: 0.9,
      roughness: 0.1,
      transparent: true,
      opacity: 0.7
    });

    // Front windshield (angled)
    const frontWindshieldGeometry = new THREE.BoxGeometry(0.85, 0.3, 0.05);
    const frontWindshield = new THREE.Mesh(frontWindshieldGeometry, glassMaterial);
    frontWindshield.position.set(0, 0.6, 0.4);
    frontWindshield.rotation.x = Math.PI / 6; // Angle the windshield
    frontWindshield.castShadow = true;
    this.carBody.add(frontWindshield);

    // Rear windshield (angled)
    const rearWindshieldGeometry = new THREE.BoxGeometry(0.85, 0.3, 0.05);
    const rearWindshield = new THREE.Mesh(rearWindshieldGeometry, glassMaterial);
    rearWindshield.position.set(0, 0.6, -0.4);
    rearWindshield.rotation.x = -Math.PI / 6; // Angle the windshield
    rearWindshield.castShadow = true;
    this.carBody.add(rearWindshield);

    // Side windows
    const sideWindowGeometry = new THREE.BoxGeometry(0.05, 0.2, 0.6);

    // Left side window
    const leftWindow = new THREE.Mesh(sideWindowGeometry, glassMaterial);
    leftWindow.position.set(0.48, 0.55, 0);
    leftWindow.castShadow = true;
    this.carBody.add(leftWindow);

    // Right side window
    const rightWindow = new THREE.Mesh(sideWindowGeometry, glassMaterial);
    rightWindow.position.set(-0.48, 0.55, 0);
    rightWindow.castShadow = true;
    this.carBody.add(rightWindow);
  }

  private createLights(): void {
    // Create headlights
    const headlightGeometry = new THREE.SphereGeometry(0.08, 16, 16);
    const headlightMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xffffcc,
      emissiveIntensity: 0.8
    });

    // Left headlight
    const leftHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    leftHeadlight.position.set(0.3, 0.4, 0.9);
    this.carBody.add(leftHeadlight);

    // Right headlight
    const rightHeadlight = new THREE.Mesh(headlightGeometry, headlightMaterial);
    rightHeadlight.position.set(-0.3, 0.4, 0.9);
    this.carBody.add(rightHeadlight);

    // Create taillights
    const taillightGeometry = new THREE.BoxGeometry(0.15, 0.08, 0.05);
    const taillightMaterial = new THREE.MeshStandardMaterial({
      color: 0xff0000,
      emissive: 0xff0000,
      emissiveIntensity: 0.5
    });

    // Left taillight
    const leftTaillight = new THREE.Mesh(taillightGeometry, taillightMaterial);
    leftTaillight.position.set(0.3, 0.4, -0.9);
    this.carBody.add(leftTaillight);

    // Right taillight
    const rightTaillight = new THREE.Mesh(taillightGeometry, taillightMaterial);
    rightTaillight.position.set(-0.3, 0.4, -0.9);
    this.carBody.add(rightTaillight);
  }

  private createWheels(): void {
    // Create wheels with better proportions
    const wheelRadius = 0.2;
    const wheelThickness = 0.08;

    // Tire geometry and material
    const tireGeometry = new THREE.CylinderGeometry(wheelRadius, wheelRadius, wheelThickness, 24);
    tireGeometry.rotateZ(Math.PI / 2);
    const tireMaterial = new THREE.MeshStandardMaterial({
      color: 0x222222,
      roughness: 0.9,
      metalness: 0.1
    });

    // Rim geometry and material
    const rimRadius = wheelRadius * 0.7;
    const rimGeometry = new THREE.CylinderGeometry(rimRadius, rimRadius, wheelThickness + 0.01, 16);
    rimGeometry.rotateZ(Math.PI / 2);
    const rimMaterial = new THREE.MeshStandardMaterial({
      color: 0xcccccc,
      roughness: 0.2,
      metalness: 0.8
    });

    // Wheel positions
    const wheelPositions = [
      { x: 0.45, y: 0.2, z: 0.6 },  // Front left
      { x: -0.45, y: 0.2, z: 0.6 }, // Front right
      { x: 0.45, y: 0.2, z: -0.6 }, // Rear left
      { x: -0.45, y: 0.2, z: -0.6 } // Rear right
    ];

    // Create wheels with rims
    wheelPositions.forEach(position => {
      // Create tire
      const tire = new THREE.Mesh(tireGeometry, tireMaterial);
      tire.position.set(position.x, position.y, position.z);
      tire.castShadow = true;
      tire.receiveShadow = true;
      this.carGroup.add(tire);
      this.wheels.push(tire);

      // Create rim
      const rim = new THREE.Mesh(rimGeometry, rimMaterial);
      rim.position.set(position.x, position.y, position.z);
      this.carGroup.add(rim);

      // Create simple hub cap
      const hubCapGeometry = new THREE.CircleGeometry(rimRadius * 0.7, 16);
      const hubCapMaterial = new THREE.MeshStandardMaterial({
        color: 0xdddddd,
        roughness: 0.2,
        metalness: 0.9
      });

      const hubCap = new THREE.Mesh(hubCapGeometry, hubCapMaterial);
      hubCap.position.set(position.x + (wheelThickness / 2 + 0.01) * (position.x > 0 ? 1 : -1), position.y, position.z);
      hubCap.rotation.set(0, Math.PI / 2, 0);
      hubCap.rotation.z = position.x > 0 ? 0 : Math.PI;
      this.carGroup.add(hubCap);
    });
  }

  public updateWheelRotation(amount: number): void {
    // Rotate wheels based on car movement
    this.wheels.forEach(wheel => {
      wheel.rotation.x += amount * 10;
    });
  }
}