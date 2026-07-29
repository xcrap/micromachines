import * as THREE from "three";
import { TRACK_WIDTH } from "../core/Config";
import type { TrackPath } from "./TrackPath";
import type { Terrain } from "./Terrain";
import type { Obstacle } from "./Scatter";

export interface FinishLineResult {
    group: THREE.Group;
    obstacles: Obstacle[];
    /** `lit` red lights during the countdown; `go` switches the whole bar to green. */
    setStartLights(lit: number, go: boolean): void;
    dispose(): void;
}

const HALF_WIDTH = TRACK_WIDTH / 2;
const PILLAR_OFFSET = HALF_WIDTH + 2.6;
const PILLAR_HEIGHT = 6.2;
const LIGHT_COUNT = 5;

/** The start lights live inside the gantry sign, so their layout is driven by its texture. */
const BANNER_HEIGHT = 2.9;
const BANNER_TEXTURE_WIDTH = 2048;
const BANNER_TEXTURE_HEIGHT = 366;
const SOCKET_CENTER_Y_PX = 268;
const SOCKET_RADIUS_PX = 34;
const SOCKET_SPACING_PX = 132;

const RED_OFF = new THREE.Color(0x2e0c0c);
const RED_ON = new THREE.Color(0xff2418);
const GREEN_ON = new THREE.Color(0x2bff5a);

export function createFinishLine(trackPath: TrackPath, terrain: Terrain): FinishLineResult {
    const root = new THREE.Group();
    root.name = "finish-line";
    root.userData.nonCollidable = true;

    const disposables: { dispose(): void }[] = [];
    const obstacles: Obstacle[] = [];

    const start = trackPath.samples[0];
    const yaw = Math.atan2(start.tangentX, start.tangentZ);
    const baseHeight = terrain.getHeightAt(start.x, start.z);

    // The gantry is built facing +Z and then placed on the track; the painted line is world-space.
    const group = new THREE.Group();
    group.position.set(start.x, baseHeight, start.z);
    group.rotation.y = yaw;
    root.add(group);

    const steelMaterial = new THREE.MeshStandardMaterial({ color: 0xd8dde2, roughness: 0.35, metalness: 0.85 });
    const accentMaterial = new THREE.MeshStandardMaterial({ color: 0xd8261f, roughness: 0.45, metalness: 0.25 });
    disposables.push(steelMaterial, accentMaterial);

    const pillarGeometry = new THREE.CylinderGeometry(0.28, 0.34, PILLAR_HEIGHT, 10);
    const footGeometry = new THREE.CylinderGeometry(0.55, 0.7, 0.5, 10);
    disposables.push(pillarGeometry, footGeometry);

    for (const side of [-1, 1]) {
        const pillar = new THREE.Mesh(pillarGeometry, steelMaterial);
        pillar.position.set(side * PILLAR_OFFSET, PILLAR_HEIGHT / 2, 0);
        pillar.castShadow = true;
        group.add(pillar);

        const foot = new THREE.Mesh(footGeometry, accentMaterial);
        foot.position.set(side * PILLAR_OFFSET, 0.25, 0);
        foot.castShadow = true;
        group.add(foot);

        const worldX = start.x + -start.tangentZ * side * PILLAR_OFFSET;
        const worldZ = start.z + start.tangentX * side * PILLAR_OFFSET;
        obstacles.push({ x: worldX, z: worldZ, radius: 0.7, height: PILLAR_HEIGHT, solidity: 1 });
    }

    const beamGeometry = new THREE.BoxGeometry(PILLAR_OFFSET * 2 + 0.6, 0.34, 0.34);
    const beam = new THREE.Mesh(beamGeometry, steelMaterial);
    beam.position.set(0, PILLAR_HEIGHT - 0.2, 0);
    beam.castShadow = true;
    group.add(beam);
    disposables.push(beamGeometry);

    // The gantry faces along the travel direction, so the sign is turned to greet the driver.
    // Everything inside this group is authored in sign space, matching the banner texture.
    const bannerWidth = PILLAR_OFFSET * 2;
    const signGroup = new THREE.Group();
    signGroup.position.set(0, PILLAR_HEIGHT + 1.35, 0);
    signGroup.rotation.y = Math.PI;
    group.add(signGroup);

    const bannerTexture = createBannerTexture();
    const bannerMaterial = new THREE.MeshStandardMaterial({
        map: bannerTexture,
        roughness: 0.72,
        metalness: 0.05,
        side: THREE.DoubleSide,
    });
    const bannerGeometry = new THREE.PlaneGeometry(bannerWidth, BANNER_HEIGHT);
    const banner = new THREE.Mesh(bannerGeometry, bannerMaterial);
    banner.castShadow = true;
    signGroup.add(banner);
    disposables.push(bannerTexture, bannerMaterial, bannerGeometry);

    // Emissive lenses sit exactly on the sockets painted into the sign.
    const pixelToWorld = bannerWidth / BANNER_TEXTURE_WIDTH;
    const lensGeometry = new THREE.CircleGeometry(SOCKET_RADIUS_PX * pixelToWorld * 0.78, 18);
    disposables.push(lensGeometry);

    const lightMaterials: THREE.MeshStandardMaterial[] = [];

    for (let i = 0; i < LIGHT_COUNT; i++) {
        const socketPixelX = BANNER_TEXTURE_WIDTH / 2 + (i - (LIGHT_COUNT - 1) / 2) * SOCKET_SPACING_PX;
        const localX = (socketPixelX / BANNER_TEXTURE_WIDTH - 0.5) * bannerWidth;
        const localY = (0.5 - SOCKET_CENTER_Y_PX / BANNER_TEXTURE_HEIGHT) * BANNER_HEIGHT;

        const material = new THREE.MeshStandardMaterial({
            color: 0x120404,
            emissive: RED_OFF,
            emissiveIntensity: 0.7,
            roughness: 0.25,
        });
        const lens = new THREE.Mesh(lensGeometry, material);
        lens.position.set(localX, localY, 0.02);
        signGroup.add(lens);

        lightMaterials.push(material);
        disposables.push(material);
    }

    return {
        group: root,
        obstacles,
        setStartLights(lit: number, go: boolean) {
            for (let i = 0; i < lightMaterials.length; i++) {
                const material = lightMaterials[i];
                if (go) {
                    material.emissive.copy(GREEN_ON);
                    material.emissiveIntensity = 1.5;
                } else if (i < lit) {
                    material.emissive.copy(RED_ON);
                    material.emissiveIntensity = 1.6;
                } else {
                    material.emissive.copy(RED_OFF);
                    material.emissiveIntensity = 0.7;
                }
            }
        },
        dispose() {
            disposables.forEach((item) => item.dispose());
        },
    };
}

