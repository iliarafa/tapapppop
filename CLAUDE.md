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

`src/main.jsx` mounts the component inside `<React.StrictMode>` — see "StrictMode safety" below.

### Screen flow

`title` (logo + "TAP TO START") → `menu` (mode selection) → `play` → `end` (stats + retry/menu)

Settings and history are nested under `settings` from the menu.

### Game modes

- **Classic** — timed (30s). Squares spawn at random intervals with difficulty ramping over time via `classicDifficulty(elapsed)`: spawn rate accelerates (800→300ms) and mark lifetime compresses (1800→900ms). Score based on reaction time. Tracks taps, average score, and hit accuracy.
- **RBG** (RGB sequence) — survival with 5 lives. Squares spawn in R/B/G colors and must be tapped in R→B→G sequence order.
  - **Pressure** drives spawn pacing only via `rgbDifficulty(pressure)` (faster spawns, shorter lifetimes); +1 per correct tap, −3 per wrong tap, capped at 30.
  - **Combo** drives the score multiplier via `comboMultiplier(combo)` (x1.00 → x2.50 in 0.25 steps every 5 correct taps). Resets on wrong tap or life loss. Combo readout (`12×`) appears top-left under the score, hidden while combo < 2.
  - **Milestones** at combo 20 (x2.00) and 30 (x2.50) trigger a 40-particle burst + screen shake on the canvas.
  - **Spawn guarantee:** if no mark of the currently-expected color is on screen, the next spawn is forced to that color so the player never has to wait through purely random spawns.
  - **Missed-shot penalty:** every time a mark of the expected color expires untapped, `missedRef` increments. The expected-color square in `SequenceIndicator` shrinks `1.3 → 0.78 → 0.26` (`missedStep` 0/1/2). Third miss costs a life and resets the indicator.
- **MATH** — survival with 5 lives. Numbered squares spawn in batches (5–9). Player must tap them in ascending order (1, 2, 3...). Counter continues across batches and resets to 1 only on life loss. Difficulty increases per round via `mathDifficulty(round)`: shorter lifetime, larger batch size.

### Per-tap visual feedback

`playTapFeedback(x, y, color, label?)` is a single reusable helper called from every successful-tap branch in all three modes. It spawns:

1. **Squash & stretch ghost** — `tapPop` keyframe (150ms, scale 1 → 0.7 → 1.1 → 1) at the tap position.
2. **Rim glow ring** — `tapGlow` keyframe (200ms outward fade) using a colored border.
3. **Particle burst** — 14 dots in the mark's color with white/yellow accents, light gravity bias (6px) baked into dy.
4. **Subtle full-screen flash** — `flashFade` keyframe (150ms, opacity 0.06 → 0) tinted with the mark's color.

All four states (`tapPops`, `flashes`, plus existing `particles` and `floats`) follow the same `setTimeout`-cleanup pattern. Tweak intensity by editing the constants at the top of the helper.

### Key internals

- All UI is inline-styled React with no CSS framework. Font: "Press Start 2P" (Google Fonts, loaded via `@import` in a `<style>` tag).
- Two themes (`night`/`day`) defined as color token objects in `themes`. Toggle is a pixel art sun icon.
- All marks are squares (single entry in `markShapes`). Timer feedback is opacity fade only (no ring).
- `Mark` component accepts optional `label` (number) and `rgbColor` props for mode-specific rendering.
- `randomPos(existing)` generates non-overlapping positions via a golden-angle Poisson-disk sampler. **Important:** it mutates a module-level `spawnIndex` counter, so it must be called outside `setMarks` updaters (see StrictMode notes).
- Ref-based tracking (`markBirths`, `markColors`, `markLabels`, `markPositions`, `livesRef`, `pressureRef`, `comboRef`, `rgbNextRef`, `missedRef`, `mathNextRef`, `mathCounterRef`) avoids stale closures and lets event handlers read game state synchronously without going through `setState((prev) => ...)` updaters.
- `TitleBgSquares` component renders animated RBG squares on title and menu screens.
- History persists to `localStorage` under `tapapppop:history:v1` (versioned). `buildRun`, `appendRun`, `loadHistory`, `computeBests` live near the top of the file.

### StrictMode safety

The app runs under `<React.StrictMode>`, which **double-invokes functional state updaters in dev** to surface impure code. Two rules follow from this:

1. **Never put side effects inside a state updater.** Any `audio.*`, `playTapFeedback`, `spawnParticles`, `bumpCombo`, etc. that lives inside `setMarks((prev) => …)` or `setRgbNext((expected) => …)` will fire twice. The current handlers (`handleClassicTap`, `handleRgbTap`, `handleMathTap`) all read state via refs (e.g. `rgbNextRef`, `mathNextRef`) and run side effects in the handler body, then call `setX(value)` with a plain value at the end. Preserve this pattern.
2. **Never call `randomPos` inside a state updater.** It mutates `spawnIndex`, so a double-invocation produces two different positions per spawn. The chosen position must be computed once outside `setMarks`, written to `markPositions.current[id]`, and then passed into a pure `setMarks((prev) => [...prev, mark])`. This keeps the rendered mark's position and the ref-stored position in lockstep — without it, tap-feedback bursts fire at the wrong location.
