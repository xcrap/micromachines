import * as THREE from "three";
import { NOISE_GLSL } from "../core/Noise";
import { injectSurfaceShader } from "../core/ShaderInject";
import { GROUND_SIZE, TRACK_WIDTH } from "../core/Config";
import type { Terrain } from "./Terrain";

export interface GroundResult {
    mesh: THREE.Mesh;
    material: THREE.MeshStandardMaterial;
    dispose(): void;
}

const GROUND_FRAGMENT_COMMON = /* glsl */ `
${NOISE_GLSL}
varying float vTrackDist;

// Height field standing in for the grass canopy. Cheap on purpose — it gets
// sampled three times per pixel to derive a gradient for the shading normal.
float mm_grassHeight(vec2 p) {
    return mm_noise(p * 2.3) * 0.62 + mm_noise(p * 7.9) * 0.38;
}
`;

/**
 * Perturbs the lit normal with the grass height field. Without this the ground is a
 * perfectly smooth surface and no amount of colour noise stops it reading as flat paint.
 */
const GROUND_FRAGMENT_NORMAL = /* glsl */ `
{
    float bumpFade = 1.0 - smoothstep(16.0, 62.0, vViewDepth);
    if (bumpFade > 0.01) {
        vec2 p = vWorldPosition.xz;
        float step = 0.16;
        float h0 = mm_grassHeight(p);
        float hx = mm_grassHeight(p + vec2(step, 0.0));
        float hz = mm_grassHeight(p + vec2(0.0, step));

        // Bare ground and the packed shoulder are much smoother than open grass.
        float verge = smoothstep(uRoadHalfWidth, uRoadHalfWidth + 3.0, vTrackDist);
        vec3 gradient = vec3(hx - h0, 0.0, hz - h0) / step;
        vec3 bumped = normalize(vWorldNormal - gradient * (0.34 * bumpFade * verge));
        normal = normalize((viewMatrix * vec4(bumped, 0.0)).xyz);
    }
}
`;

