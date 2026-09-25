import * as THREE from "three";
import { NOISE_GLSL } from "../../core/Noise";
import { injectSurfaceShader } from "../../core/ShaderInject";
import { TRACK_WIDTH, type QualityTier } from "../../core/Config";
import type { Terrain } from "../../map/Terrain";
import { lathe, MeshBatch, placement } from "./Batch";
import {
    FLOOR_HEIGHT,
    TABLE_BEVEL,
    TABLE_CORNER,
    TABLE_HALF_X,
    TABLE_HALF_Z,
    TABLE_THICKNESS,
} from "./Dimensions";

export interface KitchenResult {
    objects: THREE.Object3D[];
    dispose(): void;
}

const TILE_SIZE = 32;

const WOOD_FRAGMENT_COMMON = /* glsl */ `
${NOISE_GLSL}
uniform float uTrackHalfWidth;
varying float vTrackDist;
float mmRoughness;
`;

/**
 * Honey oak planks running along X, with butt joints, grain and a varnish that is
 * polished along the racing line and dusted with crumbs everywhere else.
 */
const WOOD_FRAGMENT_COLOR = /* glsl */ `
{
    vec3 n = abs(normalize(vWorldNormal));
    bool top = n.y > 0.7 && vWorldPosition.y > -0.6;
    vec2 p = n.y > 0.7 ? vWorldPosition.xz : (n.z > n.x ? vWorldPosition.xy : vWorldPosition.zy);
    float detailFade = 1.0 - smoothstep(40.0, 110.0, vViewDepth);

    const float plankWidth = 17.0;
    float plankCoord = p.y / plankWidth;
    float plank = floor(plankCoord);
    float across = fract(plankCoord);
    float plankHash = mm_hash(vec2(plank, 3.7));

    float jointLength = 80.0 + plankHash * 70.0;
    float alongCoord = (p.x + plankHash * 311.0) / jointLength;
    float board = floor(alongCoord);
    float along = fract(alongCoord);
    float boardHash = mm_hash(vec2(plank * 7.0 + board, 19.1));

    vec3 light = vec3(0.40, 0.19, 0.07);
    vec3 mid = vec3(0.29, 0.13, 0.045);
    vec3 dark = vec3(0.14, 0.06, 0.02);

    float figure = mm_noise(vec2(p.x * 0.021 + boardHash * 40.0, p.y * 0.19 + plank * 3.0));
    float wobble = mm_noise(vec2(p.x * 0.06, p.y * 0.8 + boardHash * 9.0));
    float rings = 0.5 + 0.5 * sin((p.y * 2.1 + figure * 11.0 + wobble * 2.2) * 1.6);
    rings = smoothstep(0.55, 1.0, rings);

    vec3 color = mix(light, mid, figure * 0.8);
    color = mix(color, dark, rings * 0.5);
    color *= 0.78 + boardHash * 0.36;

    if (detailFade > 0.01) {
        float streak = mm_noise(vec2(p.x * 0.45, p.y * 11.0)) - 0.5;
        color *= 1.0 + streak * 0.16 * detailFade;
    }

    mmRoughness = 0.5;

    if (top) {
        float edgeAcross = min(across, 1.0 - across) * plankWidth;
        float edgeAlong = min(along, 1.0 - along) * jointLength;
        float aa = max(fwidth(p.y) * 1.2, 0.06);
        float seam = 1.0 - smoothstep(0.05, 0.05 + aa + 0.12, edgeAcross);
        seam = max(seam, (1.0 - smoothstep(0.04, 0.04 + aa + 0.08, edgeAlong)) * 0.8);
        color *= 1.0 - seam * 0.6;

        // Wiped clean where the cars race; crumbs and a dull film everywhere else.
        float offTrack = smoothstep(uTrackHalfWidth + 1.2, uTrackHalfWidth + 4.0, vTrackDist);
        float racingLine = 1.0 - smoothstep(0.0, uTrackHalfWidth, vTrackDist);
        color *= 1.0 + racingLine * 0.07;
        color = mix(color, color * vec3(1.04, 1.0, 0.92) + vec3(0.03, 0.02, 0.0), offTrack * 0.5);

        if (detailFade > 0.01 && offTrack > 0.01) {
            vec2 wp = vWorldPosition.xz;
            float crumbField = smoothstep(0.35, 0.75, mm_noise(wp * 0.09 + 13.0));
            float crumbs = smoothstep(0.86, 0.93, mm_noise(wp * 2.3)) * crumbField * offTrack * detailFade;
            color = mix(color, vec3(0.55, 0.34, 0.12), crumbs * 0.85);
        }

        mmRoughness = mix(0.46, 0.62, offTrack) + seam * 0.3;
    }

    diffuseColor.rgb = color;
}
`;

