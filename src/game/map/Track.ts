import * as THREE from 'three';

export function createTrack(scene: THREE.Scene, terrainObjects: THREE.Object3D[]): { trackMesh: THREE.Mesh, trackPoints: THREE.Vector2[] } {
    const trackPath = new THREE.Shape();
    trackPath.moveTo(0, 0);
    trackPath.bezierCurveTo(20, 0, 40, -10, 40, -40);
    trackPath.bezierCurveTo(40, -60, 20, -70, 0, -60);
    trackPath.bezierCurveTo(-20, -50, -40, -20, -40, 0);
    trackPath.bezierCurveTo(-40, 20, -20, 40, 0, 40);
    trackPath.bezierCurveTo(20, 40, 20, 20, 0, 0);

    const trackPoints = trackPath.getPoints(200);

    const trackVertices = [];
    const trackUVs = [];
    const trackIndices = [];
    const trackWidth = 10;

    for (let i = 0; i < trackPoints.length; i++) {
        const point = trackPoints[i];
        const nextPoint = trackPoints[(i + 1) % trackPoints.length];

        const dirX = nextPoint.x - point.x;
        const dirY = nextPoint.y - point.y;
        const length = Math.sqrt(dirX * dirX + dirY * dirY);

        const normDirX = dirX / length;
        const normDirY = dirY / length;

        const perpX = -normDirY;
        const perpY = normDirX;

        const halfWidth = trackWidth / 2;

        trackVertices.push(point.x + perpX * halfWidth, 0.01, point.y + perpY * halfWidth);
        trackVertices.push(point.x - perpX * halfWidth, 0.01, point.y - perpY * halfWidth);

        trackUVs.push(0, i / trackPoints.length);
        trackUVs.push(1, i / trackPoints.length);

        if (i < trackPoints.length - 1) {
            const vertexIndex = i * 2;
            trackIndices.push(vertexIndex, vertexIndex + 1, vertexIndex + 2);
            trackIndices.push(vertexIndex + 1, vertexIndex + 3, vertexIndex + 2);
        }
    }

    const trackGeometry = new THREE.BufferGeometry();
    trackGeometry.setAttribute('position', new THREE.Float32BufferAttribute(trackVertices, 3));
    trackGeometry.setAttribute('uv', new THREE.Float32BufferAttribute(trackUVs, 2));
    trackGeometry.setIndex(trackIndices);
    trackGeometry.computeVertexNormals();

    const trackMaterial = new THREE.MeshStandardMaterial({
        color: 0x8b4513,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
    });

    const trackMesh = new THREE.Mesh(trackGeometry, trackMaterial);
    trackMesh.receiveShadow = true;
    trackMesh.castShadow = false;
    scene.add(trackMesh);

    terrainObjects.push(trackMesh);

    return { trackMesh, trackPoints };
}
