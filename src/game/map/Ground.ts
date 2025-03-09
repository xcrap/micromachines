import * as THREE from "three";

export function createGround(
    scene: THREE.Scene,
    terrainObjects: THREE.Object3D[],
): THREE.Mesh {
    const groundSize = 200;
    const groundSegments = 150;
    const groundGeometry = new THREE.PlaneGeometry(
        groundSize,
        groundSize,
        groundSegments,
        groundSegments,
    );

    // Modify the geometry to create height variations
    const positionAttribute = groundGeometry.getAttribute("position");
    const vertex = new THREE.Vector3();

    // Create a height map for later use
    const heightMap: Map<string, number> = new Map();

    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);

        // Simple noise function for height variation
        const distance = Math.sqrt(vertex.x * vertex.x + vertex.y * vertex.y);

        // Add some variation to make it look more natural
        let height = Math.sin(vertex.x * 0.05) * Math.cos(vertex.y * 0.05) * 2.0;

        // Add some larger hills
        height += Math.sin(vertex.x * 0.02) * Math.cos(vertex.y * 0.02) * 5.0;

        // Keep the center area relatively flat for the track
        if (distance > 20) {
            vertex.z = height;
        } else {
            // Smoothly transition from flat to varied terrain
            vertex.z = (height * (distance - 10)) / 10;
        }

        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);

        // Store the height for this x,y coordinate for later use
        const key = `${Math.round(vertex.x)},${Math.round(vertex.y)}`;
        heightMap.set(key, vertex.z);
    }

    // Update the geometry
    groundGeometry.computeVertexNormals();

    // Create a material with a nice green color
    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x2e8b57, // Sea green
        roughness: 0.8,
        metalness: 0.2,
        flatShading: false,
    });

    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal
    groundMesh.receiveShadow = true;

    // Define an interface for the mesh with a getHeightAt method
    interface GroundMeshWithHeight extends THREE.Mesh {
        getHeightAt(x: number, z: number): number;
    }

    // Create the ground mesh with height functionality
    const customGroundMesh = groundMesh as unknown as GroundMeshWithHeight;

    // Add a height function to the mesh
    customGroundMesh.getHeightAt = (x: number, z: number): number => {
        // Convert to the coordinate system used in the heightMap
        const key = `${Math.round(x)},${Math.round(z)}`;

        if (heightMap.has(key)) {
            return heightMap.get(key) || 0;
        }

        // Fallback to calculation
        let height = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2.0;
        height += Math.sin(x * 0.02) * Math.cos(z * 0.02) * 5.0;

        const distance = Math.sqrt(x * x + z * z);
        if (distance > 20) {
            return height;
        }
        // Return smoothly transitioned height for center area
        return (height * (distance - 10)) / 10;
    };

    scene.add(groundMesh);
    terrainObjects.push(groundMesh);

    return groundMesh;
}
