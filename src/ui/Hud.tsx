import { useImperativeHandle, useRef, useState, type Ref } from "react";
import type { HudState, RacerStanding, TrackOutline } from "../game/GameEngine";
import { Minimap, type MinimapHandle } from "./Minimap";
import { formatTime, ordinalSuffix } from "./format";

export interface HudHandle {
    update(state: HudState): void;
}

export interface Announcement {
    id: number;
    text: string;
    detail?: string;
    tone: "red" | "yellow" | "blue" | "green";
}

interface HudProps {
    ref?: Ref<HudHandle>;
    standings: readonly RacerStanding[];
    racers: readonly { color: string; isPlayer: boolean }[];
    outline: TrackOutline | null;
    announcement: Announcement | null;
}

const REV_SEGMENTS = 14;
const BOOST_SEGMENTS = 5;
const MAX_DISPLAY_KPH = 150;
const BOOST_READY = 0.18;

const TONE_CLASSES: Record<Announcement["tone"], string> = {
    red: "bg-toy-red text-paper",
    yellow: "bg-toy-yellow text-ink",
    blue: "bg-toy-blue text-paper",
    green: "bg-toy-green text-paper",
};

export function Hud({ ref, standings, racers, outline, announcement }: HudProps) {
    const positionRef = useRef<HTMLSpanElement>(null);
    const suffixRef = useRef<HTMLSpanElement>(null);
    const lapRef = useRef<HTMLSpanElement>(null);
    const lapTimeRef = useRef<HTMLSpanElement>(null);
    const bestLapRef = useRef<HTMLSpanElement>(null);
    const speedRef = useRef<HTMLSpanElement>(null);
    const revRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const boostRefs = useRef<(HTMLSpanElement | null)[]>([]);
    const boostReadyRef = useRef<HTMLSpanElement>(null);
    const wrongWayRef = useRef<HTMLDivElement>(null);
    const hintRef = useRef<HTMLDivElement>(null);
    const minimapRef = useRef<MinimapHandle>(null);

    const cache = useRef({ position: "", lap: "", lapTime: "", bestLap: "", speed: "", rev: -1, boost: -1, ready: false, wrongWay: false, hint: true });
    const [countdown, setCountdown] = useState("");
    const countdownCache = useRef("");

    useImperativeHandle(ref, () => ({
        update(state: HudState) {
            const c = cache.current;

            const position = String(state.position);
            if (position !== c.position) {
                c.position = position;
                if (positionRef.current) positionRef.current.textContent = position;
                if (suffixRef.current) suffixRef.current.textContent = ordinalSuffix(state.position);
            }

            const lap = `${state.lap}/${state.totalLaps}`;
            if (lap !== c.lap) {
                c.lap = lap;
                if (lapRef.current) lapRef.current.textContent = lap;
            }

            const lapTime = formatTime(state.raceState === "countdown" ? 0 : state.lapTime);
            if (lapTime !== c.lapTime) {
                c.lapTime = lapTime;
                if (lapTimeRef.current) lapTimeRef.current.textContent = lapTime;
            }

            const bestLap = formatTime(state.bestLap ?? state.recordLap);
            if (bestLap !== c.bestLap) {
                c.bestLap = bestLap;
                if (bestLapRef.current) bestLapRef.current.textContent = bestLap;
            }

            const speed = String(Math.round(state.speedKph));
            if (speed !== c.speed) {
                c.speed = speed;
                if (speedRef.current) speedRef.current.textContent = speed;
            }

            const rev = Math.round(Math.min(1, state.speedKph / MAX_DISPLAY_KPH) * REV_SEGMENTS);
            if (rev !== c.rev) {
                c.rev = rev;
                revRefs.current.forEach((segment, index) => {
                    if (segment) segment.dataset.on = index < rev ? "1" : "0";
                });
            }

            const boost = Math.round(state.boost * BOOST_SEGMENTS * 4);
            if (boost !== c.boost) {
                c.boost = boost;
                boostRefs.current.forEach((segment, index) => {
                    if (!segment) return;
                    const fill = Math.min(1, Math.max(0, state.boost * BOOST_SEGMENTS - index));
                    segment.style.transform = `scaleX(${fill})`;
                });
            }

            const ready = state.boost >= BOOST_READY && !state.boosting && state.raceState === "racing";
            if (ready !== c.ready) {
                c.ready = ready;
                if (boostReadyRef.current) boostReadyRef.current.style.opacity = ready ? "1" : "0";
            }

            if (state.wrongWay !== c.wrongWay) {
                c.wrongWay = state.wrongWay;
                if (wrongWayRef.current) wrongWayRef.current.style.opacity = state.wrongWay ? "1" : "0";
            }

            const hint = state.raceState === "countdown" || state.totalTime < 7;
            if (hint !== c.hint) {
                c.hint = hint;
                if (hintRef.current) hintRef.current.style.opacity = hint ? "1" : "0";
            }

            const label = state.raceState === "countdown"
                ? (state.countdown > 3 ? "" : state.countdown > 0 ? String(Math.ceil(state.countdown)) : "GO!")
                : (state.totalTime < 0.8 ? "GO!" : "");
            if (label !== countdownCache.current) {
                countdownCache.current = label;
                setCountdown(label);
            }

            minimapRef.current?.update(state.carPositions);
        },
    }), []);

    return (
        <div className="pointer-events-none absolute inset-0 select-none font-body">
            {/* Position + running order */}
            <div className="absolute left-[clamp(12px,2.2vw,28px)] top-[clamp(12px,2.2vw,28px)] flex flex-col items-start gap-3">
                <div className="sticker -rotate-3 bg-toy-yellow px-4 pb-1 pt-2">
                    <div className="flex items-start leading-none">
                        <span ref={positionRef} className="font-display text-[clamp(48px,6vw,76px)] leading-[0.9]">4</span>
                        <span className="ml-1 mt-1 flex flex-col">
                            <span ref={suffixRef} className="font-display text-[clamp(18px,2.1vw,26px)] leading-none">TH</span>
                            <span className="mt-1 text-[13px] font-extrabold leading-none text-ink/70">/ {racers.length}</span>
                        </span>
                    </div>
                </div>

                <ol className="flex flex-col gap-1">
                    {standings.map((racer) => (
                        <li
                            key={racer.index}
                            className={`sticker sticker-sm flex w-[9.5rem] items-center gap-2 px-2 py-[3px] text-[13px] font-extrabold italic transition-transform duration-300 ease-(--ease-out-quint) ${racer.isPlayer ? "translate-x-2 bg-toy-red text-paper" : ""}`}
                        >
                            <span className="font-display not-italic w-4 text-center">{racer.position}</span>
                            <span className="h-3 w-3 shrink-0 rounded-full border-2 border-ink" style={{ background: racer.color }} />
                            <span className="truncate tracking-wide">{racer.name}</span>
                            {racer.finished && <span className="pattern-checker ml-auto h-3 w-4 rounded-[3px] border-2 border-ink" />}
                        </li>
                    ))}
                </ol>
            </div>

            {/* Lap, timer and map */}
            <div className="absolute right-[clamp(12px,2.2vw,28px)] top-[clamp(12px,2.2vw,28px)] flex flex-col items-end gap-3">
                <div className="sticker rotate-2 px-4 py-2 text-right">
                    <div className="flex items-baseline justify-end gap-2">
                        <span className="text-[12px] font-extrabold tracking-[0.18em] text-ink/60">LAP</span>
                        <span ref={lapRef} className="font-display text-[clamp(26px,3vw,36px)] leading-none">1/3</span>
                    </div>
                    <span ref={lapTimeRef} className="block text-[clamp(20px,2.2vw,26px)] font-extrabold tabular-nums leading-tight">0:00.000</span>
                    <div className="mt-0.5 flex items-center justify-end gap-2 text-[12px] font-bold tabular-nums text-ink/60">
                        <span className="tracking-[0.14em]">BEST</span>
                        <span ref={bestLapRef}>--:--.---</span>
                    </div>
                </div>

                <div className="sticker h-[clamp(120px,15vw,176px)] w-[clamp(120px,15vw,176px)] -rotate-1 bg-paper-dim p-2">
                    <Minimap ref={minimapRef} outline={outline} racers={racers} />
                </div>
            </div>

            {/* Speed + boost */}
            <div className="absolute bottom-[clamp(12px,2.2vw,28px)] right-[clamp(12px,2.2vw,28px)] flex flex-col items-end gap-2">
                <span
                    ref={boostReadyRef}
                    className="sticker sticker-sm animate-ready bg-toy-blue px-2 py-0.5 font-display text-[13px] text-paper opacity-0 transition-opacity duration-200"
                >
                    SHIFT TO BOOST
                </span>
                <div className="sticker -rotate-2 px-4 pb-3 pt-2">
                    <div className="flex items-end justify-between gap-4">
                        <span ref={speedRef} className="font-display text-[clamp(40px,4.6vw,58px)] leading-none tabular-nums">0</span>
                        <span className="mb-1 text-[12px] font-extrabold tracking-[0.18em] text-ink/60">KM/H</span>
                    </div>
                    <div className="mt-2 flex gap-[3px]">
                        {Array.from({ length: REV_SEGMENTS }, (_, index) => (
                            <span
                                key={index}
                                ref={(element) => { revRefs.current[index] = element; }}
                                data-on="0"
                                className={`h-3 w-[9px] -skew-x-12 rounded-[2px] border-2 border-ink transition-colors duration-100 data-[on=0]:bg-paper-dim ${index >= REV_SEGMENTS - 3 ? "data-[on=1]:bg-toy-red" : index >= REV_SEGMENTS - 7 ? "data-[on=1]:bg-toy-yellow" : "data-[on=1]:bg-toy-green"}`}
                            />
                        ))}
                    </div>
                    <div className="mt-2 flex items-center gap-2">
                        <span className="text-[11px] font-extrabold tracking-[0.18em] text-toy-blue">BOOST</span>
                        <div className="flex flex-1 gap-[3px]">
                            {Array.from({ length: BOOST_SEGMENTS }, (_, index) => (
                                <span key={index} className="relative h-3 flex-1 -skew-x-12 overflow-hidden rounded-[2px] border-2 border-ink bg-paper-dim">
                                    <span
                                        ref={(element) => { boostRefs.current[index] = element; }}
                                        className="absolute inset-0 origin-left bg-toy-blue"
                                        style={{ transform: "scaleX(0)" }}
                                    />
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            </div>

            {/* Controls reminder, fades once the race is under way */}
            <div
                ref={hintRef}
                className="sticker sticker-sm absolute bottom-[clamp(12px,2.2vw,28px)] left-[clamp(12px,2.2vw,28px)] grid grid-cols-[auto_auto] items-center gap-x-3 gap-y-1 px-3 py-2 text-[12px] font-bold text-ink/80 transition-opacity duration-700"
            >
                <span><span className="keycap">↑</span> <span className="keycap">↓</span></span><span>Drive</span>
                <span><span className="keycap">←</span> <span className="keycap">→</span></span><span>Steer</span>
                <span><span className="keycap">Space</span></span><span>Drift — fills boost</span>
                <span><span className="keycap">Shift</span></span><span>Boost</span>
                <span><span className="keycap">R</span> <span className="keycap">C</span></span><span>Reset · Camera</span>
                <span><span className="keycap">Esc</span></span><span>Pause</span>
            </div>

            {/* Countdown */}
            {countdown && (
                <div className="absolute inset-x-0 top-[34%] flex justify-center">
                    <div
                        key={countdown}
                        className={`animate-slap outlined-type text-[clamp(84px,13vw,168px)] leading-none ${countdown === "GO!" ? "text-toy-green" : countdown === "1" ? "text-toy-yellow" : "text-paper"}`}
                    >
                        {countdown}
                    </div>
                </div>
            )}

            {/* Wrong way */}
            <div
                ref={wrongWayRef}
                className="absolute inset-x-0 top-[22%] flex justify-center opacity-0 transition-opacity duration-200"
            >
                <div className="sticker -rotate-2 bg-toy-red px-5 py-2 font-display text-[clamp(22px,3vw,34px)] text-paper">
                    WRONG WAY!
                </div>
            </div>

            {/* Lap / event announcements */}
            {announcement && (
                <div className="absolute inset-x-0 top-[13%] flex justify-center">
                    <div key={announcement.id} className={`animate-slap sticker px-5 py-2 text-center ${TONE_CLASSES[announcement.tone]}`}>
                        <div className="font-display text-[clamp(22px,3vw,34px)] leading-tight">{announcement.text}</div>
                        {announcement.detail && (
                            <div className="text-[15px] font-extrabold tabular-nums tracking-wide opacity-90">{announcement.detail}</div>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}
