import * as THREE from "three";
import { Rng } from "../../core/Random";
import { injectSurfaceShader } from "../../core/ShaderInject";
import type { Terrain } from "../../map/Terrain";
import { FENCE_HALF, GROUND_HALF } from "./GardenLayout";
import { merge, paint } from "./Shapes";

export interface FenceResult {
    meshes: THREE.Mesh[];
    dispose(): void;
}

const PLANK_WIDTH = 3.3;
const PLANK_GAP = 0.3;
const PLANK_THICKNESS = 0.6;
const PLANK_HEIGHT = 50;
const RAIL_HEIGHTS = [13, 41];
const RAIL_THICKNESS = 1.3;
const POST_SPACING = 50;

function createWoodTexture(rng: Rng): THREE.CanvasTexture {
    const width = 128;
    const height = 1024;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    ctx.fillStyle = "#b98a58";
    ctx.fillRect(0, 0, width, height);

    // Long vertical grain lines with a gentle wander, plus a couple of knots.
    for (let line = 0; line < 46; line++) {
        const x0 = rng.range(0, width);
        const shade = rng.range(-1, 1);
        ctx.strokeStyle = shade > 0 ? `rgba(90,58,30,${0.12 + shade * 0.2})` : `rgba(235,200,150,${0.08 - shade * 0.12})`;
        ctx.lineWidth = rng.range(0.6, 2.6);
        ctx.beginPath();
        for (let y = 0; y <= height; y += 32) {
            const x = x0 + Math.sin(y * 0.006 + line) * 3 + Math.sin(y * 0.021 + line * 2.3) * 1.2;
            if (y === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }

    for (let knot = 0; knot < 3; knot++) {
        const x = rng.range(20, width - 20);
        const y = rng.range(80, height - 80);
        const gradient = ctx.createRadialGradient(x, y, 1, x, y, 11);
        gradient.addColorStop(0, "rgba(70,40,18,0.85)");
        gradient.addColorStop(0.5, "rgba(110,70,36,0.45)");
        gradient.addColorStop(1, "rgba(110,70,36,0)");
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.ellipse(x, y, 9, 16, 0, 0, Math.PI * 2);
        ctx.fill();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = THREE.RepeatWrapping;
    texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = 4;
    return texture;
}

/** Swaps u and v so a long horizontal board shows grain along its length. */
function rotateUvs(geometry: THREE.BufferGeometry, repeat: number): void {
    const uv = geometry.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
        const u = uv.getX(i);
        const v = uv.getY(i);
        uv.setXY(i, v, u * repeat);
    }
}

function buildBackgroundTrees(rng: Rng): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const greens = [0x2c5a26, 0x356b2c, 0x3f7a33, 0x2a4f24];
    const bark = new THREE.Color(0x4c3824);
    const temp = new THREE.Color();

    const spots: [number, number][] = [];
    for (let i = 0; i < 11; i++) {
        const side = i % 3;
        const along = rng.range(-190, 190);
        const out = rng.range(190, 250);
        // Trees on three sides; the fourth stays open so a wide slice of sky shows.
        if (side === 0) spots.push([along, -out]);
        else if (side === 1) spots.push([out, along]);
        else spots.push([-out, along]);
    }

    for (const [x, z] of spots) {
        const height = rng.range(95, 140);
        const trunk = new THREE.CylinderGeometry(rng.range(4, 6), rng.range(7, 9), height, 9);
        trunk.translate(x, height / 2 - 5, z);
        parts.push(paint(trunk, bark));

        const blobs = 5 + rng.int(3);
        for (let i = 0; i < blobs; i++) {
            const radius = rng.range(26, 44);
            const blob = new THREE.IcosahedronGeometry(radius, 1);
            const angle = rng.next() * Math.PI * 2;
            const spread = i === 0 ? 0 : rng.range(14, 36);
            blob.scale(1, 0.8, 1);
            blob.translate(x + Math.cos(angle) * spread, height + rng.range(-18, 22), z + Math.sin(angle) * spread);
            const dark = new THREE.Color(rng.pick(greens));
            const top = height + 60;
            parts.push(paint(blob, (_x, y) => temp.copy(dark).lerp(dark.clone().multiplyScalar(1.4), THREE.MathUtils.clamp((y - height + 40) / (top - height + 40), 0, 1))));
        }
    }

    return merge(parts);
}

export function createFence(terrain: Terrain, seed = 9090): FenceResult {
    const rng = new Rng(seed);
    const woodTexture = createWoodTexture(rng);
    const wood = new THREE.MeshStandardMaterial({ map: woodTexture, roughness: 0.86, metalness: 0 });
    // Planks share one texture; a per-instance offset (and mirror) keeps the knots from lining up.
    injectSurfaceShader(wood, {
        cacheKey: "mm-fence-planks",
        vertexBody: /* glsl */ `
#ifdef USE_INSTANCING
{
    float plankHash = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
    vMapUv.y += plankHash * 7.0;
    if (plankHash > 0.5) vMapUv.x = 1.0 - vMapUv.x;
}
#endif`,
    });

    const plankGeometry = new THREE.BoxGeometry(PLANK_WIDTH, 1, PLANK_THICKNESS);
    plankGeometry.translate(0, 0.5, 0);

    const step = PLANK_WIDTH + PLANK_GAP;
    const perSide = Math.floor((FENCE_HALF * 2) / step);
    const planks = new THREE.InstancedMesh(plankGeometry, wood, perSide * 4);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();
    const up = new THREE.Vector3(0, 1, 0);
    const tint = new THREE.Color();

    // Each side runs along its own axis; planks face into the garden.
    const sides = [
        { yaw: 0, point: (v: number) => [v, -FENCE_HALF] as const },
        { yaw: -Math.PI / 2, point: (v: number) => [FENCE_HALF, v] as const },
        { yaw: Math.PI, point: (v: number) => [-v, FENCE_HALF] as const },
        { yaw: Math.PI / 2, point: (v: number) => [-FENCE_HALF, -v] as const },
    ];

    let index = 0;
    const railParts: THREE.BufferGeometry[] = [];

    for (const side of sides) {
        quaternion.setFromAxisAngle(up, side.yaw);
        for (let i = 0; i < perSide; i++) {
            const v = -FENCE_HALF + step * (i + 0.5);
            const [x, z] = side.point(v);
            const base = terrain.getHeightAt(x, z) - 2;
            const height = PLANK_HEIGHT + 2 + rng.range(-0.8, 0.8);
            position.set(x, base, z);
            scale.set(1, height, 1);
            matrix.compose(position, quaternion, scale);
            planks.setMatrixAt(index, matrix);
            const shade = rng.range(0.82, 1.08);
            tint.setRGB(shade * rng.range(0.97, 1.03), shade * rng.range(0.95, 1.0), shade * rng.range(0.9, 0.98));
            planks.setColorAt(index, tint);
            index++;
        }

        // Rails and posts sit on the garden side of the boards.
        const inward = PLANK_THICKNESS / 2 + RAIL_THICKNESS / 2;
        for (const railY of RAIL_HEIGHTS) {
            const rail = new THREE.BoxGeometry(FENCE_HALF * 2, 3.2, RAIL_THICKNESS);
            rotateUvs(rail, 30);
            rail.translate(0, railY, inward);
            rail.rotateY(side.yaw);
            const [cx, cz] = side.point(0);
            rail.translate(cx, 0, cz);
            railParts.push(rail);
        }

        for (let v = -FENCE_HALF; v <= FENCE_HALF; v += POST_SPACING) {
            const post = new THREE.BoxGeometry(3.6, PLANK_HEIGHT + 6, 3.2);
            post.translate(0, (PLANK_HEIGHT + 6) / 2 - 3, inward + 0.95);
            post.rotateY(side.yaw);
            const [px, pz] = side.point(v);
            post.translate(px, terrain.getHeightAt(px, pz), pz);
            railParts.push(post);
        }
    }

    planks.instanceMatrix.needsUpdate = true;
    if (planks.instanceColor) planks.instanceColor.needsUpdate = true;
    planks.computeBoundingSphere();
    planks.castShadow = true;
    planks.receiveShadow = true;
    planks.name = "fence-planks";
    planks.userData.nonCollidable = true;

    const railGeometry = merge(railParts.map((part) => {
        const expanded = part.toNonIndexed();
        part.dispose();
        return expanded;
    }));
    const railMaterial = new THREE.MeshStandardMaterial({ map: woodTexture, color: 0xc9a67c, roughness: 0.86, metalness: 0 });
    const rails = new THREE.Mesh(railGeometry, railMaterial);
    rails.castShadow = true;
    rails.receiveShadow = true;
    rails.name = "fence-rails";
    rails.userData.nonCollidable = true;

    const treeGeometry = buildBackgroundTrees(rng);
    const treeMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
    const trees = new THREE.Mesh(treeGeometry, treeMaterial);
    trees.name = "neighbour-trees";
    trees.userData.nonCollidable = true;

    // Beyond the fence: a plain, low lawn so high cameras never see the edge of the world.
    const outerGeometry = new THREE.RingGeometry(GROUND_HALF - 12, 900, 4, 1, Math.PI / 4);
    outerGeometry.rotateX(-Math.PI / 2);
    outerGeometry.translate(0, -4.5, 0);
    const outerMaterial = new THREE.MeshStandardMaterial({ color: 0x3f6f2a, roughness: 1, metalness: 0 });
    const outer = new THREE.Mesh(outerGeometry, outerMaterial);
    outer.name = "outer-lawn";
    outer.userData.nonCollidable = true;

    return {
        meshes: [planks, rails, trees, outer],
        dispose() {
            plankGeometry.dispose();
            railGeometry.dispose();
            treeGeometry.dispose();
            outerGeometry.dispose();
            wood.dispose();
            railMaterial.dispose();
            treeMaterial.dispose();
            outerMaterial.dispose();
            woodTexture.dispose();
            planks.dispose();
        },
    };
}
