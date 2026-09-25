import { useImperativeHandle, useMemo, useRef, type Ref } from "react";
import type { TrackOutline } from "../game/GameEngine";

export interface MinimapHandle {
    update(positions: Float32Array): void;
}

interface MinimapProps {
    ref?: Ref<MinimapHandle>;
    outline: TrackOutline | null;
    racers: readonly { color: string; isPlayer: boolean }[];
}

const PADDING = 14;

/**
 * North-up map drawn the way the classic top-down camera sees the world (+Z up, +X left).
 * Car dots are moved imperatively every frame; React only renders the track once.
 */
export function Minimap({ ref, outline, racers }: MinimapProps) {
    const dots = useRef<(SVGCircleElement | null)[]>([]);

    const view = useMemo(() => {
        if (!outline) return null;
        const minX = -outline.maxX - PADDING;
        const minY = -outline.maxZ - PADDING;
        const width = outline.maxX - outline.minX + PADDING * 2;
        const height = outline.maxZ - outline.minZ + PADDING * 2;

        let path = "";
        for (let i = 0; i < outline.points.length; i += 2) {
            path += `${i === 0 ? "M" : "L"}${(-outline.points[i]).toFixed(1)} ${(-outline.points[i + 1]).toFixed(1)}`;
        }
        path += "Z";

        const startX = -outline.points[0];
        const startY = -outline.points[1];
        return { viewBox: `${minX} ${minY} ${width} ${height}`, path, startX, startY, scale: Math.max(width, height) / 100 };
    }, [outline]);

    useImperativeHandle(ref, () => ({
        update(positions: Float32Array) {
            for (let i = 0; i < dots.current.length; i++) {
                const dot = dots.current[i];
                if (!dot) continue;
                dot.setAttribute("cx", (-positions[i * 2]).toFixed(1));
                dot.setAttribute("cy", (-positions[i * 2 + 1]).toFixed(1));
            }
        },
    }), []);

    // SVG paints in document order, so the player's dot goes last to sit on top.
    const drawOrder = useMemo(
        () => racers.map((_, index) => index).sort((a, b) => Number(racers[a].isPlayer) - Number(racers[b].isPlayer)),
        [racers],
    );

    if (!view) return null;

    return (
        <svg viewBox={view.viewBox} className="block h-full w-full" aria-hidden="true">
            <path d={view.path} fill="none" stroke="var(--color-ink)" strokeWidth={view.scale * 9} strokeLinejoin="round" />
            <path d={view.path} fill="none" stroke="var(--color-paper)" strokeWidth={view.scale * 5} strokeLinejoin="round" />
            <circle cx={view.startX} cy={view.startY} r={view.scale * 3.2} fill="var(--color-toy-red)" stroke="var(--color-ink)" strokeWidth={view.scale * 1.2} />
            {drawOrder.map((index) => (
                <circle
                    key={index}
                    ref={(element) => { dots.current[index] = element; }}
                    r={view.scale * (racers[index].isPlayer ? 5.2 : 4)}
                    fill={racers[index].color}
                    stroke="var(--color-ink)"
                    strokeWidth={view.scale * 1.6}
                />
            ))}
        </svg>
    );
}
