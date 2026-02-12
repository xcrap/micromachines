import * as THREE from "three";

export function createGround(
    scene: THREE.Scene,
    terrainObjects: THREE.Object3D[],
): { mesh: THREE.Mesh, onResize: (width: number, height: number) => void } {
    const groundSize = 200;
    const groundSegments = 150;
    const groundGeometry = new THREE.PlaneGeometry(
        groundSize,
        groundSize,
        groundSegments,
        groundSegments,
    );

    // Modify the geometry to create height variations
    const positionAttribute = groundGeometry.getAttribute("position");
    const vertex = new THREE.Vector3();
    const computeHeight = (x: number, z: number): number => {
        let height = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2.0;
        height += Math.sin(x * 0.02) * Math.cos(z * 0.02) * 5.0;
        const distance = Math.sqrt(x * x + z * z);
        if (distance > 20) return height;
        if (distance <= 10) return 0;
        return (height * (distance - 10)) / 10;
    };

    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);
        vertex.z = computeHeight(vertex.x, vertex.y);
        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    // Update the geometry
    groundGeometry.computeVertexNormals();

    const grassShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
            varying vec2 v_uv;
            varying vec3 v_worldPos;

            void main() {
                v_uv = uv;
                v_worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision mediump float;

            uniform vec2 u_resolution;
            varying vec2 v_uv;
            varying vec3 v_worldPos;

            float hash(vec2 p) {
                return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
            }

            float hash2(vec2 p) {
                return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453);
            }

            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                return mix(
                    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
                    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
                    f.y
                );
            }

            float fbm(vec2 p, int octaves) {
                float value = 0.0;
                float amp = 0.5;
                float freq = 1.0;
                for (int i = 0; i < 6; i++) {
                    if (i >= octaves) break;
                    value += amp * noise(p * freq);
                    amp *= 0.5;
                    freq *= 2.0;
                }
                return value;
            }

            void main() {
                vec2 wp = v_worldPos.xz;

                vec3 grassDark = vec3(0.15, 0.35, 0.08);
                vec3 grassMid = vec3(0.22, 0.48, 0.12);
                vec3 grassLight = vec3(0.35, 0.58, 0.18);
                vec3 grassYellow = vec3(0.55, 0.52, 0.20);
                vec3 dirtBrown = vec3(0.42, 0.32, 0.18);
                vec3 cloverLight = vec3(0.28, 0.45, 0.22);

                float n1 = fbm(wp * 0.08 + vec2(10.0, 20.0), 4);
                float n2 = fbm(wp * 0.15 + vec2(30.0, 50.0), 3);
                float n3 = noise(wp * 0.4 + vec2(5.0, 15.0));
                float microNoise = noise(wp * 2.0);

                vec3 baseColor = mix(grassDark, grassMid, n1);
                baseColor = mix(baseColor, grassLight, n2 * 0.6);

                float yellowPatches = smoothstep(0.55, 0.75, fbm(wp * 0.12 + vec2(100.0, 80.0), 3));
                baseColor = mix(baseColor, grassYellow, yellowPatches * 0.35);

                float dirtPatches = smoothstep(0.7, 0.85, fbm(wp * 0.06 + vec2(200.0, 150.0), 4));
                baseColor = mix(baseColor, dirtBrown, dirtPatches * 0.25);

                float clover = smoothstep(0.6, 0.7, noise(wp * 0.5 + vec2(300.0, 250.0)));
                clover *= smoothstep(0.5, 0.6, noise(wp * 0.3 + vec2(350.0, 300.0)));
                baseColor = mix(baseColor, cloverLight, clover * 0.3);

                float grassBlades = noise(wp * 8.0) * 0.08;
                baseColor += vec3(grassBlades * 0.5, grassBlades, grassBlades * 0.3);

                baseColor += (microNoise - 0.5) * 0.04;

                float ao = 0.92 + n3 * 0.08;
                baseColor *= ao;

                float vignette = 1.0 - length(v_uv - 0.5) * 0.3;
                baseColor *= vignette;

                gl_FragColor = vec4(baseColor, 1.0);
            }
        `,
        side: THREE.DoubleSide,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1
    });

    // Make sure these settings are applied to our shader material
    grassShaderMaterial.needsUpdate = true;
    grassShaderMaterial.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);

    // Create the ground mesh with the shader material
    const groundMesh = new THREE.Mesh(groundGeometry, grassShaderMaterial);
    groundMesh.rotation.x = -Math.PI / 2; // Rotate to make it horizontal
    groundMesh.receiveShadow = true;

    // Define an interface for the mesh with a getHeightAt method
    interface GroundMeshWithHeight extends THREE.Mesh {
        getHeightAt(x: number, z: number): number;
        material: THREE.ShaderMaterial; // Add this for TypeScript
    }

    // Create the ground mesh with height functionality
    const customGroundMesh = groundMesh as unknown as GroundMeshWithHeight;

    customGroundMesh.getHeightAt = computeHeight;

    scene.add(groundMesh);
    terrainObjects.push(groundMesh);

    const onResize = (width: number, height: number) => {
        customGroundMesh.material.uniforms.u_resolution.value.set(width, height);
    };

    return { mesh: groundMesh, onResize };
}
