import * as THREE from 'three';

interface TrailParticle {
    mesh: THREE.Mesh;
    creationTime: number;
    position: THREE.Vector3;
}

export class TrailSystem {
    private scene: THREE.Scene;
    private trailParticles: TrailParticle[] = [];
    private trailMaterial: THREE.MeshBasicMaterial;
    private trailGeometry: THREE.PlaneGeometry;
    private readonly TRAIL_LIFETIME: number = 3; // 3 seconds lifetime

    constructor(scene: THREE.Scene) {
        this.scene = scene;

        // Create material with transparency for fading
        this.trailMaterial = new THREE.MeshBasicMaterial({
            color: 0x333333,
            transparent: true,
            opacity: 0.7,
            side: THREE.DoubleSide
        });

        // Small plane for each trail particle
        this.trailGeometry = new THREE.PlaneGeometry(0.15, 0.08);
    }

    public addTrail(position: THREE.Vector3, rotation: number): void {
        // Create a new trail particle
        const mesh = new THREE.Mesh(this.trailGeometry, this.trailMaterial.clone());

        // Position the trail on the ground with a small offset to prevent z-fighting
        mesh.position.set(position.x, 0.01, position.z);

        // Rotate to lay flat on the ground
        mesh.rotation.x = -Math.PI / 2;

        // Apply car's rotation to the trail
        mesh.rotation.z = rotation;

        // Add to scene
        this.scene.add(mesh);

        // Save creation time for fade out
        const trailParticle: TrailParticle = {
            mesh,
            creationTime: Date.now() / 1000, // Current time in seconds
            position: position.clone()
        };

        this.trailParticles.push(trailParticle);
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
    }

    public dispose(): void {
        // Clean up all trail particles
        for (const trail of this.trailParticles) {
            this.scene.remove(trail.mesh);
            if (trail.mesh.material instanceof THREE.Material) {
                trail.mesh.material.dispose();
            }
        }

        this.trailGeometry.dispose();
        this.trailMaterial.dispose();
        this.trailParticles = [];
    }
}
