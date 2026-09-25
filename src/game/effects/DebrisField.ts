import * as THREE from "three";
import type { DebrisSpec } from "../tracks/types";
import type { HeightFunction } from "../map/Terrain";

const CELL_SIZE = 2;
const GRAVITY = 30;
const SLEEP_SPEED_SQ = 0.03 * 0.03;
const CAR_HALF_WIDTH = 0.66;
const CAR_HALF_LENGTH = 1.05;
const RESTITUTION = 0.45;

function cellKey(cx: number, cz: number): number {
    return (cx + 4096) * 8192 + (cz + 4096);
}

/**
 * Loose clutter the cars can plough through. Items sleep in a spatial grid until something
 * touches them, so a thousand cereal hoops cost nothing while they lie still.
 */
export class DebrisField {
    readonly mesh: THREE.InstancedMesh;

    private readonly count: number;
    private readonly radius: number;
    private readonly restHeight: number;
    private readonly mass: number;
    private readonly heightAt: HeightFunction;

    private readonly initial: Float32Array;
    private readonly px: Float32Array;
    private readonly py: Float32Array;
    private readonly pz: Float32Array;
    private readonly vx: Float32Array;
    private readonly vy: Float32Array;
    private readonly vz: Float32Array;
    private readonly yaw: Float32Array;
    private readonly spin: Float32Array;
    private readonly tiltX: Float32Array;
    private readonly tiltZ: Float32Array;
    private readonly tiltSpeedX: Float32Array;
    private readonly tiltSpeedZ: Float32Array;
    private readonly scale: Float32Array;
    private readonly awake: Uint8Array;

    private readonly awakeList: number[] = [];
    private readonly cells = new Map<number, number[]>();
    private readonly cellOf: Float64Array;

    private dirtyMin = Infinity;
    private dirtyMax = -Infinity;

    private readonly _matrix = new THREE.Matrix4();
    private readonly _position = new THREE.Vector3();
    private readonly _quaternion = new THREE.Quaternion();
    private readonly _euler = new THREE.Euler(0, 0, 0, "YXZ");
    private readonly _scale = new THREE.Vector3();

    constructor(spec: DebrisSpec, heightAt: HeightFunction) {
        this.count = spec.items.length;
        this.radius = spec.radius;
        this.restHeight = spec.restHeight;
        this.mass = THREE.MathUtils.clamp(spec.mass, 0, 1);
        this.heightAt = heightAt;

        const n = this.count;
        this.initial = new Float32Array(n * 4);
        this.px = new Float32Array(n);
        this.py = new Float32Array(n);
        this.pz = new Float32Array(n);
        this.vx = new Float32Array(n);
        this.vy = new Float32Array(n);
        this.vz = new Float32Array(n);
        this.yaw = new Float32Array(n);
        this.spin = new Float32Array(n);
        this.tiltX = new Float32Array(n);
        this.tiltZ = new Float32Array(n);
        this.tiltSpeedX = new Float32Array(n);
        this.tiltSpeedZ = new Float32Array(n);
        this.scale = new Float32Array(n);
        this.awake = new Uint8Array(n);
        this.cellOf = new Float64Array(n).fill(-1);

        this.mesh = new THREE.InstancedMesh(spec.geometry, spec.material, Math.max(1, n));
        this.mesh.count = n;
        this.mesh.castShadow = spec.castShadow;
        this.mesh.receiveShadow = true;
        this.mesh.frustumCulled = false;
        this.mesh.name = `debris-${spec.name}`;
        this.mesh.userData.nonCollidable = true;
        this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

        spec.items.forEach((item, index) => {
            this.initial[index * 4] = item.x;
            this.initial[index * 4 + 1] = item.z;
            this.initial[index * 4 + 2] = item.yaw;
            this.initial[index * 4 + 3] = item.scale ?? 1;
            if (item.color) this.mesh.setColorAt(index, item.color);
        });
        if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;

        this.reset();
    }

    /** Puts every item back where the theme placed it — used when a race restarts. */
    public reset(): void {
        this.cells.clear();
        this.awakeList.length = 0;

        for (let i = 0; i < this.count; i++) {
            const x = this.initial[i * 4];
            const z = this.initial[i * 4 + 1];
            this.px[i] = x;
            this.pz[i] = z;
            this.yaw[i] = this.initial[i * 4 + 2];
            this.scale[i] = this.initial[i * 4 + 3];
            this.py[i] = this.heightAt(x, z) + this.restHeight * this.scale[i];
            this.vx[i] = 0;
            this.vy[i] = 0;
            this.vz[i] = 0;
            this.spin[i] = 0;
            this.tiltX[i] = 0;
            this.tiltZ[i] = 0;
            this.tiltSpeedX[i] = 0;
            this.tiltSpeedZ[i] = 0;
            this.awake[i] = 0;
            this.cellOf[i] = -1;
            this.insert(i);
            this.writeMatrix(i);
        }

        this.dirtyMin = Infinity;
        this.dirtyMax = -Infinity;
        this.mesh.instanceMatrix.clearUpdateRanges();
        this.mesh.instanceMatrix.needsUpdate = true;
    }

