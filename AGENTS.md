# Micro Machines 3D

## Commands

- **Dev server:** `npm run dev`
- **Build:** `npm run build`
- **Lint:** `npm run lint`
- **Typecheck:** `npx tsc --noEmit`

Always run lint and typecheck after making changes.

## Tech Stack

- React 19, TypeScript, Three.js
- Vite, Tailwind CSS 4, PostCSS
- ESLint with typescript-eslint

## Project Structure

- `src/App.tsx` — React root with game container and UI overlay
- `src/game/GameEngine.ts` — Main engine: scene, camera, renderer, game loop
- `src/game/car/` — Car controller, physics, and 3D model
- `src/game/effects/` — Trail system for drift marks
- `src/game/input/` — Keyboard input manager
- `src/game/map/` — Map builder, track, ground, hills, trees, rocks, finish line

## Code Conventions

- No comments unless the code is complex and requires context
- Use arrow functions for event handlers stored as class fields
- Dispose all Three.js resources (geometry, material, textures) on cleanup
- Pre-allocate temp vectors/quaternions as class fields to avoid per-frame allocations
- Use `Readonly<THREE.Vector3>` for zero-copy position/direction getters
- Centralize resize handling in GameEngine rather than adding window listeners in individual modules
- Share geometry/material across instances where possible (trees, rocks)
