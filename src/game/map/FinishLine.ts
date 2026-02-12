import * as THREE from 'three';
import { TRACK_EDGE_BLEED, TRACK_WIDTH } from './Track';

export function createFinishLine(
    scene: THREE.Scene,
    trackPoints: THREE.Vector2[],
    groundMesh: THREE.Mesh,
    startIndex: number = 0
): THREE.Group {
    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    const finishLine = new THREE.Group();
    const roadWidth = TRACK_WIDTH + TRACK_EDGE_BLEED * 2;
    const pillarWidth = 0.5;
    const halfRoadWidth = roadWidth / 2;
    const halfPillarSpan = halfRoadWidth + pillarWidth / 2;
    const pillarHeight = 5;
    const archDepth = 0.6;

    const pillarGeo = new THREE.BoxGeometry(pillarWidth, pillarHeight, pillarWidth);
    const pillarMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.2,
        metalness: 0.8,
    });

    const leftPillar = new THREE.Mesh(pillarGeo, pillarMat);
    leftPillar.position.set(-halfPillarSpan, pillarHeight / 2, 0);
    leftPillar.castShadow = true;

    const rightPillar = new THREE.Mesh(pillarGeo, pillarMat);
    rightPillar.position.set(halfPillarSpan, pillarHeight / 2, 0);
    rightPillar.castShadow = true;

    finishLine.add(leftPillar);
    finishLine.add(rightPillar);

    const archGeo = new THREE.BoxGeometry(roadWidth + pillarWidth * 2, archDepth, 0.5);
    const archMat = new THREE.MeshStandardMaterial({
        color: 0xee0000,
        roughness: 0.3,
        metalness: 0.6,
    });
    const arch = new THREE.Mesh(archGeo, archMat);
    arch.position.set(0, pillarHeight + archDepth / 2 - 0.2, 0);
    arch.castShadow = true;
    finishLine.add(arch);

    const checkeredBandGeo = new THREE.BoxGeometry(roadWidth, 0.3, 0.55);
    const checkeredTexture = createCheckeredTexture();
    const checkeredMat = new THREE.MeshStandardMaterial({
        map: checkeredTexture,
        roughness: 0.5,
        metalness: 0.3,
    });
    const checkeredBand = new THREE.Mesh(checkeredBandGeo, checkeredMat);
    checkeredBand.position.set(0, pillarHeight - 0.4, 0);
    finishLine.add(checkeredBand);

    const stripeCount = 16;
    const stripeSpan = TRACK_WIDTH;
    const stripeWidth = stripeSpan / stripeCount;
    const stripeLength = 3;

    for (let i = 0; i < stripeCount; i++) {
        const stripeGeo = new THREE.BoxGeometry(stripeWidth, 0.02, stripeLength);
        const stripeMat = new THREE.MeshStandardMaterial({
            color: i % 2 === 0 ? 0xffffff : 0x111111,
            roughness: 0.7,
            metalness: 0.1,
        });
        const stripe = new THREE.Mesh(stripeGeo, stripeMat);
        const xPos = -stripeSpan / 2 + stripeWidth / 2 + i * stripeWidth;
        stripe.position.set(xPos, 0.02, 0);
        stripe.receiveShadow = true;
        finishLine.add(stripe);
    }

    const finishGeo = new THREE.PlaneGeometry(4, 1.5);
    const finishMat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.4,
        metalness: 0.2,
        side: THREE.DoubleSide,
    });
    const finishSign = new THREE.Mesh(finishGeo, finishMat);
    finishSign.position.set(0, pillarHeight + archDepth / 2 + 0.8, 0.3);
    finishLine.add(finishSign);

    const lightPoleGeo = new THREE.CylinderGeometry(0.08, 0.08, 0.6, 8);
    const lightGeo = new THREE.SphereGeometry(0.15, 16, 16);
    const lightPoleMat = new THREE.MeshStandardMaterial({ color: 0x333333, metalness: 0.8 });
    const lightMat = new THREE.MeshStandardMaterial({
        color: 0xffffaa,
        emissive: 0xffffaa,
        emissiveIntensity: 0.8,
    });

    const lightPositions = [-halfPillarSpan + 1, halfPillarSpan - 1];
    for (const xPos of lightPositions) {
        const pole = new THREE.Mesh(lightPoleGeo, lightPoleMat);
        pole.position.set(xPos, pillarHeight + 0.3, 0.3);
        finishLine.add(pole);

        const light = new THREE.Mesh(lightGeo, lightMat);
        light.position.set(xPos, pillarHeight + 0.65, 0.3);
        finishLine.add(light);
    }

    const capGeo = new THREE.ConeGeometry(0.25, 0.3, 8);
    const capMat = new THREE.MeshStandardMaterial({
        color: 0xffcc00,
        roughness: 0.2,
        metalness: 0.8,
    });

    for (const xPos of [-halfPillarSpan, halfPillarSpan]) {
        const cap = new THREE.Mesh(capGeo, capMat);
        cap.position.set(xPos, pillarHeight + archDepth + 0.05, 0);
        cap.rotation.x = Math.PI;
        finishLine.add(cap);
    }

    const trackPointCount = trackPoints.length;
    const startPointIndex = ((startIndex % trackPointCount) + trackPointCount) % trackPointCount;
    const startPoint = trackPoints[startPointIndex];
    const y = getHeightAt(startPoint.x, startPoint.y);

    finishLine.position.set(startPoint.x, y, startPoint.y);

    if (trackPointCount > 1) {
        const directionSampleOffset = 1;
        const previousPoint = trackPoints[(startPointIndex - directionSampleOffset + trackPointCount) % trackPointCount];
        const nextPoint = trackPoints[(startPointIndex + directionSampleOffset) % trackPointCount];

        const direction = new THREE.Vector2()
            .subVectors(nextPoint, previousPoint)
            .normalize();

        const perpDirection = new THREE.Vector2(-direction.y, direction.x);
        const angle = Math.atan2(-perpDirection.y, perpDirection.x);
        finishLine.rotation.y = angle;
    }

    scene.add(finishLine);

    return finishLine;
}

function createCheckeredTexture(): THREE.Texture {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const squares = 8;
    const squareSize = size / squares;

    for (let i = 0; i < squares; i++) {
        for (let j = 0; j < squares; j++) {
            ctx.fillStyle = (i + j) % 2 === 0 ? '#ffffff' : '#111111';
            ctx.fillRect(i * squareSize, j * squareSize, squareSize, squareSize);
        }
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(4, 1);
    return texture;
}
