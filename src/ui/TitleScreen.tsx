import type { TrackId } from "../game/tracks";
import { formatTime } from "./format";

export interface TrackCard {
    id: TrackId;
    name: string;
    location: string;
    description: string;
    laps: number;
    bestLap: number | null;
}

interface TitleScreenProps {
    tracks: readonly TrackCard[];
    selected: TrackId;
    rivals: readonly { name: string; color: string }[];
    onSelect(id: TrackId): void;
    onStart(): void;
}

const PATTERN: Record<TrackId, string> = {
    breakfast: "pattern-gingham",
    backyard: "pattern-lawn",
};

export function TitleScreen({ tracks, selected, rivals, onSelect, onStart }: TitleScreenProps) {
    return (
        <div className="pointer-events-none absolute inset-0 select-none font-body">
            <div className="pointer-events-auto absolute left-[clamp(16px,4vw,64px)] top-[clamp(16px,5vh,56px)] flex max-w-[min(34rem,calc(100vw-32px))] flex-col">
                <h1 className="logo-type animate-rise -rotate-3 text-[clamp(44px,7.2vw,92px)]">
                    MICRO
                    <br />
                    MACHINES
                </h1>
                <p className="animate-rise mt-4 w-fit -rotate-1 rounded-md bg-ink px-2 py-0.5 text-[clamp(13px,1.3vw,16px)] font-extrabold italic tracking-wide text-paper [animation-delay:80ms]">
                    Tiny cars. Giant tracks. Four go in, one takes the trophy.
                </p>

                <h2 className="animate-rise mt-[clamp(20px,4vh,40px)] text-[12px] font-extrabold tracking-[0.24em] text-paper [animation-delay:140ms] [text-shadow:0_2px_0_var(--color-ink)]">
                    PICK A TRACK
                </h2>
                <div className="mt-2 flex flex-col gap-3">
                    {tracks.map((track, index) => {
                        const active = track.id === selected;
                        return (
                            <button
                                key={track.id}
                                type="button"
                                onClick={() => (active ? onStart() : onSelect(track.id))}
                                className={`animate-rise sticker group flex cursor-pointer items-stretch overflow-hidden text-left transition-transform duration-300 ease-out-quint focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-toy-yellow ${active ? "-translate-y-1 -rotate-1 bg-toy-yellow" : "translate-x-3 rotate-1 opacity-90 hover:translate-x-1"}`}
                                style={{ animationDelay: `${200 + index * 70}ms` }}
                                aria-pressed={active}
                            >
                                <span className={`${PATTERN[track.id]} w-[clamp(52px,7vw,84px)] shrink-0 border-r-3 border-ink`} />
                                <span className="flex min-w-0 flex-1 flex-col px-4 py-3">
                                    <span className="font-display text-[clamp(20px,2.4vw,28px)] leading-none">{track.name}</span>
                                    <span className="mt-1 text-[13px] font-extrabold italic tracking-wide text-ink/70">{track.location}</span>
                                    <span className="mt-1.5 text-[14px] font-medium leading-snug text-ink/85">{track.description}</span>
                                    <span className="mt-2 flex gap-3 text-[12px] font-extrabold tabular-nums tracking-wide">
                                        <span>{track.laps} LAPS</span>
                                        <span className="text-ink/60">BEST {formatTime(track.bestLap)}</span>
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="animate-rise mt-[clamp(20px,4vh,36px)] flex flex-wrap items-center gap-4 [animation-delay:380ms]">
                    <button
                        type="button"
                        onClick={onStart}
                        className="sticker cursor-pointer bg-toy-red px-7 py-3 font-display text-[clamp(26px,3vw,36px)] text-paper transition-transform duration-200 ease-out-quint hover:-translate-y-0.5 hover:-rotate-2 active:translate-y-0.5 active:shadow-[2px_2px_0_var(--color-ink)] focus-visible:outline-4 focus-visible:outline-offset-4 focus-visible:outline-toy-yellow"
                    >
                        RACE!
                    </button>
                    <span className="text-[13px] font-bold text-paper [text-shadow:0_2px_0_var(--color-ink)]">
                        <span className="keycap">Enter</span> to race · <span className="keycap">↑</span> <span className="keycap">↓</span> to switch
                    </span>
                </div>
            </div>

            <div className="animate-rise absolute bottom-[clamp(16px,4vh,40px)] right-[clamp(16px,4vw,64px)] flex flex-col items-end gap-2 [animation-delay:460ms]">
                <span className="text-[12px] font-extrabold tracking-[0.24em] text-paper [text-shadow:0_2px_0_var(--color-ink)]">ON THE GRID</span>
                <div className="flex gap-2">
                    {rivals.map((rival, index) => (
                        <span
                            key={rival.name}
                            className="sticker sticker-sm flex items-center gap-1.5 px-2 py-1 text-[13px] font-extrabold italic"
                            style={{ transform: `rotate(${index % 2 === 0 ? -2 : 2}deg)` }}
                        >
                            <span className="h-3 w-3 rounded-full border-2 border-ink" style={{ background: rival.color }} />
                            {rival.name}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
}
