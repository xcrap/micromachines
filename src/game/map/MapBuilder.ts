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
    // Create a larger, more complex track
    this.trackPath.moveTo(0, 0);

    // Create a larger track with more curves and features
    this.trackPath.bezierCurveTo(20, -20, 30, -30, 0, -40);
    this.trackPath.bezierCurveTo(-30, -50, -40, -30, 0, -20);
    this.trackPath.bezierCurveTo(20, -10, 40, 10, 20, 30);
    this.trackPath.bezierCurveTo(0, 50, -30, 40, -40, 20);
    this.trackPath.bezierCurveTo(-50, 0, -30, -10, 0, 0);
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

    // Add track markings
    this.addTrackMarkings();

    // Add tire marks and dirt details to make the track look more used
    this.addTrackDetails();
  }

  private addTrackDetails(): void {
    if (!this.trackMesh) return;

    // Add random tire marks and dirt patches along the track
    const trackPoints = this.trackPath.getPoints(100);

    // Create tire marks
    for (let i = 0; i < 50; i++) {
      // Pick a random point along the track
      const pointIndex = Math.floor(Math.random() * trackPoints.length);
      const point = trackPoints[pointIndex];

      // Random offset from center of track
      const offset = (Math.random() - 0.5) * this.trackWidth * 0.7;

      // Create a tire mark (dark streak)
      const markWidth = 0.1 + Math.random() * 0.2;
      const markLength = 1 + Math.random() * 3;

      const markGeometry = new THREE.PlaneGeometry(markWidth, markLength);
      const markMaterial = new THREE.MeshStandardMaterial({
        color: 0x333333,
        transparent: true,
        opacity: 0.3 + Math.random() * 0.3,
        roughness: 0.9
      });

      const mark = new THREE.Mesh(markGeometry, markMaterial);

      // Position and rotate the mark
      mark.position.set(point.x + offset, 0.002, point.y);
      mark.rotation.x = -Math.PI / 2;
      mark.rotation.z = Math.random() * Math.PI * 2;

      this.scene.add(mark);
    }

    // Add dirt piles at track edges
    for (let i = 0; i < 80; i++) {
      // Pick a random point along the track
      const pointIndex = Math.floor(Math.random() * trackPoints.length);
      const point = trackPoints[pointIndex];

      // Position at track edge
      const edgeOffset = (this.trackWidth / 2) * (Math.random() > 0.5 ? 1 : -1);
      const inwardOffset = Math.random() * 0.5; // Pull slightly inward from edge

      // Create a small dirt pile
      const pileRadius = 0.2 + Math.random() * 0.4;
      const pileHeight = 0.05 + Math.random() * 0.1;

      const pileGeometry = new THREE.SphereGeometry(pileRadius, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
      const pileMaterial = new THREE.MeshStandardMaterial({
        color: 0x8B4513, // Match track color
        roughness: 1.0
      });

      const pile = new THREE.Mesh(pileGeometry, pileMaterial);

      // Position the pile at track edge
      pile.position.set(
        point.x + (edgeOffset - inwardOffset * Math.sign(edgeOffset)),
        0,
        point.y
      );

      pile.scale.y = pileHeight / pileRadius;
      pile.receiveShadow = true;

      this.scene.add(pile);
      this.terrainObjects.push(pile);
    }
  }

  private createHills(): void {
    // Create larger hills that the car can drive over
    for (let i = 0; i < 15; i++) {
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

      hill.position.set(
        Math.cos(angle) * distance,
        0,
        Math.sin(angle) * distance
      );

      hill.scale.y = height;
      hill.receiveShadow = true;
      hill.castShadow = true;

      this.scene.add(hill);

      // Add hill to terrain objects for raycasting
      this.terrainObjects.push(hill);
    }
  }

  private addTrackMarkings(): void {
    if (!this.trackMesh) return;

    // Create a smaller shape for the center line
    const lineShape = this.trackPath.clone();

    // Create dashed line geometry
    const points = lineShape.getPoints(200);
    const dashGeometry = new THREE.BufferGeometry();

    // Create dashed line effect by using only some of the points
    const dashPoints: THREE.Vector3[] = [];
    for (let i = 0; i < points.length; i++) {
      // Add point only for every other segment to create dashed effect
      if (i % 8 < 4) {
        dashPoints.push(new THREE.Vector3(points[i].x, 0.002, points[i].y));
      }
    }

    dashGeometry.setFromPoints(dashPoints);

    // Create line material
    const lineMaterial = new THREE.LineBasicMaterial({
      color: 0xffffff,
      opacity: 0.5,
      transparent: true
    });

    // Create line mesh
    const line = new THREE.Line(dashGeometry, lineMaterial);

    this.scene.add(line);
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
    // Create simple trees using cones and cylinders
    for (let i = 0; i < 40; i++) {
      const treeGroup = new THREE.Group();

      // Tree trunk
      const trunkGeometry = new THREE.CylinderGeometry(0.2, 0.3, 1, 8);
      const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b4513, // Brown
        roughness: 0.9
      });
      const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);
      trunk.position.y = 0.5;
      trunk.castShadow = true;
      trunk.receiveShadow = true;
      treeGroup.add(trunk);

      // Tree top
      const topGeometry = new THREE.ConeGeometry(1, 2, 8);
      const topMaterial = new THREE.MeshStandardMaterial({
        color: 0x228b22, // Forest green
        roughness: 0.8
      });
      const top = new THREE.Mesh(topGeometry, topMaterial);
      top.position.y = 2;
      top.castShadow = true;
      top.receiveShadow = true;
      treeGroup.add(top);

      // Position trees randomly but away from the track
      const distance = 40 + Math.random() * 60;
      const angle = Math.random() * Math.PI * 2;

      treeGroup.position.set(
        Math.cos(angle) * distance,
        0,
        Math.sin(angle) * distance
      );

      this.scene.add(treeGroup);
    }
  }

  private addRocks(): void {
    // Create rocks using irregular geometries
    for (let i = 0; i < 30; i++) {
      const rockGeometry = new THREE.DodecahedronGeometry(0.5 + Math.random() * 1.5, 0);
      const rockMaterial = new THREE.MeshStandardMaterial({
        color: 0x808080, // Gray
        roughness: 0.9,
        metalness: 0.1
      });

      const rock = new THREE.Mesh(rockGeometry, rockMaterial);

      // Deform rock to make it look more natural
      const positionAttribute = rockGeometry.getAttribute('position');
      const vertex = new THREE.Vector3();

      for (let j = 0; j < positionAttribute.count; j++) {
        vertex.fromBufferAttribute(positionAttribute, j);

        vertex.x += (Math.random() - 0.5) * 0.2;
        vertex.y += (Math.random() - 0.5) * 0.2;
        vertex.z += (Math.random() - 0.5) * 0.2;

        positionAttribute.setXYZ(j, vertex.x, vertex.y, vertex.z);
      }

      rockGeometry.computeVertexNormals();

      // Position rocks randomly
      const distance = 20 + Math.random() * 70;
      const angle = Math.random() * Math.PI * 2;

      rock.position.set(
        Math.cos(angle) * distance,
        0.25,
        Math.sin(angle) * distance
      );

      // Random rotation and scale
      rock.rotation.set(
        Math.random() * Math.PI,
        Math.random() * Math.PI,
        Math.random() * Math.PI
      );

      const scale = 0.5 + Math.random() * 2;
      rock.scale.set(scale, scale * 0.8, scale);

      rock.castShadow = true;
      rock.receiveShadow = true;

      this.scene.add(rock);

      // Add rock to terrain objects for raycasting
      this.terrainObjects.push(rock);
    }
  }

  private addFinishLine(): void {
    // Create a finish line near the start of the track
    const finishGeometry = new THREE.PlaneGeometry(this.trackWidth - 1, 2);
    const finishMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.5,
      metalness: 0.2
    });

    // Create checkerboard pattern
    const textureSize = 8;
    const data = new Uint8Array(textureSize * textureSize * 3);

    for (let i = 0; i < textureSize; i++) {
      for (let j = 0; j < textureSize; j++) {
        const index = (i * textureSize + j) * 3;
        const isWhite = (i + j) % 2 === 0;

        data[index] = isWhite ? 255 : 0;
        data[index + 1] = isWhite ? 255 : 0;
        data[index + 2] = isWhite ? 255 : 0;
      }
    }

    const texture = new THREE.DataTexture(data, textureSize, textureSize, THREE.RGBAFormat);
    texture.needsUpdate = true;

    finishMaterial.map = texture;

    const finishLine = new THREE.Mesh(finishGeometry, finishMaterial);
    finishLine.rotation.x = -Math.PI / 2;
    finishLine.position.set(0, 0.002, 0); // Just above ground to prevent z-fighting
    finishLine.receiveShadow = true;

    this.scene.add(finishLine);
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

    // Check if the point is within the track width
    return minDistance <= this.trackWidth;
  }

  // Get all terrain objects for raycasting
  public getTerrainObjects(): THREE.Object3D[] {
    return this.terrainObjects;
  }
}