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
  progression.ts     — per-protocol mastery ranks, sparklines, Stats rendering
  streaks.ts         — daily-challenge streak tracking (the only streak source of truth)
  audioUnlocks.ts    — purchasable audio layers (spatial pan, binaural, gamma)
  lib/supabase.ts    — lazily dynamic-imported Supabase client (own bundle chunk)
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
    modals.ts        — pause/resume/results listeners, pauseGame(), registerShowResultsScreen()
    leaderboard.ts   — board rendering, name prompt, report control, browser screen
```

### Circular dependency breaks

Two patterns are used where a clean import graph isn't possible:

1. **`setThemeChangeCallback()`** in `save.ts` — `applyTheme` needs to update Three.js objects that don't exist until `initScene` runs. `main.ts` registers the callback after `initScene` succeeds.

2. **`registerShowResultsScreen()`** in `game/runLoop.ts` — `gameOver()` needs to call `showResultsScreen()` from `ui/modals.ts`, but that would create a cycle. `modals.ts` registers itself by calling `registerShowResultsScreen(showResultsScreen)` at module load time.

### Forge / palettes (`src/palettes.ts`)

- The Forge is **curated base + uniform hue rotation**, not free colour choice. Uniform rotation
  preserves the hue *distances* between active/correct/wrong, so no reachable palette can make them
  collide — that property is why rotation replaced five independent RGB sliders.
- Colour-vision palettes live in Settings → Accessibility, **not** in the Forge. They are an access
  need, not a cosmetic, and belong where players who need them will look.
- `profile.accessiblePalette` overrides the stored calibration and must be re-applied at startup
  (`initAccessiblePalette()` in `main.ts`), or it persists but silently does nothing until Settings
  is next opened.
- Open question for the economy pass: free bases + a full hue slider structurally undercut the paid
  shop themes. The shop needs to sell something rotation cannot produce, or stop selling colour.

### Keyboard / screen reader (`src/keyboard.ts`)

- Activation routes through `handleInteraction()` — the same entry point as a pointer tap — so every
  protocol rule applies without being reimplemented. Never add a second "tile was chosen" path.
- The cursor writes to `userData.targetScale`, the same channel mouse hover uses, so the two cannot
  fight over the highlight.
- Flashes and phases are mirrored to `#sr-board-announce`. Any new visual-only game signal needs an
  announcement, or it doesn't exist for a screen-reader player.

### Economy (`src/materials.ts`, `src/entitlements.ts`)

- **The shop does not sell colour.** The Forge gives eight designed palettes and a full hue slider
  away free, so anything sold as colour is a rotation away. Materials (surface, glow falloff,
  transparency, wireframe) are the axis rotation cannot reach — that is what Signal buys.
- **Paid Calibrations bundle a palette + a signature material.** That pairing is the product, and it
  is why existing purchases gained value rather than being devalued. Owning a Calibration does NOT
  grant its material for general use — that would be a cheap route to a 900–3000 Signal item.
- `activeBoardMaterial()` re-checks ownership at render time. Never trust `profile.activeMaterial`
  alone; a hand-edited save would otherwise equip anything.
- **Premium never gates play.** Protocols, pacings, modifiers, the daily and the leaderboard are
  free permanently. No energy timers, no ad-gated retries, no paid continues — in a permadeath game
  a paid retry is how you get uninstalled. It sells cosmetics and record-keeping depth only.
- The purchase button renders only when `VITE_PURCHASE_PROVIDER` is set, so no build ships a button
  that cannot complete. `grantPremium()` is for a confirmed receipt — a client-set flag is not one.
- **Store copy must describe sound, not promise cognition.** The audio layers were "Gamma Protocol —
  40 Hz gamma-band entrainment" and "Binaural Focus"; both Apple and Google scrutinise implied
  cognitive-benefit claims. The audio is unchanged, the promise is gone. Keep it that way.
- `FREE_HISTORY_LIMIT` lives in `entitlements.ts`, not `progression.ts`. Splitting it across both
  made their imports circular, which throws a TDZ error at init and white-screens the game.

### Modifiers (`src/game/modifiers.ts`)

- Modifiers are **properties of existing protocols**, never new protocols. Chromatic failed as a
  sixth protocol for two structural reasons: it fought the Forge (a colour-memory task built on
  player-recolourable materials is unstable), and it tested perception while everything else tests
  memory. As a modifier it adds a channel to a memory task instead.
