import * as THREE from 'three';

export function createTrack(scene: THREE.Scene, terrainObjects: THREE.Object3D[]) {
    // Define control points for a dynamic rally track with smoother transitions.
    // These points are arranged in a roughly oval layout with varying curvatures.
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
    // A slightly lower tension (0.3) helps avoid overly sharp joint extensions.
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

    // Build the strip geometry along the curve.
    for (let i = 0; i < splinePoints.length; i++) {
        const point3D = splinePoints[i];
        const n2D = normals[i];
        const halfW = trackWidth / 2;

        // Outer edge vertex (offset by the normal)
        vertices.push(
            point3D.x + n2D.x * halfW,
            point3D.y + 0.01, // slight elevation to avoid z-fighting
            point3D.z + n2D.y * halfW
        );
        // Inner edge vertex (offset in the opposite direction)
        vertices.push(
            point3D.x - n2D.x * halfW,
            point3D.y + 0.01,
            point3D.z - n2D.y * halfW
        );

        // UV mapping along the track.
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

    // Material for the track.
    const material = new THREE.MeshStandardMaterial({
        color: 0x8b4513,
        roughness: 1.0,
        metalness: 0.0,
        side: THREE.DoubleSide,
    });

    // Create the mesh, add it to the scene, and store in terrainObjects.
    const trackMesh = new THREE.Mesh(geometry, material);
    trackMesh.receiveShadow = true;
    scene.add(trackMesh);
    terrainObjects.push(trackMesh);

    // Convert 3D points to 2D Vector2 for finish line creation
    const trackPoints2D = splinePoints.map(point => new THREE.Vector2(point.x, point.z));

    return {
        trackMesh,
        trackPoints: trackPoints2D,
        startPosition: splinePoints[0], // Return the start position for the car
        startDirection: curve.getTangent(0) // Return the starting direction
    };
}
