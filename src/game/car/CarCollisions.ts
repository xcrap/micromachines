import type { CarController } from "./CarController";
import { HULL_CIRCLE_OFFSETS, HULL_CIRCLE_RADIUS } from "./CarController";

const RESTITUTION = 0.35;
/** Share of the contact torque applied, so a nudge on the rear quarter turns a car without spinning it out. */
const SPIN = 0.6;
const BROAD_PHASE_SQ = 3.2 * 3.2;
const MAX_HEIGHT_GAP = 1.1;

const velocityA = { x: 0, z: 0 };
const velocityB = { x: 0, z: 0 };

/**
 * Bumper-car contact between every pair of cars: overlap is split evenly and the closing
 * speed is exchanged along the contact normal, so side swipes nudge and T-bones spin.
 */
export function resolveCarCollisions(cars: readonly CarController[]): void {
    for (let i = 0; i < cars.length; i++) {
        const a = cars[i];
        if (a.isGhost()) continue;
        const pa = a.getPositionRef();
        const da = a.getDirectionRef();

        for (let j = i + 1; j < cars.length; j++) {
            const b = cars[j];
            if (b.isGhost()) continue;
            const pb = b.getPositionRef();

            if (Math.abs(pa.y - pb.y) > MAX_HEIGHT_GAP) continue;
            const cx = pb.x - pa.x;
            const cz = pb.z - pa.z;
            if (cx * cx + cz * cz > BROAD_PHASE_SQ) continue;

            const db = b.getDirectionRef();
            let deepest = 0;
            let normalX = 0;
            let normalZ = 0;
            let contactX = 0;
            let contactZ = 0;

            for (const offsetA of HULL_CIRCLE_OFFSETS) {
                const ax = pa.x + da.x * offsetA;
                const az = pa.z + da.z * offsetA;
                for (const offsetB of HULL_CIRCLE_OFFSETS) {
                    const bx = pb.x + db.x * offsetB;
                    const bz = pb.z + db.z * offsetB;
                    const dx = bx - ax;
                    const dz = bz - az;
                    const distance = Math.hypot(dx, dz);
                    const penetration = HULL_CIRCLE_RADIUS * 2 - distance;
                    if (penetration <= deepest) continue;

                    deepest = penetration;
                    if (distance > 1e-4) {
                        normalX = dx / distance;
                        normalZ = dz / distance;
                    } else {
                        normalX = -da.z;
                        normalZ = da.x;
                    }
                    contactX = (ax + bx) / 2;
                    contactZ = (az + bz) / 2;
                }
            }

            if (deepest <= 0) continue;

            const half = deepest / 2;
            a.nudge(-normalX * half, -normalZ * half);
            b.nudge(normalX * half, normalZ * half);

            a.getWorldVelocity(velocityA);
            b.getWorldVelocity(velocityB);
            const closing = (velocityB.x - velocityA.x) * normalX + (velocityB.z - velocityA.z) * normalZ;
            if (closing >= 0) continue;

            // Leaning on a car should be a smooth shove, so bounce only builds up for real hits.
            const restitution = RESTITUTION * Math.min(1, Math.max(0, (-closing - 1.5) / 6));
            const impulse = (-(1 + restitution) * closing) / 2;
            a.applyWorldImpulse(-normalX * impulse, -normalZ * impulse, contactX, contactZ, SPIN);
            b.applyWorldImpulse(normalX * impulse, normalZ * impulse, contactX, contactZ, SPIN);

            const severity = Math.min(1, -closing / 18);
            if (severity > 0.12) a.emitSparks(contactX, contactZ, normalX, normalZ, severity);
        }
    }
}