    private insert(index: number): void {
        const key = cellKey(Math.floor(this.px[index] / CELL_SIZE), Math.floor(this.pz[index] / CELL_SIZE));
        const bucket = this.cells.get(key);
        if (bucket) bucket.push(index);
        else this.cells.set(key, [index]);
        this.cellOf[index] = key;
    }

    private remove(index: number): void {
        const key = this.cellOf[index];
        if (key < 0) return;
        const bucket = this.cells.get(key);
        if (bucket) {
            const at = bucket.indexOf(index);
            if (at >= 0) {
                bucket[at] = bucket[bucket.length - 1];
                bucket.pop();
            }
        }
        this.cellOf[index] = -1;
    }

    private wake(index: number): void {
        if (this.awake[index]) return;
        this.awake[index] = 1;
        this.remove(index);
        this.awakeList.push(index);
    }

    /**
     * Pushes items out of a car's footprint and hands them the car's momentum.
     * Returns how much the car should be slowed, as a 0..1 fraction of its speed.
     */
    public collideCar(
        x: number,
        z: number,
        y: number,
        headingSin: number,
        headingCos: number,
        carVx: number,
        carVz: number,
    ): number {
        const reach = CAR_HALF_LENGTH + this.radius * 2;
        const minCx = Math.floor((x - reach) / CELL_SIZE);
        const maxCx = Math.floor((x + reach) / CELL_SIZE);
        const minCz = Math.floor((z - reach) / CELL_SIZE);
        const maxCz = Math.floor((z + reach) / CELL_SIZE);

        let drag = 0;

        for (let cz = minCz; cz <= maxCz; cz++) {
            for (let cx = minCx; cx <= maxCx; cx++) {
                const bucket = this.cells.get(cellKey(cx, cz));
                if (!bucket) continue;
                // Iterate backwards: a hit wakes the item and removes it from this bucket.
                for (let k = bucket.length - 1; k >= 0; k--) {
                    drag += this.collideItem(bucket[k], x, z, y, headingSin, headingCos, carVx, carVz);
                }
            }
        }

        for (let k = this.awakeList.length - 1; k >= 0; k--) {
            drag += this.collideItem(this.awakeList[k], x, z, y, headingSin, headingCos, carVx, carVz);
        }

        // Capped per step so ploughing a whole row of cereal slows the car rather than jolting it.
        return Math.min(drag, 0.02);
    }

    private collideItem(
        i: number,
        x: number,
        z: number,
        y: number,
        sin: number,
        cos: number,
        carVx: number,
        carVz: number,
    ): number {
        const radius = this.radius * this.scale[i];
        if (this.py[i] - radius > y + 1.1 || this.py[i] + radius < y - 0.3) return 0;

        const dx = this.px[i] - x;
        const dz = this.pz[i] - z;
        if (dx * dx + dz * dz > (CAR_HALF_LENGTH + CAR_HALF_WIDTH + radius) ** 2) return 0;

        const localX = dx * cos - dz * sin;
        const localZ = dx * sin + dz * cos;
        const closestX = THREE.MathUtils.clamp(localX, -CAR_HALF_WIDTH, CAR_HALF_WIDTH);
        const closestZ = THREE.MathUtils.clamp(localZ, -CAR_HALF_LENGTH, CAR_HALF_LENGTH);
        let offsetX = localX - closestX;
        let offsetZ = localZ - closestZ;
        let distance = Math.hypot(offsetX, offsetZ);

        if (distance >= radius) return 0;

        if (distance < 1e-4) {
            // Centre inside the hull: shove it out through the nearest side.
            const toSide = CAR_HALF_WIDTH - Math.abs(localX);
            const toEnd = CAR_HALF_LENGTH - Math.abs(localZ);
            if (toSide < toEnd) {
                offsetX = Math.sign(localX) || 1;
                offsetZ = 0;
            } else {
                offsetX = 0;
                offsetZ = Math.sign(localZ) || 1;
            }
            distance = 0;
        } else {
            offsetX /= distance;
            offsetZ /= distance;
        }

        // Local normal back to world space.
        const normalX = offsetX * cos + offsetZ * sin;
        const normalZ = -offsetX * sin + offsetZ * cos;
        const penetration = radius - distance;

        this.wake(i);
        this.px[i] += normalX * penetration;
        this.pz[i] += normalZ * penetration;

        const relative = (carVx - this.vx[i]) * normalX + (carVz - this.vz[i]) * normalZ;
        if (relative <= 0) return 0;

        const lightness = 1 - this.mass * 0.7;
        const impulse = relative * (1 + RESTITUTION) * lightness;
        this.vx[i] += normalX * impulse + carVx * 0.12 * lightness;
        this.vz[i] += normalZ * impulse + carVz * 0.12 * lightness;
        this.vy[i] = Math.max(this.vy[i], Math.min(relative * 0.32 * lightness, 7) + Math.random() * 1.2 * lightness);

        const kick = Math.min(relative, 20) * lightness;
        this.spin[i] += (Math.random() - 0.5) * kick * 1.4;
        this.tiltSpeedX[i] += (Math.random() - 0.5) * kick * 1.1;
        this.tiltSpeedZ[i] += (Math.random() - 0.5) * kick * 1.1;

        return Math.min(relative, 25) * (0.0009 + this.mass * 0.004);
    }