const GROUND_FRAGMENT_COLOR = /* glsl */ `
{
    vec2 wp = vWorldPosition.xz;

    // High frequency detail is faded out with distance so the ground never crawls or aliases.
    float detailFade = 1.0 - smoothstep(55.0, 165.0, vViewDepth);

    vec3 grassDeep   = vec3(0.078, 0.188, 0.063);
    vec3 grassMid    = vec3(0.169, 0.349, 0.102);
    vec3 grassLight  = vec3(0.310, 0.494, 0.161);
    vec3 grassDry    = vec3(0.478, 0.463, 0.196);
    vec3 clover      = vec3(0.216, 0.404, 0.196);
    vec3 soil        = vec3(0.318, 0.239, 0.145);
    vec3 rock        = vec3(0.400, 0.392, 0.365);

    // Rotated domains break up the value-noise lattice, which is otherwise visible as
    // square patches once the camera gets close to the ground.
    mat2 turn = mat2(0.8776, -0.4794, 0.4794, 0.8776);
    vec2 wpRot = turn * wp;

    float macro  = mm_fbm(wp * 0.013, 4);
    float meso   = mm_fbm(wpRot * 0.062, 4);
    float patchy = mm_fbm(wpRot * 0.17 + vec2(7.0, 41.0), 3);
    float fine   = mm_noise(wp * 0.55);
    float micro  = mm_noise(wpRot * 3.1);

    vec3 color = mix(grassDeep, grassMid, smoothstep(0.25, 0.72, macro));
    color = mix(color, grassLight, smoothstep(0.42, 0.88, meso) * 0.75);

    // Mid-scale mottling, otherwise open ground reads as flat paint up close.
    color = mix(color, grassDeep, smoothstep(0.72, 0.18, patchy) * 0.32);
    color = mix(color, grassLight, smoothstep(0.48, 0.95, patchy) * 0.3);

    float dryPatch = smoothstep(0.54, 0.82, mm_fbm(wp * 0.021 + vec2(63.0, 17.0), 3));
    color = mix(color, grassDry, dryPatch * 0.45);

    float soilPatch = smoothstep(0.68, 0.90, mm_fbm(wp * 0.036 + vec2(151.0, 92.0), 4));
    color = mix(color, soil, soilPatch * 0.35);

    float cloverPatch = smoothstep(0.60, 0.78, mm_fbm(wpRot * 0.34 + vec2(211.0, 47.0), 3));
    color = mix(color, clover, cloverPatch * 0.3);

    // Tufts: voronoi cells read as individual clumps, dark in the gaps between them.
    float tuft = mm_voronoi(wpRot * 1.7);
    float tuftShade = mix(0.87, 1.09, smoothstep(0.04, 0.5, tuft));
    color *= mix(1.0, tuftShade, detailFade);

    // Anisotropic noise streaks along one axis, which reads as blade direction.
    float blades = mm_noise(wpRot * vec2(2.6, 13.0)) - 0.5;
    color += vec3(blades * 0.05, blades * 0.10, blades * 0.03) * detailFade;
    color += (micro - 0.5) * 0.035 * detailFade;

    // Steep faces show through as bare soil and rock, with a little strata banding
    // so the enclosing hills do not flatten into one grey mass.
    float slope = 1.0 - clamp(vWorldNormal.y, 0.0, 1.0);
    float strata = mm_fbm(vec2(wpRot.x * 0.06 + wpRot.y * 0.03, vWorldPosition.y * 0.28), 3);
    vec3 exposed = mix(soil, rock, smoothstep(0.35, 0.7, strata));
    color = mix(color, exposed * (0.85 + strata * 0.3), smoothstep(0.22, 0.5, slope));
    color = mix(color, rock * (0.8 + strata * 0.4), smoothstep(0.55, 0.85, slope) * 0.75);

    // Worn, dusty shoulder where cars run wide off the road.
    float shoulder = 1.0 - smoothstep(uRoadHalfWidth, uRoadHalfWidth + 2.6, vTrackDist);
    float shoulderNoise = mm_fbm(wp * 0.5, 3);
    float wear = shoulder * shoulder * (0.5 + shoulderNoise * 0.6);
    color = mix(color, vec3(0.353, 0.278, 0.180), clamp(wear, 0.0, 0.85));

    float ao = 0.90 + mm_noise(wp * 0.28) * 0.10;
    diffuseColor.rgb = color * ao;
}
`;

export function createGround(terrain: Terrain, segments: number): GroundResult {
    const geometry = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const vertexCount = position.count;
    const trackDistance = new Float32Array(vertexCount);
    const sample = { height: 0, trackDistance: 0 };

    for (let i = 0; i < vertexCount; i++) {
        const x = position.getX(i);
        const z = position.getZ(i);
        terrain.sampleSurface(x, z, sample);
        position.setY(i, sample.height);
        trackDistance[i] = sample.trackDistance;
    }

    position.needsUpdate = true;
    geometry.setAttribute("aTrackDist", new THREE.BufferAttribute(trackDistance, 1));
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.96,
        metalness: 0,
        dithering: true,
    });

    injectSurfaceShader(material, {
        cacheKey: "mm-ground",
        uniforms: {
            uRoadHalfWidth: { value: TRACK_WIDTH / 2 + 1.5 },
        },
        vertexCommon: "attribute float aTrackDist;\nvarying float vTrackDist;",
        vertexBody: "vTrackDist = aTrackDist;",
        fragmentCommon: `uniform float uRoadHalfWidth;\n${GROUND_FRAGMENT_COMMON}`,
        fragmentColor: GROUND_FRAGMENT_COLOR,
        fragmentNormal: GROUND_FRAGMENT_NORMAL,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = "ground";
    mesh.userData.nonCollidable = true;

    return {
        mesh,
        material,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
