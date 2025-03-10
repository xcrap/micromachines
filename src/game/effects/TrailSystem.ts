import * as THREE from 'three';

interface TrailParticle {
    mesh: THREE.Mesh;
    creationTime: number;
    position: THREE.Vector3;
    previousPosition?: THREE.Vector3; // To track previous position for line segments
    width: number;
}

interface TrailSegment {
    mesh: THREE.Mesh;
    creationTime: number;
    startPosition: THREE.Vector3;
    endPosition: THREE.Vector3;
}

export class TrailSystem {
    private scene: THREE.Scene;
    private trailParticles: TrailParticle[] = [];
    private trailSegments: TrailSegment[] = [];
    private trailMaterial: THREE.MeshBasicMaterial;
    private trailGeometry: THREE.PlaneGeometry;
    private readonly TRAIL_LIFETIME: number = 5; // Increased to 5 seconds lifetime
    private trailColor: THREE.Color;
    private validObjectsCache: Map<string, boolean> = new Map();
    private invalidObjectsCache: Map<string, boolean> = new Map();
    private lastTrailPositions: Map<string, THREE.Vector3> = new Map(); // Track last position by wheel ID
    raycaster: THREE.Raycaster;
    private trackObjects: THREE.Object3D[] = [];

    constructor(scene: THREE.Scene, color = 0x333333) {
        this.scene = scene;
        this.trailColor = new THREE.Color(color);
        this.raycaster = new THREE.Raycaster();

        // Create material with transparency for fading
        this.trailMaterial = new THREE.MeshBasicMaterial({
            color: this.trailColor,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide,
            depthWrite: false, // Prevent z-fighting
            blending: THREE.AdditiveBlending, // Better visibility
            // Ensure trails are rendered below other objects
            depthTest: true
        });

        // Small plane for each trail particle
        this.trailGeometry = new THREE.PlaneGeometry(1, 1); // We'll scale it later
    }

    public setTrackObjects(trackObjects: THREE.Object3D[]): void {
        this.trackObjects = trackObjects;
    }

    public addTrail(position: THREE.Vector3, rotation: number, color?: THREE.Color, wheelId: string = 'default', width: number = 0.08): void {
        // Check if position is on track or ground and adjust color accordingly
        const isOnTrack = this.isOnTrackSurface(position);

        // Create a material for this trail
        const material = this.trailMaterial.clone();

        // Set color based on surface if not explicitly provided
        if (!color) {
            if (isOnTrack) {
                // Brown for track
                material.color = new THREE.Color(0x8B4513);
            } else {
                // Green for grass/ground
                material.color = new THREE.Color(0x4CAF50);
            }
        } else {
            material.color = color;
        }

        // Get previous position for this wheel
        const prevPosition = this.lastTrailPositions.get(wheelId);

        // Create a trail segment if we have a previous position
        if (prevPosition && position.distanceTo(prevPosition) < 0.5) {
            // Create a line segment between the two points
            const segment = this.createTrailSegment(prevPosition, position, rotation, material, width);
            if (segment) {
                this.trailSegments.push(segment);
            }
        } else {
            // If no previous position or too far away, just create a single mark
            const mesh = new THREE.Mesh(this.trailGeometry, material);
            mesh.renderOrder = -100;

            mesh.position.set(position.x, position.y + 0.01, position.z);
            mesh.rotation.x = -Math.PI / 2;
            mesh.rotation.z = rotation;

            // Scale the mesh to desired width
            mesh.scale.set(0.15, width, 1);

            this.scene.add(mesh);

            const trailParticle: TrailParticle = {
                mesh,
                creationTime: Date.now() / 1000, // Current time in seconds
                position: position.clone(),
                width: width
            };

            this.trailParticles.push(trailParticle);
        }

        // Update the last position for this wheel
        this.lastTrailPositions.set(wheelId, position.clone());
    }

