import * as THREE from "three";
import { Rng } from "../../core/Random";
import { fbm2D, valueNoise2D } from "../../core/Noise";
import { injectDepthDisplacement, injectSurfaceShader } from "../../core/ShaderInject";
import { WIND_VERTEX_BODY, WIND_VERTEX_COMMON, windMaterialUniforms } from "../../core/Wind";
import { TRACK_WIDTH, type QualityTier } from "../../core/Config";
import type { Terrain } from "../../map/Terrain";
import type { TrackPath } from "../../map/TrackPath";
import { PlacementGrid, type Obstacle } from "../../map/Scatter";
import { BED_START, FENCE_HALF, PLAY_RADIUS, soilAmount } from "./GardenLayout";
import { merge, paint } from "./Shapes";

export interface FloraResult {
    meshes: THREE.InstancedMesh[];
    obstacles: Obstacle[];
    dispose(): void;
}

interface Placement {
    x: number;
    y: number;
    z: number;
    yaw: number;
    scale: number;
    tiltX: number;
    tiltZ: number;
    petal?: THREE.Color;
}

/** Raw triangle soup builder for foliage, where thousands of tiny parts would be slow to merge. */
class Soup {
    readonly positions: number[] = [];
    readonly normals: number[] = [];
    readonly colors: number[] = [];
    readonly sway: number[] = [];
    readonly tint: number[] = [];

    public vertex(x: number, y: number, z: number, n: THREE.Vector3, color: THREE.Color, sway: number, tint = 0): void {
        this.positions.push(x, y, z);
        this.normals.push(n.x, n.y, n.z);
        this.colors.push(color.r, color.g, color.b);
        this.sway.push(sway);
        this.tint.push(tint);
    }

    public toGeometry(): THREE.BufferGeometry {
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute("position", new THREE.Float32BufferAttribute(this.positions, 3));
        geometry.setAttribute("normal", new THREE.Float32BufferAttribute(this.normals, 3));
        geometry.setAttribute("color", new THREE.Float32BufferAttribute(this.colors, 3));
        geometry.setAttribute("aSway", new THREE.Float32BufferAttribute(this.sway, 1));
        geometry.setAttribute("aTint", new THREE.Float32BufferAttribute(this.tint, 1));
        geometry.computeBoundingSphere();
        return geometry;
    }
}

const UP = new THREE.Vector3(0, 1, 0);
const _n = new THREE.Vector3();
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _color = new THREE.Color();

/** Foliage normals lean toward the sky so blades light like the lawn instead of going black edge-on. */
function foliageNormal(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, upBias: number): THREE.Vector3 {
    _n.subVectors(b, a).cross(_c.subVectors(c, a)).normalize();
    if (_n.y < 0) _n.negate();
    return _n.multiplyScalar(1 - upBias).addScaledVector(UP, upBias).normalize();
}

function triangle(
    soup: Soup,
    a: THREE.Vector3,
    b: THREE.Vector3,
    c: THREE.Vector3,
    colorA: THREE.Color,
    colorB: THREE.Color,
    colorC: THREE.Color,
    swayA: number,
    swayB: number,
    swayC: number,
    upBias: number,
    tint = 0,
): void {
    const normal = foliageNormal(a, b, c, upBias).clone();
    soup.vertex(a.x, a.y, a.z, normal, colorA, swayA, tint);
    soup.vertex(b.x, b.y, b.z, normal, colorB, swayB, tint);
    soup.vertex(c.x, c.y, c.z, normal, colorC, swayC, tint);
}

/**
 * One tapered, curved blade. `swayHeight` normalises the sway weight so every part of a
 * plant bends consistently with its overall height.
 */
function addBlade(
    soup: Soup,
    ox: number,
    oz: number,
    baseY: number,
    height: number,
    width: number,
    yaw: number,
    lean: number,
    base: THREE.Color,
    tip: THREE.Color,
    swayHeight: number,
    upBias = 0.55,
    fold = 0,
): void {
    const rows = [0, 0.38, 0.72];
    const dirX = Math.sin(yaw);
    const dirZ = Math.cos(yaw);
    const sideX = Math.cos(yaw);
    const sideZ = -Math.sin(yaw);

    const point = (s: number, side: number, out: THREE.Vector3) => {
        const halfWidth = width * 0.5 * Math.pow(1 - s, 0.75);
        const forward = lean * s * s * height;
        const y = baseY + height * s * (1 - 0.18 * Math.abs(lean) * s);
        const cup = fold * Math.abs(side) * halfWidth;
        return out.set(
            ox + dirX * (forward - cup) + sideX * side * halfWidth,
            y,
            oz + dirZ * (forward - cup) + sideZ * side * halfWidth,
        );
    };

    const colorAt = (s: number) => _color.copy(base).lerp(tip, s).clone();
    const swayAt = (s: number) => Math.pow(THREE.MathUtils.clamp((baseY + height * s) / swayHeight, 0, 1), 1.6);

    for (let r = 0; r < rows.length; r++) {
        const s0 = rows[r];
        const s1 = r + 1 < rows.length ? rows[r + 1] : 1;
        const c0 = colorAt(s0);
        const c1 = colorAt(s1);

        if (s1 >= 1) {
            triangle(
                soup,
                point(s0, -1, _a).clone(),
                point(s0, 1, _b).clone(),
                point(1, 0, _c).clone(),
                c0, c0, c1,
                swayAt(s0), swayAt(s0), swayAt(1),
                upBias,
            );
        } else {
            const a = point(s0, -1, new THREE.Vector3());
            const b = point(s0, 1, new THREE.Vector3());
            const c = point(s1, -1, new THREE.Vector3());
            const d = point(s1, 1, new THREE.Vector3());
            triangle(soup, a, b, c, c0, c0, c1, swayAt(s0), swayAt(s0), swayAt(s1), upBias);
            triangle(soup, b, d, c, c0, c1, c1, swayAt(s0), swayAt(s1), swayAt(s1), upBias);
        }
    }
}

