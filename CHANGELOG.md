# Changelog

All notable changes to SIGNAL are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Fixed
- **Onboarding skip flag**: `hasSeenOnboarding` and `hasCompletedOnboarding` are now persisted to
  localStorage at the very start of the skip-button handler, before `returnToMenu()` re-reads the
  profile. Added a `hasSeenOnboarding` guard in `startOnboardingRound()` to prevent double-entry.
- **Score submit timing**: confirmed `submitScore()` fires only after `await promptDisplayName()`
  resolves, so the display name is always saved before the leaderboard entry is created.
- **iOS safe-area insets**: on iOS devices the viewport meta gains `viewport-fit=cover` at runtime
  and `env(safe-area-inset-top/bottom)` values are read once and stored as `--sat`/`--sab` CSS
  custom properties. `.header` and `#menu-sheet` reference these via `calc()`. Non-iOS / headless
  environments are unaffected (no DOM overhead, CSS fallback is `0px`).
- **Hint text wrapping**: protocol and pacing hint strings shortened to fit narrow screens without
  wrapping; `#hint-message` gained `max-width: 320px` and auto side margins.
- **Test reliability**: removed auto-start of menu ambient from `initAudio()`. The ambient now
  starts exclusively from `returnToMenu()`, eliminating CPU contention between Web Audio oscillators
  and the SwiftShader software WebGL renderer that was causing `setTimeout` delays to stretch past
  Playwright's 8 s assertion windows. All 17 tests now pass reliably.
- **Defensive opacity**: `initGame()` now explicitly resets `#ui-layer` opacity to `1`, matching
  the same guard already present in `startOnboardingRound()`.



### Changed — Menu redesign
- **Bottom sheet menu**: replaced the centre-display overlay with a sliding
  bottom sheet. The 3D board is now visible and interactive behind the menu at
  all times. Sheet hides during gameplay and reappears on return to menu.
- **Protocol / Pacing / Streak** displayed as three equal columns in the sheet
  header — bare name only (no "Protocol:" / "Pace:" prefix).
- **Hint text** updated to two centred lines (protocol hint + pacing hint) using
  `<br>` rather than the single compressed `·`-joined string.
- **Streak column** in mode row: shows `N days ◆` in combo colour when streak ≥ 1,
  dash in muted colour otherwise.
- **Daily row**: replaced button with a full-width clickable div; shows
  "available now" vs "complete · returns tomorrow" state without disabling
  interaction.
- **Currency balance** moved to top-right header, visible during menu only
  (gameplay shows the stats bar instead).
- **Label renames**: "Operator Log" → "Stats", "Exchange" → "Shop",
  "Calibrate Signal" → "Style", "Signal Balance:" → "Balance:",
  "Name Your Signal" → "Choose a Name". Subtext on name modal simplified
  (removed "Choose carefully — it can't be changed.").
- **Mistake reason strings** simplified: "INVALID NODE" / "FALSE POSITIVE" →
  "WRONG TILE"; "MISSED TARGET" → "MISSED"; "RHYTHM DE-SYNC" → "OFF RHYTHM";
  "RUN FAILED" → "RUN ENDED".

### Fixed
- **Skip button z-index** in onboarding overlay was `z-index:2` — below the
  sheet's `z-index:200` backdrop — so the button was invisible on mobile.
  Fixed to `z-index:210`; `#ob-card` set to `z-index:201`.
- **Orientation-change zoom drift** (`onWindowResize`): `camera.zoom` is now
  reset to `1` before `updateProjectionMatrix()` so a pinch-zoom from one
  orientation doesn't carry a stale multiplier into the other.
- **Tutorial audio**: `initAudio()` is now called at the start of
  `startOnboarding()` (while the user-gesture call stack is live) and
  `playTone('active')` fires on each tile flash during both observe sequences.
- **iOS haptics button**: hidden entirely instead of showing "Unsupported" —
  detected via `navigator.userAgent` for iPhone/iPad/iPod.
- **Forge BG slot live preview**: when `selectedSlot === 'bg'`, the slider
  now also updates `--bg` on `:root` immediately so the page background
  transitions live while dragging.

### Fixed
- **Daily leaderboard mode key** was `"daily"` (a single shared bucket for all
  dates); changed to `"daily_YYYY-MM-DD"` so each day's daily challenge has its
  own isolated leaderboard. Standard mode keys changed from `"mode:spatial:classic"`
  (colon-separated with `"mode:"` prefix) to `"spatial_classic"` (underscore, no
  prefix) to match the title-formatter's expectations.
- **Leaderboard title** now shows human-readable text: `"DAILY · JUN 22"` for daily
  runs and `"SPATIAL · CLASSIC"` for standard runs. Previously used a broken
  colon-split fallback. Date parsing uses `T00:00:00` suffix to force local-time
  interpretation and avoid off-by-one in negative-UTC-offset timezones.

