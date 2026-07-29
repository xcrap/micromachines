import * as THREE from "three";
import { NOISE_GLSL } from "../core/Noise";
import { injectSurfaceShader } from "../core/ShaderInject";
import { TRACK_EDGE_BLEED, TRACK_SURFACE_OFFSET, TRACK_WIDTH } from "../core/Config";
import type { TrackPath } from "./TrackPath";
import type { Terrain } from "./Terrain";

export interface TrackResult {
    roadMesh: THREE.Mesh;
    kerbMesh: THREE.Mesh | null;
    dispose(): void;
}

const HALF_WIDTH = TRACK_WIDTH / 2;
const TOTAL_HALF_WIDTH = HALF_WIDTH + TRACK_EDGE_BLEED;
const WIDTH_SEGMENTS = 14;

const KERB_MIN_CURVATURE = 0.025;
const KERB_MIN_RUN = 14;
const KERB_STRIPE_LENGTH = 1.5;
const KERB_WHITE = new THREE.Color(0xdedbd2);
const KERB_RED = new THREE.Color(0xb03028);

const TRACK_FRAGMENT_COMMON = /* glsl */ `
${NOISE_GLSL}
uniform float uHalfWidth;
uniform float uBleed;
varying float vOffset;
varying float vArc;
`;

const TRACK_FRAGMENT_COLOR = /* glsl */ `
{
    vec2 wp = vWorldPosition.xz;
    float absOffset = abs(vOffset);
    float detailFade = 1.0 - smoothstep(30.0, 110.0, vViewDepth);

    vec3 dirtDark  = vec3(0.196, 0.137, 0.086);
    vec3 dirtMid   = vec3(0.325, 0.235, 0.153);
    vec3 dirtLight = vec3(0.435, 0.333, 0.231);
    vec3 dust      = vec3(0.541, 0.451, 0.341);
    vec3 gravel    = vec3(0.427, 0.408, 0.376);

    float coarse = mm_fbm(wp * 0.09, 4);
    float medium = mm_fbm(wp * 0.34, 4);
    float fine   = mm_fbm(wp * 1.1, 3);

    vec3 color = mix(dirtDark, dirtMid, smoothstep(0.24, 0.62, coarse));
    color = mix(color, dirtLight, smoothstep(0.46, 0.82, medium) * 0.7);
    color += (fine - 0.5) * 0.07 * detailFade;

    // Polished racing line: two compacted, darker grooves either side of centre.
    float groove = exp(-pow((absOffset - 2.15) * 1.35, 2.0));
    float grooveWear = groove * (0.55 + 0.45 * mm_noise(vec2(vArc * 0.35, vOffset * 0.6)));
    color = mix(color, dirtDark * 0.86, grooveWear * 0.55);

    // Loose material pushed to the outside of the road.
    float looseEdge = smoothstep(uHalfWidth - 2.6, uHalfWidth + 0.4, absOffset);
    float gravelCells = mm_voronoi(wp * 2.6);
    color = mix(color, gravel * (0.78 + gravelCells * 0.45), looseEdge * 0.42);
    color = mix(color, dust, looseEdge * smoothstep(0.55, 0.85, mm_fbm(wp * 0.22 + vec2(31.0, 11.0), 3)) * 0.4);

    // Scattered pebbles and dried cracks.
    float pebbles = smoothstep(0.80, 0.90, mm_noise(wp * 4.2 + vec2(44.0, 17.0)));
    color = mix(color, gravel * 1.08, pebbles * 0.3 * detailFade);

    float cracks = smoothstep(0.03, 0.09, mm_voronoi(wp * 1.4 + vec2(55.0, 33.0)));
    float crackMask = smoothstep(0.58, 0.80, mm_fbm(wp * 0.16, 3));
    color *= mix(1.0, 0.82 + cracks * 0.18, crackMask * 0.55 * detailFade);

    // Damp, dark patches.
    float damp = smoothstep(0.62, 0.80, mm_fbm(wp * 0.13 + vec2(15.0, 25.0), 4));
    color = mix(color, dirtDark * 0.78, damp * 0.35);

    float ao = 0.93 + fine * 0.07;
    diffuseColor.rgb = color * ao;

    // Ragged, noise-eaten border so the road never reads as a hard-edged decal.
    float edge = 1.0 - smoothstep(uHalfWidth, uHalfWidth + uBleed, absOffset);
    float border = mm_fbm(wp * 0.85 + vec2(77.0, 33.0), 4) * 0.62
                 + mm_noise(wp * 3.4) * 0.24
                 + mm_noise(wp * 9.0) * 0.10;
    diffuseColor.a = smoothstep(0.06, 0.52, edge + (border - 0.48) * 0.9);
    if (diffuseColor.a < 0.02) discard;
}
`;

