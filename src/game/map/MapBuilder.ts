import * as THREE from 'three';

export class MapBuilder {
  private scene: THREE.Scene;
  private trackMesh: THREE.Mesh | null = null;
  private trackPath: THREE.Shape;
  private trackWidth: number = 8; // Increased track width
  private terrainObjects: THREE.Object3D[] = [];
  private groundMesh: THREE.Mesh | null = null;

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
    this.createHills();
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
    const trackPoints = this.trackPath.getPoints(200); // More points for smoother track

    // Create a flat track by using a ribbon of triangles along the path
    const trackVertices = [];
    const trackUVs = [];
    const trackIndices = [];

    // Create vertices for the track (a flat ribbon along the path)
    for (let i = 0; i < trackPoints.length; i++) {
      const point = trackPoints[i];
      const nextPoint = trackPoints[(i + 1) % trackPoints.length];

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
        0.001, // Just slightly above ground to prevent z-fighting
        point.y + perpY * halfWidth
      );

      // Right side vertex
      trackVertices.push(
        point.x - perpX * halfWidth,
        0.001,
        point.y - perpY * halfWidth
      );

      // UVs for texture mapping
      trackUVs.push(0, i / trackPoints.length);
      trackUVs.push(1, i / trackPoints.length);

      // Create triangles (two per segment)
      if (i < trackPoints.length - 1) {
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

    // Create track material with a dirt-like appearance
    const trackMaterial = new THREE.MeshStandardMaterial({
      color: dirtTexture.color,
      roughness: dirtTexture.roughness,
      metalness: dirtTexture.metalness,
      side: THREE.DoubleSide
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

      // Check if the hill would intersect with the track
      if (!this.isPointOnTrack(x, z)) {
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

  private addTerrainVariations(): void {
    // Create small bumps and texture variations on the ground
    for (let i = 0; i < 100; i++) {
      const radius = 1 + Math.random() * 4;
      const height = 0.05 + Math.random() * 0.2;

      const bumpGeometry = new THREE.SphereGeometry(radius, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2);
      const bumpMaterial = new THREE.MeshStandardMaterial({
        color: 0x355E3B, // Match ground color
        roughness: 0.9,
        metalness: 0.1
      });

      const bump = new THREE.Mesh(bumpGeometry, bumpMaterial);

      // Position bumps randomly across the terrain
      const distance = Math.random() * 90;
      const angle = Math.random() * Math.PI * 2;

      bump.position.set(
        Math.cos(angle) * distance,
        0.01, // Just above ground
        Math.sin(angle) * distance
      );

      bump.scale.y = height;
      bump.receiveShadow = true;

      this.scene.add(bump);

      // Add bump to terrain objects for raycasting
      this.terrainObjects.push(bump);
    }
  }

  private addDecorations(): void {
    // Add trees
    this.addTrees();

    // Add rocks
    this.addRocks();

    // Add finish line
    this.addFinishLine();

    // Add terrain variations for better ground contact
    this.addTerrainVariations();
  }

  private addTrees(): void {
    // Add trees around the track
    for (let i = 0; i < 30; i++) {
      const treeHeight = 3 + Math.random() * 2;
      const trunkRadius = 0.2 + Math.random() * 0.1;

      // Create tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(trunkRadius, trunkRadius * 1.2, treeHeight, 8);
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x4A2B0F, // Brown color for trunk
        roughness: 0.9,
        metalness: 0.1
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);

      // Create tree top (leaves)
      const leavesGeometry = new THREE.ConeGeometry(treeHeight / 2, treeHeight, 8);
      const leavesMaterial = new THREE.MeshStandardMaterial({
        color: 0x2D5A27, // Dark green for leaves
        roughness: 0.8,
        metalness: 0.1
      });
      const leaves = new THREE.Mesh(leavesGeometry, leavesMaterial);
      leaves.position.y = treeHeight / 2;

      // Create tree group
      const tree = new THREE.Group();
      tree.add(trunk);
      tree.add(leaves);

      // Position tree randomly but away from track
      let validPosition = false;
      let attempts = 0;
      while (!validPosition && attempts < 50) {
        const distance = 40 + Math.random() * 50;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        if (!this.isPointOnTrack(x, z)) {
          tree.position.set(x, 0, z);
          validPosition = true;
        }
        attempts++;
      }

      if (validPosition) {
        tree.castShadow = true;
        tree.receiveShadow = true;
        this.scene.add(tree);
        this.terrainObjects.push(tree);
      }
    }
  }

  private addRocks(): void {
    // Add rocks around the track
    for (let i = 0; i < 20; i++) {
      const rockSize = 1 + Math.random() * 2;

      const rockGeometry = new THREE.DodecahedronGeometry(rockSize, 1);
      const rockMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080, // Gray color for rocks
        roughness: 0.9,
        metalness: 0.2
      });

      const rock = new THREE.Mesh(rockGeometry, rockMaterial);

      // Position rocks randomly but away from track
      let validPosition = false;
      let attempts = 0;
      while (!validPosition && attempts < 50) {
        const distance = 35 + Math.random() * 45;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        if (!this.isPointOnTrack(x, z)) {
          rock.position.set(x, rockSize / 2, z);
          validPosition = true;
        }
        attempts++;
      }

      if (validPosition) {
        // Add some random rotation for variety
        rock.rotation.x = Math.random() * Math.PI;
        rock.rotation.y = Math.random() * Math.PI;
        rock.rotation.z = Math.random() * Math.PI;

        rock.castShadow = true;
        rock.receiveShadow = true;
        this.scene.add(rock);
        this.terrainObjects.push(rock);
      }
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
    // Get track points
    const trackPoints = this.trackPath.getPoints(200);

    // Find the closest point on the track
    let minDistance = Infinity;

    for (const point of trackPoints) {
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