import { useCallback, useEffect, useRef, useState } from "react";
import { GameEngine, type HudState } from "./game/GameEngine";
import { formatTime } from "./game/race/RaceManager";
import { Car } from "./icons/Car";

const GAUGE_RADIUS = 54;
const GAUGE_CIRCUMFERENCE = 2 * Math.PI * GAUGE_RADIUS;
const GAUGE_ARC = GAUGE_CIRCUMFERENCE * 0.75;
const MAX_DISPLAY_KPH = 160;

interface FinishSummary {
    totalTime: number;
    bestLap: number | null;
}

function App() {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<GameEngine | null>(null);

    const speedRef = useRef<HTMLSpanElement>(null);
    const gaugeRef = useRef<SVGCircleElement>(null);
    const boostRef = useRef<HTMLDivElement>(null);
    const boostLabelRef = useRef<HTMLDivElement>(null);
    const lapRef = useRef<HTMLSpanElement>(null);
    const lapTimeRef = useRef<HTMLSpanElement>(null);
    const lastLapRef = useRef<HTMLSpanElement>(null);
    const bestLapRef = useRef<HTMLSpanElement>(null);
    const fpsRef = useRef<HTMLSpanElement>(null);
    const surfaceRef = useRef<HTMLSpanElement>(null);
    const wrongWayRef = useRef<HTMLDivElement>(null);
    const countdownRef = useRef<HTMLDivElement>(null);

    const previous = useRef({ speed: "", lap: "", lapTime: "", lastLap: "", bestLap: "", fps: "", countdown: "", surface: "" });
    const latestBestLap = useRef<number | null>(null);

    const [finish, setFinish] = useState<FinishSummary | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const toastTimer = useRef<number | null>(null);

    const showToast = useCallback((message: string) => {
        setToast(message);
        if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
        toastTimer.current = window.setTimeout(() => setToast(null), 2200);
    }, []);

    const applyHud = useCallback((state: HudState) => {
        const cache = previous.current;

        const speed = Math.round(state.speedKph).toString();
        if (speed !== cache.speed) {
            cache.speed = speed;
            if (speedRef.current) speedRef.current.textContent = speed;
        }

        if (gaugeRef.current) {
            const fraction = Math.min(1, state.speedKph / MAX_DISPLAY_KPH);
            gaugeRef.current.style.strokeDashoffset = `${GAUGE_ARC * (1 - fraction)}`;
            gaugeRef.current.style.stroke = state.airborne
                ? "#a78bfa"
                : state.onTrack
                    ? "#facc15"
                    : "#fb923c";
        }

        if (boostRef.current) {
            boostRef.current.style.width = `${Math.round(state.boost * 100)}%`;
        }
        if (boostLabelRef.current) {
            const ready = state.boost >= 0.18;
            boostLabelRef.current.style.color = ready ? "#22d3ee" : "rgba(255,255,255,0.4)";
            boostLabelRef.current.style.textShadow = ready ? "0 0 10px rgba(34,211,238,0.75)" : "none";
        }

        const lap = `${Math.min(state.lap, state.totalLaps)}/${state.totalLaps}`;
        if (lap !== cache.lap) {
            cache.lap = lap;
            if (lapRef.current) lapRef.current.textContent = lap;
        }

        const lapTime = formatTime(state.lapTime);
        if (lapTime !== cache.lapTime) {
            cache.lapTime = lapTime;
            if (lapTimeRef.current) lapTimeRef.current.textContent = lapTime;
        }

        const lastLap = formatTime(state.lastLap);
        if (lastLap !== cache.lastLap) {
            cache.lastLap = lastLap;
            if (lastLapRef.current) lastLapRef.current.textContent = lastLap;
        }

        latestBestLap.current = state.bestLap;
        const bestLap = formatTime(state.bestLap);
        if (bestLap !== cache.bestLap) {
            cache.bestLap = bestLap;
            if (bestLapRef.current) bestLapRef.current.textContent = bestLap;
        }

        const fps = `${Math.round(state.fps)} fps`;
        if (fps !== cache.fps) {
            cache.fps = fps;
            if (fpsRef.current) fpsRef.current.textContent = fps;
        }

        const surface = state.airborne ? "AIR" : state.onTrack ? "TRACK" : "OFF-ROAD";
        if (surface !== cache.surface) {
            cache.surface = surface;
            if (surfaceRef.current) {
                surfaceRef.current.textContent = surface;
                surfaceRef.current.style.color = state.airborne
                    ? "#c4b5fd"
                    : state.onTrack
                        ? "rgba(255,255,255,0.45)"
                        : "#fb923c";
            }
        }

        if (wrongWayRef.current) {
            wrongWayRef.current.style.opacity = state.wrongWay ? "1" : "0";
        }

        const countdown = state.raceState === "countdown"
            ? (state.countdown > 0 ? Math.ceil(state.countdown).toString() : "GO!")
            : "";
        if (countdown !== cache.countdown) {
            cache.countdown = countdown;
            if (countdownRef.current) {
                countdownRef.current.textContent = countdown;
                countdownRef.current.style.opacity = countdown ? "1" : "0";
                countdownRef.current.style.transform = `scale(${countdown === "GO!" ? 1.25 : 1})`;
                countdownRef.current.style.color = countdown === "GO!" ? "#4ade80" : "#ffffff";
            }
        }
    }, []);

    useEffect(() => {
        if (!containerRef.current) return;

        const engine = new GameEngine(containerRef.current);
        engineRef.current = engine;

        engine.setHudListener(applyHud);
        engine.setHudEvents({
            onLapCompleted(lap, lapTime, isBest) {
                showToast(isBest ? `NEW BEST LAP  ${formatTime(lapTime)}` : `LAP ${lap - 1}  ${formatTime(lapTime)}`);
            },
            onRaceFinished(totalTime) {
                setFinish({ totalTime, bestLap: latestBestLap.current });
            },
        });

        engine.start();

        return () => {
            if (toastTimer.current !== null) window.clearTimeout(toastTimer.current);
            engine.dispose();
            engineRef.current = null;
        };
    }, [applyHud, showToast]);

    const restart = useCallback(() => {
        setFinish(null);
        setToast(null);
        engineRef.current?.restart();
    }, []);

    useEffect(() => {
        if (!finish) return;

        const onKey = (event: KeyboardEvent) => {
            if (event.key === "Enter") restart();
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [finish, restart]);

    return (
        <div className="relative w-full h-screen overflow-hidden bg-[#0b1016]">
            <div ref={containerRef} className="w-full h-full" />

            <div className="pointer-events-none absolute inset-0 select-none">
                {/* Title + lap board */}
                <div className="absolute top-4 left-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-black/55 px-3 py-2 backdrop-blur-md">
                        <Car className="h-5 w-5 text-amber-300" />
                        <h1 className="text-sm font-semibold tracking-[0.18em] text-white/90">MICRO MACHINES</h1>
                    </div>

                    <div className="rounded-lg border border-white/10 bg-black/55 px-3 py-2.5 backdrop-blur-md">
                        <div className="flex items-baseline gap-2">
                            <span className="text-[10px] font-medium tracking-[0.2em] text-white/40">LAP</span>
                            <span ref={lapRef} className="text-xl font-bold tabular-nums text-white">1/3</span>
                        </div>
                        <div className="mt-1.5 flex items-baseline gap-2">
                            <span className="text-[10px] font-medium tracking-[0.2em] text-white/40">TIME</span>
                            <span ref={lapTimeRef} className="text-lg font-semibold tabular-nums text-amber-300">0:00.000</span>
                        </div>
                        <div className="mt-1 flex flex-col gap-0.5 text-[11px] tabular-nums text-white/50">
                            <div className="flex justify-between gap-4">
                                <span>Last</span>
                                <span ref={lastLapRef}>--:--.---</span>
                            </div>
                            <div className="flex justify-between gap-4">
                                <span>Best</span>
                                <span ref={bestLapRef} className="text-emerald-300/80">--:--.---</span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Controls */}
                <div className="absolute bottom-4 left-4 rounded-lg border border-white/10 bg-black/45 px-3 py-2.5 text-[11px] backdrop-blur-md">
                    <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1 text-white/70">
                        <span className="text-white/40">Drive</span><span className="font-mono">↑ ↓ / Q A</span>
                        <span className="text-white/40">Steer</span><span className="font-mono">← → / O P</span>
                        <span className="text-white/40">Drift</span><span className="font-mono">Space</span>
                        <span className="text-white/40">Boost</span><span className="font-mono text-cyan-300/80">Shift</span>
                        <span className="text-white/40">Respawn</span><span className="font-mono">R</span>
                        <span className="text-white/40">Camera</span><span className="font-mono">C</span>
                    </div>
                    <div className="mt-2 flex items-center justify-between gap-4 border-t border-white/10 pt-1.5 text-[10px] text-white/35">
                        <span ref={surfaceRef}>TRACK</span>
                        <span ref={fpsRef}>60 fps</span>
                    </div>
                </div>

                {/* Speed + boost */}
                <div className="absolute right-4 bottom-4 flex flex-col items-end gap-2">
                    <div className="relative h-32 w-32">
                        <svg viewBox="0 0 128 128" className="h-full w-full -rotate-[0deg]">
                            <circle
                                cx="64"
                                cy="64"
                                r={GAUGE_RADIUS}
                                fill="rgba(0,0,0,0.5)"
                                stroke="rgba(255,255,255,0.12)"
                                strokeWidth="7"
                                strokeLinecap="round"
                                strokeDasharray={`${GAUGE_ARC} ${GAUGE_CIRCUMFERENCE}`}
                                transform="rotate(135 64 64)"
                            />
                            <circle
                                ref={gaugeRef}
                                cx="64"
                                cy="64"
                                r={GAUGE_RADIUS}
                                fill="none"
                                stroke="#facc15"
                                strokeWidth="7"
                                strokeLinecap="round"
                                strokeDasharray={`${GAUGE_ARC} ${GAUGE_CIRCUMFERENCE}`}
                                strokeDashoffset={GAUGE_ARC}
                                transform="rotate(135 64 64)"
                                style={{ transition: "stroke 200ms linear" }}
                            />
                        </svg>
                        <div className="absolute inset-0 flex flex-col items-center justify-center">
                            <span ref={speedRef} className="text-3xl font-bold leading-none tabular-nums text-white">0</span>
                            <span className="mt-0.5 text-[9px] font-medium tracking-[0.22em] text-white/40">KM/H</span>
                        </div>
                    </div>

                    <div className="w-32 rounded-md border border-white/10 bg-black/55 px-2 py-1.5 backdrop-blur-md">
                        <div ref={boostLabelRef} className="mb-1 text-[9px] font-semibold tracking-[0.22em] text-white/40">
                            BOOST
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                            <div
                                ref={boostRef}
                                className="h-full w-0 rounded-full bg-gradient-to-r from-cyan-400 to-sky-300"
                                style={{ transition: "width 90ms linear" }}
                            />
                        </div>
                    </div>
                </div>

                {/* Countdown */}
                <div
                    ref={countdownRef}
                    className="absolute inset-x-0 top-[44%] text-center text-7xl font-black tracking-tight text-white opacity-0 drop-shadow-[0_4px_24px_rgba(0,0,0,0.75)]"
                    style={{ transition: "opacity 160ms ease-out, transform 160ms ease-out" }}
                />

                {/* Wrong way */}
                <div
                    ref={wrongWayRef}
                    className="absolute inset-x-0 top-[16%] text-center text-2xl font-bold tracking-[0.2em] text-red-400 opacity-0 drop-shadow-[0_2px_12px_rgba(0,0,0,0.8)]"
                    style={{ transition: "opacity 180ms ease-out" }}
                >
                    WRONG WAY
                </div>

                {/* Lap toast */}
                {toast && (
                    <div className="absolute inset-x-0 top-[10%] flex justify-center">
                        <div className="rounded-full border border-amber-300/30 bg-black/70 px-5 py-2 text-sm font-semibold tracking-[0.14em] text-amber-300 backdrop-blur-md">
                            {toast}
                        </div>
                    </div>
                )}

                {/* Race finished */}
                {finish && (
                    <div className="pointer-events-auto absolute inset-0 flex items-center justify-center bg-black/55 backdrop-blur-sm">
                        <div className="w-72 rounded-xl border border-white/15 bg-[#10151c]/95 p-6 text-center shadow-2xl">
                            <div className="text-[10px] font-semibold tracking-[0.28em] text-amber-300">RACE COMPLETE</div>
                            <div className="mt-3 text-3xl font-bold tabular-nums text-white">
                                {formatTime(finish.totalTime)}
                            </div>
                            <div className="mt-1 text-xs text-white/45">total time</div>
                            <div className="mt-4 flex items-center justify-between rounded-lg bg-white/5 px-3 py-2 text-xs">
                                <span className="text-white/45">Best lap</span>
                                <span className="tabular-nums text-emerald-300">{formatTime(finish.bestLap)}</span>
                            </div>
                            <button
                                type="button"
                                onClick={restart}
                                className="mt-5 w-full rounded-lg bg-amber-400 px-4 py-2.5 text-sm font-semibold text-black transition hover:bg-amber-300"
                            >
                                Race again
                            </button>
                            <div className="mt-2 text-[10px] text-white/30">or press Enter</div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default App;