export function createTrack(trackPath: TrackPath, terrain: Terrain): TrackResult {
    const samples = trackPath.samples;
    const rows = samples.length;
    const vertsPerRow = WIDTH_SEGMENTS + 1;

    const positions = new Float32Array(rows * vertsPerRow * 3);
    const offsets = new Float32Array(rows * vertsPerRow);
    const arcs = new Float32Array(rows * vertsPerRow);
    const indices: number[] = [];

    for (let i = 0; i < rows; i++) {
        const sample = samples[i];
        const normalX = -sample.tangentZ;
        const normalZ = sample.tangentX;

        for (let j = 0; j <= WIDTH_SEGMENTS; j++) {
            const u = j / WIDTH_SEGMENTS;
            const offset = (u - 0.5) * 2 * TOTAL_HALF_WIDTH;
            const x = sample.x + normalX * offset;
            const z = sample.z + normalZ * offset;
            const y = terrain.getHeightAt(x, z) + TRACK_SURFACE_OFFSET;

            const index = i * vertsPerRow + j;
            positions[index * 3] = x;
            positions[index * 3 + 1] = y;
            positions[index * 3 + 2] = z;
            offsets[index] = offset;
            arcs[index] = sample.arc;
        }

        const rowStart = i * vertsPerRow;
        const nextRowStart = ((i + 1) % rows) * vertsPerRow;

        for (let j = 0; j < WIDTH_SEGMENTS; j++) {
            const a = rowStart + j;
            const b = rowStart + j + 1;
            const c = nextRowStart + j;
            const d = nextRowStart + j + 1;
            indices.push(a, b, c, b, d, c);
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute("aOffset", new THREE.BufferAttribute(offsets, 1));
    geometry.setAttribute("aArc", new THREE.BufferAttribute(arcs, 1));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.94,
        metalness: 0,
        transparent: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        dithering: true,
    });

    injectSurfaceShader(material, {
        cacheKey: "mm-track",
        uniforms: {
            uHalfWidth: { value: HALF_WIDTH },
            uBleed: { value: TRACK_EDGE_BLEED },
        },
        vertexCommon: "attribute float aOffset;\nattribute float aArc;\nvarying float vOffset;\nvarying float vArc;",
        vertexBody: "vOffset = aOffset;\nvArc = aArc;",
        fragmentCommon: TRACK_FRAGMENT_COMMON,
        fragmentColor: TRACK_FRAGMENT_COLOR,
    });

    const roadMesh = new THREE.Mesh(geometry, material);
    roadMesh.receiveShadow = true;
    roadMesh.castShadow = false;
    roadMesh.renderOrder = 1;
    roadMesh.matrixAutoUpdate = false;
    roadMesh.updateMatrix();
    roadMesh.name = "track";
    roadMesh.userData.nonCollidable = true;

    const kerbs = createKerbs(trackPath, terrain);

    return {
        roadMesh,
        kerbMesh: kerbs?.mesh ?? null,
        dispose() {
            geometry.dispose();
            material.dispose();
            kerbs?.dispose();
        },
    };
}

function createKerbs(
    trackPath: TrackPath,
    terrain: Terrain,
): { mesh: THREE.Mesh; dispose(): void } | null {
    const samples = trackPath.samples;
    const rows = samples.length;

    // Kerbs only belong on real corners — find contiguous runs of high curvature.
    const isCorner = new Uint8Array(rows);
    for (let i = 0; i < rows; i++) {
        isCorner[i] = Math.abs(samples[i].curvature) > KERB_MIN_CURVATURE ? 1 : 0;
    }

    const runs: { start: number; length: number }[] = [];
    let index = 0;
    while (index < rows) {
        if (!isCorner[index]) {
            index++;
            continue;
        }
        let length = 0;
        while (length < rows && isCorner[(index + length) % rows]) length++;
        if (length >= KERB_MIN_RUN) runs.push({ start: index, length });
        index += length;
    }

    if (runs.length === 0) return null;

    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const color = new THREE.Color();

    // Lateral offset / height-above-road pairs describing the raised rumble profile.
    const profile: readonly (readonly [number, number])[] = [
        [HALF_WIDTH - 0.1, 0.005],
        [HALF_WIDTH + 0.36, 0.075],
        [HALF_WIDTH + 0.78, 0.09],
        [HALF_WIDTH + 1.0, 0.0],
    ];

    for (const run of runs) {
        for (const side of [1, -1]) {
            const rowBase: number[] = [];

            for (let k = 0; k <= run.length; k++) {
                const sampleIndex = (run.start + k) % rows;
                const sample = samples[sampleIndex];
                const normalX = -sample.tangentZ * side;
                const normalZ = sample.tangentX * side;

                const stripe = Math.floor(sample.arc / KERB_STRIPE_LENGTH) % 2 === 0;
                color.copy(stripe ? KERB_RED : KERB_WHITE);

                const rowStart = positions.length / 3;
                rowBase.push(rowStart);

                for (const [lateral, lift] of profile) {
                    const x = sample.x + normalX * lateral;
                    const z = sample.z + normalZ * lateral;
                    const y = terrain.getHeightAt(x, z) + TRACK_SURFACE_OFFSET + lift;
                    positions.push(x, y, z);
                    colors.push(color.r, color.g, color.b);
                }
            }

            for (let k = 0; k < run.length; k++) {
                const current = rowBase[k];
                const next = rowBase[k + 1];
                for (let j = 0; j < profile.length - 1; j++) {
                    const a = current + j;
                    const b = current + j + 1;
                    const c = next + j;
                    const d = next + j + 1;
                    if (side > 0) {
                        indices.push(a, b, c, b, d, c);
                    } else {
                        indices.push(a, c, b, b, c, d);
                    }
                }
            }
        }
    }

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.62,
        metalness: 0.02,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.renderOrder = 2;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = "kerbs";
    mesh.userData.nonCollidable = true;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