- **Chromatic's channel colours are fixed and theme-exempt.** They are gameplay information, so the
  Forge must never be able to rotate them into each other. Never derive them from `t`.
- Each channel also carries a semitone, so colour is audible as well as visible. That is what makes
  Resonant possible and keeps Chromatic playable without colour vision.
- Modified runs get their own leaderboards (`modifierBoardSuffix()`). Mixing a 1.8x score into the
  standard board would make the standard board unwinnable without the modifier.
- Unlocks are gated per protocol, not globally — Chromatic on Spatial is a different skill from
  Chromatic on Rhythm.
- 2-Back is excluded by `modifiersAvailableFor()`; a second channel on a running 2-back comparison
  is a materially harder exercise that needs its own design pass.

### Progression (`src/progression.ts`)

- Per-protocol mastery is **additive only** — it records completed runs and derives a rank. It must
  never gate content or feed back into run scoring, or the two systems start fighting.
- `RANK_THRESHOLDS[0]` is `1`, not `0`, so an unplayed protocol reads rank 0 = "Unranked". Setting it
  to 0 makes every untouched protocol score rank I.
- Adding a field to `ProtocolMastery` means bumping `SCHEMA_VERSION` **and** backfilling it in
  `getMastery()` — a partial object from an older build otherwise throws into `load()`'s catch,
  which resets the whole profile.

### Moderation (`supabase/schema.sql`)

- The client blocklist in `game/leaderboard.ts` is a UX fast-path only. Anything that must actually
  hold belongs in the SECURITY DEFINER functions — the client bundle is editable by the player.
- Blocklist terms have a `match_mode`: `substring` for unambiguous slurs, `word` for anything that
  occurs inside ordinary words. Adding a short term as `substring` is how you block Scunthorpe.
- Schema changes should be verified against a real Postgres, not eyeballed. A local instance
  (`initdb` + `pg_ctl`, roles `anon`/`authenticated`) applies `schema.sql` end to end.

### Save system

- `STORAGE_KEY = 'sig_profile_v1'` — must not change; existing player saves are keyed on this.
- `SCHEMA_VERSION` in `save.ts` — bump and add a migration branch in `migrate()` whenever `SavedProfile` in `types.ts` gains fields.
- The `custom` theme is rebuilt from `profile.customHex` at load time in `buildThemes()`.

### Run lifecycle invariants

- **`state.runId` + `endRun()`** (`state.ts`) is the ownership token for "the run currently in
  progress". `endRun()` bumps it and is called by `initGame()`, `gameOver()`, and `returnToMenu()`.
- Every async gameplay step in `runLoop.ts` captures `runId` at entry and returns early via
  `isStale(runId)` after each `await`, `setTimeout`, or `cameraShake` callback. Without this an
  abandoned run keeps writing to shared `state` and driving the DOM — that's how aborting a 2-Back
  run used to throw a results screen over the main menu seconds later.
- **Any new `await`/timer inside a gameplay sequence must re-check `isStale(runId)` after it.**
  Adding one without the check reintroduces the bug class.
- Pausing must never abandon a sequence. Wait the pause out (`awaitUnpaused()`); returning early
  from mid-Observe leaves the round with no path back into Execute.
- `runTimer()` clamps its per-frame delta to `MAX_TIMER_FRAME_MS`. rAF timestamps advance across
  gaps where no frame fired, so an unclamped delta bills the player for backgrounded time.
- Backgrounding auto-pauses via `pauseGame()` in `ui/modals.ts` — shared with the pause button.

### Three.js version (pinned 0.128.0)

- The pin is deliberate and the version is old. An upgrade to 0.185 was attempted and reverted:
  r152 colour management, r155 physical lighting and a reworked `UnrealBloomPass` each shift the
  look, and the response across the bloom threshold is discontinuous, so no light-scale constant
  reproduces the original.
- If you take this on, treat it as an **art pass**: re-author palettes, emissive intensities, light
  units and bloom strength/radius/threshold together, and compare against a screenshot baseline
  rather than assuming. Board-region mean brightness on the menu is a workable metric (0.128
  baseline ≈ 39.7).

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
