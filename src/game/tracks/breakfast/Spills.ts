import * as THREE from "three";
import type { QualityTier } from "../../core/Config";
import { Rng } from "../../core/Random";
import type { SurfaceKind, SurfacePatch } from "../types";

export const SPILT_MILK: SurfaceKind = {
    id: "milk",
    grip: 0.3,
    drag: 0.5,
    speedScale: 1,
    dust: null,
    skid: null,
    skidAlpha: 0,
};

export const ORANGE_JUICE: SurfaceKind = {
    id: "juice",
    grip: 0.4,
    drag: 0.8,
    speedScale: 1,
    dust: null,
    skid: null,
    skidAlpha: 0,
};

export const JAM: SurfaceKind = {
    id: "jam",
    grip: 1,
    drag: 12,
    speedScale: 0.55,
    dust: null,
    skid: 0x4a0610,
    skidAlpha: 0.55,
};

export const SUGAR: SurfaceKind = {
    id: "sugar",
    grip: 0.75,
    drag: 2,
    speedScale: 0.9,
    dust: 0xf6f3ea,
    skid: 0xcfc9bb,
    skidAlpha: 0.35,
};

interface LiquidLook {
    color: THREE.Color;
    alpha: number;
    /** Height of the meniscus at the centre of the puddle. */
    depth: number;
}

const LIQUIDS: Record<string, LiquidLook> = {
    milk: { color: new THREE.Color(0xf3f3ee), alpha: 0.96, depth: 0.2 },
    juice: { color: new THREE.Color(0xff7a00), alpha: 0.9, depth: 0.16 },
    jam: { color: new THREE.Color(0x7a0612), alpha: 0.96, depth: 0.26 },
};

/** Profile of a settled puddle from centre to rim: (radius fraction, height fraction, shade). */
const MENISCUS: readonly [number, number, number][] = [
    [0, 1, 1], [0.4, 0.98, 1], [0.7, 0.9, 0.98], [0.86, 0.72, 0.93], [0.95, 0.4, 0.8], [1, 0.08, 0.7],
];

export interface SpillsResult {
    objects: THREE.Object3D[];
    dispose(): void;
}

/**
 * Glossy domed puddles for the liquid patches and a dusting of grains for sugar. The rim
 * wobbles a few percent around the physics ellipse so what you see is what you slide on.
 */
