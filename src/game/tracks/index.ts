import { backyardTheme } from "./backyard/BackyardTheme";
import { breakfastTheme } from "./breakfast/BreakfastTheme";
import type { TrackId, TrackTheme } from "./types";

export const TRACKS: Record<TrackId, TrackTheme> = {
    breakfast: breakfastTheme,
    backyard: backyardTheme,
};

export const TRACK_ORDER: readonly TrackId[] = ["breakfast", "backyard"];

export type { TrackId, TrackTheme } from "./types";
