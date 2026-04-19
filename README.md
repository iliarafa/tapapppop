# TAP TAP APP

A minimalist, retro-pixel reaction game for mobile-first browsers and iOS. Tap squares as fast as you can — three modes, three different ways to lose your nerve.

Built as a single React component with no game engine and no asset pipeline. All tap/miss/life-loss SFX are synthesised in the Web Audio API at runtime; only the two background music tracks are MP3s served from `public/music/`.

## Run it locally

```bash
npm install
npm run dev      # Vite dev server on http://localhost:5173
npm run build    # production build to dist/
npm run preview  # serve the production build
```

The project is also wired up for iOS via Capacitor (see `@capacitor/*` dependencies in `package.json`).

## Modes

### Classic
30-second timed run. Squares spawn at increasing speed; tap them before they fade. Score is based on reaction time. Tracks taps, average score, and hit accuracy.

### RBG (sequence)
Survival mode with 5 lives. Squares spawn in red, blue, and green — tap them in **R → B → G** sequence order.

- **Combo multiplier** — every correct tap raises a combo counter that drives a `x1.00 → x2.50` score multiplier (every 5 in combo bumps it +0.25). Combo resets on a wrong tap or life loss.
- **Milestone bursts** — combos of 20 (x2.00) and 30 (x2.50) trigger a 40-particle explosion + screen shake.
- **Spawn guarantee** — the currently-needed color is always available on screen, so you're never waiting through unlucky random spawns.
- **Missed-shot penalty** — the sequence indicator's expected square shrinks `1.3 → 0.78 → 0.26` as you ignore expected-color marks. Three misses cost a life.
- **Pressure** continues to drive how fast new marks spawn.

### MATH
Survival mode with 5 lives. Numbered squares spawn in batches of 5–9 — tap them in ascending order (1, 2, 3, …). The counter persists across batches and only resets when you lose a life. Each round shortens lifetimes and grows the batch.

## Visual feedback

Every successful tap fires a single reusable `playTapFeedback` effect, in all three modes:

- A quick **squash & stretch ghost** at the tap point (150 ms).
- A **rim glow** that expands and fades out (200 ms).
- A **particle burst** of 14 dots in the mark's color with white/yellow accents and a hint of gravity.
- An **extremely subtle full-screen color flash** (opacity 0.06, 150 ms).

All effects are pure DOM + CSS keyframes — no canvas, no shaders, mobile-friendly.

## Settings & history

From the main menu → `SETTINGS`:

- **Theme** — toggle between night (default) and day palettes.
- **Sound** — mute / unmute the synthesised SFX and music.
- **History** — your last 50 runs and per-mode bests, persisted to `localStorage` under `tapapppop:history:v1`.

## Tech stack

- **React 19** + **Vite 8** — single component (`tap-app-pop.jsx`) rendered into `#root`.
- **Capacitor 8** — iOS wrapper.
- No CSS framework, no state management library, no test framework. All UI is inline-styled. The retro font is **Press Start 2P** loaded from Google Fonts via an `@import` inside a `<style>` tag.
- **Sound effects** (tap, miss, life lost, chain complete, game over) are synthesised with the Web Audio API — no SFX files. **Music** uses two small MP3s in `public/music/` played via an `HTMLAudioElement`: `mainmusic.mp3` on menus, `gamemusic.mp3` during play.

## Project layout

```
tap-app-pop.jsx     # entire game (UI, state, audio engine, persistence)
src/main.jsx        # React root, mounts the game in <StrictMode>
index.html          # Vite entry
public/music/       # mainmusic.mp3, gamemusic.mp3 (menu & gameplay tracks)
public/             # SVG icons served at the root
ios/                # Capacitor iOS project
capacitor.config.json
CLAUDE.md           # architecture notes for AI assistants and contributors
```

## License

ISC.
