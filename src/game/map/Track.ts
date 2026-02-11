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

    // Track geometry parameters — extra bleed for organic edge blending
    const trackWidth = 10;
    const bleedWidth = 3.0;
    const totalHalfW = trackWidth / 2 + bleedWidth;
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

    const heightOffset = 0.35;
    const widthSegments = 6;

    for (let i = 0; i < splinePoints.length; i++) {
        const point3D = splinePoints[i];
        const n2D = normals[i];

        for (let j = 0; j <= widthSegments; j++) {
            const t = j / widthSegments;
            const offset = (t - 0.5) * 2.0 * totalHalfW;
            const px = point3D.x + n2D.x * offset;
            const pz = point3D.z + n2D.y * offset;
            const py = getHeightAt(px, pz) + heightOffset;

            vertices.push(px, py, pz);
            uvs.push(t, i / splinePoints.length);
        }

        const vertsPerRow = widthSegments + 1;
        const rowStart = i * vertsPerRow;
        const nextRowStart = ((i + 1) % splinePoints.length) * vertsPerRow;

        for (let j = 0; j < widthSegments; j++) {
            const a = rowStart + j;
            const b = rowStart + j + 1;
            const c = nextRowStart + j;
            const d = nextRowStart + j + 1;
            indices.push(a, b, c);
            indices.push(b, d, c);
        }
    }

    // Create BufferGeometry.
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();

    const edgeRatio = bleedWidth / (trackWidth / 2 + bleedWidth);

    const trackShaderMaterial = new THREE.ShaderMaterial({
        uniforms: {
            u_time: { value: 0.0 },
            u_resolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
            u_edgeRatio: { value: edgeRatio }
        },
        transparent: true,
        depthWrite: true,
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
            precision highp float;

            uniform float u_edgeRatio;
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

            float voronoi(vec2 p) {
                vec2 i = floor(p);
                vec2 f = fract(p);
                float minDist = 1.0;
                for (int y = -1; y <= 1; y++) {
                    for (int x = -1; x <= 1; x++) {
                        vec2 neighbor = vec2(float(x), float(y));
                        vec2 point = vec2(hash(i + neighbor), hash2(i + neighbor));
                        vec2 diff = neighbor + point - f;
                        minDist = min(minDist, dot(diff, diff));
                    }
                }
                return sqrt(minDist);
            }

            void main() {
                vec2 uv = v_uv;
                vec2 wp = v_worldPos.xz * 0.15;

                // Organic edge alpha — noise-driven fade in the bleed margin
                float edgeDist = min(uv.x, 1.0 - uv.x);
                float edgeNorm = edgeDist / u_edgeRatio;

                float edgeNoise1 = fbm(wp * 3.0 + vec2(77.0, 33.0), 4);
                float edgeNoise2 = noise(wp * 8.0 + vec2(11.0, 55.0));
                float edgeNoise3 = noise(wp * 16.0 + vec2(44.0, 22.0));
                float noisyEdge = edgeNorm + (edgeNoise1 - 0.5) * 0.5
                                           + (edgeNoise2 - 0.5) * 0.2
                                           + (edgeNoise3 - 0.5) * 0.1;

                float edgeAlpha = edgeDist > u_edgeRatio
                    ? 1.0
                    : smoothstep(0.0, 0.6, noisyEdge);
                if (edgeAlpha < 0.01) discard;

                // Remap UV to track-only portion (excluding bleed)
                float trackU = (uv.x - u_edgeRatio) / (1.0 - 2.0 * u_edgeRatio);
                trackU = clamp(trackU, 0.0, 1.0);

                vec3 dirtDark = vec3(0.32, 0.22, 0.13);
                vec3 dirtMid = vec3(0.48, 0.34, 0.22);
                vec3 dirtLight = vec3(0.58, 0.44, 0.30);
                vec3 dirtPale = vec3(0.65, 0.52, 0.38);
                vec3 mudDark = vec3(0.22, 0.16, 0.10);
                vec3 gravelGrey = vec3(0.55, 0.52, 0.48);

                float coarseNoise = fbm(wp * 1.5 + vec2(3.7, 8.2), 4);
                float medNoise = fbm(wp * 4.0 + vec2(12.1, 5.9), 5);
                float fineNoise = fbm(wp * 12.0 + vec2(7.3, 22.1), 4);
                float microDetail = noise(wp * 30.0 + vec2(1.3, 4.7));

                float dirtBlend = coarseNoise * 0.5 + medNoise * 0.35 + fineNoise * 0.15;

                vec3 baseColor = mix(dirtDark, dirtMid, smoothstep(0.25, 0.55, dirtBlend));
                baseColor = mix(baseColor, dirtLight, smoothstep(0.5, 0.75, dirtBlend));
                baseColor = mix(baseColor, dirtPale, smoothstep(0.7, 0.9, coarseNoise) * 0.3);

                baseColor += (microDetail - 0.5) * 0.06;

                float gravelPattern = voronoi(wp * 18.0);
                float gravelMask = smoothstep(0.08, 0.18, gravelPattern);
                float gravelScatter = smoothstep(0.55, 0.65, noise(wp * 6.0 + vec2(9.1, 3.3)));
                baseColor = mix(baseColor, gravelGrey * (0.8 + gravelPattern * 0.3), gravelScatter * (1.0 - gravelMask) * 0.4);

                float pebbleMask = smoothstep(0.82, 0.88, noise(wp * 25.0 + vec2(44.0, 17.0)));
                vec3 pebbleColor = vec3(0.5 + hash(floor(wp * 25.0)) * 0.15, 0.48, 0.44);
                baseColor = mix(baseColor, pebbleColor, pebbleMask * 0.35);

                float crackSeed = noise(wp * 3.0 + vec2(55.0, 33.0));
                float crackDetail = voronoi(wp * 8.0 + vec2(crackSeed * 2.0));
                float crackLine = smoothstep(0.02, 0.05, crackDetail);
                float crackMask = smoothstep(0.6, 0.8, noise(wp * 1.5 + vec2(20.0, 10.0)));
                baseColor *= mix(1.0, crackLine * 0.85 + 0.15, crackMask * 0.5);

                float muddyAreas = smoothstep(0.55, 0.7, fbm(wp * 2.0 + vec2(15.0, 25.0), 4));
                float wetness = muddyAreas * 0.45;
                baseColor = mix(baseColor, mudDark, wetness);
                baseColor *= 1.0 - wetness * 0.15;

                float dustPatches = smoothstep(0.6, 0.75, fbm(wp * 2.5 + vec2(40.0, 60.0), 3));
                baseColor = mix(baseColor, dirtPale * 1.1, dustPatches * 0.2);

                // Edge color transition: dirt→grassy-brown at margins
                float innerEdge = smoothstep(0.0, 0.18, edgeDist / max(u_edgeRatio, 0.01));
                vec3 edgeTint = mix(vec3(0.30, 0.33, 0.18), dirtDark, 0.4);
                baseColor = mix(edgeTint, baseColor, innerEdge);

                float ao = 0.92 + fineNoise * 0.08;
                baseColor *= ao;

                gl_FragColor = vec4(baseColor, edgeAlpha);
            }
        `,
        side: THREE.DoubleSide,
    });

    trackShaderMaterial.needsUpdate = true;
    trackShaderMaterial.uniforms.u_resolution.value.set(window.innerWidth, window.innerHeight);

    const trackMesh = new THREE.Mesh(geometry, trackShaderMaterial);
    trackMesh.receiveShadow = true;
    trackMesh.renderOrder = -200;
    scene.add(trackMesh);
    terrainObjects.push(trackMesh);

    for (let i = 0; i < splinePoints.length; i++) {
        const point = splinePoints[i];
        point.y = getHeightAt(point.x, point.z) + heightOffset;
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