function buildTuft(rng: Rng, blades: number, minHeight: number, maxHeight: number, seedHeads: number): THREE.BufferGeometry {
    const soup = new Soup();
    const base = new THREE.Color();
    const tip = new THREE.Color();
    const swayHeight = maxHeight * 1.1;

    for (let i = 0; i < blades; i++) {
        const angle = rng.next() * Math.PI * 2;
        const radius = Math.sqrt(rng.next()) * 0.42;
        const ox = Math.cos(angle) * radius;
        const oz = Math.sin(angle) * radius;
        const height = rng.range(minHeight, maxHeight);
        const dry = rng.next() > 0.85;

        base.setRGB(0.03, 0.1, 0.012).multiplyScalar(rng.range(0.85, 1.15));
        if (dry) tip.setRGB(0.36, 0.34, 0.09);
        else tip.setRGB(0.13, 0.36, 0.03).multiplyScalar(rng.range(0.85, 1.15));

        addBlade(soup, ox, oz, 0, height, rng.range(0.2, 0.34), angle + rng.range(-0.6, 0.6), rng.range(0.12, 0.5), base, tip, swayHeight);
    }

    for (let i = 0; i < seedHeads; i++) {
        const angle = rng.next() * Math.PI * 2;
        const height = rng.range(maxHeight * 1.15, maxHeight * 1.45);
        const stem = new THREE.Color(0.12, 0.2, 0.04);
        const seed = new THREE.Color(0.3, 0.2, 0.08);
        addBlade(soup, Math.cos(angle) * 0.15, Math.sin(angle) * 0.15, 0, height, 0.09, angle, 0.18, stem, stem, height);
        addBlade(soup, Math.cos(angle) * 0.15 + Math.sin(angle) * 0.18 * height, Math.sin(angle) * 0.15 + Math.cos(angle) * 0.18 * height, height * 0.8, height * 0.32, 0.26, angle, 0.1, seed, seed.clone().multiplyScalar(1.15), height);
    }

    return soup.toGeometry();
}

/** Flat radial petal: a diamond from `inner` to `outer`, cupped upward toward the tip. */
function addPetal(
    soup: Soup,
    cx: number,
    cy: number,
    cz: number,
    angle: number,
    inner: number,
    outer: number,
    width: number,
    cup: number,
    color: THREE.Color,
    tipColor: THREE.Color,
    sway: number,
    tint: number,
): void {
    const dx = Math.cos(angle);
    const dz = Math.sin(angle);
    const px = -dz;
    const pz = dx;
    const mid = inner + (outer - inner) * 0.45;

    const a = new THREE.Vector3(cx + dx * inner, cy, cz + dz * inner);
    const b = new THREE.Vector3(cx + dx * mid + px * width * 0.5, cy + cup * 0.4, cz + dz * mid + pz * width * 0.5);
    const c = new THREE.Vector3(cx + dx * outer, cy + cup, cz + dz * outer);
    const d = new THREE.Vector3(cx + dx * mid - px * width * 0.5, cy + cup * 0.4, cz + dz * mid - pz * width * 0.5);

    const normalUp = new THREE.Vector3(0, 1, 0);
    soup.vertex(a.x, a.y, a.z, normalUp, color, sway, tint);
    soup.vertex(c.x, c.y, c.z, normalUp, tipColor, sway, tint);
    soup.vertex(b.x, b.y, b.z, normalUp, color, sway, tint);
    soup.vertex(a.x, a.y, a.z, normalUp, color, sway, tint);
    soup.vertex(d.x, d.y, d.z, normalUp, color, sway, tint);
    soup.vertex(c.x, c.y, c.z, normalUp, tipColor, sway, tint);
}

/** Appends an arbitrary painted geometry (already positioned) into a soup with a fixed sway and tint. */
function addGeometry(soup: Soup, source: THREE.BufferGeometry, color: THREE.Color, swayHeight: number, tint: number, shade?: (y: number) => number): void {
    const geometry = source.index ? source.toNonIndexed() : source;
    geometry.computeVertexNormals();
    const position = geometry.getAttribute("position");
    const normal = geometry.getAttribute("normal");
    const n = new THREE.Vector3();
    const c = new THREE.Color();
    for (let i = 0; i < position.count; i++) {
        const y = position.getY(i);
        n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
        c.copy(color).multiplyScalar(shade ? shade(y) : 1);
        soup.vertex(position.getX(i), y, position.getZ(i), n, c, Math.pow(THREE.MathUtils.clamp(y / swayHeight, 0, 1), 1.6), tint);
    }
    if (geometry !== source) geometry.dispose();
    source.dispose();
}

function stemCurve(height: number, lean: number): THREE.QuadraticBezierCurve3 {
    return new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(lean * 0.2, height * 0.55, 0),
        new THREE.Vector3(lean, height, 0),
    );
}

