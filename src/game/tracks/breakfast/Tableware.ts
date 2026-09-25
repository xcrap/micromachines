import * as THREE from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { TeapotGeometry } from "three/examples/jsm/geometries/TeapotGeometry.js";
import { Rng } from "../../core/Random";
import type { Obstacle } from "../../map/Scatter";
import { facesOutward, lathe, MeshBatch, placement, within, type ColorFn } from "./Batch";
import { remapBoxFaces, remapUv, type PrintAtlas } from "./PrintAtlas";

export interface TablewareBatches {
    /** Glossy glazed pottery. */
    ceramic: MeshBatch;
    /** Bread, fruit, butter — satin surfaces. */
    food: MeshBatch;
    /** Milk, coffee, juice and jam surfaces — mirror-wet. */
    liquid: MeshBatch;
    /** Clear glassware, drawn transparent. */
    glass: MeshBatch;
    /** Stainless cutlery and lids. */
    metal: MeshBatch;
    /** Anything printed, textured from the shared atlas. */
    print: MeshBatch;
}

export interface PropContext {
    batches: TablewareBatches;
    atlas: PrintAtlas;
    obstacles: Obstacle[];
    /** Radial segments for turned pottery. */
    segments: number;
    rng: Rng;
}

const color = (hex: number) => new THREE.Color(hex);

const WHITE_GLAZE = color(0xf5f2ea);
const CREAM_GLAZE = color(0xf8f1e0);
const COBALT = color(0x2459c9);
const GOLD = color(0xd9a53a);
const HONEY = [color(0xd99a3a), color(0xe8b04e), color(0xcf8a2c), color(0xf0bf5c)];
const TOAST_FACE = color(0xd89a45);
const TOAST_CRUST = color(0x86481b);
const BUTTER = color(0xffe28a);
const STEEL = color(0xd4d8dd);
const STEEL_DARK = color(0x8d949c);
const MILK = color(0xf7f5ee);
const COFFEE = color(0x3a1c0b);
const ORANGE_JUICE = color(0xff9a1c);
const JAM = color(0x7a0714);
const GLASS_TINT = color(0xe6f2f6);

/** World offset of a point given in a prop's local frame. */
function toWorld(x: number, z: number, yaw: number, localX: number, localZ: number): [number, number] {
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    return [x + cos * localX + sin * localZ, z - sin * localX + cos * localZ];
}

function circleObstacle(ctx: PropContext, x: number, z: number, radius: number, height: number, solidity = 1): void {
    ctx.obstacles.push({ x, z, radius, height, solidity });
}

function boxObstacle(
    ctx: PropContext,
    x: number,
    z: number,
    halfX: number,
    halfZ: number,
    yaw: number,
    height: number,
    solidity = 1,
): void {
    ctx.obstacles.push({ x, z, radius: Math.hypot(halfX, halfZ), height, solidity, box: { halfX, halfZ, yaw } });
}

function disc(radius: number, y: number, segments: number): THREE.BufferGeometry {
    const geometry = new THREE.CircleGeometry(radius, segments);
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, y, 0);
    return geometry;
}

function hoopGeometry(): THREE.BufferGeometry {
    const geometry = new THREE.TorusGeometry(0.44, 0.17, 5, 10);
    geometry.rotateX(Math.PI / 2);
    return geometry;
}

/** A spoon lying bowl-up along +Z, bowl centred on the origin with its rim at y = 0. */
export function spoonGeometry(): THREE.BufferGeometry[] {
    const bowl = new THREE.SphereGeometry(1, 16, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2);
    bowl.scale(2.1, 0.75, 2.9);

    const outline = new THREE.Shape();
    outline.moveTo(-0.45, 2.4);
    outline.lineTo(-0.38, 7);
    outline.quadraticCurveTo(-0.9, 12.5, -0.85, 14.5);
    outline.quadraticCurveTo(-0.8, 16.2, 0, 16.4);
    outline.quadraticCurveTo(0.8, 16.2, 0.85, 14.5);
    outline.quadraticCurveTo(0.9, 12.5, 0.38, 7);
    outline.lineTo(0.45, 2.4);
    outline.closePath();

    const handle = new THREE.ExtrudeGeometry(outline, { depth: 0.22, bevelEnabled: false, curveSegments: 5 });
    handle.rotateX(Math.PI / 2);
    handle.translate(0, 0.22, 0);
    return [bowl, handle];
}

