function fract(value: number): number {
    return value - Math.floor(value);
}

export function hash2D(x: number, y: number): number {
    return fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453123);
}

export function valueNoise2D(x: number, y: number): number {
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const fx = x - ix;
    const fy = y - iy;
    const ux = fx * fx * (3 - 2 * fx);
    const uy = fy * fy * (3 - 2 * fy);

    const a = hash2D(ix, iy);
    const b = hash2D(ix + 1, iy);
    const c = hash2D(ix, iy + 1);
    const d = hash2D(ix + 1, iy + 1);

    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}

export function fbm2D(x: number, y: number, octaves: number): number {
    let value = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let normalization = 0;

    for (let i = 0; i < octaves; i++) {
        value += amplitude * valueNoise2D(x * frequency, y * frequency);
        normalization += amplitude;
        amplitude *= 0.5;
        frequency *= 2.03;
    }

    return value / normalization;
}

/** Same value-noise basis as the TS helpers above so CPU height and GPU shading agree. */
export const NOISE_GLSL = /* glsl */ `
float mm_hash(vec2 p) {
    return fract(sin(p.x * 127.1 + p.y * 311.7) * 43758.5453123);
}

float mm_hash2(vec2 p) {
    return fract(sin(dot(p, vec2(269.5, 183.3))) * 43758.5453123);
}

float mm_noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    float a = mm_hash(i);
    float b = mm_hash(i + vec2(1.0, 0.0));
    float c = mm_hash(i + vec2(0.0, 1.0));
    float d = mm_hash(i + vec2(1.0, 1.0));
    return a + (b - a) * u.x + (c - a) * u.y + (a - b - c + d) * u.x * u.y;
}

float mm_fbm(vec2 p, int octaves) {
    float value = 0.0;
    float amplitude = 0.5;
    float norm = 0.0;
    for (int i = 0; i < 6; i++) {
        if (i >= octaves) break;
        value += amplitude * mm_noise(p);
        norm += amplitude;
        amplitude *= 0.5;
        p *= 2.03;
    }
    return value / norm;
}

float mm_voronoi(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float minDist = 1.0;
    for (int y = -1; y <= 1; y++) {
        for (int x = -1; x <= 1; x++) {
            vec2 neighbor = vec2(float(x), float(y));
            vec2 cell = vec2(mm_hash(i + neighbor), mm_hash2(i + neighbor));
            vec2 diff = neighbor + cell - f;
            minDist = min(minDist, dot(diff, diff));
        }
    }
    return sqrt(minDist);
}
`;
