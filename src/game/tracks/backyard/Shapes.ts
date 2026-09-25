import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type ColorRule = THREE.Color | ((x: number, y: number, z: number, index: number) => THREE.Color);

/**
 * Non-indexed copy of `source` with a baked vertex colour (and optional extra float attributes),
 * ready to merge. Disposes `source`.
 */
export function paint(
    source: THREE.BufferGeometry,
    rule: ColorRule,
    extras: Record<string, (x: number, y: number, z: number) => number> = {},
): THREE.BufferGeometry {
    const geometry = source.index ? source.toNonIndexed() : source.clone();
    source.dispose();
    if (geometry.getAttribute("uv")) geometry.deleteAttribute("uv");
    if (geometry.getAttribute("uv1")) geometry.deleteAttribute("uv1");
    if (geometry.getAttribute("color")) geometry.deleteAttribute("color");

    const position = geometry.getAttribute("position");
    const colors = new Float32Array(position.count * 3);
    const extraArrays = Object.keys(extras).map((name) => ({ name, array: new Float32Array(position.count) }));

    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        const color = rule instanceof THREE.Color ? rule : rule(x, y, z, i);
        colors[i * 3] = color.r;
        colors[i * 3 + 1] = color.g;
        colors[i * 3 + 2] = color.b;
        for (const extra of extraArrays) extra.array[i] = extras[extra.name](x, y, z);
    }

    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    for (const extra of extraArrays) geometry.setAttribute(extra.name, new THREE.BufferAttribute(extra.array, 1));
    if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
    return geometry;
}

/** Merges painted parts into one geometry and disposes the parts. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
    const merged = mergeGeometries(parts, false);
    parts.forEach((part) => part.dispose());
    if (!merged) throw new Error("Failed to merge garden geometry");
    return merged;
}

/** Colour ramp by height, handy for stems and trunks. */
export function heightRamp(bottom: THREE.Color, top: THREE.Color, height: number): ColorRule {
    const temp = new THREE.Color();
    return (_x, y) => temp.copy(bottom).lerp(top, THREE.MathUtils.clamp(y / height, 0, 1));
}

/** Slight per-vertex brightness jitter so flat-coloured parts do not look like plastic cutouts. */
export function jitter(color: THREE.Color, amount: number, seed = 1): ColorRule {
    const temp = new THREE.Color();
    return (x, y, z) => {
        const n = Math.sin(x * 12.9898 * seed + y * 78.233 + z * 37.719) * 43758.5453;
        const f = 1 + (n - Math.floor(n) - 0.5) * amount;
        return temp.copy(color).multiplyScalar(f);
    };
}

export type BatchMaterial = "matte" | "gloss" | "ceramic" | "metal" | "rubber";

/**
 * Unique, static props are baked into world space and merged per material, so the whole
 * garden's one-off objects cost a handful of draw calls.
 */
export class StaticBatch {
    private readonly parts = new Map<BatchMaterial, THREE.BufferGeometry[]>();

    public add(geometry: THREE.BufferGeometry, matrix: THREE.Matrix4, material: BatchMaterial): void {
        const placed = geometry.clone();
        placed.applyMatrix4(matrix);
        let list = this.parts.get(material);
        if (!list) {
            list = [];
            this.parts.set(material, list);
        }
        list.push(placed);
    }

    public build(): { meshes: THREE.Mesh[]; dispose(): void } {
        const meshes: THREE.Mesh[] = [];
        const disposables: { dispose(): void }[] = [];

        for (const [key, list] of this.parts) {
            if (list.length === 0) continue;
            const geometry = merge(list);
            geometry.computeBoundingSphere();
            const material = createBatchMaterial(key);
            const mesh = new THREE.Mesh(geometry, material);
            mesh.castShadow = true;
            mesh.receiveShadow = true;
            mesh.matrixAutoUpdate = false;
            mesh.updateMatrix();
            mesh.name = `garden-${key}`;
            mesh.userData.nonCollidable = true;
            meshes.push(mesh);
            disposables.push(geometry, material);
        }
        this.parts.clear();

        return {
            meshes,
            dispose() {
                disposables.forEach((item) => item.dispose());
            },
        };
    }
}

function createBatchMaterial(key: BatchMaterial): THREE.Material {
    switch (key) {
        case "gloss":
            return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.32, metalness: 0 });
        case "ceramic":
            return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.22, metalness: 0 });
        case "metal":
            return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.75 });
        case "rubber":
            return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0 });
        case "matte":
        default:
            return new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
    }
}

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();

/** Shared scratch transform builder for one-off placements. Not re-entrant. */
export function transform(
    x: number,
    y: number,
    z: number,
    yaw = 0,
    scale = 1,
    tiltX = 0,
    tiltZ = 0,
): THREE.Matrix4 {
    _euler.set(tiltX, yaw, tiltZ, "YXZ");
    _quaternion.setFromEuler(_euler);
    _position.set(x, y, z);
    _scale.setScalar(scale);
    return _matrix.compose(_position, _quaternion, _scale);
}