function knifeGeometry(): THREE.BufferGeometry[] {
    const outline = new THREE.Shape();
    outline.moveTo(-0.85, 0);
    outline.lineTo(0.85, 0);
    outline.lineTo(0.85, 7.6);
    outline.quadraticCurveTo(0.85, 10.6, -0.2, 10.9);
    outline.lineTo(-0.85, 10.1);
    outline.closePath();
    const blade = new THREE.ExtrudeGeometry(outline, { depth: 0.16, bevelEnabled: false, curveSegments: 5 });
    blade.rotateX(Math.PI / 2);
    blade.translate(0, 0.35, 0);

    const handle = new RoundedBoxGeometry(1.35, 0.7, 9.2, 2, 0.3);
    handle.translate(0, 0.35, -4.7);
    return [blade, handle];
}

function forkGeometry(): THREE.BufferGeometry[] {
    const parts: THREE.BufferGeometry[] = [];
    for (const x of [-1.05, -0.35, 0.35, 1.05]) {
        const tine = new THREE.BoxGeometry(0.32, 0.22, 4.4);
        tine.translate(x, 0.3, 4.5);
        parts.push(tine);
    }
    const neck = new THREE.Shape();
    neck.moveTo(-1.3, 2.4);
    neck.lineTo(1.3, 2.4);
    neck.quadraticCurveTo(1.2, 0.6, 0.42, -0.6);
    neck.lineTo(-0.42, -0.6);
    neck.quadraticCurveTo(-1.2, 0.6, -1.3, 2.4);
    const base = new THREE.ExtrudeGeometry(neck, { depth: 0.24, bevelEnabled: false, curveSegments: 4 });
    base.rotateX(Math.PI / 2);
    base.translate(0, 0.42, 0);
    parts.push(base);

    const [, handle] = spoonGeometry();
    handle.rotateY(Math.PI);
    handle.translate(0, 0.2, 1.8);
    parts.push(handle);
    return parts;
}

function addParts(batch: MeshBatch, parts: THREE.BufferGeometry[], tint: THREE.ColorRepresentation | ColorFn, matrix: THREE.Matrix4): void {
    for (const part of parts) batch.add(part, tint, matrix);
}

export function addSpoon(ctx: PropContext, matrix: THREE.Matrix4): void {
    addParts(ctx.batches.metal, spoonGeometry(), STEEL, matrix);
}

export function addKnife(ctx: PropContext, matrix: THREE.Matrix4): void {
    const [blade, handle] = knifeGeometry();
    ctx.batches.metal.add(blade, STEEL, matrix);
    ctx.batches.metal.add(handle, STEEL_DARK, matrix);
}

export function addFork(ctx: PropContext, matrix: THREE.Matrix4): void {
    addParts(ctx.batches.metal, forkGeometry(), STEEL, matrix);
}

/** Flat on the table: spoons and forks rest on their backs, a slight tilt drops the handle end onto the wood. */
export function addCutlery(ctx: PropContext, kind: "spoon" | "knife" | "fork", x: number, z: number, yaw: number): void {
    if (kind === "spoon") addSpoon(ctx, placement(x, 0.75, z, yaw, 0.035));
    else if (kind === "knife") addKnife(ctx, placement(x, 0, z, yaw));
    else addFork(ctx, placement(x, 0.02, z, yaw));
}

