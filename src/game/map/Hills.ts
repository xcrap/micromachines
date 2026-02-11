import * as THREE from 'three';

function simpleNoise(x: number, y: number, z: number): number {
    const n = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
    return (n - Math.floor(n)) * 2 - 1;
}

function fbmNoise(x: number, y: number, z: number, octaves: number): number {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let maxValue = 0;
    for (let i = 0; i < octaves; i++) {
        value += simpleNoise(x * frequency, y * frequency, z * frequency) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2.1;
    }
    return value / maxValue;
}

function createHillGeometry(radius: number, seed: number): THREE.BufferGeometry {
    const widthSegments = 28;
    const heightSegments = 14;
    const geometry = new THREE.SphereGeometry(radius, widthSegments, heightSegments, 0, Math.PI * 2, 0, Math.PI / 2);

    const posAttr = geometry.getAttribute('position');
    const vertex = new THREE.Vector3();
    const topColor = new THREE.Color(0x3a9d4f);
    const midColor = new THREE.Color(0x2d7a3a);
    const baseColor = new THREE.Color(0x4a3a28);
    const tempColor = new THREE.Color();

    const colors = new Float32Array(posAttr.count * 3);

    for (let i = 0; i < posAttr.count; i++) {
        vertex.fromBufferAttribute(posAttr, i);

        const normalizedY = vertex.y / radius;
        const noiseDisplacement = fbmNoise(
            vertex.x * 0.3 + seed,
            vertex.y * 0.3 + seed * 1.7,
            vertex.z * 0.3 + seed * 2.3,
            3
        );

        if (normalizedY > 0.7) {
            const flattenFactor = 1 - (normalizedY - 0.7) / 0.3;
            const flatAmount = 0.15 + 0.1 * Math.abs(noiseDisplacement);
            vertex.y *= 1 - flatAmount * (1 - flattenFactor);
        }

        if (Math.abs(vertex.y) > 0.01) {
            const displacementStrength = radius * 0.08;
            const dir = new THREE.Vector3(vertex.x, 0, vertex.z).normalize();
            vertex.x += dir.x * noiseDisplacement * displacementStrength;
            vertex.z += dir.z * noiseDisplacement * displacementStrength;
            vertex.y += noiseDisplacement * displacementStrength * 0.3;
        }

        posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);

        const colorNoise = fbmNoise(
            vertex.x * 0.5 + seed * 3.1,
            vertex.y * 0.5 + seed * 4.7,
            vertex.z * 0.5 + seed * 5.3,
            2
        ) * 0.15;

        if (normalizedY > 0.5) {
            const t = (normalizedY - 0.5) / 0.5;
            tempColor.copy(midColor).lerp(topColor, t);
        } else {
            const t = normalizedY / 0.5;
            tempColor.copy(baseColor).lerp(midColor, t);
        }

        tempColor.r = Math.max(0, Math.min(1, tempColor.r + colorNoise));
        tempColor.g = Math.max(0, Math.min(1, tempColor.g + colorNoise * 0.7));
        tempColor.b = Math.max(0, Math.min(1, tempColor.b + colorNoise * 0.3));

        colors[i * 3] = tempColor.r;
        colors[i * 3 + 1] = tempColor.g;
        colors[i * 3 + 2] = tempColor.b;
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    return geometry;
}

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

    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    const sharedMaterial = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.9,
        metalness: 0.05,
    });

    const mapRadius = 90;

    while (hillsCreated < 15 && attempts < maxAttempts) {
        const radius = 6 + Math.random() * 12;
        const height = 1 + Math.random() * 3;

        const maxDistance = mapRadius - radius;
        const distance = 40 + Math.random() * (maxDistance - 40);
        const angle = Math.random() * Math.PI * 2;

        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        let isValidPosition = true;

        const checkPoints = 12;
        const checkRadii = [radius * 1.2, radius * 0.8, radius * 0.4];

        for (const checkRadius of checkRadii) {
            for (let i = 0; i < checkPoints; i++) {
                const checkAngle = (i / checkPoints) * Math.PI * 2;
                const checkX = x + Math.cos(checkAngle) * checkRadius;
                const checkZ = z + Math.sin(checkAngle) * checkRadius;

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

        if (isValidPosition && isPointOnTrack(x, z)) {
            isValidPosition = false;
        }

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
            const hillGroup = new THREE.Group();
            const baseHeight = getHeightAt(x, z);

            const seed = hillsCreated * 7.31 + 42.0;
            const hillGeometry = createHillGeometry(radius, seed);

            const posAttr = hillGeometry.getAttribute('position');
            const vertex = new THREE.Vector3();

            for (let i = 0; i < posAttr.count; i++) {
                vertex.fromBufferAttribute(posAttr, i);

                if (Math.abs(vertex.y) < 0.01) {
                    const worldX = x + vertex.x;
                    const worldZ = z + vertex.z;
                    const vertexHeight = getHeightAt(worldX, worldZ);
                    vertex.y = (vertexHeight - baseHeight) / height;
                    posAttr.setXYZ(i, vertex.x, vertex.y, vertex.z);
                }
            }

            hillGeometry.computeVertexNormals();

            const hillMesh = new THREE.Mesh(hillGeometry, sharedMaterial);
            hillMesh.castShadow = true;
            hillMesh.receiveShadow = true;

            hillGroup.position.set(x, baseHeight, z);
            hillGroup.scale.set(1, height, 1);
            hillGroup.rotation.y = Math.random() * Math.PI * 2;

            hillGroup.add(hillMesh);
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
