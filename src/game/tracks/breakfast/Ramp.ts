import * as THREE from "three";
import type { Obstacle } from "../../map/Scatter";
import type { MeshBatch } from "./Batch";
import { placement } from "./Batch";

/**
 * A chopping board propped on two cookbooks across the back straight. The drivable
 * surface is analytic so the physics matches the mesh exactly: the board rises from flush
 * with the table to the lip, and the books form a plateau the car can land on.
 */
const ORIGIN_X = -88.66;
const ORIGIN_Z = 14.0;
const DIRECTION_X = 0.0556;
const DIRECTION_Z = -0.9985;

const RAMP_LENGTH = 15;
const RAMP_RISE = 4.2;
const RAMP_HALF_WIDTH = 6.5;
const BOARD_THICKNESS = 1.1;

const BOOKS_START = 14.6;
const BOOKS_LENGTH = 10;
const BOOKS_HALF_WIDTH = 12;
const PITCH = Math.atan2(RAMP_RISE, RAMP_LENGTH);
/** The books top out exactly where the board's underside meets them at the lip. */
const BOOKS_TOP = RAMP_RISE - BOARD_THICKNESS / Math.cos(PITCH);

const YAW = Math.atan2(DIRECTION_X, DIRECTION_Z);
const WALL_HALF = 0.35;

function toLocal(x: number, z: number): [number, number] {
    const dx = x - ORIGIN_X;
    const dz = z - ORIGIN_Z;
    return [dx * DIRECTION_X + dz * DIRECTION_Z, -dx * DIRECTION_Z + dz * DIRECTION_X];
}

function toWorld(along: number, across: number): [number, number] {
    return [ORIGIN_X + DIRECTION_X * along - DIRECTION_Z * across, ORIGIN_Z + DIRECTION_Z * along + DIRECTION_X * across];
}

/** Height of the ramp or books at a point, or 0 when the point is not on them. */
export function rampHeight(x: number, z: number): number {
    const dx = x - ORIGIN_X;
    const dz = z - ORIGIN_Z;
    if (dx * dx + dz * dz > 1300) return 0;

    const [along, across] = toLocal(x, z);
    const side = Math.abs(across);
    let height = 0;
    if (along >= 0 && along <= RAMP_LENGTH && side <= RAMP_HALF_WIDTH) height = (along / RAMP_LENGTH) * RAMP_RISE;
    if (along >= BOOKS_START && along <= BOOKS_START + BOOKS_LENGTH && side <= BOOKS_HALF_WIDTH) height = Math.max(height, BOOKS_TOP);
    return height;
}

/** Keeps loose cereal off the ramp and books. */
export function isNearRamp(x: number, z: number): boolean {
    const [along, across] = toLocal(x, z);
    return along > -1.5 && along < BOOKS_START + BOOKS_LENGTH + 1.2 && Math.abs(across) < BOOKS_HALF_WIDTH + 1.5;
}

function wall(along0: number, along1: number, across0: number, across1: number, height: number): Obstacle {
    const [x, z] = toWorld((along0 + along1) / 2, (across0 + across1) / 2);
    const halfX = Math.abs(across1 - across0) / 2;
    const halfZ = Math.abs(along1 - along0) / 2;
    return { x, z, radius: Math.hypot(halfX, halfZ), height, solidity: 1, box: { halfX, halfZ, yaw: YAW } };
}

/**
 * Walls stand just outside the drivable footprint, so they stop cars at table level from
 * driving into the sides while acting as low guard rails for cars already up on top.
 */
function rampObstacles(): Obstacle[] {
    const obstacles: Obstacle[] = [];
    const segments: [number, number][] = [[3, 7.5], [7.5, 11.25], [11.25, RAMP_LENGTH]];

    for (const side of [-1, 1]) {
        for (const [start, end] of segments) {
            const rise = (end / RAMP_LENGTH) * RAMP_RISE;
            obstacles.push(wall(start, end, side * RAMP_HALF_WIDTH, side * (RAMP_HALF_WIDTH + WALL_HALF * 2), rise));
        }
        obstacles.push(wall(BOOKS_START - 0.5, BOOKS_START, side * (RAMP_HALF_WIDTH + WALL_HALF * 2), side * BOOKS_HALF_WIDTH, BOOKS_TOP));
        obstacles.push(wall(BOOKS_START, BOOKS_START + BOOKS_LENGTH, side * BOOKS_HALF_WIDTH, side * (BOOKS_HALF_WIDTH + WALL_HALF * 2), BOOKS_TOP));
    }

    return obstacles;
}

const PLANK_TONES = [0xc2925a, 0xb3824a, 0xcc9d62, 0xba8950, 0xc6975c, 0xae7e47].map((hex) => new THREE.Color(hex));
const PAGES = new THREE.Color(0xf1e8d2);

function addBook(batch: MeshBatch, along: number, bottom: number, thickness: number, length: number, halfWidth: number, cover: number, trim: number): void {
    const [x, z] = toWorld(along, 0);
    const matrix = placement(x, bottom, z, YAW);
    const coverColor = new THREE.Color(cover);
    const trimColor = new THREE.Color(trim);
    const board = 0.2;
    const width = halfWidth * 2;

    const pages = new THREE.BoxGeometry(width - 0.5, thickness - board * 2, length - 0.5);
    pages.translate(0.25, thickness / 2, 0);
    batch.add(pages, PAGES, matrix);

    for (const y of [board / 2, thickness - board / 2]) {
        const plate = new THREE.BoxGeometry(width, board, length);
        plate.translate(0, y, 0);
        batch.add(plate, coverColor, matrix);
    }

    const spine = new THREE.BoxGeometry(0.3, thickness, length);
    spine.translate(-halfWidth - 0.1, thickness / 2, 0);
    batch.add(spine, (p, _n, out) => {
        out.copy(Math.abs(p.z) > length * 0.36 && Math.abs(p.z) < length * 0.42 ? trimColor : coverColor);
    }, matrix);
}

export function createRamp(batch: MeshBatch): Obstacle[] {
    const boardLength = Math.hypot(RAMP_LENGTH, RAMP_RISE);
    const planks = PLANK_TONES.length;
    const plankWidth = (RAMP_HALF_WIDTH * 2) / planks;
    const boardMatrix = placement(ORIGIN_X, 0, ORIGIN_Z, YAW, -PITCH);

    for (let i = 0; i < planks; i++) {
        const plank = new THREE.BoxGeometry(plankWidth - 0.05, BOARD_THICKNESS, boardLength);
        plank.translate(-RAMP_HALF_WIDTH + plankWidth * (i + 0.5), -BOARD_THICKNESS / 2, boardLength / 2);
        batch.add(plank, PLANK_TONES[i], boardMatrix);
    }

    const center = BOOKS_START + BOOKS_LENGTH / 2;
    const lowerThickness = BOOKS_TOP * 0.52;
    addBook(batch, center, 0, lowerThickness, BOOKS_LENGTH - 0.6, BOOKS_HALF_WIDTH - 0.4, 0x8c2a2a, 0xd9a53a);
    addBook(batch, center, lowerThickness, BOOKS_TOP - lowerThickness, BOOKS_LENGTH, BOOKS_HALF_WIDTH, 0x23407a, 0xd9a53a);

    return rampObstacles();
}
