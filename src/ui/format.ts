export function ordinalSuffix(position: number): string {
    const tens = position % 100;
    if (tens >= 11 && tens <= 13) return "TH";
    switch (position % 10) {
        case 1:
            return "ST";
        case 2:
            return "ND";
        case 3:
            return "RD";
        default:
            return "TH";
    }
}

export { formatTime } from "../game/race/RaceManager";