function buildDaisy(rng: Rng): { geometry: THREE.BufferGeometry; height: number } {
    const soup = new Soup();
    const height = 7;
    const lean = 0.7;
    const stemGreen = new THREE.Color(0.06, 0.18, 0.025);

    addGeometry(soup, new THREE.TubeGeometry(stemCurve(height, lean), 4, 0.13, 4, false), stemGreen, height, 0);
    for (let i = 0; i < 3; i++) {
        addBlade(soup, 0, 0, 0, rng.range(2, 2.8), 0.62, (i / 3) * Math.PI * 2, 0.55, stemGreen.clone().multiplyScalar(0.8), new THREE.Color(0.1, 0.28, 0.04), height, 0.5, 0.3);
    }

    const headY = height + 0.1;
    const center = new THREE.CylinderGeometry(0.62, 0.7, 0.42, 12, 1);
    center.translate(lean, headY, 0);
    addGeometry(soup, center, new THREE.Color(0.95, 0.52, 0.02), height, 0);

    const white = new THREE.Color(1, 1, 1);
    const petals = 12;
    for (let i = 0; i < petals; i++) {
        addPetal(soup, lean, headY, 0, (i / petals) * Math.PI * 2 + rng.range(-0.05, 0.05), 0.4, 2.2, 0.62, 0.35, white, white.clone().multiplyScalar(0.92), 1, 1);
    }

    return { geometry: soup.toGeometry(), height: headY };
}

function buildTulip(): { geometry: THREE.BufferGeometry; height: number } {
    const soup = new Soup();
    const height = 10;
    const lean = 0.45;
    const stemGreen = new THREE.Color(0.06, 0.2, 0.04);
    const leafGreen = new THREE.Color(0.09, 0.26, 0.06);

    addGeometry(soup, new THREE.TubeGeometry(stemCurve(height, lean), 4, 0.16, 4, false), stemGreen, height, 0);
    addBlade(soup, 0, 0, 0, 5.4, 1.5, 0.3, 0.35, leafGreen.clone().multiplyScalar(0.8), leafGreen, height, 0.35, 0.5);
    addBlade(soup, 0, 0, 0, 4.6, 1.4, Math.PI + 0.4, 0.4, leafGreen.clone().multiplyScalar(0.8), leafGreen, height, 0.35, 0.5);

    const profile = [
        new THREE.Vector2(0.05, 0),
        new THREE.Vector2(0.75, 0.25),
        new THREE.Vector2(1.18, 0.95),
        new THREE.Vector2(1.2, 1.7),
        new THREE.Vector2(1.0, 2.35),
        new THREE.Vector2(0.78, 2.7),
    ];
    const cup = new THREE.LatheGeometry(profile, 9);
    const position = cup.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
        const y = position.getY(i);
        if (y < 2.2) continue;
        const angle = Math.atan2(position.getZ(i), position.getX(i));
        // Three petal tips poking up from the rim.
        position.setY(i, y + Math.max(0, Math.cos(angle * 3)) * 0.55);
    }
    cup.translate(lean, height - 0.2, 0);
    addGeometry(soup, cup, new THREE.Color(1, 1, 1), height, 1, (y) => 0.72 + 0.28 * THREE.MathUtils.clamp((y - height) / 2.5, 0, 1));

    return { geometry: soup.toGeometry(), height: height + 2.6 };
}

function buildDandelion(rng: Rng): { geometry: THREE.BufferGeometry; height: number } {
    const soup = new Soup();
    const height = 5.6;
    const lean = 0.5;
    const stemGreen = new THREE.Color(0.1, 0.22, 0.04);
    const leaf = new THREE.Color(0.06, 0.2, 0.03);

    addGeometry(soup, new THREE.TubeGeometry(stemCurve(height, lean), 4, 0.11, 4, false), stemGreen, height, 0);
    for (let i = 0; i < 5; i++) {
        addBlade(soup, 0, 0, 0, rng.range(2.6, 3.4), 0.8, (i / 5) * Math.PI * 2 + rng.range(-0.3, 0.3), 1.6, leaf.clone().multiplyScalar(0.85), leaf, height, 0.75);
    }

    const head = new THREE.IcosahedronGeometry(1.05, 1);
    const position = head.getAttribute("position") as THREE.BufferAttribute;
    for (let i = 0; i < position.count; i++) {
        position.setY(i, position.getY(i) * 0.62);
        const jitterAmount = 0.9 + ((i * 7919) % 13) / 60;
        position.setX(i, position.getX(i) * jitterAmount);
        position.setZ(i, position.getZ(i) * jitterAmount);
    }
    head.translate(lean, height + 0.3, 0);
    addGeometry(soup, head, new THREE.Color(1, 1, 1), height, 1);

    return { geometry: soup.toGeometry(), height: height + 1 };
}