const BOWL_PROFILE: [number, number][] = [
    [0, 0.05], [4.6, 0.05], [5.0, 0.2], [5.3, 0.8], [5.1, 1.0], [6.4, 1.8], [7.7, 3.4], [8.6, 5.4],
    [8.72, 5.95], [8.74, 6.05], [8.92, 6.85], [8.94, 6.95], [9.0, 7.2], [9.05, 7.8], [8.85, 8.05],
    [8.55, 7.85], [8.35, 6.9], [7.8, 5.0], [6.6, 3.0], [4.8, 1.8], [2.5, 1.45], [0, 1.4],
];

export function addCerealBowl(ctx: PropContext, x: number, z: number, yaw: number, band = COBALT): void {
    const matrix = placement(x, 0, z, yaw);
    ctx.batches.ceramic.add(lathe(BOWL_PROFILE, ctx.segments), (p, n, out) => {
        out.copy(facesOutward(p, n) && p.y > 5.98 && p.y < 6.92 ? band : facesOutward(p, n) ? WHITE_GLAZE : CREAM_GLAZE);
    }, matrix);
    ctx.batches.liquid.add(disc(8.0, 5.8, ctx.segments), MILK, matrix);

    for (let i = 0; i < 16; i++) {
        const angle = ctx.rng.next() * Math.PI * 2;
        const radius = Math.sqrt(ctx.rng.next()) * 6.6;
        const local = placement(Math.cos(angle) * radius, 5.86, Math.sin(angle) * radius, ctx.rng.next() * 6, ctx.rng.range(-0.2, 0.2), ctx.rng.range(-0.2, 0.2));
        ctx.batches.food.add(hoopGeometry(), ctx.rng.pick(HONEY), within(matrix, local));
    }

    addSpoon(ctx, within(matrix, placement(-3.2, 5.2, 0.6, Math.PI / 2 + 0.2, -0.62)));
    circleObstacle(ctx, x, z, 9.3, 8);
}

const MUG_PROFILE: [number, number][] = [
    [0, 0.05], [4.0, 0.05], [4.35, 0.3], [4.5, 0.9], [4.5, 9.35], [4.46, 9.8], [4.2, 10.05],
    [3.95, 9.9], [3.88, 9.3], [3.88, 1.2], [0, 1.1],
];

export function addMug(ctx: PropContext, x: number, z: number, yaw: number, glaze: number): void {
    const main = color(glaze);
    const matrix = placement(x, 0, z, yaw);
    ctx.batches.ceramic.add(lathe(MUG_PROFILE, ctx.segments), (p, n, out) => {
        out.copy(facesOutward(p, n) && p.y < 9.6 ? main : WHITE_GLAZE);
    }, matrix);

    const handle = new THREE.TorusGeometry(2.3, 0.62, 8, 12, Math.PI);
    handle.rotateZ(-Math.PI / 2);
    handle.translate(4.3, 5.2, 0);
    ctx.batches.ceramic.add(handle, main, matrix);
    ctx.batches.liquid.add(disc(3.88, 8.4, ctx.segments), COFFEE, matrix);

    circleObstacle(ctx, x, z, 4.8, 10);
    const [hx, hz] = toWorld(x, z, yaw, 6.5, 0);
    circleObstacle(ctx, hx, hz, 1.4, 8);
}

const PLATE_PROFILE: [number, number][] = [
    [0, 0.05], [8.2, 0.05], [8.5, 0.25], [8.8, 0.6], [9.4, 0.75], [12.2, 1.7], [12.75, 1.95],
    [12.8, 2.0], [13.05, 2.2], [12.9, 2.32], [12.5, 2.22], [12.45, 2.2], [9.3, 1.0], [0, 0.9],
];