export function createSpills(patches: readonly SurfacePatch[], quality: QualityTier): SpillsResult {
    const rng = new Rng(777);
    const segments = quality.name === "low" ? 28 : 44;
    const positions: number[] = [];
    const colors: number[] = [];
    const indices: number[] = [];
    const sugarPatches: SurfacePatch[] = [];

    const addPuddle = (patch: SurfacePatch, look: LiquidLook, scale: number, ox = 0, oz = 0) => {
        const base = positions.length / 3;
        const phases = [rng.next() * 6.28, rng.next() * 6.28, rng.next() * 6.28];
        const cos = Math.cos(patch.rotation);
        const sin = Math.sin(patch.rotation);

        positions.push(patch.x + ox, look.depth * scale + 0.02, patch.z + oz);
        colors.push(look.color.r, look.color.g, look.color.b, look.alpha);

        for (let ring = 1; ring < MENISCUS.length; ring++) {
            const [fraction, height, shade] = MENISCUS[ring];
            for (let s = 0; s < segments; s++) {
                const angle = (s / segments) * Math.PI * 2;
                const wobble = 1 + 0.045 * Math.sin(angle * 3 + phases[0]) + 0.03 * Math.sin(angle * 5 + phases[1]) + 0.02 * Math.sin(angle * 9 + phases[2]);
                const u = Math.cos(angle) * patch.radiusX * scale * fraction * wobble;
                const v = Math.sin(angle) * patch.radiusZ * scale * fraction * wobble;
                positions.push(patch.x + ox + u * cos - v * sin, look.depth * scale * height + 0.02, patch.z + oz + u * sin + v * cos);
                colors.push(look.color.r * shade, look.color.g * shade, look.color.b * shade, ring === MENISCUS.length - 1 ? look.alpha * 0.8 : look.alpha);
            }
        }

        for (let s = 0; s < segments; s++) {
            const next = (s + 1) % segments;
            indices.push(base, base + 1 + next, base + 1 + s);
        }
        for (let ring = 1; ring < MENISCUS.length - 1; ring++) {
            const inner = base + 1 + (ring - 1) * segments;
            const outer = inner + segments;
            for (let s = 0; s < segments; s++) {
                const next = (s + 1) % segments;
                indices.push(inner + s, inner + next, outer + s, inner + next, outer + next, outer + s);
            }
        }
    };

    for (const patch of patches) {
        const look = LIQUIDS[patch.surface.id];
        if (!look) {
            if (patch.surface.id === "sugar") sugarPatches.push(patch);
            continue;
        }

        addPuddle(patch, look, 1);
        // A few stray droplets around the main puddle.
        const droplets = 2 + rng.int(3);
        for (let i = 0; i < droplets; i++) {
            const angle = rng.next() * Math.PI * 2;
            const reach = 1.15 + rng.next() * 0.35;
            const ox = Math.cos(angle) * patch.radiusX * reach;
            const oz = Math.sin(angle) * patch.radiusZ * reach;
            const droplet = { ...patch, radiusX: rng.range(0.5, 1.1), radiusZ: rng.range(0.5, 1.1) };
            addPuddle(droplet, look, 1, ox * Math.cos(patch.rotation) - oz * Math.sin(patch.rotation), ox * Math.sin(patch.rotation) + oz * Math.cos(patch.rotation));
        }
    }

    const objects: THREE.Object3D[] = [];
    const disposables: { dispose(): void }[] = [];

    if (positions.length > 0) {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 4));
        geometry.setIndex(indices);
        geometry.computeVertexNormals();

        const material = new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: true,
            roughness: 0.04,
            metalness: 0,
            polygonOffset: true,
            polygonOffsetFactor: -2,
            polygonOffsetUnits: -2,
        });

        const mesh = new THREE.Mesh(geometry, material);
        mesh.name = "spills";
        mesh.receiveShadow = true;
        mesh.renderOrder = 2;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        objects.push(mesh);
        disposables.push(geometry, material);
    }

    if (sugarPatches.length > 0) {
        const grainsPerPatch = quality.name === "low" ? 140 : 320;
        const grain = new THREE.BoxGeometry(0.22, 0.16, 0.22);
        const material = new THREE.MeshStandardMaterial({ color: 0xfdfcf8, roughness: 0.35, metalness: 0 });
        const grains = new THREE.InstancedMesh(grain, material, grainsPerPatch * sugarPatches.length);
        const matrix = new THREE.Matrix4();
        const quaternion = new THREE.Quaternion();
        const euler = new THREE.Euler();
        const position = new THREE.Vector3();
        const scale = new THREE.Vector3();
        let index = 0;

        for (const patch of sugarPatches) {
            const cos = Math.cos(patch.rotation);
            const sin = Math.sin(patch.rotation);
            for (let i = 0; i < grainsPerPatch; i++) {
                const angle = rng.next() * Math.PI * 2;
                // Denser in the middle, thinning out toward the rim like a real spill.
                const reach = Math.pow(rng.next(), 0.8) * 1.05;
                const u = Math.cos(angle) * patch.radiusX * reach;
                const v = Math.sin(angle) * patch.radiusZ * reach;
                position.set(patch.x + u * cos - v * sin, 0.07, patch.z + u * sin + v * cos);
                euler.set(rng.range(-0.4, 0.4), rng.next() * Math.PI, rng.range(-0.4, 0.4));
                quaternion.setFromEuler(euler);
                scale.setScalar(rng.range(0.6, 1.3));
                matrix.compose(position, quaternion, scale);
                grains.setMatrixAt(index++, matrix);
            }
        }

        grains.instanceMatrix.needsUpdate = true;
        grains.computeBoundingSphere();
        grains.name = "sugar-grains";
        grains.receiveShadow = true;
        objects.push(grains);
        disposables.push(grain, material, { dispose: () => grains.dispose() });
    }

    return {
        objects,
        dispose() {
            disposables.forEach((item) => item.dispose());
        },
    };
}
