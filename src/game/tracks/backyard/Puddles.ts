import * as THREE from "three";
import { NOISE_GLSL } from "../../core/Noise";
import { injectSurfaceShader } from "../../core/ShaderInject";
import { TRACK_WIDTH } from "../../core/Config";
import type { Terrain } from "../../map/Terrain";
import type { SurfaceKind, SurfacePatch } from "../types";
import { loopPoint } from "./GardenLayout";

export interface PuddlesResult {
    meshes: THREE.Mesh[];
    patches: SurfacePatch[];
    dispose(): void;
}

const MUD: SurfaceKind = {
    id: "mud",
    grip: 0.5,
    drag: 4.5,
    speedScale: 0.68,
    dust: 0x4a3421,
    skid: 0x241609,
    skidAlpha: 0.75,
};

const WATER: SurfaceKind = {
    id: "water",
    grip: 0.4,
    drag: 1.2,
    speedScale: 0.92,
    dust: 0xcfe3ec,
    skid: null,
    skidAlpha: 0,
};

interface PuddleStyle {
    center: THREE.Color;
    rim: THREE.Color;
    opacity: number;
    roughness: number;
}

const STYLES: Record<"mud" | "water", PuddleStyle> = {
    mud: { center: new THREE.Color(0x5c3b1f), rim: new THREE.Color(0x3a2412), opacity: 0.96, roughness: 0.32 },
    water: { center: new THREE.Color(0x4f86a6), rim: new THREE.Color(0x4a3420), opacity: 0.74, roughness: 0.06 },
};

const PUDDLE_FRAGMENT_COMMON = /* glsl */ `
${NOISE_GLSL}
uniform vec3 uCenter;
uniform vec3 uRim;
uniform float uOpacity;
uniform float uRoughness;
varying vec2 vLocal;
float mmRim = 0.0;
float mmRipple = 0.0;
`;

const PUDDLE_FRAGMENT_COLOR = /* glsl */ `
{
    vec2 wp = vWorldPosition.xz;
    float edgeNoise = mm_noise(wp * 0.9) * 0.24 + mm_noise(wp * 2.8) * 0.09;
    float d = length(vLocal) + edgeNoise - 0.16;
    float alpha = 1.0 - smoothstep(0.8, 0.9, d);
    mmRim = smoothstep(0.55, 0.88, d);
    mmRipple = mm_noise(wp * 1.4 + vec2(3.0, 9.0));
    diffuseColor.rgb = mix(uCenter, uRim, mmRim);
    diffuseColor.a = alpha * mix(uOpacity, 0.85, mmRim);
    if (diffuseColor.a < 0.01) discard;
}
`;

const PUDDLE_FRAGMENT_NORMAL = /* glsl */ `
{
    roughnessFactor = mix(uRoughness, 0.7, mmRim);
    vec3 viewPos = -vViewPosition;
    vec3 dpdx = dFdx(viewPos);
    vec3 dpdy = dFdy(viewPos);
    vec3 r1 = cross(dpdy, normal);
    vec3 r2 = cross(normal, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (dFdx(mmRipple) * r1 + dFdy(mmRipple) * r2);
    normal = normalize(abs(det) * normal - grad * 0.08);
}
`;

const DRIVABLE_HALF_WIDTH = TRACK_WIDTH / 2 + 1.2;