const WOOD_FRAGMENT_ROUGHNESS = /* glsl */ `
#include <roughnessmap_fragment>
roughnessFactor = mmRoughness;
`;

const FLOOR_FRAGMENT_COMMON = /* glsl */ `
${NOISE_GLSL}
uniform vec2 uTableHalf;
uniform vec2 uShadowOffset;
float mmRoughness;
`;

const FLOOR_FRAGMENT_COLOR = /* glsl */ `
{
    vec2 wp = vWorldPosition.xz;
    vec2 cell = floor(wp / ${TILE_SIZE.toFixed(1)});
    vec2 f = fract(wp / ${TILE_SIZE.toFixed(1)});

    float checker = mod(cell.x + cell.y, 2.0);
    vec3 color = mix(vec3(0.62, 0.56, 0.45), vec3(0.035, 0.04, 0.05), checker);
    color *= 0.93 + mm_hash(cell) * 0.1;
    color *= 0.95 + mm_noise(wp * 0.04) * 0.1;

    float toEdge = min(min(f.x, 1.0 - f.x), min(f.y, 1.0 - f.y)) * ${TILE_SIZE.toFixed(1)};
    float grout = 1.0 - smoothstep(0.25, 0.25 + max(fwidth(wp.x) * 1.5, 0.35), toEdge);
    color = mix(color, vec3(0.42, 0.39, 0.34), grout);

    // Soft pool of shade under the table — the shadow map only covers what is near the car.
    vec2 q = abs(wp - uShadowOffset) - uTableHalf;
    float outside = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0);
    float shade = 1.0 - smoothstep(-30.0, 35.0, outside);
    color *= 1.0 - shade * 0.55;

    mmRoughness = mix(0.22, 0.9, grout);
    diffuseColor.rgb = color;
}
`;

function withRoughness(material: THREE.MeshStandardMaterial): void {
    const inner = material.onBeforeCompile;
    material.onBeforeCompile = (shader, renderer) => {
        inner.call(material, shader, renderer);
        shader.fragmentShader = shader.fragmentShader.replace("#include <roughnessmap_fragment>", WOOD_FRAGMENT_ROUGHNESS);
    };
}

function roundedRectShape(halfX: number, halfZ: number, radius: number): THREE.Shape {
    const shape = new THREE.Shape();
    shape.moveTo(-halfX + radius, -halfZ);
    shape.lineTo(halfX - radius, -halfZ);
    shape.quadraticCurveTo(halfX, -halfZ, halfX, -halfZ + radius);
    shape.lineTo(halfX, halfZ - radius);
    shape.quadraticCurveTo(halfX, halfZ, halfX - radius, halfZ);
    shape.lineTo(-halfX + radius, halfZ);
    shape.quadraticCurveTo(-halfX, halfZ, -halfX, halfZ - radius);
    shape.lineTo(-halfX, -halfZ + radius);
    shape.quadraticCurveTo(-halfX, -halfZ, -halfX + radius, -halfZ);
    return shape;
}

