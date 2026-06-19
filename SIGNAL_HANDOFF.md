# SIGNAL — Handoff Spec for Claude Code

**Status:** Single-file prototype is feature-complete for v1 scope. This document is the
handoff brief for migrating it into a real project structure and pushing it from
"plays correctly" to "release-ready" — both engineering and design work.

**How to use this doc:** Phase 0 is mandatory and should be a standalone session before
anything else. Phases 1–3 can be separate Claude Code sessions/prompts. Each phase has
a "definition of done" — don't move to the next phase until the current one's done
criteria are actually verified, not just implemented.

---

## 0. Context: what exists today

`signal.html` is a single-file (~1,280 line) HTML/CSS/JS game using Three.js r128 for a
3D tile-based memory training game. No build step, no modules — everything is one
`<script>` tag with global state. It currently includes:

- **5 cognitive protocols**: Spatial, Sequential, Interference, Rhythm, 2-Back
- **3 pacing modes**: Classic (timer/permadeath), Zen (no timer, streak-based), Sprint (60s clock)
- **A combo system**: multiplier climbs in steps, drives score, particles, screen juice,
  haptics (intensity scaled down ~65% on detected touch devices, since a freeze-frame
  that reads as "punchy" on desktop reads as input lag on a touchscreen)
- **An economy**: "Signal" currency, earned per run, spent on "Calibrations" (themes)
- **A custom calibration ("Forge")**: RGB sliders → one accent color, currently the
  *only* color customization that exists
- **A daily challenge**: date-seeded protocol/pacing, once per day, separate scoring
- **A versioned save system**: `SaveSystem` object wrapping localStorage, schema-versioned,
  with corruption recovery and field backfill — already written to make a future backend
  swap a two-function change, not a rewrite
- **Visual systems**: bloom post-processing (UnrealBloomPass), custom fresnel rim
  lighting injected via `onBeforeCompile`, deltaTime-corrected animation loop

### Known fragile points (found via real usage, not theoretical)
These aren't hypothetical — each one actually broke in production-like conditions
during prototyping:

