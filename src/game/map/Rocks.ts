import * as THREE from 'three';

export function createRocks(scene: THREE.Scene, terrainObjects: THREE.Object3D[], isPointOnTrack: (x: number, z: number) => boolean, groundMesh: THREE.Mesh): THREE.Mesh[] {
    const rocks: THREE.Mesh[] = [];
    const rockCount = 30;
    let rocksCreated = 0;
    let attempts = 0;
    const maxAttempts = 150;

    // Get the height function
    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    while (rocksCreated < rockCount && attempts < maxAttempts) {
        const rockGeometry = new THREE.DodecahedronGeometry(1 + Math.random());
        const rockMaterial = new THREE.MeshStandardMaterial({
            color: 0x808080,
            roughness: 0.9,
            metalness: 0.2,
        });

        const rock = new THREE.Mesh(rockGeometry, rockMaterial);

        const distance = 25 + Math.random() * 75;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        if (!isPointOnTrack(x, z)) {
            // Get the height at this position
            const y = getHeightAt(x, z);

            rock.position.set(x, y, z);
            rock.scale.set(
                0.5 + Math.random() * 1.5,
                0.5 + Math.random() * 1.5,
                0.5 + Math.random() * 1.5,
            );
            rock.rotation.set(
                Math.random() * Math.PI,
                Math.random() * Math.PI,
                Math.random() * Math.PI,
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
