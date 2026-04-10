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

### Screen flow

`title` (logo + "TAP TO START") → `menu` (mode selection) → `play` → `end` (stats + retry/menu)

### Game modes

- **Classic** — timed (30s). Squares spawn at random intervals with difficulty ramping over time via `classicDifficulty(elapsed)`: spawn rate accelerates (800→300ms) and mark lifetime compresses (1800→900ms). Score based on reaction time. Tracks taps, average score, and hit accuracy.
- **RGB** — survival with 5 lives. Squares spawn in R/G/B colors and must be tapped in R→B→G sequence order. A "pressure" system drives dynamic difficulty via `rgbDifficulty(pressure)`: correct taps increase pressure (faster spawns, shorter lifetimes, higher score multiplier up to x2.50), wrong taps cost a life and drop pressure.
- **MATH** — survival with 5 lives. Numbered squares spawn in batches (5–9). Player must tap them in ascending order (1, 2, 3...). Counter continues across batches and resets to 1 only on life loss. Difficulty increases per round via `mathDifficulty(round)`: shorter lifetime, larger batch size.

### Key internals

- All UI is inline-styled React with no CSS framework. Font: "Press Start 2P" (Google Fonts, loaded via `@import` in a `<style>` tag).
- Two themes (`night`/`day`) defined as color token objects in `themes`. Toggle is a pixel art sun icon.
- All marks are squares (single entry in `markShapes`). Timer feedback is opacity fade only (no ring).
- `Mark` component accepts optional `label` (number) and `rgbColor` props for mode-specific rendering.
- `randomPos(existing)` generates non-overlapping positions with minimum 8% distance between centers and 10%+ edge padding.
- Ref-based tracking (`markBirths`, `markColors`, `markLabels`, `livesRef`, `pressureRef`, `mathCounterRef`) avoids stale closure issues in timers and callbacks.
- `TitleBgSquares` component renders animated RGB squares on title and menu screens.
