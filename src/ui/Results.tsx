import type { RacerStanding } from "../game/GameEngine";
import { formatTime, ordinalSuffix } from "./format";

interface ResultsProps {
    standings: readonly RacerStanding[];
    playerPosition: number;
    trackName: string;
    newRecord: boolean;
    onRaceAgain(): void;
    onMenu(): void;
}

const PODIUM_COLORS = ["bg-toy-yellow", "bg-[#d9dde6]", "bg-[#e0a36a]"];

export function Results({ standings, playerPosition, trackName, newRecord, onRaceAgain, onMenu }: ResultsProps) {
    const winner = standings.find((racer) => racer.position === 1 && racer.finished);
    const leaderTime = winner?.finishTime ?? null;
    const headline = playerPosition === 1 ? "VICTORY!" : `${playerPosition}${ordinalSuffix(playerPosition)} PLACE`;

    return (
        <div className="pointer-events-auto absolute inset-0 flex items-center bg-ink/40 font-body">
            <div className="ml-[clamp(16px,8vw,120px)] mr-4 flex w-[min(30rem,calc(100vw-32px))] flex-col">
                <span className="animate-rise text-[12px] font-extrabold tracking-[0.24em] text-paper [text-shadow:0_2px_0_var(--color-ink)]">
                    {trackName.toUpperCase()} · RESULTS
                </span>
                <h2 className={`animate-slap outlined-type mt-1 text-[clamp(52px,7.5vw,96px)] leading-none ${playerPosition === 1 ? "text-toy-yellow" : "text-paper"}`}>
                    {headline}
                </h2>
                {newRecord && (
                    <span className="animate-rise sticker sticker-sm mt-3 w-fit rotate-2 bg-toy-blue px-2 py-0.5 font-display text-[14px] text-paper [animation-delay:200ms]">
                        NEW LAP RECORD
                    </span>
                )}

                <ol className="mt-5 flex flex-col gap-2">
                    {standings.map((racer, index) => {
                        const gap = racer.finished && leaderTime !== null && racer.finishTime !== null && racer.position > 1
                            ? `+${(racer.finishTime - leaderTime).toFixed(3)}`
                            : null;
                        return (
                            <li
                                key={racer.index}
                                className={`animate-rise sticker flex items-center gap-3 px-3 py-2 ${racer.isPlayer ? "translate-x-3 bg-toy-red text-paper" : ""}`}
                                style={{ animationDelay: `${160 + index * 70}ms` }}
                            >
                                <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border-3 border-ink font-display text-[18px] text-ink ${PODIUM_COLORS[racer.position - 1] ?? "bg-paper-dim"}`}>
                                    {racer.position}
                                </span>
                                <span className="h-4 w-4 shrink-0 rounded-full border-2 border-ink" style={{ background: racer.color }} />
                                <span className="font-display text-[18px]">{racer.name}</span>
                                <span className="ml-auto flex flex-col items-end text-right tabular-nums leading-tight">
                                    {racer.finished ? (
                                        <>
                                            <span className="text-[15px] font-extrabold">{formatTime(racer.finishTime)}</span>
                                            <span className="text-[11px] font-bold opacity-70">{gap ?? `BEST ${formatTime(racer.bestLap)}`}</span>
                                        </>
                                    ) : (
                                        <span className="text-[13px] font-extrabold italic opacity-80">still racing…</span>
                                    )}
                                </span>
                            </li>
                        );
                    })}
                </ol>

                <div className="animate-rise mt-6 flex flex-wrap items-center gap-3 [animation-delay:480ms]">
                    <button
                        type="button"
                        onClick={onRaceAgain}
                        className="sticker cursor-pointer bg-toy-yellow px-5 py-2 font-display text-[22px] transition-transform duration-200 ease-out-quint hover:-translate-y-0.5 hover:-rotate-1"
                    >
                        RACE AGAIN
                    </button>
                    <button
                        type="button"
                        onClick={onMenu}
                        className="sticker cursor-pointer px-4 py-2 font-display text-[18px] transition-transform duration-200 ease-out-quint hover:-translate-y-0.5 hover:rotate-1"
                    >
                        PICK TRACK
                    </button>
                    <span className="text-[12px] font-bold text-paper [text-shadow:0_2px_0_var(--color-ink)]">
                        <span className="keycap">Enter</span> · <span className="keycap">Esc</span>
                    </span>
                </div>
            </div>
        </div>
    );
}