### Added
- **Streak & habit loop** (schema v5):
  - `currentStreak`, `longestStreak`, `lastRunDate` added to `SavedProfile`; v4→v5
    migration sets all three to zero/null so existing players start a fresh streak
    from today without losing any other data.
  - `recordStreakForToday()` in `save.ts` — idempotent (safe to call multiple times
    in one day), handles first run, continuation, and gap-day reset. Returns
    `StreakResult` with `isNewRecord` and `isMilestone` flags.
  - Milestone titles: on days 3, 7, 14, 30, 60, 100 the results-screen `#end-title`
    is overridden to `"N-DAY STREAK"` in `var(--combo)` gold.
  - `#streak-line` in the results screen shows `"N-day streak"` (hidden on day 1);
    turns `var(--correct)` green when a new personal best is set.
  - `#daily-nudge` below the leaderboard panel: tells the player whether the Daily
    Calibration is still available or already done, always visible after a run.
  - Streak badge in the stats bar (`N🔥`) when `currentStreak ≥ 2`.
  - Operator Log modal shows two new stat boxes: Current Streak and Best Streak.
  - Two new smoke tests: streak increments from yesterday's run; streak resets after
    a gap day while preserving `longestStreak`. Tests use `__signal.getCubeScreenPos`
    to click a guaranteed-wrong tile (deterministic game-over, no timer dependency).
- **Leaderboard UI** (wired end-to-end on the results screen):
  - First-run display name prompt: `#display-name-modal` appears after the first game
    ends. Player enters a callsign (1–20 chars); Skip skips the name and suppresses
    score submission. Name is stored in `profile.display_name` and never prompted again.
  - Score auto-submitted to Supabase via `submitScore()` (fire-and-forget) after each
    run, but only when a display name has been set.
  - Leaderboard panel (`#leaderboard-panel`) rendered inside the results screen below
    the SIGNAL payout. Shows skeleton rows immediately, fills with live board data once
    the fetch resolves. Handles network failures silently (shows error text, never crashes).
  - Player's own row highlighted in `var(--active)` with a left-border accent.
  - Board key is mode-specific (`mode:spatial:classic`) or `daily:YYYY-MM-DD` for the
    daily calibration run.
  - Skeleton animation respects `isReducedMotion()` — static bars when reduced motion
    is on.
  - `window.__signal.leaderboard` debug shim removed now that the UI is wired.
  - `LeaderboardRow` interface added to `types.ts`; `fetchBoard()` updated to select
    `created_at` and expose it as `achieved_at`.
- **Leaderboard data layer** (backend plumbing, no UI yet):
  - `@supabase/supabase-js` installed; lazy `getClient()` in `src/lib/supabase.ts` —
    throws a clear error only when actually called, so the game runs fine without env vars.
  - `supabase/schema.sql`: `leaderboard_scores` table with RLS, public SELECT policy,
    post-May-2026 Data API grants, and a `submit_score` SECURITY DEFINER function that
    validates inputs and upserts only when the new score beats the stored one.
  - `src/game/leaderboard.ts`: `modeBoardKey()`, `dailyBoardKey()`, `submitScore()`,
    `fetchBoard()`, `setDisplayName()`. All network calls are wrapped in try/catch —
    leaderboard failures never crash the game.
  - Client-side profanity filter in `submitScore` (normalised string match); comment
    notes that the DB function is the authoritative place for stronger moderation.
  - `SCHEMA_VERSION` bumped to 4; `player_id` (stable UUID) and `display_name` added to
    `SavedProfile`; v3→v4 migration in `save.ts` generates a UUID for existing players.
  - `src/vite-env.d.ts` added to type `import.meta.env.VITE_SUPABASE_URL/ANON_KEY`.
  - `.env.example` added; `.gitignore` already covered `.env`.
  - `window.__signal.leaderboard` exposes `{submitScore, fetchBoard, modeBoardKey,
    dailyBoardKey, setDisplayName}` **temporarily** for console testing — to be removed
    once the leaderboard UI is built.

