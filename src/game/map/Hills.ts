import * as THREE from 'three';

export function createHills(
    scene: THREE.Scene,
    terrainObjects: THREE.Object3D[],
    isPointOnTrack: (x: number, z: number) => boolean,
    groundMesh: THREE.Mesh
): THREE.Group[] {
    const hills: THREE.Group[] = [];
    let attempts = 0;
    let hillsCreated = 0;
    const maxAttempts = 300;

    // Get the height function
    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    // Define the map boundary to ensure hills are placed within the ground mesh
    const mapRadius = 90; // Reduced from ground size of 200 (100 radius) to ensure hills fit completely

    while (hillsCreated < 15 && attempts < maxAttempts) {
        const radius = 6 + Math.random() * 12;
        const height = 1 + Math.random() * 3;

        // Position hills with distance that ensures they're within map boundaries
        // Account for hill radius to prevent edge placement
        const maxDistance = mapRadius - radius;
        const distance = 40 + Math.random() * (maxDistance - 40);
        const angle = Math.random() * Math.PI * 2;

        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        // Track collision detection
        let isValidPosition = true;

        // Check multiple points around and within the hill's radius
        const checkPoints = 12;
        const checkRadii = [radius * 1.2, radius * 0.8, radius * 0.4];

        for (const checkRadius of checkRadii) {
            for (let i = 0; i < checkPoints; i++) {
                const checkAngle = (i / checkPoints) * Math.PI * 2;
                const checkX = x + Math.cos(checkAngle) * checkRadius;
                const checkZ = z + Math.sin(checkAngle) * checkRadius;

                // Verify point is within map boundaries
                const distanceFromCenter = Math.sqrt(checkX * checkX + checkZ * checkZ);
                if (distanceFromCenter > mapRadius) {
                    isValidPosition = false;
                    break;
                }

                if (isPointOnTrack(checkX, checkZ)) {
                    isValidPosition = false;
                    break;
                }
            }
            if (!isValidPosition) break;
        }

        // Additional center point check
        if (isValidPosition && isPointOnTrack(x, z)) {
            isValidPosition = false;
        }

        // Check distance from other hills to prevent overlap
        if (isValidPosition) {
            for (const existingHill of hills) {
                const existingPos = existingHill.position;
                const dist = Math.sqrt(
                    (existingPos.x - x) ** 2 +
                    (existingPos.z - z) ** 2
                );

                if (dist < radius + (existingHill.userData as { radius: number }).radius + 3) {
                    isValidPosition = false;
                    break;
                }
            }
        }

        if (isValidPosition) {
            // Create a hill group that will hold multiple meshes
            const hillGroup = new THREE.Group();

            // Get the base height at the center
            const baseHeight = getHeightAt(x, z);

            // Create the main hill as a custom mesh with displaced bottom vertices
            const segments = 24; // Higher resolution for better ground conformity
            const hillGeometry = new THREE.SphereGeometry(radius, segments, segments / 2, 0, Math.PI * 2, 0, Math.PI / 2);

            // Displace the bottom vertices to match terrain
            const positionAttribute = hillGeometry.getAttribute('position');
            const vertex = new THREE.Vector3();

            for (let i = 0; i < positionAttribute.count; i++) {
                vertex.fromBufferAttribute(positionAttribute, i);

                // If this is a bottom vertex (y close to 0)
                if (Math.abs(vertex.y) < 0.01) {
                    // Calculate world position of this vertex
                    const worldX = x + vertex.x;
                    const worldZ = z + vertex.z;

                    // Get height at this world position
                    const vertexHeight = getHeightAt(worldX, worldZ);

                    // Adjust the vertex y position to follow the terrain
                    // Convert from world height to local height relative to base
                    vertex.y = (vertexHeight - baseHeight) / height;
                }

                positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
            }

            hillGeometry.computeVertexNormals();

            const hillMaterial = new THREE.MeshStandardMaterial({
                color: 0x2e8b57,
                roughness: 0.9,
                metalness: 0.1,
            });

            const hillMesh = new THREE.Mesh(hillGeometry, hillMaterial);
            hillMesh.castShadow = true;
            hillMesh.receiveShadow = true;

            // Position the hill correctly
            hillGroup.position.set(x, baseHeight, z);

            // Scale for height
            hillGroup.scale.set(1, height, 1);

            // Rotate for variety
            hillGroup.rotation.y = Math.random() * Math.PI * 2;

            // Add the hill mesh to the group
            hillGroup.add(hillMesh);

            // Store metadata
            hillGroup.userData = { radius: radius };

            scene.add(hillGroup);
            terrainObjects.push(hillGroup);
            hills.push(hillGroup);
            hillsCreated++;
        }

        attempts++;
    }

    return hills;
}