function toastGeometry(): THREE.BufferGeometry {
    const slice = new THREE.Shape();
    slice.moveTo(-5.1, -5.4);
    slice.lineTo(5.1, -5.4);
    slice.lineTo(5.1, 2.6);
    slice.quadraticCurveTo(5.9, 5.8, 2.6, 5.7);
    slice.quadraticCurveTo(0.8, 5.6, 0, 4.8);
    slice.quadraticCurveTo(-0.8, 5.6, -2.6, 5.7);
    slice.quadraticCurveTo(-5.9, 5.8, -5.1, 2.6);
    slice.closePath();

    const geometry = new THREE.ExtrudeGeometry(slice, {
        depth: 0.8,
        bevelEnabled: true,
        bevelThickness: 0.22,
        bevelSize: 0.3,
        bevelSegments: 2,
        curveSegments: 6,
    });
    geometry.rotateX(-Math.PI / 2);
    geometry.translate(0, 0.22, 0);
    return geometry;
}

const toastColor: ColorFn = (p, n, out) => {
    if (Math.abs(n.y) > 0.8) {
        const burn = 0.5 + 0.5 * Math.sin(p.x * 1.3 + p.z * 0.9) * Math.cos(p.z * 1.7 - p.x * 0.4);
        out.copy(TOAST_FACE).lerp(TOAST_CRUST, burn * 0.35);
    } else {
        out.copy(TOAST_CRUST);
    }
};

export function addPlateOfToast(ctx: PropContext, x: number, z: number, yaw: number): void {
    const matrix = placement(x, 0, z, yaw);
    ctx.batches.ceramic.add(lathe(PLATE_PROFILE, ctx.segments + 8), (p, _n, out) => {
        out.copy(Math.hypot(p.x, p.z) > 12.6 ? COBALT : WHITE_GLAZE);
    }, matrix);

    ctx.batches.food.add(toastGeometry(), toastColor, within(matrix, placement(-2.2, 0.92, 1.4, 0.35)));
    ctx.batches.food.add(toastGeometry(), toastColor, within(matrix, placement(3.4, 1.62, -2.6, -0.5, 0.07, 0.04)));
    ctx.batches.food.add(new RoundedBoxGeometry(3.2, 0.7, 2.6, 2, 0.28), BUTTER, within(matrix, placement(-1.8, 2.3, 1.0, 0.8)));
    addKnife(ctx, within(matrix, placement(7.2, 1.35, 1.5, -0.25, 0, -0.08)));

    circleObstacle(ctx, x, z, 13.2, 2.4);
}

const JUICE_GLASS_PROFILE: [number, number][] = [
    [0, 0.02], [3.2, 0.02], [3.45, 0.3], [3.75, 13.0], [3.55, 13.05], [3.3, 1.1], [0, 1.0],
];

export function addJuiceGlass(ctx: PropContext, x: number, z: number): void {
    const matrix = placement(x, 0, z);
    ctx.batches.glass.add(lathe(JUICE_GLASS_PROFILE, ctx.segments), GLASS_TINT, matrix);
    ctx.batches.liquid.add(lathe([[0, 1.08], [3.28, 1.08], [3.52, 9.4], [0, 9.4]], ctx.segments), ORANGE_JUICE, matrix);
    circleObstacle(ctx, x, z, 3.9, 13);
}

/** Gable top of a juice carton as a closed prism, all mapped to plain card. */
function gableGeometry(width: number, depth: number, rise: number): THREE.BufferGeometry {
    const hx = width / 2;
    const hz = depth / 2;
    const v = (x: number, y: number, z: number) => [x, y, z];
    const quads = [
        [v(-hx, 0, hz), v(hx, 0, hz), v(hx, rise, 0), v(-hx, rise, 0)],
        [v(hx, 0, -hz), v(-hx, 0, -hz), v(-hx, rise, 0), v(hx, rise, 0)],
    ];
    const triangles = [
        [v(hx, 0, hz), v(hx, 0, -hz), v(hx, rise, 0)],
        [v(-hx, 0, -hz), v(-hx, 0, hz), v(-hx, rise, 0)],
    ];
    const positions: number[] = [];
    for (const [a, b, c, d] of quads) positions.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (const [a, b, c] of triangles) positions.push(...a, ...b, ...c);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(new Float32Array((positions.length / 3) * 2).fill(0.5), 2));
    geometry.computeVertexNormals();
    return geometry;
}

