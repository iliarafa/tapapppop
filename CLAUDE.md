# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — start Vite dev server on port 5173
- `npm run build` — production build to `dist/`
- `npm run preview` — serve production build locally
- No test framework is configured yet.

## Architecture

Single-component React game (`tap-app-pop.jsx`) served via Vite. The entire game lives in one file with no routing, state management library, or backend.

**Entry flow:** `index.html` → `src/main.jsx` → `tap-app-pop.jsx` (default export `TapAppPop`)

### Game modes

- **Classic** — timed (30s). Shapes spawn at random intervals, score based on reaction time (faster tap = more points). Tracks taps, average score, and hit accuracy.
- **RGB** — survival with lives. Shapes spawn in R/G/B colors and must be tapped in R→B→G sequence order. A "pressure" system drives dynamic difficulty: correct taps increase pressure (faster spawns, shorter lifetimes, higher score multiplier up to x2.50), wrong taps cost a life and drop pressure. Game ends when all 5 lives are lost.

### Key internals

- All UI is inline-styled React with no CSS framework. Font: "Press Start 2P" (Google Fonts, loaded via `@import` in a `<style>` tag).
- Two themes (`night`/`day`) defined as color token objects in `themes`.
- `rgbDifficulty(pressure)` is the core difficulty curve — returns `{lifetime, spawnMin, spawnMax, multiplier}` as a function of accumulated pressure (0–30).
- Marks use `requestAnimationFrame` for smooth countdown ring animation. Shape variants (circle, square, triangle, diamond) are SVG render functions in `markShapes`.
- Ref-based tracking (`markBirths`, `markColors`, `livesRef`, `pressureRef`) avoids stale closure issues in timers and callbacks.
