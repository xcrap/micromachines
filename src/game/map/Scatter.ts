export interface Obstacle {
    x: number;
    z: number;
    radius: number;
    /** Top of the obstacle relative to the ground — the car clears it when airborne above this. */
    height: number;
    /** 0 = brushed aside, 1 = immovable. Drives how hard the impact feels. */
    solidity: number;
}

/** Uniform-grid occupancy test so scattered props keep their distance without an O(n²) sweep. */
export class PlacementGrid {
    private readonly cells = new Map<number, { x: number; z: number; radius: number }[]>();

    constructor(private readonly cellSize: number) {}

    private key(cx: number, cz: number): number {
        return (cx + 4096) * 8192 + (cz + 4096);
    }

    public canPlace(x: number, z: number, radius: number): boolean {
        const reach = Math.ceil((radius + this.cellSize) / this.cellSize);
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);

        for (let dz = -reach; dz <= reach; dz++) {
            for (let dx = -reach; dx <= reach; dx++) {
                const bucket = this.cells.get(this.key(cx + dx, cz + dz));
                if (!bucket) continue;

                for (const item of bucket) {
                    const distX = item.x - x;
                    const distZ = item.z - z;
                    const minDist = item.radius + radius;
                    if (distX * distX + distZ * distZ < minDist * minDist) return false;
                }
            }
        }

        return true;
    }

    public place(x: number, z: number, radius: number): void {
        const cx = Math.floor(x / this.cellSize);
        const cz = Math.floor(z / this.cellSize);
        const key = this.key(cx, cz);
        const bucket = this.cells.get(key);

        if (bucket) {
            bucket.push({ x, z, radius });
        } else {
            this.cells.set(key, [{ x, z, radius }]);
        }
    }

    public clear(): void {
        this.cells.clear();
    }
}
