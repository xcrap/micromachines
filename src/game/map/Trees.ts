import * as THREE from 'three';

interface TreeTemplate {
    trunkGeometry: THREE.CylinderGeometry;
    foliageTiers: { geometry: THREE.ConeGeometry; material: THREE.MeshStandardMaterial; yOffset: number }[];
}

function buildTemplates(): TreeTemplate[] {
    const greens = [
        [0x1a4d2e, 0x226b3a, 0x2d8a4e],
        [0x14532d, 0x1b6b35, 0x28854a],
        [0x0f3d22, 0x1a5c30, 0x247a40],
    ];

    const templates: TreeTemplate[] = [];

    const tierConfigs: { tiers: number; trunkH: number; trunkRadTop: number; trunkRadBot: number; baseRadius: number; baseHeight: number; radiusShrink: number; heightShrink: number }[] = [
        { tiers: 2, trunkH: 1.2, trunkRadTop: 0.15, trunkRadBot: 0.3, baseRadius: 1.8, baseHeight: 2.5, radiusShrink: 0.55, heightShrink: 0.7 },
        { tiers: 3, trunkH: 1.6, trunkRadTop: 0.18, trunkRadBot: 0.35, baseRadius: 2.2, baseHeight: 2.8, radiusShrink: 0.6, heightShrink: 0.72 },
        { tiers: 4, trunkH: 2.0, trunkRadTop: 0.2, trunkRadBot: 0.4, baseRadius: 2.5, baseHeight: 2.5, radiusShrink: 0.62, heightShrink: 0.7 },
        { tiers: 3, trunkH: 1.4, trunkRadTop: 0.14, trunkRadBot: 0.28, baseRadius: 1.6, baseHeight: 2.2, radiusShrink: 0.58, heightShrink: 0.68 },
    ];

    for (let t = 0; t < tierConfigs.length; t++) {
        const cfg = tierConfigs[t];
        const colorSet = greens[t % greens.length];
        const trunkGeometry = new THREE.CylinderGeometry(cfg.trunkRadTop, cfg.trunkRadBot, cfg.trunkH, 6);

        const foliageTiers: TreeTemplate['foliageTiers'] = [];
        let currentRadius = cfg.baseRadius;
        let currentHeight = cfg.baseHeight;
        let yAccum = cfg.trunkH * 0.5;

        for (let i = 0; i < cfg.tiers; i++) {
            const geometry = new THREE.ConeGeometry(currentRadius, currentHeight, 7);
            const colorIdx = Math.min(i, colorSet.length - 1);
            const material = new THREE.MeshStandardMaterial({
                color: colorSet[colorIdx],
                roughness: 0.85,
                metalness: 0.05,
            });

            const yOffset = yAccum + currentHeight * 0.3;
            foliageTiers.push({ geometry, material, yOffset });

            yAccum += currentHeight * 0.45;
            currentRadius *= cfg.radiusShrink;
            currentHeight *= cfg.heightShrink;
        }

        templates.push({ trunkGeometry, foliageTiers });
    }

    return templates;
}

function createTreeFromTemplate(template: TreeTemplate, trunkMaterial: THREE.MeshStandardMaterial): THREE.Group {
    const tree = new THREE.Group();

    const trunk = new THREE.Mesh(template.trunkGeometry, trunkMaterial);
    trunk.castShadow = true;
    trunk.receiveShadow = true;
    tree.add(trunk);

    for (const tier of template.foliageTiers) {
        const foliage = new THREE.Mesh(tier.geometry, tier.material);
        foliage.position.y = tier.yOffset;
        foliage.castShadow = true;
        foliage.receiveShadow = true;
        tree.add(foliage);
    }

    return tree;
}

export function createTrees(scene: THREE.Scene, terrainObjects: THREE.Object3D[], isPointOnTrack: (x: number, z: number) => boolean, groundMesh: THREE.Mesh): THREE.Group[] {
    const trees: THREE.Group[] = [];
    const treeCount = 50;
    let treesCreated = 0;
    let attempts = 0;
    const maxAttempts = 200;

    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    const trunkMaterial = new THREE.MeshStandardMaterial({
        color: 0x4a2f1b,
        roughness: 0.95,
        metalness: 0.05,
    });

    const templates = buildTemplates();

    const scaleRanges = [
        { min: 0.35, max: 0.55 },
        { min: 0.6, max: 0.85 },
        { min: 0.9, max: 1.2 },
        { min: 1.3, max: 1.7 },
    ];

    while (treesCreated < treeCount && attempts < maxAttempts) {
        const distance = 30 + Math.random() * 70;
        const angle = Math.random() * Math.PI * 2;
        const x = Math.cos(angle) * distance;
        const z = Math.sin(angle) * distance;

        if (!isPointOnTrack(x, z)) {
            const y = getHeightAt(x, z);

            const templateIdx = Math.floor(Math.random() * templates.length);
            const tree = createTreeFromTemplate(templates[templateIdx], trunkMaterial);

            const sizeCategory = Math.floor(Math.random() * scaleRanges.length);
            const range = scaleRanges[sizeCategory];
            const baseScale = range.min + Math.random() * (range.max - range.min);
            const scaleX = baseScale * (0.9 + Math.random() * 0.2);
            const scaleY = baseScale * (0.85 + Math.random() * 0.3);
            const scaleZ = baseScale * (0.9 + Math.random() * 0.2);
            tree.scale.set(scaleX, scaleY, scaleZ);

            tree.position.set(x, y, z);
            tree.rotation.y = Math.random() * Math.PI * 2;

            const leanAngle = (Math.random() - 0.5) * 0.12;
            const leanAxis = Math.random() * Math.PI * 2;
            tree.rotation.x = Math.sin(leanAxis) * leanAngle;
            tree.rotation.z = Math.cos(leanAxis) * leanAngle;

            scene.add(tree);
            terrainObjects.push(tree);
            trees.push(tree);
            treesCreated++;
        }
        attempts++;
    }

    return trees;
}
