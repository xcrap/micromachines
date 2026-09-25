import type { AIPersonality } from "../car/AIDriver";
import type { CarLivery } from "../car/CarModel";

export interface RacerProfile {
    name: string;
    /** CSS colour used for the racer in the HUD. */
    color: string;
    livery: CarLivery;
    /** How the car drives when it is not the player's (and in attract mode). */
    personality: AIPersonality;
    /** Grid slot, 0 = pole. The player starts at the back and has to fight through. */
    gridSlot: number;
}

export const PLAYER_INDEX = 0;

export const ROSTER: readonly RacerProfile[] = [
    {
        name: "YOU",
        color: "#ef3b33",
        livery: { style: "coupe", body: 0xdc2f26, trim: 0x8f1a15, accent: 0xffc531, stripe: 0xf4f2ea, number: "7" },
        personality: { pace: 0.93, lane: 0, aggression: 0.6, flair: 0.5 },
        gridSlot: 3,
    },
    {
        name: "DASH",
        color: "#3b82f6",
        livery: { style: "hatch", body: 0x1f5fd6, trim: 0x173f8a, accent: 0xf4f2ea, stripe: 0xffc531, number: "3" },
        personality: { pace: 0.955, lane: -0.9, aggression: 0.85, flair: 0.7 },
        gridSlot: 0,
    },
    {
        name: "VIOLET",
        color: "#a855f7",
        livery: { style: "coupe", body: 0x7c3aed, trim: 0x4c1d95, accent: 0x2de2e6, stripe: 0xf4f2ea, number: "9" },
        personality: { pace: 0.935, lane: 1.0, aggression: 0.6, flair: 0.45 },
        gridSlot: 1,
    },
    {
        name: "BUCK",
        color: "#facc15",
        livery: { style: "pickup", body: 0xf5c21b, trim: 0xb8860b, accent: 0x1f2937, stripe: 0x1f2937, number: "5" },
        personality: { pace: 0.905, lane: 0.3, aggression: 0.4, flair: 0.2 },
        gridSlot: 2,
    },
];
