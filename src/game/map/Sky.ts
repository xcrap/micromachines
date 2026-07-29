import * as THREE from "three";
import { NOISE_GLSL } from "../core/Noise";
import { SKY_HORIZON_COLOR, SKY_TOP_COLOR, SUN_DIRECTION } from "../core/Config";

export interface SkyResult {
    mesh: THREE.Mesh;
    update(elapsed: number): void;
    dispose(): void;
}

const VERTEX_SHADER = /* glsl */ `
varying vec3 vDirection;
void main() {
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const FRAGMENT_SHADER = /* glsl */ `
precision highp float;

${NOISE_GLSL}

uniform vec3 uTopColor;
uniform vec3 uHorizonColor;
uniform vec3 uSunDirection;
uniform float uTime;

varying vec3 vDirection;

void main() {
    vec3 dir = normalize(vDirection);
    float height = clamp(dir.y, -1.0, 1.0);

    // Sky gradient with a warmer, hazier band right on the horizon.
    float gradient = pow(clamp(height * 1.05, 0.0, 1.0), 0.62);
    vec3 color = mix(uHorizonColor, uTopColor, gradient);
    color = mix(color, vec3(0.98, 0.95, 0.88), pow(1.0 - clamp(abs(height) * 4.0, 0.0, 1.0), 3.0) * 0.35);

    float sun = max(dot(dir, normalize(uSunDirection)), 0.0);
    color += vec3(1.0, 0.92, 0.74) * pow(sun, 320.0) * 1.4;
    color += vec3(1.0, 0.88, 0.62) * pow(sun, 12.0) * 0.16;

    // Slow drifting cloud deck, projected onto a dome so it converges at the horizon.
    if (height > 0.015) {
        vec2 plane = dir.xz / max(height, 0.015) * 0.34;
        plane += vec2(uTime * 0.0055, uTime * 0.0032);

        float clouds = mm_fbm(plane, 5);
        clouds = smoothstep(0.50, 0.86, clouds);
        float detail = mm_fbm(plane * 2.6 + 13.0, 4);
        clouds *= 0.55 + detail * 0.75;

        float horizonFade = smoothstep(0.015, 0.20, height);
        float distanceFade = 1.0 - smoothstep(3.0, 9.0, length(plane));
        float coverage = clamp(clouds, 0.0, 1.0) * horizonFade * max(distanceFade, 0.25);

        vec3 cloudLit = mix(vec3(0.72, 0.75, 0.80), vec3(1.0, 0.99, 0.96), smoothstep(0.2, 0.9, detail));
        color = mix(color, cloudLit, coverage * 0.88);
    }

    gl_FragColor = vec4(color, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
}
`;

export function createSky(): SkyResult {
    const geometry = new THREE.SphereGeometry(1, 32, 20);

    const material = new THREE.ShaderMaterial({
        uniforms: {
            uTopColor: { value: new THREE.Color(SKY_TOP_COLOR) },
            uHorizonColor: { value: new THREE.Color(SKY_HORIZON_COLOR) },
            uSunDirection: { value: new THREE.Vector3(...SUN_DIRECTION).normalize() },
            uTime: { value: 0 },
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        side: THREE.BackSide,
        depthWrite: false,
        depthTest: false,
        fog: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.scale.setScalar(600);
    mesh.renderOrder = -1000;
    mesh.frustumCulled = false;
    mesh.name = "sky";
    mesh.userData.nonCollidable = true;

    return {
        mesh,
        update(elapsed: number) {
            material.uniforms.uTime.value = elapsed;
        },
        dispose() {
            geometry.dispose();
            material.dispose();
        },
    };
}
