import * as THREE from 'three';

const BASE_COLORS = [
    new THREE.Color(0x6b6b6b),
    new THREE.Color(0x7a7a78),
    new THREE.Color(0x5e5c58),
    new THREE.Color(0x6d685f),
    new THREE.Color(0x585550),
];

const MOSS_COLOR = new THREE.Color(0x4a6b3a);
const BROWN_TINT = new THREE.Color(0x6b5e4a);

function createRockGeometry(detail: number, displacementStrength: number, mossy: boolean): THREE.BufferGeometry {
    const geo = new THREE.IcosahedronGeometry(1, detail);
    const positions = geo.attributes.position;
    const count = positions.count;

    const colors = new Float32Array(count * 3);
    const tempColor = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const x = positions.getX(i);
        const y = positions.getY(i);
        const z = positions.getZ(i);

        const len = Math.sqrt(x * x + y * y + z * z);
        const nx = x / len;
        const ny = y / len;
        const nz = z / len;

        const noise1 = Math.sin(nx * 5.3 + ny * 3.7) * Math.cos(nz * 4.1 + nx * 2.9);
        const noise2 = Math.sin(ny * 7.1 + nz * 5.3) * 0.5;
        const displacement = 1 + (noise1 + noise2) * displacementStrength + (Math.random() - 0.5) * displacementStrength * 0.4;

        positions.setXYZ(i, nx * displacement, ny * displacement, nz * displacement);

        const baseColor = BASE_COLORS[Math.floor(Math.random() * BASE_COLORS.length)];
        tempColor.copy(baseColor);

        const brownFactor = Math.random() * 0.3;
        tempColor.lerp(BROWN_TINT, brownFactor);

        if (mossy && ny > 0.2) {
            const mossFactor = Math.pow(Math.max(0, ny), 1.5) * (0.4 + Math.random() * 0.4);
            tempColor.lerp(MOSS_COLOR, mossFactor);
        }

        const variation = 0.9 + Math.random() * 0.2;
        tempColor.r *= variation;
        tempColor.g *= variation;
        tempColor.b *= variation;

        colors[i * 3] = tempColor.r;
        colors[i * 3 + 1] = tempColor.g;
        colors[i * 3 + 2] = tempColor.b;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return geo;
}

interface RockTemplate {
    geometry: THREE.BufferGeometry;
}

function buildTemplates(): RockTemplate[] {
    return [
        { geometry: createRockGeometry(1, 0.25, false) },
        { geometry: createRockGeometry(1, 0.35, true) },
        { geometry: createRockGeometry(2, 0.2, false) },
        { geometry: createRockGeometry(2, 0.3, true) },
    ];
}

const SIZE_RANGES: { min: number; max: number; sinkFactor: number }[] = [
    { min: 0.3, max: 0.6, sinkFactor: 0.15 },
    { min: 0.6, max: 1.2, sinkFactor: 0.25 },
    { min: 1.2, max: 2.0, sinkFactor: 0.35 },
    { min: 2.0, max: 3.0, sinkFactor: 0.45 },
];

export function createRocks(scene: THREE.Scene, terrainObjects: THREE.Object3D[], isPointOnTrack: (x: number, z: number) => boolean, groundMesh: THREE.Mesh): THREE.Mesh[] {
    const rocks: THREE.Mesh[] = [];
    const rockCount = 30;
    let rocksCreated = 0;
    let attempts = 0;
    const maxAttempts = 150;

    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.92,
        metalness: 0.08,
        flatShading: true,
    });

    const templates = buildTemplates();

    while (rocksCreated < rockCount && attempts < maxAttempts) {
        const distance = 25 + Math.random() * 75;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        if (!isPointOnTrack(x, z)) {
            const y = getHeightAt(x, z);

            const sizeIdx = Math.floor(Math.random() * SIZE_RANGES.length);
            const sizeRange = SIZE_RANGES[sizeIdx];
            const baseScale = sizeRange.min + Math.random() * (sizeRange.max - sizeRange.min);
            const sinkAmount = baseScale * sizeRange.sinkFactor;

            const templateIdx = Math.floor(Math.random() * templates.length);
            const rock = new THREE.Mesh(templates[templateIdx].geometry, material);

            rock.position.set(x, y - sinkAmount, z);
            rock.scale.set(
                baseScale * (0.7 + Math.random() * 0.6),
                baseScale * (0.5 + Math.random() * 0.7),
                baseScale * (0.7 + Math.random() * 0.6),
            );
            rock.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI * 0.3,
            );
            rock.castShadow = true;
            rock.receiveShadow = true;

            scene.add(rock);
            terrainObjects.push(rock);
            rocks.push(rock);
            rocksCreated++;
        }
        attempts++;
    }

    return rocks;
}