function createBannerTexture(): THREE.Texture {
    const width = BANNER_TEXTURE_WIDTH;
    const height = BANNER_TEXTURE_HEIGHT;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;

    const gradient = ctx.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, "#202733");
    gradient.addColorStop(1, "#0d1116");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);

    // Checkered flanks, with a clear middle band for the wordmark and the light bar.
    const clearMargin = 300;
    const square = 46;
    for (let x = 0; x < width; x += square) {
        for (let y = 0; y < height; y += square) {
            if (x > clearMargin - square && x < width - clearMargin) continue;
            ctx.fillStyle = ((x / square + y / square) % 2) === 0 ? "#f2f2ee" : "#15171a";
            ctx.fillRect(x, y, square, square);
        }
    }

    ctx.fillStyle = "#d8261f";
    ctx.fillRect(clearMargin, 0, width - clearMargin * 2, 14);
    ctx.fillRect(clearMargin, height - 14, width - clearMargin * 2, 14);

    ctx.fillStyle = "#ffd24a";
    ctx.font = "bold 128px system-ui, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("MICRO MACHINES", width / 2, 116);

    // Recessed sockets for the start lights, painted into the sign so the emissive
    // lenses read as part of it rather than as bulbs bolted underneath.
    for (let i = 0; i < LIGHT_COUNT; i++) {
        const x = width / 2 + (i - (LIGHT_COUNT - 1) / 2) * SOCKET_SPACING_PX;

        const bezel = ctx.createRadialGradient(x, SOCKET_CENTER_Y_PX, SOCKET_RADIUS_PX * 0.6, x, SOCKET_CENTER_Y_PX, SOCKET_RADIUS_PX * 1.5);
        bezel.addColorStop(0, "#05070a");
        bezel.addColorStop(0.62, "#171b22");
        bezel.addColorStop(1, "rgba(23,27,34,0)");
        ctx.fillStyle = bezel;
        ctx.beginPath();
        ctx.arc(x, SOCKET_CENTER_Y_PX, SOCKET_RADIUS_PX * 1.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.strokeStyle = "#3b424d";
        ctx.lineWidth = 5;
        ctx.beginPath();
        ctx.arc(x, SOCKET_CENTER_Y_PX, SOCKET_RADIUS_PX, 0, Math.PI * 2);
        ctx.stroke();
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 4;
    return texture;
}