export function createPuddles(terrain: Terrain, roadLift: number): PuddlesResult {
    const definitions: { t: number; outward: number; radiusX: number; radiusZ: number; kind: "mud" | "water" }[] = [
        // Rain collects in the dip of the infield esses.
        { t: 0.553, outward: -1.2, radiusX: 6.4, radiusZ: 4.4, kind: "mud" },
        // Dribble from the watering can's rose.
        { t: 0.438, outward: 3.8, radiusX: 5, radiusZ: 3.4, kind: "water" },
        { t: 0.905, outward: 3.2, radiusX: 4.2, radiusZ: 3, kind: "mud" },
    ];

    const meshes: THREE.Mesh[] = [];
    const patches: SurfacePatch[] = [];
    const disposables: { dispose(): void }[] = [];
    const materials = new Map<"mud" | "water", THREE.MeshStandardMaterial>();

    const surfaceY = (x: number, z: number) => {
        const distance = terrain.getTrackDistance(x, z);
        const fade = 1 - THREE.MathUtils.smoothstep(distance, DRIVABLE_HALF_WIDTH, DRIVABLE_HALF_WIDTH + 2);
        return terrain.getHeightAt(x, z) + roadLift * fade;
    };

    for (const definition of definitions) {
        const spot = loopPoint(definition.t, definition.outward);
        const rotation = Math.atan2(spot.tz, spot.tx);
        const axisX = { x: Math.cos(rotation), z: Math.sin(rotation) };
        const axisZ = { x: -Math.sin(rotation), z: Math.cos(rotation) };

        patches.push({
            x: spot.x,
            z: spot.z,
            radiusX: definition.radiusX * 0.82,
            radiusZ: definition.radiusZ * 0.82,
            rotation,
            surface: definition.kind === "mud" ? MUD : WATER,
        });

        const columns = 22;
        const rows = 16;
        const extent = 1.15;
        const positions = new Float32Array((columns + 1) * (rows + 1) * 3);
        const locals = new Float32Array((columns + 1) * (rows + 1) * 2);
        const indices: number[] = [];

        for (let j = 0; j <= rows; j++) {
            for (let i = 0; i <= columns; i++) {
                const u = (i / columns - 0.5) * 2 * extent;
                const v = (j / rows - 0.5) * 2 * extent;
                const x = spot.x + axisX.x * u * definition.radiusX + axisZ.x * v * definition.radiusZ;
                const z = spot.z + axisX.z * u * definition.radiusX + axisZ.z * v * definition.radiusZ;
                const index = j * (columns + 1) + i;
                positions[index * 3] = x;
                positions[index * 3 + 1] = surfaceY(x, z) + 0.08;
                positions[index * 3 + 2] = z;
                locals[index * 2] = u;
                locals[index * 2 + 1] = v;
            }
        }
        for (let j = 0; j < rows; j++) {
            for (let i = 0; i < columns; i++) {
                const a = j * (columns + 1) + i;
                const b = a + 1;
                const c = a + columns + 1;
                const d = c + 1;
                indices.push(a, c, b, b, c, d);
            }
        }

        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute("aLocal", new THREE.BufferAttribute(locals, 2));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();
        geometry.computeBoundingSphere();
        disposables.push(geometry);

        let material = materials.get(definition.kind);
        if (!material) {
            const style = STYLES[definition.kind];
            material = new THREE.MeshStandardMaterial({
                color: 0xffffff,
                roughness: style.roughness,
                metalness: 0,
                transparent: true,
                depthWrite: false,
                polygonOffset: true,
                polygonOffsetFactor: -6,
                polygonOffsetUnits: -6,
            });
            injectSurfaceShader(material, {
                cacheKey: "mm-puddle",
                uniforms: {
                    uCenter: { value: style.center },
                    uRim: { value: style.rim },
                    uOpacity: { value: style.opacity },
                    uRoughness: { value: style.roughness },
                },
                vertexCommon: "attribute vec2 aLocal;\nvarying vec2 vLocal;",
                vertexBody: "vLocal = aLocal;",
                fragmentCommon: PUDDLE_FRAGMENT_COMMON,
                fragmentColor: PUDDLE_FRAGMENT_COLOR,
                fragmentNormal: PUDDLE_FRAGMENT_NORMAL,
            });
            materials.set(definition.kind, material);
            disposables.push(material);
        }

        const mesh = new THREE.Mesh(geometry, material);
        mesh.receiveShadow = true;
        mesh.renderOrder = 3;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        mesh.name = `puddle-${definition.kind}`;
        mesh.userData.nonCollidable = true;
        meshes.push(mesh);
    }

    return {
        meshes,
        patches,
        dispose() {
            disposables.forEach((item) => item.dispose());
        },
    };
}