export function addJuiceCarton(ctx: PropContext, x: number, z: number, yaw: number): void {
    const side = ctx.atlas.rect("cartonSide");
    const paper = ctx.atlas.rect("paper");
    const matrix = placement(x, 0, z, yaw);

    const body = new THREE.BoxGeometry(9, 22, 9);
    remapBoxFaces(body, [side, side, paper, paper, side, side]);
    body.translate(0, 11, 0);
    ctx.batches.print.add(body, null, matrix);

    const gable = gableGeometry(9, 9, 3.6);
    remapUv(gable, paper);
    gable.translate(0, 22, 0);
    ctx.batches.print.add(gable, null, matrix);

    const fin = new THREE.BoxGeometry(9, 1.4, 0.35);
    remapUv(fin, paper);
    fin.translate(0, 26.2, 0);
    ctx.batches.print.add(fin, null, matrix);

    boxObstacle(ctx, x, z, 4.7, 4.7, yaw, 27);
}

/** Standing upright, or lying on its back with the front art facing the sky. */
export function addCerealBox(ctx: PropContext, x: number, z: number, yaw: number, lying: boolean): void {
    const front = ctx.atlas.rect("cerealFront");
    const side = ctx.atlas.rect("cerealSide");
    const top = ctx.atlas.rect("cerealTop");

    const box = new THREE.BoxGeometry(20, 30, 7);
    remapBoxFaces(box, [side, side, top, top, front, front]);

    if (lying) {
        box.rotateX(-Math.PI / 2);
        box.translate(0, 3.5, 0);
        boxObstacle(ctx, x, z, 10.1, 15.1, yaw, 7);
    } else {
        box.translate(0, 15, 0);
        boxObstacle(ctx, x, z, 10.1, 3.6, yaw, 30);
    }

    ctx.batches.print.add(box, null, placement(x, 0, z, yaw));
}

const JAR_PROFILE: [number, number][] = [
    [0, 0.02], [3.2, 0.02], [3.5, 0.4], [3.6, 6.6], [3.25, 7.3], [3.25, 8.1], [3.05, 8.15],
    [3.0, 7.3], [3.3, 6.6], [3.25, 0.9], [0, 0.8],
];

export function addJamJar(ctx: PropContext, x: number, z: number, yaw: number): void {
    const matrix = placement(x, 0, z, yaw);
    ctx.batches.glass.add(lathe(JAR_PROFILE, ctx.segments), GLASS_TINT, matrix);
    ctx.batches.liquid.add(lathe([[0, 0.85], [3.2, 0.85], [3.25, 6.3], [0, 6.3]], ctx.segments), JAM, matrix);

    const lid = new THREE.CylinderGeometry(3.4, 3.4, 0.9, ctx.segments);
    lid.translate(0, 8.5, 0);
    ctx.batches.metal.add(lid, GOLD, matrix);

    const cloth = lathe([[0, 9.1], [2.8, 9.05], [3.7, 8.8], [4.3, 8.0], [4.55, 7.2], [4.9, 6.6]], ctx.segments);
    remapUv(cloth, ctx.atlas.rect("gingham"));
    ctx.batches.print.add(cloth, null, matrix);

    const band = new THREE.TorusGeometry(3.62, 0.16, 5, ctx.segments);
    band.rotateX(Math.PI / 2);
    band.translate(0, 7.9, 0);
    ctx.batches.food.add(band, 0xc22a2a, matrix);

    circleObstacle(ctx, x, z, 4.6, 9.5);
}