### Changed
- **Onboarding four-fix pass** (Phase 3c): four confirmed issues from real fresh-launch
  playtesting, all fixed in one pass:
  1. **Trigger point**: tutorial no longer fires on page load as a blocking interstitial.
     It now fires on the player's first Engage press — `start-btn` in `menu.ts` checks
     `hasSeenOnboarding` and routes to `startOnboarding()` or `initGame()` accordingly.
     The player has already made an active choice to play before being guided.
  2. **Wrong tile in Step 4** fully redesigned: wrong tap → briefly show the red-tile
     highlight (same visual as a real mistake, already provided by `handleMistake`) →
     display callout "That tile wasn't in the pattern. In a real run this ends your
     streak — here, try again." → reset board and re-flash the same pattern → let the
     player retry. After 2 failed attempts the correct tiles are revealed for 2.5 s
     and the tutorial auto-advances with "No problem — you'll get it in a real run."
     `onMistake` hook fully intercepts before any pacing logic so `gameOver`, camera
     shake, and `returnToMenu` never fire during the tutorial under any circumstance.
  3. **Skip button always visible**: was rendered below `#ob-card` in the DOM stacking
     order; added `z-index:2` to the skip button and `z-index:1` to `#ob-card` so the
     button is always reachable regardless of which card is displayed.
  4. **Step 4 routing to main menu**: root cause was #2 — the old single-shot `onMistake`
     resolved `roundEndP` immediately, fast-pathing through steps 5 and 6 to `finish()`
     which calls `returnToMenu()`. The retry loop eliminates this path: wrong taps now
     stay in Step 4 until success or the attempt ceiling is reached.
- **Onboarding redesign** (Phase 3b): replaced the hook-driven live-game tutorial
  with a fully script-driven, step-by-step flow. The board is now frozen and
  controlled at each beat — no live game timer runs underneath the tutorial.
  Six steps: Intro card → matrix introduction → controlled Observe flash (tiles
  flash at 600ms/400ms cadence) → live Execute with no timer (first tile tap
  dismisses the callout) → timer explanation with a visual stress-bar demo →
  final card. Both Skip and "Start Training" land on Standby via `returnToMenu()`.
  Fixes three playtesting issues: (1) the original flow was too passive and
  competed with live gameplay; (2) letting the timer expire during the final card
  triggered an immediate game-over; (3) skipping left the player on the main menu
  instead of Standby.
- `runLoop.ts`: added `onMistake` hook to `ObHooks` — fires at the start of
  `handleMistake` before any pacing logic, preventing camera shake / results
  screen / game-over during the tutorial. `levelComplete` now returns immediately
  after firing `onRoundEnd` when a tutorial hook was registered, preventing
  `startLevel()` from running underneath the tutorial UI.

### Removed
- **Chromatic protocol** cut after playtesting revealed it couldn't hold up
  under real use conditions. Two rounds of fixes (color contrast recompute in
  Oklch/CIELAB with CVD simulation; redundant shape cues per swatch) addressed
  individual symptoms but didn't fix the underlying issue: the colour-recall
  mechanic is hard to make accessible and legible at the same time. The board
  rotates freely during Execute, which means shape cues printed on flat swatches
  don't map cleanly to rotated 3D tiles, breaking the shape-as-fallback guarantee.
  Colour contrast was also only barely adequate (floor 5.5:1) without obvious
  headroom to improve further without sacrificing visual differentiation. Protocol
  removed cleanly: `CHROMATIC_COLORS` and `id: 'chromatic'` from `protocols.ts`,
  all picker/color-assignment logic from `runLoop.ts`, `setChromaticObserveColor`
  from `board.ts`, `chromaticColors`/`chromaticPending` from `state.ts`, and the
  `#chromatic-picker` DOM node from `index.html`. Custom Calibration is unaffected.

---

## [0.4.0] — 2026-06-20

### Added
- **Chromatic protocol** (Phase 2b): new cognitive protocol where each target tile
  lights up in one of N distinct colors during Observe, and the player must recall both
  position AND color during Execute. Tap a tile → color picker appears → tap the matching
  swatch. Wrong tile or wrong color = mistake via the existing `handleMistake()` path.
- **Fixed color set for Chromatic** (`CHROMATIC_COLORS` in `protocols.ts`): 5 colors
  (Amber, Cyan, Violet, Gold, Jade) chosen for maximum perceptual distinctiveness and
  CVD-safety (no pure red/green axis). 3 colors in play at level 1, scaling to 4 at
  level 4 and 5 at level 7. Explicitly does not use the player's Custom Calibration
  palette — the challenge must be color memory, not fighting a lucky/unlucky custom accent.
- **`setChromaticObserveColor()`** in `board.ts`: sets cube emissive to an arbitrary
  hex color, bypassing the theme-color lookup used by `setCubeState`. Needed so
  Chromatic observe tiles render in their fixed puzzle colors.
- **Interaction pattern rationale documented**: implemented tap-tile-then-color (Pattern A)
  over pre-select-color-then-tap (Pattern B). Pattern A keeps the tile-first interaction
  identical to every other protocol; the color picker is a confirmation step. Pattern B
  breaks the spatial-first mental model and creates awkward hand movement on mobile
  (reach to bottom for color strip, back up to board for tile). Pattern A is also easier
  to teach: "tap the tile, then pick its color."

### Changed
- Forge Reset button sits alongside the two colorblind preset buttons (same visual
  treatment, muted styling). Restores all 5 slots to Mono theme values.

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
