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
    const heightMap: Map<string, number> = new Map();

    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);

        // Simple noise function for height variation
        const distance = Math.sqrt(vertex.x * vertex.x + vertex.y * vertex.y);

        // Add some variation to make it look more natural
        let height = Math.sin(vertex.x * 0.05) * Math.cos(vertex.y * 0.05) * 2.0;

        // Add some larger hills
        height += Math.sin(vertex.x * 0.02) * Math.cos(vertex.y * 0.02) * 5.0;

        // Keep the center area relatively flat for the track
        if (distance > 20) {
            vertex.z = height;
        } else {
            // Smoothly transition from flat to varied terrain
            vertex.z = (height * (distance - 10)) / 10;
        }

        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);

        // Store the height for this x,y coordinate for later use
        const key = `${Math.round(vertex.x)},${Math.round(vertex.y)}`;
        heightMap.set(key, vertex.z);
    }

    // Update the geometry
    groundGeometry.computeVertexNormals();

    // Create shader material for grass (without mouse interaction)
    const grassShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            u_time: { value: 0.0 },
            u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) }
        },
        vertexShader: `
            varying vec2 v_uv;

            void main() {
                v_uv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            precision mediump float;

            uniform float u_time;
            uniform vec2 u_resolution;
            varying vec2 v_uv;

            // Simplex 2D noise
            vec3 permute(vec3 x) { return mod(((x*34.0)+1.0)*x, 289.0); }

            float snoise(vec2 v) {
              const vec4 C = vec4(0.211324865405187, 0.366025403784439,
                       -0.577350269189626, 0.024390243902439);
              vec2 i  = floor(v + dot(v, C.yy));
              vec2 x0 = v -   i + dot(i, C.xx);
              vec2 i1;
              i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
              vec4 x12 = x0.xyxy + C.xxzz;
              x12.xy -= i1;
              i = mod(i, 289.0);
              vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0))
              + i.x + vec3(0.0, i1.x, 1.0));
              vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy),
                dot(x12.zw,x12.zw)), 0.0);
              m = m*m;
              m = m*m;
              vec3 x = 2.0 * fract(p * C.www) - 1.0;
              vec3 h = abs(x) - 0.5;
              vec3 ox = floor(x + 0.5);
              vec3 a0 = x - ox;
              m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);
              vec3 g;
              g.x  = a0.x  * x0.x  + h.x  * x0.y;
              g.yz = a0.yz * x12.xz + h.yz * x12.yw;
              return 130.0 * dot(m, g);
            }

            // FBM function
            float fbm(vec2 p, int octaves) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 1.0;

                for (int i = 0; i < 8; i++) {
                    if (i >= octaves) break;
                    value += amplitude * snoise(p * frequency);
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }

                return value;
            }

            // Grass detail function
            float grassDetail(vec2 p) {
                return fbm(p * 20.0, 3) * 0.1;
            }

            void main() {
                // Correct aspect ratio
                vec2 uv = v_uv;
                uv.x *= u_resolution.x / u_resolution.y;

                // Base terrain elevation
                float elevation = fbm(uv * 2.0 + u_time * 0.05, 5) * 0.5 + 0.5;

                // Add grass detail with subtle movement
                float detail = grassDetail(uv + vec2(u_time * 0.02, 0.0));
                elevation += detail;

                // Base green color for grass
                vec3 lowGrass = vec3(0.2, 0.5, 0.1);
                vec3 highGrass = vec3(0.45, 0.75, 0.15);
                vec3 dirt = vec3(0.6, 0.5, 0.3);
                vec3 flowers = vec3(0.9, 0.8, 0.2);

                // Mix colors based on elevation and noise
                vec3 grassColor = mix(lowGrass, highGrass, elevation);

                // Add some dirt patches
                float dirtNoise = fbm(uv * 5.0, 3);
                if (dirtNoise > 0.7 && elevation < 0.45) {
                    grassColor = mix(grassColor, dirt, (dirtNoise - 0.7) * 3.0);
                }

                // Add some flowers
                float flowerNoise = fbm(uv * 10.0 + vec2(0.0, u_time * 0.05), 2);
                if (flowerNoise > 0.75 && elevation > 0.5) {
                    grassColor = mix(grassColor, flowers, (flowerNoise - 0.75) * 4.0);
                }

                // Add shadows and highlights based on time
                float shadow = fbm(uv * 3.0 + vec2(u_time * 0.1, 0.0), 4) * 0.2;
                grassColor -= shadow;

                // Apply a subtle vignette
                float vignette = 1.0 - length(v_uv - 0.5) * 0.5;
                grassColor *= vignette;

                gl_FragColor = vec4(grassColor, 1.0);

                #ifdef PHYSICAL
                  #include <colorspace_fragment>
                #endif
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

    // Add a height function to the mesh
    customGroundMesh.getHeightAt = (x: number, z: number): number => {
        // Convert to the coordinate system used in the heightMap
        const key = `${Math.round(x)},${Math.round(z)}`;

        if (heightMap.has(key)) {
            return heightMap.get(key) || 0;
        }

        // Fallback to calculation
        let height = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 2.0;
        height += Math.sin(x * 0.02) * Math.cos(z * 0.02) * 5.0;

        const distance = Math.sqrt(x * x + z * z);
        if (distance > 20) {
            return height;
        }
        // Return smoothly transitioned height for center area
        return (height * (distance - 10)) / 10;
    };

    scene.add(groundMesh);
    terrainObjects.push(groundMesh);

    const onResize = (width: number, height: number) => {
        customGroundMesh.material.uniforms.u_resolution.value.set(width, height);
    };

    return { mesh: groundMesh, onResize };
}
