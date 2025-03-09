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
    private trailColor: THREE.Color;
    private validObjectsCache: Map<string, boolean> = new Map();
    private invalidObjectsCache: Map<string, boolean> = new Map();
    raycaster: THREE.Raycaster;    

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
        this.trailGeometry = new THREE.PlaneGeometry(0.15, 0.08);

    }

    public addTrail(position: THREE.Vector3, rotation: number, color?: THREE.Color): void {
        // Skip ground type checking for now as we'll handle positioning differently
        
        // Create a new trail particle
        const material = this.trailMaterial.clone();
        if (color) {
            material.color = color;
        }
        const mesh = new THREE.Mesh(this.trailGeometry, material);

        // Set a very low renderOrder to ensure it renders below everything
        mesh.renderOrder = -100;
        
        // Position the trail with an offset that's very close to the ground
        // The key is to position it just slightly above the terrain but below any objects
        mesh.position.set(position.x, position.y + 0.01, position.z);

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

        // Clear caches
        this.validObjectsCache.clear();
        this.invalidObjectsCache.clear();
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
