import * as THREE from "three";
import { NOISE_GLSL } from "../../core/Noise";
import { injectSurfaceShader } from "../../core/ShaderInject";
import { TRACK_WIDTH } from "../../core/Config";
import type { Terrain } from "../../map/Terrain";
import { GROUND_HALF, hoseBump, soilAmount } from "./GardenLayout";

export interface LawnResult {
    mesh: THREE.Mesh;
    dispose(): void;
}

const LAWN_FRAGMENT_COMMON = /* glsl */ `
${NOISE_GLSL}
uniform float uRoadHalfWidth;
varying float vTrackDist;
varying float vSoil;
float mmBump = 0.0;
`;

/**
 * Mowed lawn seen from a toy car's height: mowing stripes, dry and clover patches, bare soil on
 * molehills and beds, a dusty shoulder where cars run wide. Blade detail only near the camera.
 */
const LAWN_FRAGMENT_COLOR = /* glsl */ `
{
    vec2 wp = vWorldPosition.xz;
    float near = 1.0 - smoothstep(18.0, 58.0, vViewDepth);

    vec3 lawnDark  = vec3(0.052, 0.150, 0.018);
    vec3 lawnMid   = vec3(0.100, 0.255, 0.032);
    vec3 lawnLight = vec3(0.175, 0.360, 0.052);
    vec3 dry       = vec3(0.300, 0.290, 0.080);
    vec3 clover    = vec3(0.060, 0.215, 0.055);
    vec3 soil      = vec3(0.150, 0.088, 0.045);
    vec3 dust      = vec3(0.330, 0.245, 0.150);

    float macro  = mm_fbm(wp * 0.012, 2);
    float patchA = mm_noise(wp * 0.055 + vec2(13.0, 71.0));
    float patchB = mm_noise(wp * 0.14 + vec2(91.0, 7.0));

    vec3 color = mix(lawnDark, lawnMid, smoothstep(0.2, 0.75, macro));
    float stripe = sin(dot(wp, vec2(0.8, 0.6)) * 0.24);
    color = mix(color, lawnLight, smoothstep(-0.25, 0.25, stripe) * 0.34);
    color = mix(color, dry, smoothstep(0.64, 0.86, patchA) * 0.5);
    color = mix(color, clover, smoothstep(0.6, 0.8, patchB) * 0.55);

    if (near > 0.001) {
        vec2 bp = mat2(0.8, -0.6, 0.6, 0.8) * wp;
        float blades = mm_noise(bp * vec2(3.4, 14.0));
        float tufts  = mm_noise(wp * 1.9 + vec2(5.0, 3.0));
        mmBump = (blades * 0.65 + tufts * 0.35) * near;
        color *= mix(1.0, 0.8 + blades * 0.32 + (tufts - 0.5) * 0.14, near);
    }

    float soilMask = clamp(vSoil, 0.0, 1.0);
    color = mix(color, soil * (0.82 + patchB * 0.36), soilMask);

    float shoulder = 1.0 - smoothstep(uRoadHalfWidth, uRoadHalfWidth + 3.2, vTrackDist);
    float wear = shoulder * shoulder * (0.45 + patchA * 0.55 + patchB * 0.2);
    color = mix(color, dust, clamp(wear, 0.0, 0.85));

    diffuseColor.rgb = color;
}
`;

/** Surface-gradient bump from screen-space derivatives: no extra noise lookups for the normal. */
const LAWN_FRAGMENT_NORMAL = /* glsl */ `
{
    vec3 viewPos = -vViewPosition;
    vec3 dpdx = dFdx(viewPos);
    vec3 dpdy = dFdy(viewPos);
    float dhdx = dFdx(mmBump);
    float dhdy = dFdy(mmBump);
    vec3 r1 = cross(dpdy, normal);
    vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dhdx * r1 + dhdy * r2);
    normal = normalize(abs(det) * normal - grad * 0.045);
}
`;

export function createLawn(terrain: Terrain, segments: number): LawnResult {
    const size = GROUND_HALF * 2;
    const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
    geometry.rotateX(-Math.PI / 2);

    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const count = position.count;
    const trackDistance = new Float32Array(count);
    const soil = new Float32Array(count);
    const sample = { height: 0, trackDistance: 0 };

    for (let i = 0; i < count; i++) {
        const x = position.getX(i);
        const z = position.getZ(i);
        terrain.sampleSurface(x, z, sample);
        // The hose ridge is physics only — the tube itself sits on the flat lawn.
        position.setY(i, sample.height - hoseBump(x, z));
        trackDistance[i] = sample.trackDistance;
        soil[i] = soilAmount(x, z);
    }

    position.needsUpdate = true;
    geometry.setAttribute("aTrackDist", new THREE.BufferAttribute(trackDistance, 1));
    geometry.setAttribute("aSoil", new THREE.BufferAttribute(soil, 1));
    geometry.deleteAttribute("uv");
    geometry.computeVertexNormals();
    geometry.computeBoundingSphere();

    const material = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.95,
        metalness: 0,
        dithering: true,
    });

    injectSurfaceShader(material, {
        cacheKey: "mm-lawn",
        uniforms: {
            uRoadHalfWidth: { value: TRACK_WIDTH / 2 + 1.5 },
        },
        vertexCommon: "attribute float aTrackDist;\nattribute float aSoil;\nvarying float vTrackDist;\nvarying float vSoil;",
        vertexBody: "vTrackDist = aTrackDist;\nvSoil = aSoil;",
        fragmentCommon: LAWN_FRAGMENT_COMMON,
        fragmentColor: LAWN_FRAGMENT_COLOR,
        fragmentNormal: LAWN_FRAGMENT_NORMAL,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();
    mesh.name = "lawn";
    mesh.userData.nonCollidable = true;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
