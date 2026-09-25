# Micro Machines 3D

Tiny toy cars, giant everyday tracks. A browser racer in the spirit of the classic Micro Machines games, built with React, Three.js and TypeScript.

## Tracks

- **Breakfast Bends** — a lap of the kitchen table. The course is lined with cereal hoops you can plough through, there is spilt milk, juice and jam to slide or stick in, and the edge of the table is a long way down.
- **Backyard Rally** — a dirt path through a lawn that towers over the cars: giant flowers, a football, flowerpots and toy bricks, all fenced in by a garden fence the size of a skyscraper.

Each race is three laps against three AI rivals — Dash, Violet and Buck — who each have their own pace, racing line and appetite for drifting. You start at the back of the grid.

## How to Play

| Key | Action |
| --- | --- |
| ↑ / ↓ (or W / S, Q / A) | Accelerate / brake and reverse |
| ← / → (or O / P) | Steer |
| Space | Handbrake drift — drifting fills the boost meter |
| Shift | Boost |
| R | Put the car back on the track |
| C | Cycle camera: chase, classic top-down, free orbit |
| Esc | Pause |

Gamepads work too: right trigger to accelerate, left trigger to brake, A to drift, B or RB to boost.

Bumping rivals is allowed. Falling off the table is not recommended.

## Development

```bash
bun install        # or npm install
bun run dev        # start the dev server
bun run build      # production build
bun run typecheck  # typecheck (TypeScript 7)
```

`/preview.html?track=breakfast&view=chase&t=0.3` opens a dev-only viewer for a single track (views: `chase`, `top`, `orbit`; `[` and `]` step around the lap).

### Adding a track

Tracks live in `src/game/tracks/<name>/` and implement the `TrackTheme` interface from `src/game/tracks/types.ts`: a lap layout, a height function, surfaces, lighting, and a `build()` that returns meshes, obstacles, surface patches (puddles, spills) and pushable debris. Register it in `src/game/tracks/index.ts` and it appears on the title screen.

## Ideas for later

- Sound: engines, skids, bumps and a countdown
- More tracks (bath tub, pool table, school desk)
- Local split-screen or head-to-head elimination mode
- Touch controls