function buildSunflower(rng: Rng): { geometry: THREE.BufferGeometry; height: number } {
    const soup = new Soup();
    const height = 46;
    const stemGreen = new THREE.Color(0.07, 0.18, 0.03);
    const leafGreen = new THREE.Color(0.06, 0.2, 0.025);

    const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(0, height * 0.6, 0.6),
        new THREE.Vector3(0, height, 2.2),
    );
    addGeometry(soup, new THREE.TubeGeometry(curve, 10, 0.75, 6, false), stemGreen, height, 0);

    for (let i = 0; i < 6; i++) {
        const y = 8 + i * 6 + rng.range(-1, 1);
        const yaw = i * 2.3 + rng.range(-0.3, 0.3);
        addBlade(soup, 0, 0, y, 8, 5.5, yaw, 1.3, leafGreen.clone().multiplyScalar(0.8), leafGreen, height, 0.6, 0.25);
    }

    // The head faces +Z (outward from the stem) so placement can turn it toward the garden.
    const head = new THREE.Group();
    head.position.set(0, height + 0.5, 2.6);
    head.rotation.x = 0.5;
    head.updateMatrixWorld();

    const discGeometry = new THREE.CylinderGeometry(5, 5.4, 1.4, 20, 1);
    discGeometry.rotateX(Math.PI / 2);
    discGeometry.applyMatrix4(head.matrixWorld);
    addGeometry(soup, discGeometry, new THREE.Color(0.09, 0.04, 0.015), height, 0, (y) => 0.9 + ((y * 13.7) % 1) * 0.2);

    const backGeometry = new THREE.ConeGeometry(5.2, 2.4, 16, 1, true);
    backGeometry.rotateX(-Math.PI / 2);
    backGeometry.translate(0, 0, -1.8);
    backGeometry.applyMatrix4(head.matrixWorld);
    addGeometry(soup, backGeometry, stemGreen, height, 0);

    const petalSoup = new Soup();
    const yellow = new THREE.Color(0.95, 0.55, 0.01);
    const deep = new THREE.Color(0.85, 0.3, 0.005);
    for (let ring = 0; ring < 2; ring++) {
        const count = 22;
        for (let i = 0; i < count; i++) {
            const angle = (i / count) * Math.PI * 2 + ring * 0.14;
            addPetal(petalSoup, 0, ring * -0.25, 0, angle, 4.4, 10.2 - ring * 0.8, 2.1, -0.9 - ring * 0.4, deep, yellow, 1, 0);
        }
    }
    const petalGeometry = petalSoup.toGeometry();
    petalGeometry.rotateX(Math.PI / 2);
    petalGeometry.applyMatrix4(head.matrixWorld);
    const petalPositions = petalGeometry.getAttribute("position");
    const petalColors = petalGeometry.getAttribute("color");
    const n = new THREE.Vector3(0, 0, 1).applyMatrix3(new THREE.Matrix3().setFromMatrix4(head.matrixWorld)).normalize();
    for (let i = 0; i < petalPositions.count; i++) {
        _color.setRGB(petalColors.getX(i), petalColors.getY(i), petalColors.getZ(i));
        soup.vertex(petalPositions.getX(i), petalPositions.getY(i), petalPositions.getZ(i), n, _color, 1, 0);
    }
    petalGeometry.dispose();

    return { geometry: soup.toGeometry(), height: height + 10 };
}

function buildClover(rng: Rng): THREE.BufferGeometry {
    const soup = new Soup();
    const green = new THREE.Color(0.05, 0.2, 0.035);
    const light = new THREE.Color(0.16, 0.38, 0.1);
    const stemHeight = rng.range(0.9, 1.3);

    addBlade(soup, 0, 0, 0, stemHeight, 0.1, 0, 0.1, green, green, stemHeight + 0.2, 0.3);

    for (let leaf = 0; leaf < 3; leaf++) {
        const angle = (leaf / 3) * Math.PI * 2 + rng.range(-0.15, 0.15);
        const steps = 8;
        const center = new THREE.Vector3(0, stemHeight, 0);
        for (let i = 0; i < steps; i++) {
            const a0 = (i / steps) * Math.PI * 2;
            const a1 = ((i + 1) / steps) * Math.PI * 2;
            const heart = (a: number) => {
                // Two lobes: a cardioid-ish outline with the notch facing out.
                const r = 0.55 * (1 - 0.35 * Math.cos(a * 2)) * (0.8 + 0.2 * Math.cos(a));
                const lx = 0.5 + Math.cos(a) * r;
                const lz = Math.sin(a) * r * 1.05;
                return new THREE.Vector3(
                    Math.cos(angle) * lx - Math.sin(angle) * lz,
                    stemHeight + 0.06 * lx,
                    Math.sin(angle) * lx + Math.cos(angle) * lz,
                );
            };
            const p0 = heart(a0);
            const p1 = heart(a1);
            const middle = new THREE.Vector3(Math.cos(angle) * 0.45, stemHeight + 0.03, Math.sin(angle) * 0.45);
            triangle(soup, center, p0, p1, green, green, green, 1, 1, 1, 0.8);
            triangle(soup, middle, p0, p1, light, green, green, 1, 1, 1, 0.8);
        }
    }

    return soup.toGeometry();
}

