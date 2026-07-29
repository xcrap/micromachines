import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { Rng } from "../core/Random";
import { fbm2D } from "../core/Noise";
import { injectDepthDisplacement, injectSurfaceShader } from "../core/ShaderInject";
import { WIND_VERTEX_BODY, WIND_VERTEX_COMMON, windMaterialUniforms } from "../core/Wind";
import { TRACK_WIDTH, WORLD_RADIUS } from "../core/Config";
import type { Terrain } from "./Terrain";
import { PlacementGrid, type Obstacle } from "./Scatter";

export interface TreesResult {
    meshes: THREE.InstancedMesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

interface TreeTemplate {
    geometry: THREE.BufferGeometry;
    /** Radius of the trunk at the base — only the trunk is solid. */
    trunkRadius: number;
    canopyRadius: number;
    height: number;
}

const TRUNK_COLORS = [0x7a5a3c, 0x6b4d32, 0x8a6a48, 0x5e4429];
const CONIFER_GREENS = [0x24603a, 0x2d7444, 0x35854d, 0x419a5c];
const BROADLEAF_GREENS = [0x397c31, 0x47913c, 0x55a548, 0x64b955];
const AUTUMN_LEAVES = [0x9c5522, 0xb86a28, 0xc98432, 0x8a4a1e];

function paint(
    source: THREE.BufferGeometry,
    totalHeight: number,
    baseColor: THREE.Color,
    tipColor: THREE.Color,
    swayScale: number,
    rng: Rng,
): THREE.BufferGeometry {
    // Faceted look, and it also lets every part merge into one buffer regardless of indexing.
    const geometry = source.index ? source.toNonIndexed() : source;
    if (geometry !== source) source.dispose();

    const position = geometry.getAttribute("position");
    const count = position.count;
    const colors = new Float32Array(count * 3);
    const sway = new Float32Array(count);
    const temp = new THREE.Color();

    for (let i = 0; i < count; i++) {
        const y = position.getY(i);
        const gradient = THREE.MathUtils.clamp(y / totalHeight, 0, 1);

        temp.copy(baseColor).lerp(tipColor, gradient * gradient);
        const jitter = 0.88 + rng.next() * 0.24;
        colors[i * 3] = temp.r * jitter;
        colors[i * 3 + 1] = temp.g * jitter;
        colors[i * 3 + 2] = temp.b * jitter;

        sway[i] = Math.pow(gradient, 1.7) * swayScale;
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    geometry.setAttribute("aSway", new THREE.BufferAttribute(sway, 1));
    geometry.deleteAttribute("uv");
    return geometry;
}

function buildConifer(rng: Rng, tiers: number, trunkHeight: number, baseRadius: number): TreeTemplate {
    const parts: THREE.BufferGeometry[] = [];
    const trunkRadius = baseRadius * 0.16;

    const trunk = new THREE.CylinderGeometry(trunkRadius * 0.6, trunkRadius, trunkHeight, 6);
    trunk.translate(0, trunkHeight / 2, 0);
    const trunkColor = new THREE.Color(rng.pick(TRUNK_COLORS));
    parts.push(paint(trunk, trunkHeight, trunkColor, trunkColor.clone().multiplyScalar(1.2), 0.15, rng));

    // Conifers stay evergreen — a whole yellow pine reads as a mistake, not a season.
    const greens = CONIFER_GREENS;
    let radius = baseRadius;
    let tierHeight = baseRadius * 1.35;
    let y = trunkHeight * 0.55;
    let totalHeight = trunkHeight;

    for (let i = 0; i < tiers; i++) {
        const cone = new THREE.ConeGeometry(radius, tierHeight, 8, 1);
        const centerY = y + tierHeight * 0.35;
        cone.translate(0, centerY, 0);

        const dark = new THREE.Color(greens[Math.min(i, greens.length - 1)]);
        const light = new THREE.Color(greens[Math.min(i + 1, greens.length - 1)]);
        parts.push(paint(cone, centerY + tierHeight * 0.5, dark, light, 1, rng));

        totalHeight = Math.max(totalHeight, centerY + tierHeight * 0.5);
        y += tierHeight * 0.44;
        radius *= 0.68;
        tierHeight *= 0.8;
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    merged.computeVertexNormals();

    return { geometry: merged, trunkRadius, canopyRadius: baseRadius, height: totalHeight };
}

function buildBroadleaf(rng: Rng, trunkHeight: number, canopyRadius: number): TreeTemplate {
    const parts: THREE.BufferGeometry[] = [];
    const trunkRadius = canopyRadius * 0.2;

    const trunk = new THREE.CylinderGeometry(trunkRadius * 0.75, trunkRadius, trunkHeight, 7);
    trunk.translate(0, trunkHeight / 2, 0);
    const trunkColor = new THREE.Color(rng.pick(TRUNK_COLORS));
    parts.push(paint(trunk, trunkHeight, trunkColor, trunkColor.clone().multiplyScalar(1.25), 0.12, rng));

    const greens = rng.next() > 0.85 ? AUTUMN_LEAVES : BROADLEAF_GREENS;
    const blobCount = 3 + rng.int(2);
    let totalHeight = trunkHeight;

    for (let i = 0; i < blobCount; i++) {
        const blobRadius = canopyRadius * rng.range(0.55, 0.95);
        const blob = new THREE.IcosahedronGeometry(blobRadius, 1);

        const angle = (i / blobCount) * Math.PI * 2 + rng.range(-0.4, 0.4);
        const spread = i === 0 ? 0 : canopyRadius * rng.range(0.3, 0.6);
        const blobY = trunkHeight + canopyRadius * rng.range(0.25, 0.75);

        blob.scale(1, rng.range(0.75, 1.0), 1);
        blob.translate(Math.cos(angle) * spread, blobY, Math.sin(angle) * spread);

        const dark = new THREE.Color(greens[rng.int(2)]);
        const light = new THREE.Color(greens[2 + rng.int(2)]);
        parts.push(paint(blob, blobY + blobRadius, dark, light, 1, rng));

        totalHeight = Math.max(totalHeight, blobY + blobRadius);
    }

    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    merged.computeVertexNormals();

    return { geometry: merged, trunkRadius, canopyRadius, height: totalHeight };
}

export function createTrees(terrain: Terrain, count: number, seed = 1337): TreesResult {
    const rng = new Rng(seed);

    const templates: TreeTemplate[] = [
        buildConifer(rng, 3, 1.9, 2.0),
        buildConifer(rng, 4, 2.4, 2.4),
        buildConifer(rng, 2, 1.4, 1.6),
        buildBroadleaf(rng, 2.6, 2.3),
        buildBroadleaf(rng, 3.4, 2.9),
        buildBroadleaf(rng, 2.0, 1.7),
    ];

    const transforms: THREE.Matrix4[][] = templates.map(() => []);
    const tints: THREE.Color[][] = templates.map(() => []);
    const obstacles: Obstacle[] = [];
    const grid = new PlacementGrid(6);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const positionVec = new THREE.Vector3();
    const scaleVec = new THREE.Vector3();
    const tint = new THREE.Color();

    const minTrackClearance = TRACK_WIDTH / 2 + 6.5;
    let placed = 0;
    let attempts = 0;
    const maxAttempts = count * 40;

    while (placed < count && attempts < maxAttempts) {
        attempts++;

        const radius = Math.sqrt(rng.next()) * (WORLD_RADIUS - 6) + 6;
        const angle = rng.next() * Math.PI * 2;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;

        // Forest clumps rather than an even sprinkle.
        const density = fbm2D(x * 0.017 + 40, z * 0.017 - 25, 3);
        if (rng.next() > density * 1.5) continue;

        const trackDistance = terrain.getTrackDistance(x, z);
        if (trackDistance < minTrackClearance) continue;
        if (terrain.getSlopeAt(x, z) > 0.55) continue;

        const templateIndex = rng.int(templates.length);
        const template = templates[templateIndex];
        const scale = rng.range(0.75, 1.45) * (trackDistance > 30 ? 1.15 : 0.9);
        const footprint = template.canopyRadius * scale * 0.55;

        if (!grid.canPlace(x, z, footprint)) continue;
        grid.place(x, z, footprint);

        const y = terrain.getHeightAt(x, z) - 0.15;
        const lean = rng.range(-0.06, 0.06);

        euler.set(lean, rng.next() * Math.PI * 2, rng.range(-0.06, 0.06));
        quaternion.setFromEuler(euler);
        positionVec.set(x, y, z);
        scaleVec.set(scale * rng.range(0.92, 1.08), scale * rng.range(0.9, 1.15), scale * rng.range(0.92, 1.08));
        matrix.compose(positionVec, quaternion, scaleVec);

        transforms[templateIndex].push(matrix.clone());

        const shade = rng.range(0.82, 1.15);
        tint.setRGB(shade * rng.range(0.94, 1.06), shade, shade * rng.range(0.9, 1.02));
        tints[templateIndex].push(tint.clone());

        obstacles.push({
            x,
            z,
            radius: Math.max(0.5, template.trunkRadius * scale + 0.35),
            height: template.height * scale,
            solidity: 1,
        });

        placed++;
    }

    const uniforms = windMaterialUniforms(0.16);
    const meshes: THREE.InstancedMesh[] = [];
    const materials: THREE.Material[] = [];

    templates.forEach((template, index) => {
        const instanceCount = transforms[index].length;
        if (instanceCount === 0) return;

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            roughness: 0.88,
            metalness: 0,
        });

        injectSurfaceShader(material, {
            cacheKey: "mm-tree",
            uniforms,
            vertexCommon: WIND_VERTEX_COMMON,
            vertexBody: WIND_VERTEX_BODY,
        });

        const mesh = new THREE.InstancedMesh(template.geometry, material, instanceCount);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.name = `trees-${index}`;
        mesh.userData.nonCollidable = true;

        const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        injectDepthDisplacement(depthMaterial, "mm-tree-depth", uniforms, WIND_VERTEX_COMMON, WIND_VERTEX_BODY);
        mesh.customDepthMaterial = depthMaterial;

        for (let i = 0; i < instanceCount; i++) {
            mesh.setMatrixAt(i, transforms[index][i]);
            mesh.setColorAt(i, tints[index][i]);
        }

        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        mesh.computeBoundingSphere();

        meshes.push(mesh);
        materials.push(material, depthMaterial);
    });

    return {
        meshes,
        obstacles,
        dispose() {
            templates.forEach((template) => template.geometry.dispose());
            materials.forEach((material) => material.dispose());
            meshes.forEach((mesh) => mesh.dispose());
        },
    };
}
