import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/** Receives a vertex in the part's own space and writes its colour. */
export type ColorFn = (position: THREE.Vector3, normal: THREE.Vector3, out: THREE.Color) => void;

const _position = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _color = new THREE.Color();
const _matrix = new THREE.Matrix4();
const _euler = new THREE.Euler(0, 0, 0, "YXZ");
const _quaternion = new THREE.Quaternion();
const _translation = new THREE.Vector3();
const _scale = new THREE.Vector3();

/**
 * Collects many small parts that share one material into a single draw call. Parts are
 * coloured in their own space (so patterns follow the object) and then baked into world space.
 */
export class MeshBatch {
    private readonly parts: THREE.BufferGeometry[] = [];

    constructor(private readonly options: { uv?: boolean; color?: boolean } = {}) {}

    /** Takes ownership of `geometry`. */
    public add(
        geometry: THREE.BufferGeometry,
        color: THREE.ColorRepresentation | ColorFn | null,
        transform?: THREE.Matrix4,
    ): void {
        const part = geometry.index ? geometry.toNonIndexed() : geometry;
        if (part !== geometry) geometry.dispose();

        if (!part.getAttribute("normal")) part.computeVertexNormals();
        if (!this.options.uv && part.getAttribute("uv")) part.deleteAttribute("uv");
        if (part.getAttribute("uv1")) part.deleteAttribute("uv1");

        if (this.options.color !== false) {
            const position = part.getAttribute("position");
            const normal = part.getAttribute("normal");
            const colors = new Float32Array(position.count * 3);

            if (typeof color === "function") {
                for (let i = 0; i < position.count; i++) {
                    _position.fromBufferAttribute(position, i);
                    _normal.fromBufferAttribute(normal, i);
                    color(_position, _normal, _color);
                    colors[i * 3] = _color.r;
                    colors[i * 3 + 1] = _color.g;
                    colors[i * 3 + 2] = _color.b;
                }
            } else {
                _color.set(color ?? 0xffffff);
                for (let i = 0; i < position.count; i++) {
                    colors[i * 3] = _color.r;
                    colors[i * 3 + 1] = _color.g;
                    colors[i * 3 + 2] = _color.b;
                }
            }

            part.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        }

        if (transform) part.applyMatrix4(transform);
        this.parts.push(part);
    }

    public get isEmpty(): boolean {
        return this.parts.length === 0;
    }

    public build(): THREE.BufferGeometry {
        const merged = mergeGeometries(this.parts, false);
        this.parts.forEach((part) => part.dispose());
        this.parts.length = 0;
        merged.computeBoundingSphere();
        merged.computeBoundingBox();
        return merged;
    }
}

/** Revolves a (radius, height) profile around Y. */
export function lathe(profile: readonly (readonly [number, number])[], segments = 32): THREE.LatheGeometry {
    return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Transform with yaw applied first, then pitch and roll — how things are set down on a table. */
export function placement(
    x: number,
    y: number,
    z: number,
    yaw = 0,
    pitch = 0,
    roll = 0,
    scale: number | THREE.Vector3 = 1,
): THREE.Matrix4 {
    _euler.set(pitch, yaw, roll, "YXZ");
    _quaternion.setFromEuler(_euler);
    _translation.set(x, y, z);
    if (typeof scale === "number") _scale.setScalar(scale);
    else _scale.copy(scale);
    return new THREE.Matrix4().compose(_translation, _quaternion, _scale);
}

/** Combines a parent placement with a local offset, for parts of a composite prop. */
export function within(parent: THREE.Matrix4, local: THREE.Matrix4): THREE.Matrix4 {
    return _matrix.multiplyMatrices(parent, local).clone();
}

/** Is the vertex on the outside of a revolved shell (normal pointing away from the axis)? */
export function facesOutward(position: THREE.Vector3, normal: THREE.Vector3): boolean {
    return position.x * normal.x + position.z * normal.z > 0;
}
