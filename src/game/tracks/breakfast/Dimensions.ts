/** 1 unit ≈ 1 cm: a 2 cm toy racer on a big farmhouse table. */
export const TABLE_HALF_X = 118;
export const TABLE_HALF_Z = 86;
/** Corner radius of the finished top, bevel included. */
export const TABLE_CORNER = 12;
export const TABLE_BEVEL = 0.9;
export const TABLE_THICKNESS = 5;
export const FLOOR_HEIGHT = -76;

/** True inside the rounded outline of the tabletop. */
export function isOnTable(x: number, z: number): boolean {
    const ax = Math.abs(x);
    const az = Math.abs(z);
    if (ax > TABLE_HALF_X || az > TABLE_HALF_Z) return false;

    const cornerX = ax - (TABLE_HALF_X - TABLE_CORNER);
    const cornerZ = az - (TABLE_HALF_Z - TABLE_CORNER);
    if (cornerX <= 0 || cornerZ <= 0) return true;
    return cornerX * cornerX + cornerZ * cornerZ <= TABLE_CORNER * TABLE_CORNER;
}
