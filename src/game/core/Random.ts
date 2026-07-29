/** Deterministic PRNG so the world is identical on every load and the track is learnable. */
export class Rng {
    private state: number;

    constructor(seed: number) {
        this.state = seed >>> 0 || 1;
    }

    public next(): number {
        this.state = (this.state + 0x6d2b79f5) >>> 0;
        let t = this.state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    }

    public range(min: number, max: number): number {
        return min + this.next() * (max - min);
    }

    public int(maxExclusive: number): number {
        return Math.min(maxExclusive - 1, Math.floor(this.next() * maxExclusive));
    }

    public pick<T>(items: readonly T[]): T {
        return items[this.int(items.length)];
    }
}