function buildToadstool(rng: Rng): { geometry: THREE.BufferGeometry; height: number } {
    const soup = new Soup();
    const stemHeight = 2.5;
    const cream = new THREE.Color(0.85, 0.76, 0.56);

    const stem = new THREE.LatheGeometry(
        [
            new THREE.Vector2(0.55, 0),
            new THREE.Vector2(0.5, 0.4),
            new THREE.Vector2(0.4, 1.4),
            new THREE.Vector2(0.36, stemHeight),
        ],
        9,
    );
    addGeometry(soup, stem, cream, 8, 0);

    const gills = new THREE.CylinderGeometry(1.55, 0.4, 0.35, 14, 1, true);
    gills.translate(0, stemHeight + 0.05, 0);
    addGeometry(soup, gills, new THREE.Color(0.62, 0.5, 0.33), 8, 0);

    const capSource = new THREE.SphereGeometry(1.9, 22, 9, 0, Math.PI * 2, 0, Math.PI / 2);
    capSource.scale(1, 0.72, 1);
    capSource.translate(0, stemHeight, 0);
    const cap = capSource.toNonIndexed();
    capSource.dispose();
    const position = cap.getAttribute("position");
    const normal = cap.getAttribute("normal");
    const n = new THREE.Vector3();
    const dir = new THREE.Vector3();
    const white = new THREE.Color(0.95, 0.93, 0.88);
    const base = new THREE.Color(1, 1, 1);

    // Round white spots: per-vertex so the tint blends softly across each triangle.
    const spots: { dir: THREE.Vector3; radius: number }[] = [];
    for (let i = 0; i < 9; i++) {
        const angle = rng.next() * Math.PI * 2;
        const elevation = rng.range(0.35, 1.45);
        spots.push({
            dir: new THREE.Vector3(Math.cos(angle) * Math.cos(elevation), Math.sin(elevation), Math.sin(angle) * Math.cos(elevation)).normalize(),
            radius: rng.range(0.16, 0.27),
        });
    }

    for (let i = 0; i < position.count; i++) {
        const x = position.getX(i);
        const y = position.getY(i);
        const z = position.getZ(i);
        dir.set(x, (y - stemHeight) / 0.72, z).normalize();
        let spot = 0;
        for (const s of spots) spot = Math.max(spot, 1 - THREE.MathUtils.smoothstep(dir.angleTo(s.dir), s.radius * 0.7, s.radius));
        n.set(normal.getX(i), normal.getY(i), normal.getZ(i));
        soup.vertex(x, y, z, n, spot > 0.5 ? white : base, 0.2, 1 - spot);
    }
    cap.dispose();

    return { geometry: soup.toGeometry(), height: stemHeight + 1.4 };
}

function buildShrub(rng: Rng, flowers: boolean): THREE.BufferGeometry {
    const parts: THREE.BufferGeometry[] = [];
    const greens = [0x2f6b27, 0x3a7d2c, 0x468f35, 0x2a5d23];
    const blobs = 6 + rng.int(3);
    const temp = new THREE.Color();

    for (let i = 0; i < blobs; i++) {
        const radius = rng.range(2.6, 4.4);
        const blob = new THREE.IcosahedronGeometry(radius, 1);
        const angle = rng.next() * Math.PI * 2;
        const spread = i === 0 ? 0 : rng.range(1.5, 4.2);
        blob.scale(1, rng.range(0.75, 0.95), 1);
        blob.translate(Math.cos(angle) * spread, radius * 0.72 + rng.range(0, 2.4), Math.sin(angle) * spread);
        const dark = new THREE.Color(rng.pick(greens));
        const light = dark.clone().multiplyScalar(1.35);
        const top = radius * 2 + 3;
        parts.push(paint(blob, (_x, y) => temp.copy(dark).lerp(light, THREE.MathUtils.clamp(y / top, 0, 1)).multiplyScalar(rng.range(0.9, 1.1)), {
            aSway: (_x, y) => Math.pow(THREE.MathUtils.clamp(y / 10, 0, 1), 1.6) * 0.5,
            aTint: () => 0,
        }));
    }

    if (flowers) {
        const colors = [0xe86aa0, 0x8f7fe8, 0xf4f0f4, 0xf2a2c8];
        for (let i = 0; i < 9; i++) {
            const flower = new THREE.IcosahedronGeometry(rng.range(0.9, 1.4), 0);
            const angle = rng.next() * Math.PI * 2;
            const spread = rng.range(0.5, 4.5);
            flower.translate(Math.cos(angle) * spread, rng.range(4.2, 7.4), Math.sin(angle) * spread);
            parts.push(paint(flower, jitterColor(new THREE.Color(rng.pick(colors)), rng), {
                aSway: () => 0.4,
                aTint: () => 0,
            }));
        }
    }

    return merge(parts);
}

function jitterColor(color: THREE.Color, rng: Rng): THREE.Color {
    return color.multiplyScalar(rng.range(0.9, 1.08));
}

function createFoliageMaterial(cacheKey: string, windStrength: number, tinted: boolean): {
    material: THREE.MeshStandardMaterial;
    depth: THREE.MeshDepthMaterial;
} {
    const uniforms = windMaterialUniforms(windStrength);
    const material = new THREE.MeshStandardMaterial({
        vertexColors: true,
        roughness: 0.78,
        metalness: 0,
        side: THREE.DoubleSide,
    });

    const tintCommon = tinted ? "attribute float aTint;\nattribute vec3 aPetal;" : "";
    const tintBody = tinted ? "vColor.rgb = mix(vColor.rgb, vColor.rgb * aPetal, aTint);" : "";

    injectSurfaceShader(material, {
        cacheKey,
        uniforms,
        vertexCommon: `${WIND_VERTEX_COMMON}\n${tintCommon}`,
        vertexBody: `${WIND_VERTEX_BODY}\n${tintBody}`,
        // Keep the sky-biased normal on back faces too, instead of flipping it into the ground.
        fragmentNormal: "normal = normalize(vNormal);",
    });

    material.userData.tinted = tinted;

    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    injectDepthDisplacement(depth, `${cacheKey}-depth`, uniforms, WIND_VERTEX_COMMON, WIND_VERTEX_BODY);

    return { material, depth };
}

