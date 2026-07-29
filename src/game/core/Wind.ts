import * as THREE from "three";

/** One shared clock drives every swaying thing in the world. */
export const windUniforms: Record<string, THREE.IUniform> = {
    uTime: { value: 0 },
    uWindDirection: { value: new THREE.Vector2(0.86, 0.51) },
};

export function updateWind(elapsed: number): void {
    windUniforms.uTime.value = elapsed;
}

export const WIND_VERTEX_COMMON = /* glsl */ `
attribute float aSway;
uniform float uTime;
uniform vec2 uWindDirection;
uniform float uWindStrength;
`;

export const WIND_VERTEX_BODY = /* glsl */ `
{
    float phase = mmInstanceOrigin.x * 0.09 + mmInstanceOrigin.z * 0.13;
    float gust = 0.55 + 0.45 * sin(uTime * 0.31 + mmInstanceOrigin.x * 0.021 + mmInstanceOrigin.z * 0.017);
    float wave = sin(uTime * 1.45 + phase) * 0.62 + sin(uTime * 2.9 + phase * 1.7) * 0.28;
    float amount = wave * gust * aSway * uWindStrength;
    transformed.x += uWindDirection.x * amount;
    transformed.z += uWindDirection.y * amount;
}
`;

export function windMaterialUniforms(strength: number): Record<string, THREE.IUniform> {
    return {
        ...windUniforms,
        uWindStrength: { value: strength },
    };
}
