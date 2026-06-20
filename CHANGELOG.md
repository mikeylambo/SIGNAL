# Changelog

All notable changes to SIGNAL are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

---

## [0.3.0] — 2026-06-20

### Added
- **Full custom palette in Forge** (Phase 2.1 / Custom Calibration): the Forge now
  exposes all five color slots — Base (idle cube), Active (flash), Correct, Wrong, and
  Background — instead of a single accent color. Each slot has its own RGB sliders;
  clicking a slot tab loads its current values.
- **Colorblind-safe presets**: two one-tap starting points — Deuteranopia (blue/orange,
  replaces the red/green axis) and Protanopia (high-contrast blue/orange variant) —
  which the player can then further customize. Both are selectable from the Forge modal.
- **Contrast validation**: if Base and Background colors are too similar (relative
  luminance contrast ratio below 2:1 per WCAG formula), a warning is shown in the Forge
  before the player saves. Saving is not blocked — the warning is informational.
- **`CustomPalette` interface** in `types.ts` enforces the five-slot shape at compile time.
- **CLAUDE.md** project guidance file for future Claude Code sessions.

### Changed
- **Save schema bumped to v2**: existing saves migrate automatically — `customHex` is
  preserved and used as the `active` slot of the new palette; remaining slots backfill
  from Mono defaults.
- **`Theme` interface** gains `baseHex: string` so the Forge can read and write the
  cube base color without parsing the integer form.
- **Custom calibration is always free** (unlocked by default). Documented in code:
  it's an accessibility tool as much as a cosmetic one; contrast-gating it would
  undermine colorblind-preset support.

---

## [0.2.0] — 2026-06-19

### Added
- **Error boundary**: `window.onerror` and `unhandledrejection` handlers log structured
  errors to console with a TODO hook for a future telemetry endpoint.
- **WebGL availability check**: if WebGL is unavailable or disabled, `initScene` now
  throws a typed error caught in `main.ts`, which renders a readable "cannot initialize"
  overlay instead of a white screen.
- **Reduced-motion mode**: respects `prefers-reduced-motion: reduce` OS/browser setting
  on load, and stays in sync if the user changes it mid-session. An explicit in-game
  toggle (Motion: Full / Reduced) is exposed in the Operator Log modal. When active,
  camera drift, grid scroll, and camera shake are all disabled; cube animations are
  preserved as they are the primary game-feedback signal.
- **`bloomResScale()`**: bloom render resolution now scales with detected device tier
  (hardware concurrency + pixel ratio) — low-end gets 1/4 screen, mid gets 1/3, high
  keeps the original 1/2. Exported so `onWindowResize` stays consistent on resize.

### Fixed
- **Pause/resume timer desync** (real bug, found in Classic and Sprint pacing): calling
  `stopTimer()` on pause set `state.timerActive = false`, so the resume handler's
  `if (state.timerActive)` guard was always false — the run timer never restarted after
  any pause. Fixed by capturing `wasTimerActiveBeforePause` before `stopTimer()` and
  using that flag on resume to restore both `timerActive` and the rAF chain.
- **Missing `initAudio()` on primary entry points** (real bug, silent on first load):
  the Engage button, Daily Calibration button, and Pause button all bypassed
  `initAudio()`, meaning the `AudioContext` was never created on the most common game
  entry paths. Sound never started unless the user happened to click Protocol or Pace
  first.
- **Concurrent `cameraShake` calls corrupting camera position** (real bug, reproducible
  in Sprint mode where `handleMistake` and `gameOver` can both trigger shakes in rapid
  succession): two independent `requestAnimationFrame` tick closures both writing to
  `camera.position` with different `restX/Y/Z` origins produced erratic, oscillating
  camera movement. Fixed with a `shakeGeneration` counter — the older tick exits
  immediately when a newer shake starts.
- **Hitstop freeze persisting through pause/resume**: if a correct tap's brief
  freeze-frame (`hitstopEndTime`) was in progress at the moment of pause, resuming left
  the render loop appearing stuck until the hitstop timer naturally elapsed (up to
  ~100ms). Fixed by clearing `loopState.hitstopEndTime = 0` on resume.

### Changed
- **Modularized from single-file HTML to Vite + TypeScript** (Phase 0): `signal.html`
  split into 14 typed modules under `src/`. `tsconfig.json` uses `strict: true`.
  `CubeUserData` interface enforces the shape of `THREE.Mesh.userData` at compile time,
  catching the class of shape-mismatch bug that previously required a real device to surface.
- **Playwright smoke suite added**: 9 tests covering load, countdown, level increment
  via real pointer events, pause/resume, background/foreground-while-paused regression,
  abort run, store, profile, and daily calibration.

---

## [0.1.0] — prototype

Initial single-file prototype (`signal.html`). Feature-complete for v1 scope:
5 cognitive protocols × 3 pacing modes, combo system, Signal currency + calibration
store, custom Forge, daily challenge, versioned save system, bloom post-processing,
fresnel rim lighting, deltaTime-corrected render loop.
