import * as THREE from 'three';

export function createGround(scene: THREE.Scene, terrainObjects: THREE.Object3D[]): THREE.Mesh {
    const groundSize = 200;
    const groundSegments = 150;
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, groundSegments, groundSegments);

    const positionAttribute = groundGeometry.getAttribute('position');
    const vertex = new THREE.Vector3();

    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);

        const distanceFromCenter = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
        const edgeFactor = Math.min(1, Math.max(0, 1 - distanceFromCenter / (groundSize * 0.5)));

        if (distanceFromCenter > 10) {
            const noise = Math.sin(vertex.x * 0.05) * Math.cos(vertex.z * 0.05) * 0.8;
            vertex.y += noise * edgeFactor;
        }

        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    groundGeometry.computeVertexNormals();

    const groundMaterial = new THREE.MeshStandardMaterial({
        color: 0x22c55e,
        roughness: 0.9,
        metalness: 0.1,
    });

    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    terrainObjects.push(groundMesh);

    return groundMesh;
}