export function addButterDish(ctx: PropContext, x: number, z: number, yaw: number): void {
    const matrix = placement(x, 0, z, yaw);
    const base = new RoundedBoxGeometry(14, 0.9, 9.6, 2, 0.4);
    base.translate(0, 0.45, 0);
    ctx.batches.ceramic.add(base, (p, _n, out) => {
        out.copy(Math.abs(p.x) > 6.4 || Math.abs(p.z) > 4.2 ? COBALT : WHITE_GLAZE);
    }, matrix);

    const butter = new RoundedBoxGeometry(8, 3.4, 5.2, 2, 0.45);
    butter.translate(-0.8, 2.6, 0);
    ctx.batches.food.add(butter, BUTTER, matrix);
    addKnife(ctx, within(matrix, placement(2.0, 4.0, 0.6, Math.PI / 2 + 0.15, 0, 0.05)));

    boxObstacle(ctx, x, z, 7.1, 4.9, yaw, 4.4);
}

const SHAKER_PROFILE: [number, number][] = [
    [0, 0.02], [1.5, 0.02], [1.7, 0.35], [1.72, 4.6], [1.55, 5.3], [0, 5.3],
];
const SHAKER_CAP: [number, number][] = [[1.5, 5.1], [1.55, 5.7], [1.35, 6.5], [0.9, 7.0], [0, 7.1]];

export function addShakers(ctx: PropContext, x: number, z: number, yaw: number): void {
    const pairs: [number, number][] = [[-1.9, 0xf7f5ef], [1.9, 0x1d1d22]];
    for (const [offset, glaze] of pairs) {
        const [sx, sz] = toWorld(x, z, yaw, offset, 0);
        const matrix = placement(sx, 0, sz, yaw);
        ctx.batches.ceramic.add(lathe(SHAKER_PROFILE, 20), glaze, matrix);
        ctx.batches.metal.add(lathe(SHAKER_CAP, 20), STEEL, matrix);
        circleObstacle(ctx, sx, sz, 1.9, 7);
    }
}

const EGG_CUP_PROFILE: [number, number][] = [
    [0, 0.02], [2.3, 0.02], [2.4, 0.4], [1.25, 1.3], [1.1, 2.6], [2.2, 3.6], [2.8, 5.0],
    [2.95, 5.9], [2.75, 6.0], [2.5, 5.1], [1.8, 4.1], [0, 3.9],
];

export function addBoiledEgg(ctx: PropContext, x: number, z: number): void {
    const matrix = placement(x, 0, z);
    ctx.batches.ceramic.add(lathe(EGG_CUP_PROFILE, ctx.segments), 0xf2c230, matrix);
    const egg = new THREE.SphereGeometry(2.3, 20, 14);
    egg.scale(1, 1.3, 1);
    egg.translate(0, 6.5, 0);
    ctx.batches.food.add(egg, 0xe0b389, matrix);
    circleObstacle(ctx, x, z, 3.1, 9.5);
}

