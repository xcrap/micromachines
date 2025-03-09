import * as THREE from 'three';
import { ShaderMaterial, TextureLoader } from 'three';

export function createGround(scene: THREE.Scene, terrainObjects: THREE.Object3D[]): THREE.Mesh {
    const groundSize = 200;
    const groundSegments = 150;
    const groundGeometry = new THREE.PlaneGeometry(groundSize, groundSize, groundSegments, groundSegments);

    const positionAttribute = groundGeometry.getAttribute('position');
    const vertex = new THREE.Vector3();

    for (let i = 0; i < positionAttribute.count; i++) {
        vertex.fromBufferAttribute(positionAttribute, i);

        const distanceFromCenter = Math.sqrt(vertex.x * vertex.x + vertex.z * vertex.z);
        const edgeFactor = Math.min(1, Math.max(0, 1 - distanceFromCenter / (groundSize * 0.5)));

        if (distanceFromCenter > 10) {
            const noise = Math.sin(vertex.x * 0.05) * Math.cos(vertex.z * 0.05) * 0.8;
            vertex.y += noise * edgeFactor;
        }

        positionAttribute.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }

    groundGeometry.computeVertexNormals();

    const vertexShader = `
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
            vNormal = normalize(normalMatrix * normal);
            vPosition = (modelViewMatrix * vec4(position, 1.0)).xyz;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `;

    const fragmentShader = `
        uniform vec3 uColor;
        varying vec3 vNormal;
        varying vec3 vPosition;

        void main() {
            float intensity = dot(vNormal, vec3(0.0, 1.0, 0.0));
            vec3 color = uColor * intensity;
            gl_FragColor = vec4(color, 1.0);
        }
    `;

    const groundMaterial = new ShaderMaterial({
        uniforms: {
            uColor: { value: new THREE.Color(0x22c55e) }
        },
        vertexShader,
        fragmentShader
    });

    const groundMesh = new THREE.Mesh(groundGeometry, groundMaterial);
    groundMesh.rotation.x = -Math.PI / 2;
    groundMesh.receiveShadow = true;
    scene.add(groundMesh);

    terrainObjects.push(groundMesh);

    return groundMesh;
}