/** Dense grid for the top so the per-vertex track distance can drive the shading. */
function buildTop(terrain: Terrain, quality: QualityTier): THREE.BufferGeometry {
    const halfX = TABLE_HALF_X - TABLE_BEVEL;
    const halfZ = TABLE_HALF_Z - TABLE_BEVEL;
    const radius = TABLE_CORNER - TABLE_BEVEL;
    const cell = quality.name === "low" ? 2.2 : 1.4;

    const geometry = new THREE.PlaneGeometry(halfX * 2, halfZ * 2, Math.ceil((halfX * 2) / cell), Math.ceil((halfZ * 2) / cell));
    geometry.rotateX(-Math.PI / 2);
    geometry.deleteAttribute("uv");

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const distance = new Float32Array(position.count);
    const innerX = halfX - radius;
    const innerZ = halfZ - radius;

    for (let i = 0; i < position.count; i++) {
        let x = position.getX(i);
        let z = position.getZ(i);

        // Pull the grid's square corners onto the rounded outline.
        const cornerX = Math.abs(x) - innerX;
        const cornerZ = Math.abs(z) - innerZ;
        if (cornerX > 0 && cornerZ > 0) {
            const length = Math.hypot(cornerX, cornerZ);
            if (length > radius) {
                x = Math.sign(x) * (innerX + (cornerX / length) * radius);
                z = Math.sign(z) * (innerZ + (cornerZ / length) * radius);
                position.setXYZ(i, x, 0, z);
            }
        }

        distance[i] = terrain.getTrackDistance(x, z);
    }

    geometry.setAttribute("aTrackDist", new THREE.BufferAttribute(distance, 1));
    geometry.computeVertexNormals();
    return geometry;
}

/** Edge, apron, turned legs and chairs — everything wooden that is not the playing surface. */
function buildFurniture(quality: QualityTier): THREE.BufferGeometry {
    const batch = new MeshBatch({ color: false });

    const edge = new THREE.ExtrudeGeometry(
        roundedRectShape(TABLE_HALF_X - TABLE_BEVEL, TABLE_HALF_Z - TABLE_BEVEL, TABLE_CORNER - TABLE_BEVEL),
        {
            depth: TABLE_THICKNESS - TABLE_BEVEL * 2,
            bevelEnabled: true,
            bevelThickness: TABLE_BEVEL,
            bevelSize: TABLE_BEVEL,
            bevelSegments: 3,
            curveSegments: 6,
        },
    );
    edge.rotateX(Math.PI / 2);
    edge.translate(0, -TABLE_BEVEL - 0.03, 0);
    batch.add(edge, null);

    const apron = new THREE.BoxGeometry(TABLE_HALF_X * 2 - 26, 9, TABLE_HALF_Z * 2 - 26, 1, 1, 1);
    apron.translate(0, -TABLE_THICKNESS - 4.5, 0);
    batch.add(apron, null);

    const legProfile: [number, number][] = [
        [0, 0], [3.2, 0], [3.4, 1.5], [2.6, 6], [2.9, 14], [3.6, 30], [3.1, 44], [4.2, 50], [4.4, 58], [4.6, 66], [0, 66],
    ];
    const segments = quality.name === "low" ? 8 : 14;
    const legHeight = -FLOOR_HEIGHT - TABLE_THICKNESS - 5;
    for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
            const leg = lathe(legProfile, segments);
            leg.scale(1, legHeight / 66, 1);
            batch.add(leg, null, placement(sx * (TABLE_HALF_X - 17), FLOOR_HEIGHT, sz * (TABLE_HALF_Z - 17)));
        }
    }

    const chairs: readonly [number, number, number][] = [
        [-52, 1, 0.08], [48, 1, -0.12], [-44, -1, -0.05], [58, -1, 0.14], [TABLE_HALF_X + 30, 0, 0.1],
    ];
    for (const [x, side, yawJitter] of chairs) {
        const end = side === 0;
        const yaw = end ? -Math.PI / 2 + yawJitter : (side > 0 ? Math.PI : 0) + yawJitter;
        const cz = end ? 0 : side * (TABLE_HALF_Z + 30);
        addChair(batch, x, cz, yaw);
    }

    return batch.build();
}