    public update(deltaTime: number): void {
        if (this.awakeList.length === 0) return;

        const dt = Math.min(deltaTime, 1 / 30);
        const groundFriction = 3.2 + this.mass * 5;

        for (let k = this.awakeList.length - 1; k >= 0; k--) {
            const i = this.awakeList[k];

            this.vy[i] -= GRAVITY * dt;
            this.px[i] += this.vx[i] * dt;
            this.py[i] += this.vy[i] * dt;
            this.pz[i] += this.vz[i] * dt;
            this.yaw[i] += this.spin[i] * dt;
            this.tiltX[i] += this.tiltSpeedX[i] * dt;
            this.tiltZ[i] += this.tiltSpeedZ[i] * dt;

            const rest = this.heightAt(this.px[i], this.pz[i]) + this.restHeight * this.scale[i];
            const grounded = this.py[i] <= rest;

            if (grounded) {
                this.py[i] = rest;
                this.vy[i] = this.vy[i] < -2.5 ? -this.vy[i] * 0.28 : 0;

                const friction = Math.exp(-groundFriction * dt);
                this.vx[i] *= friction;
                this.vz[i] *= friction;
                this.spin[i] *= Math.exp(-5 * dt);

                // Tumbling items settle back flat once they are on the ground.
                const settle = 1 - Math.exp(-9 * dt);
                this.tiltX[i] = wrapToNearestFlat(this.tiltX[i]) * (1 - settle);
                this.tiltZ[i] = wrapToNearestFlat(this.tiltZ[i]) * (1 - settle);
                this.tiltSpeedX[i] *= 1 - settle;
                this.tiltSpeedZ[i] *= 1 - settle;
            }

            this.writeMatrix(i);

            const speedSq = this.vx[i] * this.vx[i] + this.vz[i] * this.vz[i] + this.vy[i] * this.vy[i];
            const flat = Math.abs(this.tiltX[i]) + Math.abs(this.tiltZ[i]) < 0.02;
            if (grounded && flat && speedSq < SLEEP_SPEED_SQ) {
                this.vx[i] = 0;
                this.vy[i] = 0;
                this.vz[i] = 0;
                this.spin[i] = 0;
                this.tiltX[i] = 0;
                this.tiltZ[i] = 0;
                this.awake[i] = 0;
                this.awakeList[k] = this.awakeList[this.awakeList.length - 1];
                this.awakeList.pop();
                this.insert(i);
            }
        }

        if (this.dirtyMax >= this.dirtyMin) {
            const attribute = this.mesh.instanceMatrix;
            attribute.clearUpdateRanges();
            attribute.addUpdateRange(this.dirtyMin * 16, (this.dirtyMax - this.dirtyMin + 1) * 16);
            attribute.needsUpdate = true;
            this.dirtyMin = Infinity;
            this.dirtyMax = -Infinity;
        }
    }

    private writeMatrix(i: number): void {
        this._position.set(this.px[i], this.py[i], this.pz[i]);
        this._euler.set(this.tiltX[i], this.yaw[i], this.tiltZ[i], "YXZ");
        this._quaternion.setFromEuler(this._euler);
        this._scale.setScalar(this.scale[i]);
        this._matrix.compose(this._position, this._quaternion, this._scale);
        this.mesh.setMatrixAt(i, this._matrix);

        if (i < this.dirtyMin) this.dirtyMin = i;
        if (i > this.dirtyMax) this.dirtyMax = i;
    }

    public dispose(): void {
        this.mesh.dispose();
        this.cells.clear();
        this.awakeList.length = 0;
    }
}

/** Items rest flat either way up, so a tilt settles toward the nearest multiple of π. */
function wrapToNearestFlat(angle: number): number {
    return angle - Math.round(angle / Math.PI) * Math.PI;
}