const _matrix = new THREE.Matrix4();
const _quaternion = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _position = new THREE.Vector3();
const _scale = new THREE.Vector3();

function instance(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    depth: THREE.Material | null,
    placements: Placement[],
    castShadow: boolean,
): THREE.InstancedMesh | null {
    if (placements.length === 0) return null;

    // Only tinted materials read aPetal; untinted foliage may share one geometry between meshes.
    if (material.userData.tinted) {
        const petals = new Float32Array(placements.length * 3);
        placements.forEach((placement, index) => {
            const color = placement.petal ?? _color.setRGB(1, 1, 1);
            petals[index * 3] = color.r;
            petals[index * 3 + 1] = color.g;
            petals[index * 3 + 2] = color.b;
        });
        geometry.setAttribute("aPetal", new THREE.InstancedBufferAttribute(petals, 3));
    }

    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    placements.forEach((placement, index) => {
        _euler.set(placement.tiltX, placement.yaw, placement.tiltZ, "YXZ");
        _quaternion.setFromEuler(_euler);
        _position.set(placement.x, placement.y, placement.z);
        _scale.setScalar(placement.scale);
        _matrix.compose(_position, _quaternion, _scale);
        mesh.setMatrixAt(index, _matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    mesh.name = name;
    mesh.userData.nonCollidable = true;
    if (depth) mesh.customDepthMaterial = depth;
    return mesh;
}

const DENSITY: Record<QualityTier["name"], number> = { low: 0.45, medium: 0.75, high: 1 };

const TULIP_COLORS = [0xe0262c, 0xf2c122, 0xf06aa0, 0xf08a24, 0x9b4fd6, 0xfaf4ea];
const DAISY_COLORS = [0xffffff, 0xffffff, 0xffffff, 0xf7c8e0, 0xc9b8f5];
const TOADSTOOL_COLORS = [0xd6261c, 0xd6261c, 0xe0521c, 0xa8683a];

export function createFlora(
    trackPath: TrackPath,
    terrain: Terrain,
    quality: QualityTier,
    grid: PlacementGrid,
    seed = 4242,
): FloraResult {
    const rng = new Rng(seed);
    const density = DENSITY[quality.name];
    const start = trackPath.samples[0];
    const obstacles: Obstacle[] = [];

    const nearStart = (x: number, z: number) => Math.hypot(x - start.x, z - start.z) < 20;
    const inPlay = (x: number, z: number) => Math.hypot(x, z) < PLAY_RADIUS + 2;
    const insideFence = (x: number, z: number, margin: number) =>
        Math.abs(x) < FENCE_HALF - margin && Math.abs(z) < FENCE_HALF - margin;

    const tuftTemplates = [
        buildTuft(rng, 13, 1.4, 2.5, 0),
        buildTuft(rng, 10, 2.6, 4.2, 0),
        buildTuft(rng, 9, 2.2, 3.6, 2),
    ];
    // Verge tufts sit inside the shadow frustum most of the lap; the open-lawn ones skip the shadow pass.
    const vergeTufts: Placement[][] = tuftTemplates.map(() => []);
    const lawnTufts: Placement[][] = tuftTemplates.map(() => []);

    const placeTuft = (x: number, z: number, scale: number, verge: boolean) => {
        if (nearStart(x, z) || !insideFence(x, z, 3)) return;
        if (soilAmount(x, z) > 0.45) return;
        if (!grid.canPlace(x, z, 0.3)) return;
        (verge ? vergeTufts : lawnTufts)[rng.int(tuftTemplates.length)].push({
            x,
            y: terrain.getHeightAt(x, z) - 0.05,
            z,
            yaw: rng.next() * Math.PI * 2,
            scale,
            tiltX: rng.range(-0.08, 0.08),
            tiltZ: rng.range(-0.08, 0.08),
        });
    };

    // Dense verge along both edges of the path — this is what sells the scale from the chase camera.
    const halfWidth = TRACK_WIDTH / 2;
    for (let i = 0; i < trackPath.samples.length; i++) {
        const sample = trackPath.samples[i];
        for (const side of [-1, 1]) {
            if (rng.next() > 0.62 * density) continue;
            const lateral = side * (halfWidth + 2.9 + Math.pow(rng.next(), 1.7) * 10);
            const x = sample.x - sample.tangentZ * lateral + rng.range(-0.4, 0.4);
            const z = sample.z + sample.tangentX * lateral + rng.range(-0.4, 0.4);
            if (terrain.getTrackDistance(x, z) < halfWidth + 2.7) continue;
            placeTuft(x, z, rng.range(0.8, 1.35), true);
        }
    }

    // Loose clumps across the open lawn.
    const lawnTuftCount = Math.round(700 * density);
    for (let attempt = 0, placed = 0; placed < lawnTuftCount && attempt < lawnTuftCount * 12; attempt++) {
        const x = rng.range(-FENCE_HALF + 4, FENCE_HALF - 4);
        const z = rng.range(-FENCE_HALF + 4, FENCE_HALF - 4);
        const clump = fbm2D(x * 0.03 + 11, z * 0.03 - 7, 2);
        if (rng.next() > clump * clump * 2.2) continue;
        if (terrain.getTrackDistance(x, z) < halfWidth + 3.5) continue;
        placeTuft(x, z, rng.range(0.9, 1.5), false);
        placed++;
    }

    const daisy = buildDaisy(rng);
    const tulip = buildTulip();
    const dandelion = buildDandelion(rng);
    const sunflower = buildSunflower(rng);
    const daisyPlacements: Placement[] = [];
    const tulipPlacements: Placement[] = [];
    const dandelionPlacements: Placement[] = [];
    const sunflowerPlacements: Placement[] = [];

    const addFlower = (list: Placement[], x: number, z: number, scale: number, petal: THREE.Color, height: number) => {
        list.push({
            x,
            y: terrain.getHeightAt(x, z) - 0.1,
            z,
            yaw: rng.next() * Math.PI * 2,
            scale,
            tiltX: rng.range(-0.06, 0.06),
            tiltZ: rng.range(-0.06, 0.06),
            petal,
        });
        grid.place(x, z, 0.5);
        if (inPlay(x, z)) {
            obstacles.push({ x, z, radius: 0.32 * scale, height: height * scale, solidity: 0.05 });
        }
    };

    // Clumps of wild flowers dotted through the lawn, clear of the verge so the path stays readable.
    const clumps = Math.round(46 * density);
    for (let attempt = 0, placed = 0; placed < clumps && attempt < clumps * 30; attempt++) {
        const x = rng.range(-BED_START + 6, BED_START - 6);
        const z = rng.range(-BED_START + 6, BED_START - 6);
        if (terrain.getTrackDistance(x, z) < halfWidth + 7) continue;
        if (soilAmount(x, z) > 0.2 || !grid.canPlace(x, z, 3)) continue;

        const kind = rng.next();
        const count = 3 + rng.int(5);
        const clumpColor = new THREE.Color(rng.pick(kind < 0.4 ? DAISY_COLORS : TULIP_COLORS));
        for (let k = 0; k < count; k++) {
            const angle = rng.next() * Math.PI * 2;
            const radius = Math.sqrt(rng.next()) * 3.2;
            const fx = x + Math.cos(angle) * radius;
            const fz = z + Math.sin(angle) * radius;
            if (terrain.getTrackDistance(fx, fz) < halfWidth + 5) continue;
            if (kind < 0.4) {
                addFlower(daisyPlacements, fx, fz, rng.range(0.8, 1.25), clumpColor, daisy.height);
            } else if (kind < 0.7) {
                const puff = rng.next() > 0.7;
                addFlower(dandelionPlacements, fx, fz, rng.range(0.85, 1.2) * (puff ? 1.25 : 1), new THREE.Color(puff ? 0xf4f1e8 : 0xffc414), dandelion.height);
            } else {
                addFlower(tulipPlacements, fx, fz, rng.range(0.85, 1.2), clumpColor, tulip.height);
            }
        }
        placed++;
    }

    // Clover in the lawn's clover patches — same noise the lawn shader uses for its tint.
    const clover = buildClover(rng);
    const cloverPlacements: Placement[] = [];
    const cloverCount = Math.round(400 * density);
    for (let attempt = 0; cloverPlacements.length < cloverCount && attempt < cloverCount * 20; attempt++) {
        const x = rng.range(-BED_START, BED_START);
        const z = rng.range(-BED_START, BED_START);
        if (valueNoise2D(x * 0.14 + 91, z * 0.14 + 7) < 0.6) continue;
        if (terrain.getTrackDistance(x, z) < halfWidth + 3) continue;
        if (nearStart(x, z) || soilAmount(x, z) > 0.3 || !grid.canPlace(x, z, 0.4)) continue;
        cloverPlacements.push({
            x,
            y: terrain.getHeightAt(x, z) - 0.05,
            z,
            yaw: rng.next() * Math.PI * 2,
            scale: rng.range(0.9, 1.5),
            tiltX: 0,
            tiltZ: 0,
        });
    }

    // Toadstools: a fairy ring in the infield plus a few clusters under the shrubs.
    const toadstool = buildToadstool(rng);
    const toadstoolPlacements: Placement[] = [];
    const addToadstool = (x: number, z: number, scale: number) => {
        if (!grid.canPlace(x, z, 1.2 * scale)) return;
        grid.place(x, z, 1.2 * scale);
        toadstoolPlacements.push({
            x,
            y: terrain.getHeightAt(x, z) - 0.1,
            z,
            yaw: rng.next() * Math.PI * 2,
            scale,
            tiltX: rng.range(-0.1, 0.1),
            tiltZ: rng.range(-0.1, 0.1),
            petal: new THREE.Color(rng.pick(TOADSTOOL_COLORS)),
        });
        if (inPlay(x, z)) {
            obstacles.push({ x, z, radius: 0.6 * scale, height: toadstool.height * scale, solidity: 0.35 });
        }
    };
    const ringCount = 11;
    for (let i = 0; i < ringCount; i++) {
        const angle = (i / ringCount) * Math.PI * 2 + rng.range(-0.1, 0.1);
        addToadstool(4 + Math.cos(angle) * 10, -4 + Math.sin(angle) * 10, rng.range(0.8, 1.4));
    }

    // Sunflowers claim the beds first — they tower over the fence line.
    for (let side = 0; side < 4; side++) {
        for (let k = 0; k < 3; k++) {
            const v = -FENCE_HALF + 30 + (k + rng.next() * 0.6) * ((FENCE_HALF * 2 - 60) / 3);
            const inset = FENCE_HALF - rng.range(6, 10);
            const p = side === 0 ? { x: v, z: -inset } : side === 1 ? { x: inset, z: v } : side === 2 ? { x: -v, z: inset } : { x: -inset, z: -v };
            if (!grid.canPlace(p.x, p.z, 4)) continue;
            grid.place(p.x, p.z, 4);
            sunflowerPlacements.push({
                x: p.x,
                y: terrain.getHeightAt(p.x, p.z) - 0.3,
                z: p.z,
                // Face the flower head back toward the middle of the garden.
                yaw: Math.atan2(-p.x, -p.z) + rng.range(-0.3, 0.3),
                scale: rng.range(0.85, 1.15),
                tiltX: rng.range(-0.04, 0.04),
                tiltZ: rng.range(-0.04, 0.04),
            });
        }
    }

    // Shrubs fill the beds so the fence line reads as a planted border.
    const shrubTemplates = [buildShrub(rng, false), buildShrub(rng, true), buildShrub(rng, false)];
    const shrubPlacements: Placement[][] = shrubTemplates.map(() => []);
    for (let side = 0; side < 4; side++) {
        for (let v = -FENCE_HALF + 10; v < FENCE_HALF - 10; v += rng.range(16, 26)) {
            const inset = FENCE_HALF - rng.range(5, 11);
            const p = side === 0 ? { x: v, z: -inset } : side === 1 ? { x: inset, z: v } : side === 2 ? { x: -v, z: inset } : { x: -inset, z: -v };
            if (!grid.canPlace(p.x, p.z, 5)) continue;
            grid.place(p.x, p.z, 5);
            shrubPlacements[rng.int(shrubTemplates.length)].push({
                x: p.x,
                y: terrain.getHeightAt(p.x, p.z) - 0.6,
                z: p.z,
                yaw: rng.next() * Math.PI * 2,
                scale: rng.range(1.0, 1.6),
                tiltX: 0,
                tiltZ: 0,
            });
            if (rng.next() > 0.6) {
                const angle = rng.next() * Math.PI * 2;
                addToadstool(p.x + Math.cos(angle) * 9, p.z + Math.sin(angle) * 9, rng.range(0.7, 1.1));
            }
        }
    }

    // Tulip rows fill whatever bed space the sunflowers and shrubs left.
    for (let side = 0; side < 4; side++) {
        const along = (v: number) => {
            const inset = FENCE_HALF - rng.range(8, 15);
            switch (side) {
                case 0: return { x: v, z: -inset };
                case 1: return { x: inset, z: v };
                case 2: return { x: -v, z: inset };
                default: return { x: -inset, z: -v };
            }
        };

        const rowColor = new THREE.Color(rng.pick(TULIP_COLORS));
        for (let v = -FENCE_HALF + 18; v < FENCE_HALF - 18; v += rng.range(4.2, 6.8) / Math.sqrt(density)) {
            const p = along(v);
            if (Math.abs(p.x) > FENCE_HALF - 5 || Math.abs(p.z) > FENCE_HALF - 5) continue;
            if (!grid.canPlace(p.x, p.z, 1)) continue;
            if (rng.next() > 0.93) rowColor.set(rng.pick(TULIP_COLORS));
            addFlower(tulipPlacements, p.x, p.z, rng.range(1.2, 1.6), rowColor.clone(), tulip.height);
        }
    }

    const meshes: THREE.InstancedMesh[] = [];
    const disposables: { dispose(): void }[] = [];
    const grass = createFoliageMaterial("mm-grass", 0.32, false);
    const flowers = createFoliageMaterial("mm-flower", 0.45, true);
    const shrubs = createFoliageMaterial("mm-shrub", 0.14, false);
    const tall = createFoliageMaterial("mm-sunflower", 1.1, true);
    disposables.push(grass.material, grass.depth, flowers.material, flowers.depth, shrubs.material, shrubs.depth, tall.material, tall.depth);

    const push = (mesh: THREE.InstancedMesh | null) => {
        if (mesh) meshes.push(mesh);
    };

    tuftTemplates.forEach((geometry, index) => {
        push(instance(`grass-verge-${index}`, geometry, grass.material, grass.depth, vergeTufts[index], true));
        push(instance(`grass-lawn-${index}`, geometry, grass.material, grass.depth, lawnTufts[index], false));
        disposables.push(geometry);
    });
    push(instance("clover", clover, grass.material, grass.depth, cloverPlacements, false));
    push(instance("daisies", daisy.geometry, flowers.material, flowers.depth, daisyPlacements, true));
    push(instance("tulips", tulip.geometry, flowers.material, flowers.depth, tulipPlacements, true));
    push(instance("dandelions", dandelion.geometry, flowers.material, flowers.depth, dandelionPlacements, true));
    push(instance("toadstools", toadstool.geometry, flowers.material, flowers.depth, toadstoolPlacements, true));
    push(instance("sunflowers", sunflower.geometry, tall.material, tall.depth, sunflowerPlacements, true));
    shrubTemplates.forEach((geometry, index) => {
        push(instance(`shrubs-${index}`, geometry, shrubs.material, shrubs.depth, shrubPlacements[index], true));
        disposables.push(geometry);
    });
    disposables.push(clover, daisy.geometry, tulip.geometry, dandelion.geometry, toadstool.geometry, sunflower.geometry);

    return {
        meshes,
        obstacles,
        dispose() {
            disposables.forEach((item) => item.dispose());
            meshes.forEach((mesh) => mesh.dispose());
        },
    };
}