1. **Frame-rate-dependent animation** (fixed, but watch for regressions): all motion in
   the render loop was originally tied to frame count, not elapsed time. A webview
   rendering at a different effective rate than expected made the whole game visibly
   speed up or slow down. Now deltaTime-corrected, but any *new* animation code must
   follow the same pattern (multiply by `dt60`, don't add a bare constant per frame).
2. **Theme-switch silent staleness** (fixed): switching color calibrations only updated
   idle cubes if a stale `emissiveIntensity > 0` check happened to pass. Root cause was
   two different code paths (`createBoard` and `applyTheme`) each independently
   deciding what "idle state" should look like, instead of one shared function.
3. **Double render-loop race condition** (fixed): pausing while the app/tab was
   backgrounded and foregrounded could spin up two concurrent `requestAnimationFrame`
   loops fighting over the same scene state, producing a stuck/garbled frame. Root
   cause: two independent triggers (`animate()`'s self-rescheduling and a
   `visibilitychange` handler) both calling `requestAnimationFrame` without a shared
   "is a loop already running" flag.

**The pattern across all three**: single-file, single-scope code makes this class of
bug easy to introduce and hard to catch without actually running the game on a real
device. This is the single strongest argument for Phase 1 below.

---

## 1. Phase 0 — Project setup (do this first, as its own session)

**Goal:** get the existing game into a real project Claude Code can iterate on safely,
with zero behavior change. This phase adds no features and fixes no bugs — it's pure
scaffolding. Resist the urge to "improve things while you're in there."

### Prompt to give Claude Code:

```
I have a working single-file HTML/Three.js game (attached: signal.html) that I want
restructured into a proper Vite + TypeScript project, with no behavior change.

Use TypeScript with strict mode on (strict: true in tsconfig) — not just .ts file
extensions with loose typing. The whole point is catching shape-mismatch bugs at
compile time (we already hit one in production: a cube object was assumed by one
function to always have a userData.state field, but another code path created cubes
without setting it — TypeScript would have caught that at the call site instead of
needing a real device to surface it). Don't use `any` as an escape hatch except where
genuinely unavoidable (e.g. some loose Three.js r128 addon typings) — flag those
spots with a comment explaining why.

Requirements:

1. Split the single <script> block into modules by responsibility:
   - state.ts (game state: level, score, combo, pattern, etc.)
   - save.ts (the SaveSystem object — keep its public API identical, type the saved
     profile shape explicitly so a future schema migration is type-checked too)
   - audio.ts (playTone, haptic)
   - render/scene.ts (Three.js scene/camera/renderer/bloom/rim-light setup)
   - render/board.ts (createBoard, setCubeState, cube material logic)
   - render/loop.ts (the animate() render loop, startRenderLoop/stopRenderLoop)
   - game/protocols.ts (PROTOCOLS, PACINGS definitions + per-protocol logic)
   - game/runLoop.ts (initGame, startLevel, levelComplete, gameOver, handleMistake, processHit)
   - ui/menu.ts, ui/modals.ts, ui/hud.ts (DOM manipulation, split by screen)
   - input.ts (pointer/touch handlers)
   - main.ts (wires it all together, replaces window.onload)

2. Set up Vite for local dev (npm run dev) and a static build (npm run build) that
   outputs a single deployable bundle.

3. Add a playwright-based smoke test (tests/smoke.spec.ts) that: loads the page,
   clicks Engage, waits for the countdown, clicks through a full pattern via the
   actual pointer events (not calling internal functions directly), verifies level
   increments, verifies pause/resume doesn't break anything, and SPECIFICALLY
   reproduces the background/foreground-while-paused scenario from the changelog
   below to guard against that regression class permanently.

4. Do NOT change any game balance numbers, visual values, or behavior. This is a
   structural refactor only. After it's done, the game should look and play
   identically to signal.html.

5. Keep SaveSystem's localStorage key and schema exactly as-is so existing player
   saves aren't invalidated.

Known bug classes to specifically guard against in the test suite (see attached
CHANGELOG section for full detail): frame-rate-dependent animation, theme-switch
staleness, double-render-loop race conditions on visibility change.
```

**Definition of done:** `npm run dev` serves a game that is pixel-and-behavior
identical to `signal.html`, the playwright smoke test passes, and a human playtester
(you) confirms it feels the same before any further work happens.

---

## 2. Phase 1 — Hardening pass

**Goal:** make the foundation trustworthy before adding anything new. This is where
most of the "is it actually done" gap lives.

### Prompt to give Claude Code:

```
Now that SIGNAL is modularized, harden it:

1. Error boundaries: if WebGL2/WebGL isn't available, or the Three.js CDN fails to
   load, show a clear "your device/browser can't run this" message instead of a
   white screen. If the bloom postprocessing addon scripts fail to load (CDN issue),
   already falls back gracefully — extend that same defensive pattern anywhere else
   external scripts are loaded.

2. Add basic crash/error visibility: a lightweight client-side error logger
   (window.onerror + unhandledrejection) that at minimum logs to console in a
   structured way, with a TODO comment for wiring to a real telemetry endpoint
   later. I want to know what's breaking for real players without relying on
   screenshots.

3. Audit every setInterval/setTimeout/requestAnimationFrame call in the codebase for
   the same class of bug as the double-render-loop issue: anything that can be
   triggered twice without a guard, anything that doesn't clean up if interrupted
   mid-sequence (e.g., what happens if a player backgrounds the app mid-countdown,
   mid-levelComplete animation, or mid-cameraShake?). Write down what you find before
   fixing it.

4. Add a reduced-motion mode (respect prefers-reduced-motion media query at minimum,
   plus an explicit in-game toggle) that disables camera drift, grid scroll, and
   screen shake. Some players will find the current motion uncomfortable.

5. Performance pass: profile actual frame time on a mid-tier mobile device (or
   simulate via Chrome DevTools CPU throttling at 4x-6x) during an active Sprint-mode
   run with particles active. Bloom is the most likely cost center — if it's
   expensive, make resolution/quality scale based on a detected device tier rather
   than being fixed.

Write a short report of what you found and fixed before moving on — I want to know
which of these were real vs. precautionary.
```

**Definition of done:** you can background/foreground the app at any point in the game
loop (countdown, mid-pattern, paused, mid-animation) without it breaking, a low-end
device doesn't drop frames noticeably during Sprint mode, and there's no scenario that
white-screens instead of failing gracefully.

---

## 3. Phase 2 — The two color systems

These are two different features. Keep them architecturally separate even though
they'll share a color picker UI component.

### 3.1 — Custom Calibration (player preference, not gameplay)

**What it is:** the existing RGB-slider "Forge" already does roughly this — it sets one
accent color. What's missing is treating it as a *complete* palette, not just an accent.

**Spec:**
- Player can set a full custom palette: base/idle cube color, active flash color,
  correct color, wrong/decoy color, background color — not just one accent that
  everything derives from.
- This is a **standing preference**, not a per-session seed: set once in
  Settings/Calibrate, applies to every game mode until changed.
- Decide and implement clearly: is it free from the start, or an unlock (e.g., after
  first completed run, or via Signal currency like the other calibrations)? Either is
  fine — just be deliberate, don't leave it ambiguous.
- Include a colorblind-safe preset or two (deuteranopia/protanopia-friendly) as
  selectable starting points the player can then further customize from, not just a
  blank slate. This serves both the accessibility need and the "I want my own
  scheme" desire with one system.
- Validate contrast: if a player picks a base color too close to their background
  color, warn them or auto-adjust — don't let them accidentally make the game
  unplayable.

### 3.2 — Chromatic Protocol (new gameplay mode, color is part of the puzzle)

**What it is:** a genuinely new cognitive task, not a reskin. Position-only recall is
what Spatial/Sequential already test. This protocol adds color as a second memory
dimension — the player must recall *which tile* AND *what color it was*, increasing
working-memory load in a way that's actually validated in cognitive training research
(feature-binding tasks, not just span tasks).

**Spec:**
- During the Observe phase, each target tile in the pattern lights up in one of N
  distinct colors (start with 3, scale with difficulty like grid size does) instead
  of the single uniform "active" color every other protocol uses.
- During Execute, the player must tap each tile AND select the color it showed —
  simplest UI: tap the tile, then a small color-swatch picker appears for that tile,
  player taps the matching swatch. (Open question for implementation: is
  tile-then-color two separate taps, or can swatches be pre-selected and tiles
  confirm on tap? Prototype both, see which feels better — don't guess, test.)
- Wrong tile OR wrong color = mistake, same handleMistake() path as other protocols.
- This is a genuine point of differentiation from every competitor in this genre (see
  competitive note below) — it should get real visual/audio polish, not be a
  bolt-on. Worth its own juice pass once the core loop works.
- Does NOT use the player's Custom Calibration palette for the puzzle colors — those
  need to be a fixed, maximally-distinguishable set (so the challenge is memory, not
  fighting an unlucky color choice). Player's custom palette still applies to
  everything else (board base color, UI, etc.) during this mode.

**Definition of done for Phase 2:** both systems exist independently, a player can
have a fully custom calibration AND play Chromatic mode, and the two don't interfere
with each other (Chromatic's puzzle colors stay legible regardless of equipped
calibration).

---

## 4. Phase 3 — Retention & differentiation features

Prioritized by impact, not effort. Don't build all of these before shipping — pick the
top 2-3 and ship, see what actually gets used.

1. **Real leaderboards.** The daily challenge has no point without a shared
   leaderboard — right now it's solitaire with extra steps. Needs a real backend;
   the SaveSystem abstraction was specifically built so this swap is two functions,
   not a rewrite (`SaveSystem.load`/`SaveSystem.persist`).
2. **Onboarding.** First launch currently drops the player into "Standby / Set
   protocol, then engage" with zero explanation of what a protocol or pacing is.
   Needs a short, skippable first-run flow — show, don't tell (let them play one
   guided Spatial round before exposing the full menu).
3. **Session/streak structure.** Beyond the daily badge, there's no habit loop —
   no "you've played 5 days running," no return-tomorrow hook. This is what makes
   brain-training apps sticky; right now SIGNAL has the mechanics but not the
   wrapper.
4. **Accessibility pass**, building on the colorblind presets from §3.1: reduced
   motion (Phase 1), screen reader labels on menu buttons at minimum.

---

## 5. Competitive context (why this matters, keep referencing it)

This genre is crowded and largely stagnant. Direct competitors (Human Benchmark's
spatial recall — itself based on the 1972 Corsi Block-Tapping neuropsychological
test — plus numerous direct clones across the App Store and Google Play) are
overwhelmingly flat 2D tile UIs: watch tiles flash, tap them back, grid grows. Most
offer exactly one game mode.

**SIGNAL's actual differentiation, in priority order:**
1. **Production values.** Real 3D board, bloom, rim lighting, combo juice, haptics.
   Nothing else in this genre looks or feels like this. Don't dilute this lead by
   deprioritizing polish in favor of feature count.
2. **Breadth of validated cognitive tasks in one app.** 5 protocols × 3 pacings is
   already more than any competitor found. 2-Back specifically is the most
   research-validated working-memory task in the cognitive training literature —
   worth calling out explicitly in any marketing/store copy, not just leaving as
   "protocol #5."
3. **Chromatic protocol (once built).** No competitor found does color-as-memory-target.
   This is a genuine first, not a reskin — protect that by giving it real design
   attention rather than shipping it as a quick variant.
4. **What's still missing vs. the genre baseline:** leaderboards (most competitors
   already have this — it's table stakes, not a differentiator, so Phase 3 item #1
   is closing a gap, not creating an edge).

**Positioning takeaway:** don't market this as "another memory game." Market it as
the only one of these that's actually fun to look at and has more than one trick.

---

## 6. Things explicitly out of scope for now

Listed so Claude Code doesn't scope-creep into them unprompted:
- More protocols beyond Chromatic (5 → 6 is plenty until the existing ones are proven)
- Multiplayer/real-time competitive modes
- Native app wrapper (Capacitor/etc.) — stay web-first until the web version is solid
- Monetization beyond the existing cosmetic-currency model
