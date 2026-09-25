import * as THREE from "three";
import type { QualityTier } from "../../core/Config";
import { Rng } from "../../core/Random";
import type { Obstacle } from "../../map/Scatter";
import type { SurfaceKind, SurfacePatch } from "../types";
import { MeshBatch } from "./Batch";
import type { CerealSpill } from "./Cereal";
import { PrintAtlas } from "./PrintAtlas";
import { createRamp } from "./Ramp";
import { JAM, ORANGE_JUICE, SPILT_MILK, SUGAR } from "./Spills";
import {
    addBanana,
    addBoiledEgg,
    addButterDish,
    addCerealBowl,
    addCerealBox,
    addCutlery,
    addJamJar,
    addJuiceCarton,
    addJuiceGlass,
    addMilkJug,
    addMug,
    addNapkin,
    addNewspaper,
    addOrange,
    addPlateOfToast,
    addShakers,
    addSugarBowl,
    addTeapot,
    disposeTemplates,
    type PropContext,
} from "./Tableware";

export interface SettingResult {
    objects: THREE.Object3D[];
    obstacles: Obstacle[];
    patches: SurfacePatch[];
    spills: CerealSpill[];
    sugarSpots: { x: number; z: number; radius: number; count: number }[];
    dispose(): void;
}

const TOAST_CRUMBS = [0xc98a3e, 0xa9662a, 0xe0b066, 0x8a4f1f].map((hex) => new THREE.Color(hex));

function patch(surface: SurfaceKind, x: number, z: number, radiusX: number, radiusZ: number, rotation: number): SurfacePatch {
    return { x, z, radiusX, radiusZ, rotation, surface };
}

/**
 * The breakfast spread, laid out around the course. Coordinates are hand-placed against the
 * layout in BreakfastTheme: tall pieces frame corners, liquids sit on the racing line.
 */
export function setTheTable(quality: QualityTier): SettingResult {
    const low = quality.name === "low";
    const atlas = new PrintAtlas();
    const batches = {
        ceramic: new MeshBatch(),
        food: new MeshBatch(),
        liquid: new MeshBatch(),
        glass: new MeshBatch(),
        metal: new MeshBatch(),
        print: new MeshBatch({ uv: true, color: false }),
    };
    const ctx: PropContext = {
        batches,
        atlas,
        obstacles: [],
        segments: low ? 20 : 36,
        rng: new Rng(90210),
    };

    // Infield, right lobe: the cereal bowl that has slopped milk onto the first corner.
    addCerealBowl(ctx, 60, 44, 0.4);
    addMug(ctx, 43, 55, 2.4, 0x2fa5a0);
    addCutlery(ctx, "spoon", 30, 36, 1.9);

    // Outside the start straight.
    addJuiceGlass(ctx, 104, 32);
    addJuiceCarton(ctx, 106.5, 46, 0.35);
    addShakers(ctx, 103, -22, 0.3);
    addBoiledEgg(ctx, 100, -62);
    addOrange(ctx, 103, 70, 0.4);
    addOrange(ctx, 92, 78.5, 2.1);

    // The notch of the hairpin is guarded by a towering cereal box.
    addCerealBox(ctx, 2, 74, Math.PI, false);

    // Infield, left lobe and middle.
    addTeapot(ctx, -52, 44, 0.5);
    addPlateOfToast(ctx, -52, 8, 0.3);
    addNapkin(ctx, -58, -22, 0.2);
    addCutlery(ctx, "fork", -62, -18, 1.75);
    addCutlery(ctx, "knife", -50, -27, 1.45);
    addMug(ctx, -54, -42, -0.6, 0xd8342c);
    addCerealBox(ctx, 18, -10, Math.PI / 2, true);

    // Outside the back straight and far corners.
    ctx.obstacles.push(...createRamp(batches.food));
    addJamJar(ctx, -104, 41, 0.2);
    addButterDish(ctx, -108, -27, Math.PI / 2);
    addMug(ctx, -98, 72, 0.9, 0xffc531);
    addNewspaper(ctx, -98, -69, -0.5);
    addSugarBowl(ctx, -3, -66);
    addBanana(ctx, 45, -79, 0);
    addMilkJug(ctx, 62, -80, 0);

    const patches: SurfacePatch[] = [
        patch(SPILT_MILK, 73.2, 55.5, 4.8, 3.4, 2.28),
        patch(SPILT_MILK, 67, 50, 5, 1.4, 0.735),
        patch(ORANGE_JUICE, 87.5, 30.2, 6.5, 3.6, 1.7),
        patch(JAM, -87.4, 40.6, 6.2, 3.1, -1.89),
        patch(SUGAR, -3, -41.5, 5.2, 3.3, 0),
        patch(SPILT_MILK, 57.7, -68.3, 5.5, 3.4, 0.12),
        patch(SPILT_MILK, 59.9, -74.2, 3.2, 1.1, -1.22),
    ];

    const spills: CerealSpill[] = [{ x: 2, z: -10, direction: Math.PI, count: 46 }];
    const sugarSpots = [
        { x: -3, z: -58, radius: 4.5, count: low ? 3 : 6 },
        { x: -3, z: -42, radius: 3.5, count: low ? 4 : 7 },
    ];

    const materials = {
        ceramic: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.14, metalness: 0 }),
        food: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62, metalness: 0 }),
        liquid: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.05, metalness: 0 }),
        glass: new THREE.MeshStandardMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.32,
            roughness: 0.03,
            metalness: 0.1,
            depthWrite: false,
            side: THREE.DoubleSide,
        }),
        metal: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 1, side: THREE.DoubleSide }),
        print: new THREE.MeshStandardMaterial({ map: atlas.texture, roughness: 0.5, metalness: 0 }),
    };

    const objects: THREE.Object3D[] = [];
    const geometries: THREE.BufferGeometry[] = [];

    for (const key of Object.keys(batches) as (keyof typeof batches)[]) {
        if (batches[key].isEmpty) continue;
        const geometry = batches[key].build();
        geometries.push(geometry);

        const mesh = new THREE.Mesh(geometry, materials[key]);
        mesh.name = `tableware-${key}`;
        mesh.castShadow = key !== "glass" && key !== "liquid";
        mesh.receiveShadow = true;
        mesh.matrixAutoUpdate = false;
        mesh.updateMatrix();
        if (key === "glass") mesh.renderOrder = 5;
        objects.push(mesh);
    }

    const crumbs = createCrumbs(ctx.rng, low ? 70 : 160);
    objects.push(crumbs.mesh);

    return {
        objects,
        obstacles: ctx.obstacles,
        patches,
        spills,
        sugarSpots,
        dispose() {
            geometries.forEach((geometry) => geometry.dispose());
            Object.values(materials).forEach((material) => material.dispose());
            atlas.dispose();
            crumbs.dispose();
            disposeTemplates();
        },
    };
}

