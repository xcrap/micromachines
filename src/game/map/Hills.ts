import * as THREE from 'three';

export function createHills(scene: THREE.Scene, terrainObjects: THREE.Object3D[], isPointOnTrack: (x: number, z: number) => boolean): THREE.Mesh[] {
    const hills: THREE.Mesh[] = [];
    let attempts = 0;
    let hillsCreated = 0;
    const maxAttempts = 100;

    while (hillsCreated < 15 && attempts < maxAttempts) {
        const radius = 8 + Math.random() * 15;
        const height = 1 + Math.random() * 4;

        const hillGeometry = new THREE.SphereGeometry(radius, 32, 32, 0, Math.PI * 2, 0, Math.PI / 2);
        const hillMaterial = new THREE.MeshStandardMaterial({
            color: 0x355e3b,
            roughness: 0.9,
            metalness: 0.1,
        });

        const hill = new THREE.Mesh(hillGeometry, hillMaterial);

        const distance = 30 + Math.random() * 60;
        const angle = Math.random() * Math.PI * 2;

        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        let isValidPosition = true;
        const checkPoints = 8;
        for (let i = 0; i < checkPoints; i++) {
            const checkAngle = (i / checkPoints) * Math.PI * 2;
            const checkX = x + Math.cos(checkAngle) * radius;
            const checkZ = z + Math.sin(checkAngle) * radius;
            if (isPointOnTrack(checkX, checkZ)) {
                isValidPosition = false;
                break;
            }
        }

        if (isValidPosition) {
            hill.position.set(x, 0, z);
            hill.scale.y = height;
            hill.receiveShadow = true;
            hill.castShadow = true;

            scene.add(hill);
            terrainObjects.push(hill);
            hills.push(hill);
            hillsCreated++;
        }

        attempts++;
    }

    return hills;
}
