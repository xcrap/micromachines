import * as THREE from 'three';

export function createFinishLine(scene: THREE.Scene, trackPoints: THREE.Vector2[]): THREE.Group {
    const markerHeight = 5;
    const markerWidth = 12;
    const markerDepth = 0.3;

    const pillarGeometry = new THREE.BoxGeometry(markerDepth, markerHeight, markerDepth);
    const pillarMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.7,
        metalness: 0.3,
    });

    const leftPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    leftPillar.position.set(-markerWidth / 2, markerHeight / 2, 0);

    const rightPillar = new THREE.Mesh(pillarGeometry, pillarMaterial);
    rightPillar.position.set(markerWidth / 2, markerHeight / 2, 0);

    const bannerGeometry = new THREE.BoxGeometry(markerWidth, markerDepth * 2, markerDepth);
    const bannerMaterial = new THREE.MeshStandardMaterial({
        color: 0xff0000,
        roughness: 0.7,
        metalness: 0.3,
    });

    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.position.set(0, markerHeight, 0);

    const finishLine = new THREE.Group();
    finishLine.add(leftPillar);
    finishLine.add(rightPillar);
    finishLine.add(banner);

    // Use the start point for the finish line placement
    const startPoint = trackPoints[0];
    finishLine.position.set(startPoint.x, 0, startPoint.y);

    // Calculate direction properly from the first and last points
    const firstPoint = trackPoints[0];
    const secondPoint = trackPoints[1];

    const direction = new THREE.Vector2()
        .subVectors(secondPoint, firstPoint)
        .normalize();

    // Get perpendicular direction for proper orientation across the track
    const perpDirection = new THREE.Vector2(-direction.y, direction.x);
    const angle = Math.atan2(perpDirection.y, perpDirection.x);
    finishLine.rotation.y = angle;

    finishLine.castShadow = true;
    finishLine.receiveShadow = true;

    scene.add(finishLine);

    return finishLine;
}