/** Toast crumbs scattered around the plate and in drifts across the table. */
function createCrumbs(rng: Rng, count: number): { mesh: THREE.InstancedMesh; dispose(): void } {
    const geometry = new THREE.DodecahedronGeometry(0.26, 0);
    const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, metalness: 0 });
    const mesh = new THREE.InstancedMesh(geometry, material, count);
    const matrix = new THREE.Matrix4();
    const quaternion = new THREE.Quaternion();
    const euler = new THREE.Euler();
    const position = new THREE.Vector3();
    const scale = new THREE.Vector3();

    const clusters: readonly [number, number, number, number][] = [
        [-52, 8, 21, 0.45],
        [100, -58, 9, 0.12],
        [-40, 30, 16, 0.18],
        [30, 20, 18, 0.25],
    ];

    for (let i = 0; i < count; i++) {
        let pick = rng.next();
        let cluster = clusters[0];
        for (const candidate of clusters) {
            cluster = candidate;
            pick -= candidate[3];
            if (pick <= 0) break;
        }
        const [cx, cz, radius] = cluster;
        const angle = rng.next() * Math.PI * 2;
        const distance = cluster === clusters[0] ? 13.6 + rng.next() * (radius - 13.6) : Math.sqrt(rng.next()) * radius;
        position.set(cx + Math.cos(angle) * distance, 0.1, cz + Math.sin(angle) * distance);
        euler.set(rng.next() * 3, rng.next() * 3, rng.next() * 3);
        quaternion.setFromEuler(euler);
        const size = rng.range(0.5, 1.5);
        scale.set(size, size * rng.range(0.5, 0.9), size * rng.range(0.7, 1.1));
        matrix.compose(position, quaternion, scale);
        mesh.setMatrixAt(i, matrix);
        mesh.setColorAt(i, rng.pick(TOAST_CRUMBS));
    }

    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.name = "crumbs";
    mesh.receiveShadow = true;

    return {
        mesh,
        dispose() {
            geometry.dispose();
            material.dispose();
            mesh.dispose();
        },
    };
}
