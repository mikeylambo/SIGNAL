# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run dev          # Vite dev server at http://localhost:5173
npm run build        # tsc + Vite production bundle
npm test             # Playwright smoke suite (requires chromium: npx playwright install chromium)
npx tsc --noEmit     # Type-check only, no output
```

Run a single Playwright test by name:
```bash
npx playwright test -g "pause and resume"
```

## Architecture

### Module map

```
src/
  main.ts            — entry point; wires everything, registers listeners, exposes window.__signal
  state.ts           — single mutable object shared across all modules (avoids ES module live-binding issues)
  types.ts           — shared interfaces: CubeUserData, SavedProfile, Theme, Protocol, Pacing
  save.ts            — SaveSystem (localStorage), theme definitions, applyTheme(), setThemeChangeCallback()
  audio.ts           — Web Audio API: playTone(), initAudio(), haptic()
  input.ts           — pointer/touch handlers, raycasting
  errorBoundary.ts   — window.onerror, unhandledrejection, showFatalError()
  reducedMotion.ts   — prefers-reduced-motion media query + in-game override
  utils.ts           — delay() helper
  render/
    scene.ts         — Three.js scene, camera, renderer, bloom (EffectComposer), spawnParticles()
    board.ts         — createBoard(), setCubeState(), fresnel rim shader via onBeforeCompile
    loop.ts          — animate() render loop, startRenderLoop/stopRenderLoop, cameraShake()
  game/
    protocols.ts     — PROTOCOLS[] and PACINGS[] definitions
    runLoop.ts       — initGame(), startLevel(), levelComplete(), gameOver(), handleMistake()
  ui/
    hud.ts           — HUD element updates (score, timer, combo)
    menu.ts          — main menu button listeners, Forge (color picker), store
    modals.ts        — pause/resume/results modal listeners, registerShowResultsScreen()
```

### Circular dependency breaks

Two patterns are used where a clean import graph isn't possible:

1. **`setThemeChangeCallback()`** in `save.ts` — `applyTheme` needs to update Three.js objects that don't exist until `initScene` runs. `main.ts` registers the callback after `initScene` succeeds.

2. **`registerShowResultsScreen()`** in `game/runLoop.ts` — `gameOver()` needs to call `showResultsScreen()` from `ui/modals.ts`, but that would create a cycle. `modals.ts` registers itself by calling `registerShowResultsScreen(showResultsScreen)` at module load time.

### Save system

- `STORAGE_KEY = 'sig_profile_v1'` — must not change; existing player saves are keyed on this.
- `SCHEMA_VERSION` in `save.ts` — bump and add a migration branch in `migrate()` whenever `SavedProfile` in `types.ts` gains fields.
- The `custom` theme is rebuilt from `profile.customHex` at load time in `buildThemes()`.

### Render loop invariants

- **Double-loop guard**: `startRenderLoop()` is a no-op if `loopRunning` is already true. Never call `requestAnimationFrame(animate)` directly outside of `loop.ts`.
- **dt60**: all per-frame motion must scale by `dt60 = (timestamp - lastAnimFrameTime) / (1000/60)`, clamped to 4. Adding a bare constant per frame reintroduces a frame-rate-dependency bug.
- **Hitstop**: `loopState.hitstopEndTime` gates the render body; `resume-btn` handler must clear it to 0.
- **cameraShake**: `shakeGeneration` counter cancels stale concurrent shake closures. Any new async rAF loops that write to shared state should follow the same token pattern.
- `window.__signal = { isLoopRunning, getState }` is the only bridge between app internals and Playwright tests. Don't add more surface here without a test reason.

### Theme / color flow

`applyTheme(key)` → sets CSS variables on `:root` + calls the registered scene callback → the callback updates Three.js material colors directly. The exported `t` object from `save.ts` is the single live theme reference; `board.ts` and `scene.ts` read from it whenever they set material colors.

### Scope boundaries (from SIGNAL_HANDOFF.md)

- **Don't touch `game/runLoop.ts`** when working on UI, color systems, or Forge — it handles all protocol game logic and the interaction is narrow (it reads `state` and calls `t` for colors).
- **Phase 2 / Chromatic protocol** is a separate session. The Custom Calibration palette (Forge expansion) and Chromatic protocol are architecturally independent features; keep them that way.
- Out of scope: multiplayer, native app wrapper, additional protocols beyond Chromatic, monetization changes.
