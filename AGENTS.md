# Micro Machines 3D

## Commands

- **Dev server:** `npm run dev`
- **Build:** `npm run build`
- **Typecheck:** `npx tsc --noEmit`

Always run typecheck after making changes.

## Tech Stack

- React 19, TypeScript, Three.js
- Vite, Tailwind CSS 4, PostCSS

## Project Structure

- `src/App.tsx` — React root: screen state machine (menu → race → results, pause), keyboard navigation
- `src/ui/` — Sticker-style overlays: `TitleScreen`, `Hud` (updated imperatively per frame), `Minimap`, `PauseMenu`, `Results`
- `src/game/GameEngine.ts` — Renderer, fixed-step loop, attract/race modes, four cars, HUD publishing, adaptive resolution
- `src/game/car/` — `CarController` (per-car physics integration, collisions, falls), `CarPhysics`, `CarModel` (liveries, merged meshes), `AIDriver`, `CarCollisions`
- `src/game/race/` — `RaceManager` (laps, sectors, standings, records) and `Roster` (racer names, liveries, AI personalities)
- `src/game/camera/CameraRig.ts` — Chase, classic top-down, free orbit and menu attract cameras
- `src/game/render/` — `SceneLighting` (sun, fill, env map), `PostFX` (MSAA + tilt-shift + grade)
- `src/game/effects/` — Particles, GPU-faded skid trails, pushable `DebrisField`
- `src/game/map/` — Track-agnostic world: `MapBuilder` facade, `TrackPath` spline, `Terrain` grading, road ribbon, finish line
- `src/game/tracks/` — One folder per track theme implementing `TrackTheme` (`types.ts`); registered in `tracks/index.ts`
- `src/dev/preview.ts` + `preview.html` — Dev-only track viewer: `/preview.html?track=breakfast&view=chase&t=0.3`

## Code Conventions

- No comments unless the code is complex and requires context
- Use arrow functions for event handlers stored as class fields
- Dispose all Three.js resources (geometry, material, textures) on cleanup
- Pre-allocate temp vectors/quaternions as class fields to avoid per-frame allocations
- Use `Readonly<THREE.Vector3>` for zero-copy position/direction getters
- Centralize resize handling in GameEngine rather than adding window listeners in individual modules
- Share geometry/material across instances where possible (trees, rocks)
- Theme code never touches engine internals: it returns objects, obstacles, surface patches and debris specs from `build()`
