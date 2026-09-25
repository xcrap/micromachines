import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GameEngine, type HudState, type RacerStanding, type TrackOutline } from "./game/GameEngine";
import { bestLapStorageKey, readStoredLap } from "./game/race/RaceManager";
import { PLAYER_INDEX, ROSTER } from "./game/race/Roster";
import { TRACK_ORDER, TRACKS, type TrackId } from "./game/tracks";
import { Hud, type Announcement, type HudHandle } from "./ui/Hud";
import { PauseMenu, type MenuOption } from "./ui/PauseMenu";
import { Results } from "./ui/Results";
import { TitleScreen, type TrackCard } from "./ui/TitleScreen";
import { formatTime } from "./ui/format";

type Screen = "menu" | "race" | "results";

const SELECTED_TRACK_KEY = "micro-machines-track";
const ANNOUNCEMENT_MS = 1900;
const RESULTS_DELAY_MS = 1700;
const TRACK_SWITCH_DELAY_MS = 160;

const RACER_DOTS = ROSTER.map((profile, index) => ({ color: profile.color, isPlayer: index === PLAYER_INDEX }));
const RIVALS = ROSTER.filter((_, index) => index !== PLAYER_INDEX).map(({ name, color }) => ({ name, color }));

function readSelectedTrack(): TrackId {
    try {
        const stored = window.localStorage.getItem(SELECTED_TRACK_KEY) as TrackId | null;
        if (stored && stored in TRACKS) return stored;
    } catch {
        // Private browsing — fall through to the default.
    }
    return TRACK_ORDER[0];
}

function storeSelectedTrack(id: TrackId): void {
    try {
        window.localStorage.setItem(SELECTED_TRACK_KEY, id);
    } catch {
        // Not worth surfacing; the choice just will not persist.
    }
}

/** Canvas textures in the world (banner, car numbers) are drawn with the display font, so wait for it briefly. */
function waitForFonts(): Promise<unknown> {
    const timeout = new Promise((resolve) => window.setTimeout(resolve, 2000));
    if (!document.fonts) return Promise.resolve();
    return Promise.race([
        Promise.all([document.fonts.load("64px Bungee"), document.fonts.load("800 16px Rubik")]),
        timeout,
    ]);
}