/** A plain kitchen chair facing +Z before `yaw` is applied, seat front toward the table. */
function addChair(batch: MeshBatch, x: number, z: number, yaw: number): void {
    const seatHeight = 46;
    const base = placement(x, FLOOR_HEIGHT, z, yaw);
    const part = (geometry: THREE.BufferGeometry, px: number, py: number, pz: number, pitch = 0) => {
        const local = placement(px, py, pz, 0, pitch);
        batch.add(geometry, null, new THREE.Matrix4().multiplyMatrices(base, local));
    };

    part(new THREE.BoxGeometry(44, 3.5, 42), 0, seatHeight, 0);
    for (const lx of [-19, 19]) {
        for (const lz of [-18, 18]) {
            part(new THREE.BoxGeometry(3.6, seatHeight, 3.6), lx, seatHeight / 2, lz);
        }
    }
    for (const lx of [-19, 19]) {
        part(new THREE.BoxGeometry(3.4, 48, 3.4), lx, seatHeight + 24, -19, -0.08);
    }
    part(new THREE.BoxGeometry(44, 9, 3), 0, seatHeight + 44, -21, -0.08);
    for (const sx of [-10, 0, 10]) {
        part(new THREE.BoxGeometry(4.5, 32, 1.6), sx, seatHeight + 22, -20, -0.08);
    }
    part(new THREE.BoxGeometry(38, 2.4, 2.4), 0, 12, 18);
}

export function createKitchen(
    terrain: Terrain,
    quality: QualityTier,
    sunDirection: readonly [number, number, number],
): KitchenResult {
    const woodMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.4, metalness: 0 });
    injectSurfaceShader(woodMaterial, {
        cacheKey: "mm-breakfast-wood",
        uniforms: { uTrackHalfWidth: { value: TRACK_WIDTH / 2 } },
        vertexCommon: "attribute float aTrackDist;\nvarying float vTrackDist;",
        vertexBody: "vTrackDist = aTrackDist;",
        fragmentCommon: WOOD_FRAGMENT_COMMON,
        fragmentColor: WOOD_FRAGMENT_COLOR,
    });
    withRoughness(woodMaterial);

    const topGeometry = buildTop(terrain, quality);
    const top = new THREE.Mesh(topGeometry, woodMaterial);
    top.name = "table-top";
    top.receiveShadow = true;
    top.matrixAutoUpdate = false;
    top.updateMatrix();

    const furnitureGeometry = buildFurniture(quality);
    const offTable = new Float32Array(furnitureGeometry.getAttribute("position").count).fill(100);
    furnitureGeometry.setAttribute("aTrackDist", new THREE.BufferAttribute(offTable, 1));
    const furniture = new THREE.Mesh(furnitureGeometry, woodMaterial);
    furniture.name = "table-furniture";
    furniture.castShadow = true;
    furniture.receiveShadow = true;
    furniture.matrixAutoUpdate = false;
    furniture.updateMatrix();

    const floorGeometry = new THREE.PlaneGeometry(1800, 1800, 1, 1);
    floorGeometry.rotateX(-Math.PI / 2);
    floorGeometry.translate(0, FLOOR_HEIGHT, 0);
    const floorMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0 });
    const shadowOffset = new THREE.Vector2(-sunDirection[0], -sunDirection[2]).multiplyScalar(-FLOOR_HEIGHT / sunDirection[1]);
    injectSurfaceShader(floorMaterial, {
        cacheKey: "mm-breakfast-floor",
        uniforms: {
            uTableHalf: { value: new THREE.Vector2(TABLE_HALF_X - 10, TABLE_HALF_Z - 10) },
            uShadowOffset: { value: shadowOffset },
        },
        fragmentCommon: FLOOR_FRAGMENT_COMMON,
        fragmentColor: FLOOR_FRAGMENT_COLOR,
    });
    withRoughness(floorMaterial);

    const floor = new THREE.Mesh(floorGeometry, floorMaterial);
    floor.name = "kitchen-floor";
    floor.receiveShadow = true;
    floor.matrixAutoUpdate = false;
    floor.updateMatrix();

    return {
        objects: [top, furniture, floor],
        dispose() {
            topGeometry.dispose();
            furnitureGeometry.dispose();
            floorGeometry.dispose();
            woodMaterial.dispose();
            floorMaterial.dispose();
        },
    };
}