/** Tapered, gently curved and five-sided, the way bananas actually are. */
export function addBanana(ctx: PropContext, x: number, z: number, yaw: number): void {
    const tubular = 22;
    const radial = 5;
    const path = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(-9.5, 0, 0),
        new THREE.Vector3(0, 0, -6.5),
        new THREE.Vector3(9.5, 0, 0),
    );
    const geometry = new THREE.TubeGeometry(path, tubular, 1.9, radial, false);
    const position = geometry.getAttribute("position") as THREE.BufferAttribute;
    const centre = new THREE.Vector3();
    const vertex = new THREE.Vector3();

    for (let i = 0; i < position.count; i++) {
        const u = Math.floor(i / (radial + 1)) / tubular;
        path.getPoint(u, centre);
        vertex.fromBufferAttribute(position, i).sub(centre);
        const taper = 0.18 + 0.82 * Math.pow(Math.sin(Math.PI * u), 0.55);
        vertex.multiplyScalar(taper).add(centre);
        position.setXYZ(i, vertex.x, vertex.y, vertex.z);
    }
    geometry.computeVertexNormals();

    const yellow = color(0xf2cf2a);
    const green = color(0x9fb22a);
    const brown = color(0x3d2a12);
    // The curve's x runs linearly from end to end, so it doubles as the position along the fruit.
    const ripeness: ColorFn = (p, _n, out) => {
        const u = THREE.MathUtils.clamp((p.x / 9.5 + 1) / 2, 0, 1);
        const end = Math.min(u, 1 - u);
        out.copy(yellow);
        if (end < 0.16) out.lerp(green, ((0.16 - end) / 0.16) * 0.6);
        if (end < 0.03) out.copy(brown);
    };

    ctx.batches.food.add(geometry, ripeness, placement(x, 1.75, z, yaw));

    for (const u of [0.2, 0.5, 0.8]) {
        path.getPoint(u, centre);
        const [ox, oz] = toWorld(x, z, yaw, centre.x, centre.z);
        circleObstacle(ctx, ox, oz, 2.1, 3.6, 0.8);
    }
}

export function addOrange(ctx: PropContext, x: number, z: number, yaw: number): void {
    const matrix = placement(x, 3.85, z, yaw);
    const peel = new THREE.IcosahedronGeometry(1, 3);
    peel.scale(4.1, 3.9, 4.1);
    const light = color(0xff9420);
    const dark = color(0xe8680c);
    ctx.batches.food.add(peel, (p, _n, out) => {
        const dimple = 0.5 + 0.5 * Math.sin(p.x * 5.1) * Math.sin(p.y * 4.7) * Math.sin(p.z * 5.3);
        out.copy(light).lerp(dark, 0.25 + dimple * 0.35 - p.y * 0.04);
    }, matrix);

    const stem = new THREE.CylinderGeometry(0.28, 0.38, 0.6, 6);
    stem.translate(0, 4.0, 0);
    ctx.batches.food.add(stem, 0x5b4a1f, matrix);
    const leaf = new THREE.SphereGeometry(1, 8, 4);
    leaf.scale(1.4, 0.18, 0.6);
    leaf.rotateY(0.6);
    leaf.translate(1.1, 4.05, 0.3);
    ctx.batches.food.add(leaf, 0x3f8a2e, matrix);

    circleObstacle(ctx, x, z, 4.2, 7.8, 0.85);
}

let teapotTemplate: { geometry: THREE.BufferGeometry; halfX: number; halfZ: number; height: number } | null = null;

function teapotGeometry(height: number): { geometry: THREE.BufferGeometry; halfX: number; halfZ: number; height: number } {
    const source = new TeapotGeometry(1, 6);
    source.computeBoundingBox();
    // Copied: transforming the geometry recomputes its bounding box in place.
    const box = source.boundingBox!.clone();
    const scale = height / (box.max.y - box.min.y);
    source.translate(0, -box.min.y, 0);
    source.scale(scale, scale, scale);
    return {
        geometry: source,
        halfX: ((box.max.x - box.min.x) * scale) / 2,
        halfZ: ((box.max.z - box.min.z) * scale) / 2,
        height,
    };
}

export function addTeapot(ctx: PropContext, x: number, z: number, yaw: number): void {
    teapotTemplate ??= teapotGeometry(16);
    const { halfX, halfZ, height } = teapotTemplate;
    const mint = color(0x7cc6b2);
    ctx.batches.ceramic.add(teapotTemplate.geometry.clone(), (p, _n, out) => {
        out.copy(p.y > height * 0.74 && Math.hypot(p.x, p.z) < halfZ * 0.72 ? WHITE_GLAZE : mint);
    }, placement(x, 0, z, yaw));

    circleObstacle(ctx, x, z, halfZ * 0.98, height);
    for (const side of [-1, 1]) {
        const [ox, oz] = toWorld(x, z, yaw, side * (halfX - 2.2), 0);
        circleObstacle(ctx, ox, oz, 2.2, height * 0.62);
    }
}