function App() {
    const containerRef = useRef<HTMLDivElement>(null);
    const engineRef = useRef<GameEngine | null>(null);
    const hudRef = useRef<HudHandle>(null);

    const [ready, setReady] = useState(false);
    const [screen, setScreen] = useState<Screen>("menu");
    const [paused, setPaused] = useState(false);
    const [pauseFocus, setPauseFocus] = useState(0);
    const [selectedTrack, setSelectedTrack] = useState<TrackId>(readSelectedTrack);
    const [standings, setStandings] = useState<RacerStanding[]>([]);
    const [outline, setOutline] = useState<TrackOutline | null>(null);
    const [announcement, setAnnouncement] = useState<Announcement | null>(null);
    const [playerPosition, setPlayerPosition] = useState(ROSTER.length);
    const [newRecord, setNewRecord] = useState(false);
    const [recordsVersion, setRecordsVersion] = useState(0);

    const screenRef = useRef<Screen>("menu");
    const standingsVersion = useRef(-1);
    const lastLapTime = useRef(0);
    const announcementId = useRef(0);
    const timers = useRef<number[]>([]);
    const loadedTrack = useRef<TrackId | null>(null);

    screenRef.current = screen;

    const schedule = useCallback((callback: () => void, delay: number) => {
        const id = window.setTimeout(() => {
            timers.current = timers.current.filter((timer) => timer !== id);
            callback();
        }, delay);
        timers.current.push(id);
    }, []);

    const clearTimers = useCallback(() => {
        timers.current.forEach((id) => window.clearTimeout(id));
        timers.current = [];
    }, []);

    const announce = useCallback((text: string, tone: Announcement["tone"], detail?: string) => {
        const id = ++announcementId.current;
        setAnnouncement({ id, text, tone, detail });
        schedule(() => setAnnouncement((current) => (current?.id === id ? null : current)), ANNOUNCEMENT_MS);
    }, [schedule]);

    const handleHud = useCallback((state: HudState) => {
        if (state.mode === "race") hudRef.current?.update(state);

        if (state.standingsVersion !== standingsVersion.current) {
            standingsVersion.current = state.standingsVersion;
            const engine = engineRef.current;
            if (engine) setStandings(engine.getStandings());
        }
    }, []);

    useEffect(() => {
        let cancelled = false;
        let engine: GameEngine | null = null;

        waitForFonts().then(() => {
            if (cancelled || !containerRef.current) return;

            engine = new GameEngine(containerRef.current);
            engineRef.current = engine;
            engine.setHudListener(handleHud);
            engine.setHudEvents({
                onLapCompleted(lap, lapTime, isBest) {
                    lastLapTime.current = lapTime;
                    if (isBest) setNewRecord(true);
                    announce(isBest ? "LAP RECORD!" : `LAP ${lap}`, isBest ? "blue" : "yellow", formatTime(lapTime));
                },
                onFinalLap() {
                    announce("FINAL LAP!", "red", formatTime(lastLapTime.current));
                },
                onRaceFinished(position) {
                    setPlayerPosition(position);
                    announce(position === 1 ? "WINNER!" : "FINISH!", position === 1 ? "yellow" : "green");
                    schedule(() => {
                        if (screenRef.current === "race") setScreen("results");
                    }, RESULTS_DELAY_MS);
                },
                onPlayerFell() {
                    announce("OOPS!", "red", "Back on the track");
                },
            });

            const track = readSelectedTrack();
            engine.loadTrack(track);
            loadedTrack.current = track;
            setOutline(engine.getTrackOutline());
            setStandings(engine.getStandings());
            engine.start();
            setReady(true);
        });

        return () => {
            cancelled = true;
            clearTimers();
            engine?.dispose();
            engineRef.current = null;
        };
    }, [announce, clearTimers, handleHud, schedule]);

    // Rebuilding a world takes a moment, so let rapid menu scrolling settle before loading.
    useEffect(() => {
        if (!ready || loadedTrack.current === selectedTrack) return;
        const id = window.setTimeout(() => {
            const engine = engineRef.current;
            // Starting a race loads the selection itself; never swap worlds under a race.
            if (!engine || screenRef.current !== "menu" || loadedTrack.current === selectedTrack) return;
            engine.loadTrack(selectedTrack);
            loadedTrack.current = selectedTrack;
            setOutline(engine.getTrackOutline());
            setStandings(engine.getStandings());
        }, TRACK_SWITCH_DELAY_MS);
        return () => window.clearTimeout(id);
    }, [ready, selectedTrack]);

    const selectTrack = useCallback((id: TrackId) => {
        setSelectedTrack(id);
        storeSelectedTrack(id);
    }, []);

    const startRace = useCallback(() => {
        const engine = engineRef.current;
        if (!engine) return;
        if (loadedTrack.current !== selectedTrack) {
            engine.loadTrack(selectedTrack);
            loadedTrack.current = selectedTrack;
            setOutline(engine.getTrackOutline());
        }
        clearTimers();
        engine.startRace();
        setAnnouncement(null);
        setNewRecord(false);
        setPaused(false);
        setStandings(engine.getStandings());
        setScreen("race");
    }, [clearTimers, selectedTrack]);

    const backToMenu = useCallback(() => {
        clearTimers();
        engineRef.current?.exitToMenu();
        setAnnouncement(null);
        setPaused(false);
        setScreen("menu");
        setRecordsVersion((version) => version + 1);
    }, [clearTimers]);

    const setEnginePaused = useCallback((value: boolean) => {
        engineRef.current?.setPaused(value);
        setPaused(value);
        setPauseFocus(0);
    }, []);

    const pauseOptions = useMemo<MenuOption[]>(() => [
        { label: "RESUME", onSelect: () => setEnginePaused(false) },
        { label: "RESTART", onSelect: startRace },
        { label: "PICK TRACK", onSelect: backToMenu },
    ], [backToMenu, setEnginePaused, startRace]);

    // Coming back to a hidden tab mid-race should not throw the player straight back into traffic.
    useEffect(() => {
        const onVisibility = () => {
            if (document.hidden && screenRef.current === "race" && !paused) setEnginePaused(true);
        };
        document.addEventListener("visibilitychange", onVisibility);
        return () => document.removeEventListener("visibilitychange", onVisibility);
    }, [paused, setEnginePaused]);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.repeat) return;
            const key = event.key;

            if (screen === "menu") {
                const index = TRACK_ORDER.indexOf(selectedTrack);
                if (key === "ArrowUp" || key === "ArrowLeft" || key === "w") {
                    selectTrack(TRACK_ORDER[(index - 1 + TRACK_ORDER.length) % TRACK_ORDER.length]);
                } else if (key === "ArrowDown" || key === "ArrowRight" || key === "s") {
                    selectTrack(TRACK_ORDER[(index + 1) % TRACK_ORDER.length]);
                } else if (key === "Enter") {
                    startRace();
                }
                return;
            }

            if (screen === "results") {
                if (key === "Enter") startRace();
                else if (key === "Escape") backToMenu();
                return;
            }

            if (!paused) {
                if (key === "Escape") setEnginePaused(true);
                return;
            }

            if (key === "Escape") {
                setEnginePaused(false);
            } else if (key === "ArrowUp") {
                setPauseFocus((focus) => (focus - 1 + pauseOptions.length) % pauseOptions.length);
            } else if (key === "ArrowDown") {
                setPauseFocus((focus) => (focus + 1) % pauseOptions.length);
            } else if (key === "Enter") {
                pauseOptions[pauseFocus].onSelect();
            }
        };

        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, [backToMenu, pauseFocus, pauseOptions, paused, screen, selectTrack, selectedTrack, setEnginePaused, startRace]);

    // Recomputed whenever the menu comes back so freshly set lap records show up.
    const trackCards = useMemo<TrackCard[]>(() => {
        void recordsVersion;
        return TRACK_ORDER.map((id) => ({
            id,
            name: TRACKS[id].name,
            location: TRACKS[id].location,
            description: TRACKS[id].description,
            laps: TRACKS[id].laps,
            bestLap: readStoredLap(bestLapStorageKey(id)),
        }));
    }, [recordsVersion]);

    return (
        <div className="relative h-dvh w-full overflow-hidden bg-ink">
            <div ref={containerRef} className="h-full w-full" />

            {!ready && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="logo-type -rotate-3 text-[clamp(40px,6vw,72px)]">MICRO MACHINES</span>
                </div>
            )}

            {ready && screen === "menu" && (
                <TitleScreen
                    tracks={trackCards}
                    selected={selectedTrack}
                    rivals={RIVALS}
                    onSelect={selectTrack}
                    onStart={startRace}
                />
            )}

            {ready && screen === "race" && (
                <Hud
                    ref={hudRef}
                    standings={standings}
                    racers={RACER_DOTS}
                    outline={outline}
                    announcement={announcement}
                />
            )}

            {screen === "race" && paused && (
                <PauseMenu options={pauseOptions} focused={pauseFocus} onFocus={setPauseFocus} />
            )}

            {screen === "results" && (
                <Results
                    standings={standings}
                    playerPosition={playerPosition}
                    trackName={TRACKS[selectedTrack].name}
                    newRecord={newRecord}
                    onRaceAgain={startRace}
                    onMenu={backToMenu}
                />
            )}
        </div>
    );
}

export default App;
