import * as THREE from "three";

export interface SurfaceShaderOptions {
    /** Unique per shader variant — without it Three reuses the compiled program across materials. */
    cacheKey: string;
    uniforms?: Record<string, THREE.IUniform>;
    /** Declarations available to the vertex stage. */
    vertexCommon?: string;
    /** Runs after `transformed` is initialised; may displace it. `mmInstanceOrigin` is in world space. */
    vertexBody?: string;
    /** Declarations available to the fragment stage. */
    fragmentCommon?: string;
    /** Runs after the base colour is resolved; should write to `diffuseColor.rgb`. */
    fragmentColor?: string;
    /** Runs after the shading normal is resolved; may overwrite view-space `normal`. */
    fragmentNormal?: string;
}

/**
 * Patches a lit Three material with procedural shading while keeping shadows, fog,
 * tone mapping and the whole standard lighting pipeline intact.
 */
export function injectSurfaceShader(
    material: THREE.Material,
    options: SurfaceShaderOptions,
): void {
    const {
        cacheKey,
        uniforms = {},
        vertexCommon = "",
        vertexBody = "",
        fragmentCommon = "",
        fragmentColor = "",
        fragmentNormal = "",
    } = options;

    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);

        shader.vertexShader = shader.vertexShader
            .replace(
                "#include <common>",
                `#include <common>
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;
${vertexCommon}`,
            )
            .replace(
                "#include <defaultnormal_vertex>",
                `#include <defaultnormal_vertex>
vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`,
            )
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 mmInstanceOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vec3 mmInstanceOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
${vertexBody}`,
            )
            .replace(
                "#include <project_vertex>",
                `#include <project_vertex>
#ifdef USE_INSTANCING
vWorldPosition = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
vWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif
vViewDepth = -mvPosition.z;`,
            );

        shader.fragmentShader = shader.fragmentShader
            .replace(
                "#include <common>",
                `#include <common>
varying vec3 vWorldPosition;
varying vec3 vWorldNormal;
varying float vViewDepth;
${fragmentCommon}`,
            )
            .replace(
                "#include <map_fragment>",
                `#include <map_fragment>
${fragmentColor}`,
            )
            .replace(
                "#include <normal_fragment_maps>",
                `#include <normal_fragment_maps>
${fragmentNormal}`,
            );
    };

    material.customProgramCacheKey = () => cacheKey;
    material.needsUpdate = true;
}

/** Depth/shadow passes need the same vertex displacement or shadows detach from the geometry. */
export function injectDepthDisplacement(
    material: THREE.Material,
    cacheKey: string,
    uniforms: Record<string, THREE.IUniform>,
    vertexCommon: string,
    vertexBody: string,
): void {
    material.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.vertexShader = shader.vertexShader
            .replace("#include <common>", `#include <common>\n${vertexCommon}`)
            .replace(
                "#include <begin_vertex>",
                `#include <begin_vertex>
#ifdef USE_INSTANCING
vec3 mmInstanceOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#else
vec3 mmInstanceOrigin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
#endif
${vertexBody}`,
            );
    };
    material.customProgramCacheKey = () => cacheKey;
    material.needsUpdate = true;
}
