import * as THREE from 'three';

export class MapBuilder {
  private scene: THREE.Scene;
  private trackMesh: THREE.Mesh | null = null;
  private trackPath: THREE.Shape;
  private trackWidth: number = 10; // Increased track width
  private terrainObjects: THREE.Object3D[] = [];
  private groundMesh: THREE.Mesh | null = null;
  private trackPoints: THREE.Vector2[] = [];

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.trackPath = new THREE.Shape();
    this.initializeTrackPath();
  }

  private initializeTrackPath(): void {
    // Create a larger, more complex track with smoother curves
    this.trackPath.moveTo(0, 0);

    // Create a larger track with more natural curves and features
    this.trackPath.bezierCurveTo(30, 0, 40, -20, 40, -40);
    this.trackPath.bezierCurveTo(40, -60, 20, -70, 0, -60);
    this.trackPath.bezierCurveTo(-20, -50, -40, -20, -40, 0);
    this.trackPath.bezierCurveTo(-40, 20, -20, 40, 0, 40);
    this.trackPath.bezierCurveTo(20, 40, 30, 20, 0, 0);
  }

  public buildMap(): void {
    this.createGround();
    this.createTrack();
    this.addDecorations();
  }

  private createGround(): void {
    // Create a larger ground with more subtle terrain variations
    const groundSize = 200; // Doubled ground size
    const groundSegments = 150; // More segments for better detail
    const groundGeometry = new THREE.PlaneGeometry(
      groundSize,
      groundSize,
      groundSegments,
      groundSegments
    );

    // Add some random height variations to create a more interesting terrain
    const positionAttribute = groundGeometry.getAttribute('position');
    const vertex = new THREE.Vector3();

    for (let i = 0; i < positionAttribute.count; i++) {
      vertex.fromBufferAttribute(positionAttribute, i);

      // Skip modifying the edges of the terrain to avoid sharp drops
      const distanceFromCenter = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
      const edgeFactor = Math.min(1, Math.max(0, 1 - (distanceFromCenter / (groundSize * 0.5))));

      // Add some noise-based height variations
      if (distanceFromCenter > 10) { // Don't modify the center area where the track starts
        const noise = Math.sin(vertex.x * 0.05) * Math.cos(vertex.z * 0.05) * 0.8;
        vertex.y += noise * edgeFactor;
      }

      positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
      color: 0x22c55e, // Forest green for natural ground
      roughness: 0.9,
      metalness: 0.1
    });

    this.groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    this.groundMesh.rotation.x = -Math.PI / 2;
    this.groundMesh.receiveShadow = true;
    this.scene.add(this.groundMesh);

    // Add ground to terrain objects for raycasting
    this.terrainObjects.push(this.groundMesh);
  }

  private createTrack(): void {
    // Create a flat dirt track using a path extruded with minimal height
    this.trackPoints = this.trackPath.getPoints(200); // Store track points for later use

    // Create a flat track by using a ribbon of triangles along the path
    const trackVertices = [];
    const trackUVs = [];
    const trackIndices = [];

    // Create vertices for the track (a flat ribbon along the path)
    for (let i = 0; i < this.trackPoints.length; i++) {
      const point = this.trackPoints[i];
      const nextPoint = this.trackPoints[(i + 1) % this.trackPoints.length];

      // Calculate direction vector
      const dirX = nextPoint.x - point.x;
      const dirY = nextPoint.y - point.y;
      const length = Math.sqrt(dirX * dirX + dirY * dirY);

      // Normalize direction
      const normDirX = dirX / length;
      const normDirY = dirY / length;

      // Calculate perpendicular vector
      const perpX = -normDirY;
      const perpY = normDirX;

      // Create vertices on both sides of the path
      const halfWidth = this.trackWidth / 2;

      // Left side vertex
      trackVertices.push(
        point.x + perpX * halfWidth,
        0.01, // Increased height to prevent z-fighting at distance
        point.y + perpY * halfWidth
      );

      // Right side vertex
      trackVertices.push(
        point.x - perpX * halfWidth,
        0.01,
        point.y - perpY * halfWidth
      );

      // UVs for texture mapping
      trackUVs.push(0, i / this.trackPoints.length);
      trackUVs.push(1, i / this.trackPoints.length);

      // Create triangles (two per segment)
      if (i < this.trackPoints.length - 1) {
        const vertexIndex = i * 2;

        // First triangle
        trackIndices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);

        // Second triangle
        trackIndices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
      }
    }

    // Create the track geometry
    const trackGeometry = new THREE.BufferGeometry();
    trackGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trackVertices, 3));
    trackGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(trackUVs, 2));
    trackGeometry.setIndex(trackIndices);
    trackGeometry.computeVertexNormals();

    // Create dirt track texture
    const dirtTexture = {
      color: 0x8B4513, // Saddle brown
      roughness: 1.0,
      metalness: 0.0,
      bumpScale: 0.02
    };

    // Create track material with a dirt-like appearance and improved depth handling
    const trackMaterial = new THREE.MeshStandardMaterial({
      color: dirtTexture.color,
      roughness: dirtTexture.roughness,
      metalness: dirtTexture.metalness,
      side: THREE.DoubleSide,
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1
    });

    // Create track mesh
    this.trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
    this.trackMesh.receiveShadow = true;
    this.trackMesh.castShadow = false; // Flat track doesn't need to cast shadows
    this.scene.add(this.trackMesh);

    // Add track to terrain objects for raycasting
    this.terrainObjects.push(this.trackMesh);

  }



  private createHills(): void {
    // Create larger hills that the car can drive over
    let attempts = 0;
    let hillsCreated = 0;
    const maxAttempts = 100; // Prevent infinite loops

    while (hillsCreated < 15 && attempts < maxAttempts) {
      const radius = 8 + Math.random() * 15;
      const height = 1 + Math.random() * 4;

      const hillGeometry = new THREE.SphereGeometry(radius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
      const hillMaterial = new THREE.MeshStandardMaterial({
        color: 0x355E3B, // Match ground color
        roughness: 0.9,
        metalness: 0.1
      });

      const hill = new THREE.Mesh(hillGeometry, hillMaterial);

      // Position hills randomly but away from the center
      const distance = 30 + Math.random() * 60;
      const angle = Math.random() * Math.PI * 2;

      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;

      // Check if any part of the hill would intersect with the track
      // Consider the hill's radius when checking for track intersection
      let isValidPosition = true;
      const checkPoints = 8; // Number of points to check around the hill's perimeter
      for (let i = 0; i < checkPoints; i++) {
        const checkAngle = (i / checkPoints) * Math.PI * 2;
        const checkX = x + Math.cos(checkAngle) * radius;
        const checkZ = z + Math.sin(checkAngle) * radius;
        if (this.isPointOnTrack(checkX, checkZ)) {
          isValidPosition = false;
          break;
        }
      }

      if (isValidPosition) {
        hill.position.set(x, 0, z);
        hill.scale.y = height;
        hill.receiveShadow = true;
        hill.castShadow = true;

        this.scene.add(hill);
        this.terrainObjects.push(hill);
        hillsCreated++;
      }

      attempts++;
    }
  }



  private addDecorations(): void {
    // Add finish line
    this.addFinishLine();

    // Add trees
    this.addTrees();

    // Add rocks
    this.addRocks();

    // Create Hills
    this.createHills();
  }

  private addTrees(): void {
    const treeCount = 50;
    let treesCreated = 0;
    let attempts = 0;
    const maxAttempts = 200;

    while (treesCreated < treeCount && attempts < maxAttempts) {
      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 2, 8);
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513,
        roughness: 0.9,
        metalness: 0.1
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);

      // Tree top (cone)
      const topGeometry = new THREE.ConeGeometry(2, 4, 8);
      const topMaterial = new THREE.MeshStandardMaterial({
        color: 0x228B22,
        roughness: 0.8,
        metalness: 0.1
      });
      const top = new THREE.Mesh(topGeometry, topMaterial);
      top.position.y = 3;

      // Create tree group
      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(top);

      // Position trees randomly but away from track
      const distance = 30 + Math.random() * 70;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;

      if (!this.isPointOnTrack(x, z)) {
        tree.position.set(x, 0, z);
        tree.scale.set(
          0.8 + Math.random() * 0.4,
          0.8 + Math.random() * 0.4,
          0.8 + Math.random() * 0.4
        );
        tree.rotation.y = Math.random() * Math.PI * 2;
        tree.castShadow = true;
        tree.receiveShadow = true;

        this.scene.add(tree);
        this.terrainObjects.push(tree);
        treesCreated++;
      }
      attempts++;
    }
  }

  private addRocks(): void {
    const rockCount = 30;
    let rocksCreated = 0;
    let attempts = 0;
    const maxAttempts = 150;

    while (rocksCreated < rockCount && attempts < maxAttempts) {
      const rockGeometry = new THREE.DodecahedronGeometry(1 + Math.random());
      const rockMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080,
        roughness: 0.9,
        metalness: 0.2
      });

      const rock = new THREE.Mesh(rockGeometry, rockMaterial);

      // Position rocks randomly but away from track
      const distance = 25 + Math.random() * 75;
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * distance;
      const z = Math.sin(angle) * distance;

      if (!this.isPointOnTrack(x, z)) {
        rock.position.set(x, 0, z);
        rock.scale.set(
          0.5 + Math.random() * 1.5,
          0.5 + Math.random() * 1.5,
          0.5 + Math.random() * 1.5
        );
        rock.rotation.set(
          Math.random() * Math.PI,
          Math.random() * Math.PI,
          Math.random() * Math.PI
        );
        rock.castShadow = true;
        rock.receiveShadow = true;

        this.scene.add(rock);
        this.terrainObjects.push(rock);
        rocksCreated++;
      }
      attempts++;
    }
  }



  private addFinishLine(): void {
    // Create finish line markers
    const markerHeight = 5;
    const markerWidth = this.trackWidth * 1.2;
    const markerDepth = 0.3;

    // Create two pillars for the finish line
    const pillarGeometry = new THREE.BoxGeometry(markerDepth, markerHeight, markerDepth);
    const pillarMaterial = new THREE.MeshStandardMaterial({
      color: 0xFFFFFF, // White color
      roughness: 0.7,
      metalness: 0.3
    });

    // Left pillar
    const leftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    leftPillar.position.set(-markerWidth / 2, markerHeight / 2, 0);

    // Right pillar
    const rightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    rightPillar.position.set(markerWidth / 2, markerHeight / 2, 0);

    // Top banner
    const bannerGeometry = new THREE.BoxGeometry(markerWidth, markerDepth * 2, markerDepth);
    const bannerMaterial = new THREE.MeshStandardMaterial({
      color: 0xFF0000, // Red color
      roughness: 0.7,
      metalness: 0.3
    });

    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.position.set(0, markerHeight, 0);

    // Create finish line group
    const finishLine = new THREE.Group();
    finishLine.add(leftPillar);
    finishLine.add(rightPillar);
    finishLine.add(banner);

    // Position at the start of the track
    finishLine.position.set(0, 0, -this.trackWidth / 2);
    finishLine.castShadow = true;
    finishLine.receiveShadow = true;

    this.scene.add(finishLine);
    this.terrainObjects.push(finishLine);
  }
  // Method to check if a point is on the track
  public isPointOnTrack(x: number, z: number): boolean {
    // Use stored track points for efficient checking
    let minDistance = Infinity;

    for (const point of this.trackPoints) {
      const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - z, 2));
      if (distance < minDistance) {
        minDistance = distance;
      }
    }

    // Add a buffer to prevent objects from being too close to the track
    const bufferWidth = this.trackWidth * 1.2;
    return minDistance <= bufferWidth;
  }

  // Get all terrain objects for raycasting
  public getTerrainObjects(): THREE.Object3D[] {
    return this.terrainObjects;
  }
}