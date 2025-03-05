import * as THREE from 'three';

export function createTrees(scene: THREE.Scene, terrainObjects: THREE.Object3D[], isPointOnTrack: (x: number, z: number) => boolean): THREE.Group[] {
    const trees: THREE.Group[] = [];
    const treeCount = 50;
    let treesCreated = 0;
    let attempts = 0;
    const maxAttempts = 200;

    while (treesCreated < treeCount && attempts < maxAttempts) {
        const trunkGeometry = new THREE.CylinderGeometry(0.3, 0.5, 2, 8);
        const trunkMaterial = new THREE.MeshStandardMaterial({
            color: 0x8b4513,
            roughness: 0.9,
            metalness: 0.1,
        });
        const trunk = new THREE.Mesh(trunkGeometry, trunkMaterial);

        const topGeometry = new THREE.ConeGeometry(2, 4, 8);
        const topMaterial = new THREE.MeshStandardMaterial({
            color: 0x228b22,
            roughness: 0.8,
            metalness: 0.1,
        });
        const top = new THREE.Mesh(topGeometry, topMaterial);
        top.position.y = 3;

        const tree = new THREE.Group();
        tree.add(trunk);
        tree.add(top);

        const distance = 30 + Math.random() * 70;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        if (!isPointOnTrack(x, z)) {
            tree.position.set(x, 0, z);
            tree.scale.set(
                0.8 + Math.random() * 0.4,
                0.8 + Math.random() * 0.4,
                0.8 + Math.random() * 0.4,
            );
            tree.rotation.y = Math.random() * Math.PI * 2;
            tree.castShadow = true;
            tree.receiveShadow = true;

            scene.add(tree);
            terrainObjects.push(tree);
            trees.push(tree);
            treesCreated++;
        }
        attempts++;
    }

    return trees;
}
