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

    const trackStartPoint = trackPoints[0];
    finishLine.position.set(trackStartPoint.x, 0, trackStartPoint.y);

    const nextPoint = trackPoints[1];
    const direction = new THREE.Vector2().subVectors(nextPoint, trackStartPoint).normalize();

    const angle = Math.atan2(direction.y, direction.x);
    finishLine.rotation.y = angle;

    finishLine.castShadow = true;
    finishLine.receiveShadow = true;

    scene.add(finishLine);

    return finishLine;
}
