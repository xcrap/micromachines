import * as THREE from "three";
import { RoomEnvironment } from "three/examples/jsm/environments/RoomEnvironment.js";
import type { QualityTier } from "../core/Config";
import type { ThemeEnvironment } from "../tracks/types";

const SUN_DISTANCE = 110;

/**
 * Sun, sky fill and image-based reflections for a theme. The shadow frustum follows a
 * focus point (usually just ahead of the player) so the shadow map covers what is on screen.
 */
export class SceneLighting {
    readonly sun: THREE.DirectionalLight;

    private readonly scene: THREE.Scene;
    private readonly hemisphere: THREE.HemisphereLight;
    private readonly ambient: THREE.AmbientLight;
    private readonly environmentMap: THREE.Texture;
    private readonly shadowRadius: number;
    private readonly shadowMapSize: number;
    private readonly sunOffset = new THREE.Vector3();

    constructor(scene: THREE.Scene, renderer: THREE.WebGLRenderer, quality: QualityTier) {
        this.scene = scene;
        this.shadowRadius = quality.shadowRadius;
        this.shadowMapSize = quality.shadowMapSize;

        const pmrem = new THREE.PMREMGenerator(renderer);
        const room = new RoomEnvironment();
        this.environmentMap = pmrem.fromScene(room, 0.04).texture;
        room.dispose();
        pmrem.dispose();

        this.hemisphere = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
        this.ambient = new THREE.AmbientLight(0xffffff, 0.1);

        this.sun = new THREE.DirectionalLight(0xffffff, 2.5);
        this.sun.castShadow = true;
        const shadow = this.sun.shadow;
        shadow.mapSize.set(quality.shadowMapSize, quality.shadowMapSize);
        shadow.camera.left = -this.shadowRadius;
        shadow.camera.right = this.shadowRadius;
        shadow.camera.top = this.shadowRadius;
        shadow.camera.bottom = -this.shadowRadius;
        shadow.camera.near = 1;
        shadow.camera.far = SUN_DISTANCE * 2.6;
        shadow.bias = -0.0005;
        shadow.normalBias = 0.03;

        scene.add(this.hemisphere, this.ambient, this.sun, this.sun.target);
    }

    public apply(environment: ThemeEnvironment, renderer: THREE.WebGLRenderer): void {
        this.scene.background = new THREE.Color(environment.background);
        this.scene.fog = new THREE.FogExp2(environment.fog.color, environment.fog.density);
        this.scene.environment = this.environmentMap;
        this.scene.environmentIntensity = environment.environmentIntensity;

        this.hemisphere.color.set(environment.hemisphere.sky);
        this.hemisphere.groundColor.set(environment.hemisphere.ground);
        this.hemisphere.intensity = environment.hemisphere.intensity;
        this.ambient.intensity = environment.ambient;

        this.sun.color.set(environment.sun.color);
        this.sun.intensity = environment.sun.intensity;
        this.sunOffset.set(...environment.sun.direction).normalize().multiplyScalar(SUN_DISTANCE);

        renderer.toneMappingExposure = environment.exposure;
    }

    /** Snapping to shadow texels stops shadow edges crawling as the focus point moves. */
    public follow(focus: Readonly<THREE.Vector3>): void {
        const texel = (this.shadowRadius * 2) / this.shadowMapSize;
        const x = Math.round(focus.x / texel) * texel;
        const y = Math.round(focus.y / texel) * texel;
        const z = Math.round(focus.z / texel) * texel;

        this.sun.target.position.set(x, y, z);
        this.sun.target.updateMatrixWorld();
        this.sun.position.set(x + this.sunOffset.x, y + this.sunOffset.y, z + this.sunOffset.z);
        this.sun.updateMatrixWorld();
    }

    public dispose(): void {
        this.scene.remove(this.hemisphere, this.ambient, this.sun, this.sun.target);
        this.hemisphere.dispose();
        this.ambient.dispose();
        this.sun.dispose();
        this.environmentMap.dispose();
        this.scene.environment = null;
    }
}