export function disposeTemplates(): void {
    teapotTemplate?.geometry.dispose();
    teapotTemplate = null;
}

const SUGAR_BOWL_PROFILE: [number, number][] = [
    [0, 0.02], [3.6, 0.02], [3.9, 0.4], [5.3, 2.2], [5.7, 4.4], [5.4, 6.1], [5.15, 6.3], [5.35, 6.45],
    [5.35, 6.6], [5.0, 7.1], [3.8, 7.8], [1.3, 8.2], [0.8, 8.35], [1.2, 9.0], [0.9, 9.7], [0, 9.8],
];

export function addSugarBowl(ctx: PropContext, x: number, z: number): void {
    ctx.batches.ceramic.add(lathe(SUGAR_BOWL_PROFILE, ctx.segments), (p, _n, out) => {
        out.copy((p.y > 6.2 && p.y < 6.7) || p.y > 8.3 ? GOLD : WHITE_GLAZE);
    }, placement(x, 0, z));
    circleObstacle(ctx, x, z, 5.8, 9.8);
}

const JUG_PROFILE: [number, number][] = [
    [0, 0.02], [2.8, 0.02], [3.3, 0.6], [3.7, 3.4], [3.3, 6.2], [3.6, 7.6], [3.35, 7.8], [3.05, 6.4],
    [3.3, 3.4], [2.9, 1.2], [0, 1.1],
];

export function addMilkJug(ctx: PropContext, x: number, z: number, yaw: number): void {
    const matrix = placement(x, 0, z, yaw);
    const glaze = color(0x9ec9e8);
    ctx.batches.ceramic.add(lathe(JUG_PROFILE, ctx.segments), (p, n, out) => {
        out.copy(facesOutward(p, n) ? glaze : WHITE_GLAZE);
    }, matrix);
    const handle = new THREE.TorusGeometry(1.8, 0.42, 6, 10, Math.PI);
    handle.rotateZ(-Math.PI / 2);
    handle.translate(3.4, 4.2, 0);
    ctx.batches.ceramic.add(handle, glaze, matrix);
    const spout = new THREE.ConeGeometry(1.1, 2.4, 8);
    spout.rotateZ(Math.PI / 2 - 0.35);
    spout.translate(-3.7, 7.3, 0);
    ctx.batches.ceramic.add(spout, glaze, matrix);
    ctx.batches.liquid.add(disc(3.1, 5.6, ctx.segments), MILK, matrix);
    circleObstacle(ctx, x, z, 3.9, 7.8);
}

export function addNapkin(ctx: PropContext, x: number, z: number, yaw: number, size = 17): void {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(size, 0);
    shape.lineTo(0, size);
    shape.closePath();
    const napkin = new THREE.ExtrudeGeometry(shape, { depth: 0.25, bevelEnabled: false });
    napkin.rotateX(Math.PI / 2);
    napkin.translate(-size / 3, 0.27, -size / 3);

    const position = napkin.getAttribute("position") as THREE.BufferAttribute;
    const uv = napkin.getAttribute("uv") as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
        uv.setXY(i, (position.getX(i) + size / 3) / size, (position.getZ(i) + size / 3) / size);
    }
    remapUv(napkin, ctx.atlas.rect("gingham"));
    ctx.batches.print.add(napkin, null, placement(x, 0, z, yaw));
}

export function addNewspaper(ctx: PropContext, x: number, z: number, yaw: number): void {
    const paper = ctx.atlas.rect("paper");
    const sheet = new THREE.BoxGeometry(29, 0.3, 21.8);
    remapBoxFaces(sheet, [paper, paper, ctx.atlas.rect("newspaper"), paper, paper, paper]);
    sheet.translate(0, 0.15, 0);
    ctx.batches.print.add(sheet, null, placement(x, 0, z, yaw));
}
