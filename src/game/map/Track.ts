import * as THREE from 'three';

export function createTrack(scene: THREE.Scene, terrainObjects: THREE.Object3D[], groundMesh: THREE.Mesh) {
    // Define control points for a dynamic rally track with smoother transitions.
    const controlPoints = [
        new THREE.Vector3(0, 0, -80),
        new THREE.Vector3(20, 0, -40),
        new THREE.Vector3(40, 0, -20),
        new THREE.Vector3(60, 0, 0),
        new THREE.Vector3(40, 0, 20),
        new THREE.Vector3(20, 0, 40),
        new THREE.Vector3(0, 0, 60),
        new THREE.Vector3(-20, 0, 40),
        new THREE.Vector3(-40, 0, 20),
        new THREE.Vector3(-60, 0, 0),
        new THREE.Vector3(-40, 0, -20),
        new THREE.Vector3(-20, 0, -40)
    ];

    // Create a closed Catmull–Rom curve.
    const curve = new THREE.CatmullRomCurve3(controlPoints, true);
    curve.tension = 0.3;

    // Increase divisions for a smoother path sampling.
    const divisions = 400;
    const splinePoints = curve.getPoints(divisions);

    // Track geometry parameters.
    const trackWidth = 10;
    const vertices = [];
    const uvs = [];
    const indices = [];

    // Compute normals by deriving the tangent and taking its perpendicular on the XZ plane.
    const normals = [];
    for (let i = 0; i < splinePoints.length; i++) {
        const t = i / splinePoints.length;
        const tangent3D = curve.getTangent(t);
        const tangent2D = new THREE.Vector2(tangent3D.x, tangent3D.z).normalize();
        const normal2D = new THREE.Vector2(-tangent2D.y, tangent2D.x);
        normals.push(normal2D);
    }

    // Get the height function
    const getHeightAt = (groundMesh as THREE.Mesh & {
        getHeightAt: (x: number, z: number) => number
    }).getHeightAt;

    // Build the strip geometry along the curve.
    for (let i = 0; i < splinePoints.length; i++) {
        const point3D = splinePoints[i];
        const n2D = normals[i];
        const halfW = trackWidth / 2;

        // Calculate outer and inner edge positions
        const outerX = point3D.x + n2D.x * halfW;
        const outerZ = point3D.z + n2D.y * halfW;

        const innerX = point3D.x - n2D.x * halfW;
        const innerZ = point3D.z - n2D.y * halfW;

        // Get heights at the exact outer and inner positions (with a small elevation to avoid z-fighting)
        const outerHeight = getHeightAt(outerX, outerZ) + 0.15;
        const innerHeight = getHeightAt(innerX, innerZ) + 0.15;

        // Outer edge vertex
        vertices.push(outerX, outerHeight, outerZ);

        // Inner edge vertex
        vertices.push(innerX, innerHeight, innerZ);

        // UV mapping along the track.
        // We'll make the vertical coordinate (v) run along the track
        // and the horizontal coordinate (u) go from left edge (0) to right edge (1)
        uvs.push(0, i / splinePoints.length);
        uvs.push(1, i / splinePoints.length);

        // Construct triangles for the quad between segments.
        const idx = i * 2;
        const nextIdx = ((i + 1) % splinePoints.length) * 2;
        indices.push(idx, idx + 1, nextIdx);
        indices.push(idx + 1, nextIdx + 1, nextIdx);
    }

    // Create BufferGeometry.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    // Custom shader material for the track without mouse interaction
    const trackShaderMaterial = new THREE.ShaderMaterial({
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

            // Hash function for random values
            float hash(float n) {
                return fract(sin(n) * 43758.5453);
            }

            // 2D noise function
            float noise(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                f = f * f * (3.0 - 2.0 * f);
                float n = i.x + i.y * 57.0;
                return mix(
                    mix(hash(n), hash(n + 1.0), f.x),
                    mix(hash(n + 57.0), hash(n + 58.0), f.x),
                    f.y
                );
            }

            // Fractional Brownian Motion
            float fbm(vec2 p) {
                float value = 0.0;
                float amplitude = 0.5;
                float frequency = 2.0;
                for (int i = 0; i < 5; i++) {
                    value += amplitude * noise(p * frequency);
                    amplitude *= 0.5;
                    frequency *= 2.0;
                }
                return value;
            }

            // Tire track pattern
            float tireTrack(vec2 uv, float offset) {
                float track = 0.0;

                // Track width and grooves
                float trackWidth = 0.3;
                float grooveWidth = 0.03;
                float grooveDepth = 0.7;

                // Calculate distance from track center
                float dist = abs(uv.x - offset);

                // Main track
                if (dist < trackWidth) {
                    track = 1.0;

                    // Add tire grooves
                    float groovePattern = sin(uv.y * 30.0) * 0.5 + 0.5;
                    if (mod(uv.y * 10.0 + sin(uv.x * 5.0) * 0.5, 1.0) < 0.5 * groovePattern) {
                        track *= grooveDepth;
                    }
                }

                return track;
            }

            void main() {
                // Correct aspect ratio
                vec2 uv = v_uv;
                float aspect = u_resolution.x / u_resolution.y;

                // Dirt road base color
                vec3 dirtColor1 = vec3(0.45, 0.29, 0.18); // Dark brown
                vec3 dirtColor2 = vec3(0.60, 0.40, 0.25); // Medium brown
                vec3 dirtColor3 = vec3(0.76, 0.56, 0.38); // Light brown

                // Create base dirt texture with noise
                float dirtNoise = fbm(uv * 5.0 + u_time * 0.05);
                float dirtDetail = fbm(uv * 20.0 - u_time * 0.02);

                // Combine noise layers for dirt texture
                float dirtPattern = dirtNoise * 0.7 + dirtDetail * 0.3;

                // Mix dirt colors based on noise
                vec3 baseColor = mix(dirtColor1, dirtColor2, dirtPattern);
                baseColor = mix(baseColor, dirtColor3, dirtDetail * dirtDetail * 0.5);

                // Add small stones/pebbles
                float pebbles = smoothstep(0.75, 0.8, noise(uv * 40.0));
                baseColor = mix(baseColor, vec3(0.65, 0.6, 0.55), pebbles * 0.3);

                // Add tire tracks
                float leftTrack = tireTrack(uv, 0.3);
                float rightTrack = tireTrack(uv, 0.7);

                // Combine tracks and make them darker
                float tracks = max(leftTrack, rightTrack);
                vec3 trackColor = dirtColor1 * 0.7;

                // Apply tracks to base color
                vec3 finalColor = mix(baseColor, trackColor, tracks * 0.6);

                // Add some puddles/mud
                float puddles = smoothstep(0.6, 0.7, fbm(uv * 3.0 + u_time * 0.1));
                finalColor = mix(finalColor, vec3(0.25, 0.2, 0.15), puddles * 0.5);

                // Add some variation based on time
                finalColor *= 0.9 + 0.1 * sin(u_time * 0.2);

                // Output final color
                gl_FragColor = vec4(finalColor, 1.0);

                #ifdef PHYSICAL
                  #include <colorspace_fragment>
                #endif
            }
        `,
        side: THREE.DoubleSide,
    });

    trackShaderMaterial.needsUpdate = true;
    trackShaderMaterial.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);

    // Create the mesh and add it to the scene.
    const trackMesh = new THREE.Mesh(geometry, trackShaderMaterial);
    trackMesh.receiveShadow = true;
    scene.add(trackMesh);
    terrainObjects.push(trackMesh);

    // Update splinePoints with correct heights for use in other functions
    for (let i = 0; i < splinePoints.length; i++) {
        const point = splinePoints[i];
        point.y = getHeightAt(point.x, point.z) + 0.15;
    }

    // Convert 3D points to 2D Vector2 for finish line creation
    const trackPoints2D = splinePoints.map(point => new THREE.Vector2(point.x, point.z));

    const onResize = (width: number, height: number) => {
        (trackMesh.material as THREE.ShaderMaterial).uniforms.u_resolution.value.set(width, height);
    };

    return {
        trackMesh,
        trackPoints: trackPoints2D,
        startPosition: splinePoints[0],
        startDirection: curve.getTangent(0),
        onResize
    };
}