    private createTrailSegment(startPos: THREE.Vector3, endPos: THREE.Vector3, rotation: number, material: THREE.Material, width: number): TrailSegment | null {
        // Calculate the length of the segment
        const length = startPos.distanceTo(endPos);
        if (length < 0.01) {
            return null; // Too short to create a segment
        }

        // Create a custom geometry for the segment
        const segmentGeometry = new THREE.PlaneGeometry(length, width);

        // Create mesh
        const mesh = new THREE.Mesh(segmentGeometry, material);
        mesh.renderOrder = -100;

        // Position at the midpoint between start and end
        const midPoint = new THREE.Vector3().addVectors(startPos, endPos).multiplyScalar(0.5);
        mesh.position.set(midPoint.x, midPoint.y + 0.01, midPoint.z);

        // Calculate the direction from start to end
        const direction = new THREE.Vector3().subVectors(endPos, startPos);
        const angle = Math.atan2(direction.x, direction.z);

        // Rotate to lie flat on ground
        mesh.rotation.x = -Math.PI / 2;
        // Rotate to match the line direction
        mesh.rotation.z = angle;

        // Add to scene
        this.scene.add(mesh);

        return {
            mesh,
            creationTime: Date.now() / 1000,
            startPosition: startPos.clone(),
            endPosition: endPos.clone()
        };
    }

    private isOnTrackSurface(position: THREE.Vector3): boolean {
        // If no track objects are set, we can't determine surface
        if (this.trackObjects.length === 0) {
            return true;
        }

        // Cast ray down from slightly above position
        this.raycaster.set(
            new THREE.Vector3(position.x, position.y + 1, position.z),
            new THREE.Vector3(0, -1, 0)
        );

        // Check intersection with track objects
        const intersects = this.raycaster.intersectObjects(this.trackObjects, true);

        // Return true if we hit a track object
        return intersects.length > 0;
    }

    public update(): void {
        const currentTime = Date.now() / 1000;

        // Update each trail particle
        for (let i = this.trailParticles.length - 1; i >= 0; i--) {
            const trail = this.trailParticles[i];
            const age = currentTime - trail.creationTime;

            // If the trail is older than lifetime, remove it
            if (age > this.TRAIL_LIFETIME) {
                this.scene.remove(trail.mesh);
                this.trailParticles.splice(i, 1);
                continue;
            }

            // Calculate opacity based on age (fading out)
            const opacity = 1 - (age / this.TRAIL_LIFETIME);

            // Update material opacity
            if (trail.mesh.material instanceof THREE.MeshBasicMaterial) {
                trail.mesh.material.opacity = opacity * 0.7; // Max opacity is 0.7
            }
        }

        // Update each trail segment
        for (let i = this.trailSegments.length - 1; i >= 0; i--) {
            const segment = this.trailSegments[i];
            const age = currentTime - segment.creationTime;

            // If the segment is older than lifetime, remove it
            if (age > this.TRAIL_LIFETIME) {
                this.scene.remove(segment.mesh);
                this.trailSegments.splice(i, 1);
                continue;
            }

            // Calculate opacity based on age (fading out)
            const opacity = 1 - (age / this.TRAIL_LIFETIME);

            // Update material opacity
            if (segment.mesh.material instanceof THREE.MeshBasicMaterial) {
                segment.mesh.material.opacity = opacity * 0.7; // Max opacity is 0.7
            }
        }
    }

    public dispose(): void {
        // Clean up all trail particles
        for (const trail of this.trailParticles) {
            this.scene.remove(trail.mesh);
            if (trail.mesh.material instanceof THREE.Material) {
                trail.mesh.material.dispose();
            }
        }

        // Clean up all trail segments
        for (const segment of this.trailSegments) {
            this.scene.remove(segment.mesh);
            if (segment.mesh.material instanceof THREE.Material) {
                segment.mesh.material.dispose();
            }
        }

        this.trailGeometry.dispose();
        this.trailMaterial.dispose();
        this.trailParticles = [];
        this.trailSegments = [];

        // Clear caches
        this.validObjectsCache.clear();
        this.invalidObjectsCache.clear();
        this.lastTrailPositions.clear();
    }

    public setTrailColor(color: THREE.Color | number): void {
        if (color instanceof THREE.Color) {
            this.trailColor = color;
        } else {
            this.trailColor = new THREE.Color(color);
        }
        this.trailMaterial.color = this.trailColor;
    }
}
