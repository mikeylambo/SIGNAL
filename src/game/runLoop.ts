import * as THREE from 'three';
import { state, endRun } from '../state';
import { PROTOCOLS, PACINGS } from './protocols';
import { cubes, setCubeState, setCubeChannelTint, createBoard } from '../render/board';
import { camera, spawnParticles, adjustCameraForViewport } from '../render/scene';
import { loopState, cameraShake, flashScreen, resetPivotRotation } from '../render/loop';
import { playTone, playChannelTone, haptic, initAudio } from '../audio';
import { startGameplayAudio, stopGameplayAudio, spatialPan } from '../audioUnlocks';
import { addSignal, recordRun, t, profile, saveProfile } from '../save';
import { recordActivity, recordDailyCompletion, type DailyStreakResult } from '../streaks';
import { recordProtocolRun, rankNumeral, rankTitle, rankProgress, type MasteryResult } from '../progression';
import { showMessage, updateComboUI, resetCombo, spawnScorePopup, updateTimerUI, updateStatsUI, renderStatsBar } from '../ui/hud';
import { delay } from '../utils';
import { announceFlash, announcePhase, resetKeyboardCursor } from '../keyboard';
import { track } from '../telemetry';
import { activeModifier, assignChromaticChannels, channelFor, modifierBoardSuffix, CHROMATIC_CHANNELS } from './modifiers';
import { submitScore, modeBoardKey, dailyBoardKey } from './leaderboard';
import { promptDisplayName, showLeaderboardPanel, showLeaderboardSkeleton } from '../ui/leaderboard';

// isTouchDevice / hitstopScale — duplicated from input.ts to avoid circular deps
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const hitstopScale = isTouchDevice ? 0.35 : 1;

// Lazy import of showResultsScreen to break the circular chain
let _showResultsScreen: (() => void) | null = null;
export function registerShowResultsScreen(fn: () => void): void {
  _showResultsScreen = fn;
}

let _returnToMenu: (() => void) | null = null;
export function registerReturnToMenu(fn: () => void): void {
  _returnToMenu = fn;
}

// Onboarding hooks — set by startOnboardingRound() below for the single guided
// tutorial round, cleared immediately after firing so they never affect normal gameplay.
type ObHooks = {
  onObserve?: () => void;
  onExecute?: () => void;
  onRoundEnd?: () => void;
  // Intercepts handleMistake before any pacing logic fires (gameOver / zen restart).
  // Return early prevents camera shake, results screen, etc. during the tutorial.
  onMistake?: () => void;
};
let _ob: ObHooks = {};
export function setOnboardingHooks(h: ObHooks): void { _ob = h; }
export function clearOnboardingHooks(): void { _ob = {}; }

/**
 * True once `runId` no longer identifies the active run — i.e. the player
 * aborted to the menu, died, or started a new run while this async step was
 * still awaiting. Every await in a gameplay sequence must re-check this before
 * touching state or the DOM; otherwise an abandoned run keeps driving the game
 * (an aborted 2-Back stream, for instance, used to run to completion in the
 * background and throw a game-over screen over the main menu seconds later).
 */
function isStale(runId: number): boolean {
  return state.runId !== runId;
}

export async function runCountdown(runId: number = state.runId): Promise<void> {
  // Counts only unpaused time toward `ms`, so pausing mid-countdown freezes it
  // rather than letting the pause duration count as elapsed.
  async function pauseAwareDelay(ms: number): Promise<void> {
    let remaining = ms;
    let last = performance.now();
    while (remaining > 0) {
      await delay(16);
      if (isStale(runId)) return;
      const now = performance.now();
      if (!state.isPaused) remaining -= now - last;
      last = now;
    }
  }

  const countdownEl = document.getElementById('countdown-overlay')!;
  countdownEl.style.opacity = '1';
  for (let i = 3; i > 0; i--) {
    while (state.isPaused) { await delay(50); if (isStale(runId)) return; }
    if (isStale(runId)) { countdownEl.style.opacity = '0'; return; }
    countdownEl.innerText = String(i);
    countdownEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
    playTone('tick');
    await pauseAwareDelay(100);
    countdownEl.style.transform = 'translate(-50%, -50%) scale(1)';
    await pauseAwareDelay(700);
    if (isStale(runId)) { countdownEl.style.opacity = '0'; return; }
  }
  while (state.isPaused) { await delay(50); if (isStale(runId)) return; }
  countdownEl.innerText = 'GO';
  countdownEl.style.color = 'var(--correct)';
  playTone('go');
  await pauseAwareDelay(500);
  countdownEl.style.opacity = '0';
  countdownEl.style.color = 'var(--active)';
}

// Longest single frame gap the timer will bill the player for. rAF stops
// firing while a tab is hidden but its timestamps keep tracking wall-clock, so
// an unclamped delta charges the entire backgrounded duration to the run the
// instant it resumes — a 6s app-switch used to drain 6.5s off the clock and
// end the run on return. Backgrounding also auto-pauses now (see pauseGame in
// ui/modals.ts); this clamp is the backstop for the frame already in flight,
// and it makes a genuinely slow device run the clock slow rather than skip it.
const MAX_TIMER_FRAME_MS = 100;

export function runTimer(timestamp: number): void {
  if (!state.timerActive || state.isPaused) return;
  const delta = Math.min(timestamp - state.lastFrameTime, MAX_TIMER_FRAME_MS);
  state.lastFrameTime = timestamp;
  state.timeLeft -= delta;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    updateTimerUI();
    gameOver('TIME EXPIRED');
    return;
  }
  updateTimerUI();
  state.timerAnimationId = requestAnimationFrame(runTimer);
}

export function stopTimer(): void {
  state.timerActive = false;
  if (state.timerAnimationId) cancelAnimationFrame(state.timerAnimationId);
  state.timerAnimationId = 0;
}


// ── Onboarding round ───────────────────────────────────────────────────────────
// Mirrors initGame() but forces Spatial/Classic/Level 1, skips signal and stats,
// and sets state.isOnboarding so results screen shows the "Enter SIGNAL →" CTA.
// initGame() is NOT modified.

// Re-entrancy guard: profile.hasSeenOnboarding only flips to true once the whole
// tutorial finishes, so without this a second tap on "How to Play" (easy to do on
// mobile — createBoard() below does synchronous Three.js work with no loading
// feedback) starts a second concurrent run. Both runs then share the same
// module-level _stepResolve/done/_ob and the same DOM element IDs, which is what
// produces "screen doesn't clear" / "button doesn't advance" / needing to relaunch
// the app to get back to a clean state. Set synchronously, before any await, so
// there's no gap for a second call to slip through.
let _onboardingRunning = false;

export async function startOnboardingRound(): Promise<void> {
  if (profile.hasSeenOnboarding || _onboardingRunning) return;
  _onboardingRunning = true;

  initAudio();

  const spatialIdx = PROTOCOLS.findIndex(p => p.id === 'spatial');
  const classicIdx = PACINGS.findIndex(p => p.id === 'classic');
  if (spatialIdx >= 0) state.curProtIdx = spatialIdx;
  if (classicIdx >= 0) state.curPaceIdx = classicIdx;
  state.isOnboarding = true;
  state.isDailyRun   = false;

  const uiLayer            = document.getElementById('ui-layer')!;
  const gameplayHud        = document.getElementById('gameplay-hud') as HTMLElement;
  const stressBarContainer = document.getElementById('stress-bar-container')!;
  const stressBar          = document.getElementById('stress-bar')!;

  (document.getElementById('results-screen') as HTMLElement).style.display = 'none';
  uiLayer.style.display = 'flex';
  uiLayer.style.opacity = '1';
  (document.getElementById('menu-sheet')    as HTMLElement).style.display = 'none';
  (document.getElementById('controls-hint') as HTMLElement).style.display = 'none';
  (document.getElementById('menu-topbar')   as HTMLElement).style.display = 'none';
  gameplayHud.style.display = 'flex';
  adjustCameraForViewport();

  resetPivotRotation();
  state.level = 1; state.score = 0; state.streak = 0; state.maxStreak = 0;
  state.mistakes = 0; state.clears = 0; state.earnedFragments = 0;
  state.combo = 0; state.maxCombo = 0;
  state.gridSize = 3; state.activeCount = 3; state.nBackActive = false;
  state.userClicks  = [];
  state.isPlayable  = false;

  updateComboUI();
  renderStatsBar();
  stressBarContainer.style.display = 'none';

  createBoard();
  startGameplayAudio();

  // ── Shared state ──────────────────────────────────────────────────────────
  let done = false;
  let _stepResolve: (() => void) | null = null;

  const showCard = (html: string): HTMLElement => {
    document.getElementById('ob-card')?.remove();
    const card = document.createElement('div');
    card.id = 'ob-card';
    card.style.cssText = [
      'position:fixed;inset:0;z-index:200;',
      'display:flex;align-items:center;justify-content:center;',
      'background:rgba(5,8,13,0.85);backdrop-filter:blur(8px);',
    ].join('');
    card.innerHTML = html;
    document.body.appendChild(card);
    return card;
  };
  const removeCard = () => document.getElementById('ob-card')?.remove();

  const showCallout = (msg: string): void => {
    document.getElementById('ob-callout')?.remove();
    const el = document.createElement('div');
    el.id = 'ob-callout';
    el.style.cssText = [
      'position:fixed;bottom:320px;left:0;right:0;z-index:150;',
      'display:flex;justify-content:center;pointer-events:none;',
    ].join('');
    el.innerHTML =
      '<div style="background:rgba(5,8,13,0.88);border:1px solid rgba(255,255,255,0.1);' +
      'border-radius:4px;padding:10px 18px;font-family:var(--font-mono);font-size:0.75rem;' +
      'color:var(--text-muted);letter-spacing:0.5px;text-align:center;max-width:280px;">' +
      msg + '</div>';
    document.body.appendChild(el);
  };
  const removeCallout = () => document.getElementById('ob-callout')?.remove();

  document.getElementById('ob-skip-btn')?.remove();
  const skipBtn = document.createElement('button');
  skipBtn.id = 'ob-skip-btn';
  skipBtn.textContent = 'Skip tutorial';
  // Measure the HUD's actual rendered height rather than guessing a fixed
  // offset — a hardcoded top:24px happened to land inside the HUD's own
  // vertical band (HUD height is ~52px + the safe-area inset), which is what
  // caused "Lv 1 · Pts 10" to overlap the skip button's left edge.
  const hudBottom = gameplayHud.getBoundingClientRect().bottom;
  skipBtn.style.cssText = [
    // width:auto is required here — the global `button` rule sets width:100%,
    // and with position:fixed + only `right` set that stretches this into a
    // full-viewport-width bar that overlaps whatever's under it.
    `position:fixed;top:${hudBottom + 12}px;right:calc(18px + var(--sar, 0px));z-index:300;width:auto;`,
    'padding:8px 16px;font-family:var(--font-mono);font-size:0.68rem;',
    'letter-spacing:1.5px;background:none;',
    'border:1px solid rgba(255,255,255,0.2);',
    'color:rgba(255,255,255,0.4);border-radius:2px;cursor:pointer;',
  ].join('');
  document.body.appendChild(skipBtn);

  const finish = (completed: boolean): void => {
    if (done) return;
    done = true;
    _onboardingRunning = false;
    removeCard();
    removeCallout();
    skipBtn.remove();
    clearOnboardingHooks();
    state.isPlayable = false;
    profile.hasSeenOnboarding      = true;
    profile.hasCompletedOnboarding = completed;
    saveProfile();
    stopGameplayAudio();
    _stepResolve?.();

    if (!completed) {
      // Skipping goes straight back to the menu — no results for a run the
      // player opted out of.
      state.isOnboarding = false;
      _returnToMenu?.();
      return;
    }

    // Finishing the tutorial hands off to the results screen, which has a
    // dedicated onboarding path (zero signal, no Run Again, an "Enter SIGNAL →"
    // CTA instead of Menu). That path — along with #enter-signal-btn and its
    // listener in modals.ts — was fully built but unreachable, because this
    // function used to return to the menu directly in both cases.
    // state.isOnboarding stays true so showResultsScreen picks that path; the
    // Enter SIGNAL handler clears it.
    (document.getElementById('end-title') as HTMLElement).innerText = 'CALIBRATION COMPLETE';
    (document.getElementById('end-title') as HTMLElement).style.color = 'var(--correct)';
    _showResultsScreen?.();
  };

  skipBtn.addEventListener('click', () => finish(false));

  // ── Step 1 — Intro card ───────────────────────────────────────────────────
  await new Promise<void>(resolve => {
    _stepResolve = resolve;
    const card = showCard(
      '<div style="background:rgba(5,8,13,0.95);border:1px solid rgba(255,255,255,0.1);' +
      'border-radius:6px;padding:36px 44px;text-align:center;max-width:300px;">' +
      '<div style="font-family:var(--font-display);font-size:1.5rem;font-weight:800;' +
      'letter-spacing:4px;color:var(--active);margin-bottom:12px;">SIGNAL</div>' +
      '<div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text-muted);' +
      'line-height:1.7;letter-spacing:0.5px;margin-bottom:24px;">' +
      'A memory training game.<br>Watch the pattern. Reproduce it.</div>' +
      '<button id="ob-next-1" style="background:var(--active);color:#001016;border:none;' +
      'border-radius:3px;padding:12px 28px;font-family:var(--font-display);' +
      "font-size:0.85rem;font-weight:800;letter-spacing:2px;cursor:pointer;\">Let's go \u2192</button></div>",
    );
    card.querySelector('#ob-next-1')!.addEventListener('click', () => {
      _stepResolve = null; removeCard(); resolve();
    });
  });
  if (done) return;

  // ── Step 2 — Matrix introduction ──────────────────────────────────────────
  showCard(
    '<div style="background:rgba(5,8,13,0.9);border:1px solid rgba(255,255,255,0.08);' +
    'border-radius:6px;padding:24px 32px;text-align:center;max-width:260px;">' +
    '<div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text);' +
    'letter-spacing:0.5px;line-height:1.6;">' +
    'This is your grid.<br>Tiles will flash \u2014 remember which ones.</div></div>',
  );
  await new Promise<void>(resolve => {
    _stepResolve = resolve;
    setTimeout(() => { _stepResolve = null; resolve(); }, 2500);
  });
  removeCard();
  if (done) return;

  // ── Step 3 — Controlled Observe flash ────────────────────────────────────
  showCallout('Watch carefully.');
  await delay(600);
  if (done) return;

  const patternSize = state.activeCount;
  // The board is a flat gridSize x gridSize grid (see createBoard()'s x/z loop) —
  // gridSize² valid indices, not gridSize³. Using the cubed formula here meant
  // roughly 2 out of 3 random picks landed on an index with no real cube behind
  // it: it silently never flashed during Observe (cubes[idx] was undefined) and
  // could never be tapped during Execute either, so the round could only ever
  // complete by pure luck — otherwise it hung forever waiting for a tap on a
  // tile that was never on the board.
  const totalCubes  = state.gridSize * state.gridSize;
  const pattern: number[] = [];
  while (pattern.length < patternSize) {
    const idx = Math.floor(Math.random() * totalCubes);
    if (!pattern.includes(idx)) pattern.push(idx);
  }
  state.pattern = pattern;

  for (const idx of pattern) {
    if (done) break;
    const cube = cubes[idx];
    if (cube) {
      setCubeState(cube, 'active');
      playTone('active', spatialPan(idx));
      await delay(600);
      setCubeState(cube, 'base');
      if (done) break;
      await delay(400);
    }
  }
  removeCallout();
  if (done) return;

  // ── Step 4 — Live Execute (no timer) ─────────────────────────────────────
  let retryCount = 0;
  const MAX_RETRIES = 2;

  await new Promise<void>(resolve => {
    _stepResolve = resolve;
    if (done) { resolve(); return; }

    showCallout('Now tap them back.<br>First tile dismisses this message.');
    state.userClicks = [];
    state.isPlayable = true;

    const canvas = document.getElementById('canvas-container');
    const onFirstTap = () => removeCallout();
    canvas?.addEventListener('pointerdown', onFirstTap, { once: true });

    // handleMistake() clears onboarding hooks (_ob) before calling onMistake, by
    // design, so a real in-progress mistake can't accidentally re-trigger itself.
    // That means retry() MUST re-register hooks every time it hands control back
    // to the player — otherwise the next tap (whether it's another mistake or the
    // completing correct tap) finds no onMistake/onRoundEnd hook, falls through
    // into normal (non-tutorial) game-over/level-complete logic, and this Step 4
    // promise — which only resolves via one of those two hooks — never resolves.
    // That's the "tutorial just hangs, but I can still drag the camera" bug.
    const registerHooks = (): void => {
      setOnboardingHooks({
        onMistake: () => { void retry(); },
        onRoundEnd: () => {
          clearOnboardingHooks();
          canvas?.removeEventListener('pointerdown', onFirstTap);
          removeCallout();
          _stepResolve = null;
          resolve();
        },
      });
    };

    const retry = async () => {
      retryCount++;
      state.isPlayable = false;
      canvas?.removeEventListener('pointerdown', onFirstTap);
      if (done) { resolve(); return; }

      if (retryCount >= MAX_RETRIES) {
        showCallout("No problem \u2014 you'll get it in a real run.");
        for (const idx of pattern) { const cube = cubes[idx]; if (cube) setCubeState(cube, 'correct'); }
        await delay(2500);
        if (done) { resolve(); return; }
        for (const idx of pattern) { const cube = cubes[idx]; if (cube) setCubeState(cube, 'base'); }
        clearOnboardingHooks();
        removeCallout();
        _stepResolve = null;
        resolve();
        return;
      }

      removeCallout();
      showCallout("That tile wasn't in the pattern.<br>In a real run this ends your streak \u2014 try again.");
      await delay(1800);
      if (done) { resolve(); return; }
      removeCallout();
      showCallout('Watch again\u2026');

      for (const idx of pattern) {
        if (done) break;
        const cube = cubes[idx];
        if (cube) {
          setCubeState(cube, 'active');
          playTone('active', spatialPan(idx));
          await delay(600);
          setCubeState(cube, 'base');
          if (done) break;
          await delay(400);
        }
      }
      if (done) { resolve(); return; }
      removeCallout();
      showCallout('Now try again.');
      state.userClicks = [];
      state.isPlayable = true;
      canvas?.addEventListener('pointerdown', onFirstTap, { once: true });
      registerHooks();
    };

    registerHooks();
  });
  if (done) return;
  state.isPlayable = false;

  // ── Step 5 — Timer explanation ────────────────────────────────────────────
  stressBarContainer.style.display = 'block';
  stressBar.style.width = '100%';
  stressBar.style.backgroundColor = 'var(--active)';
  showCallout('In Classic mode, this is your lifeline.<br>Keep your streak alive before it runs out.');

  // Drain the demo bar with a single CSS transition rather than 61 chained
  // setTimeouts. The stepped version rendered at ~20fps and, more importantly,
  // took 61 timer round-trips to finish: under CPU contention (software WebGL
  // in CI, a mid-tier phone under load) those stretch badly, and a 3s animation
  // could take upwards of 15s — long enough that the tutorial looked hung.
  // One transition is smooth at display refresh rate and costs one timer.
  const DRAIN_MS = 3000;
  stressBar.style.transition = `width ${DRAIN_MS}ms linear`;
  stressBar.style.width = '0%';
  await delay(DRAIN_MS);
  stressBar.style.transition = '';  // restore the stylesheet's 0.1s gameplay easing
  stressBarContainer.style.display = 'none';
  removeCallout();
  if (done) return;

  // ── Step 6 — Final card ───────────────────────────────────────────────────
  await new Promise<void>(resolve => {
    _stepResolve = resolve;
    const card = showCard(
      '<div style="background:rgba(5,8,13,0.95);border:1px solid rgba(255,255,255,0.1);' +
      'border-radius:6px;padding:36px 44px;text-align:center;max-width:300px;">' +
      '<div style="font-family:var(--font-display);font-size:1.1rem;font-weight:800;' +
      "letter-spacing:3px;color:var(--correct);margin-bottom:12px;\">You're ready.</div>" +
      '<div style="font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);' +
      'line-height:1.7;letter-spacing:0.5px;margin-bottom:24px;">' +
      'Five protocols. Three pacing modes.<br>One leaderboard. Go find your ceiling.</div>' +
      '<button id="ob-next-6" style="background:var(--active);color:#001016;border:none;' +
      'border-radius:3px;padding:12px 28px;font-family:var(--font-display);' +
      'font-size:0.85rem;font-weight:800;letter-spacing:2px;cursor:pointer;">' +
      'Start Training \u2192</button></div>',
    );
    card.querySelector('#ob-next-6')!.addEventListener('click', () => {
      _stepResolve = null; removeCard(); resolve();
    });
  });
  if (done) return;

  finish(true);
}


export async function initGame(): Promise<void> {
  // Invalidate whatever run came before (results screen, aborted run, an
  // Observe sequence still awaiting) before setting up this one.
  endRun();
  const runId = state.runId;

  const today = new Date().toISOString().split('T')[0];
  recordActivity(today);
  track('run_start', {
    protocol: PROTOCOLS[state.curProtIdx].id,
    pacing: PACINGS[state.curPaceIdx].id,
    daily: state.isDailyRun,
  });

  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  const resultsScreen      = document.getElementById('results-screen')!;
  const uiLayer            = document.getElementById('ui-layer')!;
  const stressBarContainer = document.getElementById('stress-bar-container')!;
  const stressBar          = document.getElementById('stress-bar')!;
  const gameplayHud        = document.getElementById('gameplay-hud') as HTMLElement;

  resultsScreen.style.display = 'none';
  uiLayer.style.display = 'flex';
  uiLayer.style.opacity = '1';

  // Start any purchased gameplay audio layers
  startGameplayAudio();

  resetPivotRotation();

  // Fade menu sheet out over 200ms, then hide it
  const menuSheet = document.getElementById('menu-sheet') as HTMLElement;
  menuSheet.classList.add('menu-sheet-hiding');
  setTimeout(() => {
    menuSheet.style.display = 'none';
    menuSheet.classList.remove('menu-sheet-hiding');
    // Only now does menu-sheet.getBoundingClientRect() actually read 0 height —
    // recompute so the grid re-centers for gameplay instead of keeping whatever
    // offset was last calculated (which could be stale from the menu layout if
    // no resize event happened to fire in between).
    adjustCameraForViewport();
  }, 200);
  (document.getElementById('controls-hint') as HTMLElement).style.display = 'none';
  (document.getElementById('menu-topbar')   as HTMLElement).style.display = 'none';

  // Show gameplay HUD at opacity 0; transition to 1 after the 200ms menu fade
  gameplayHud.style.opacity = '0';
  gameplayHud.style.display = 'flex';

  state.level = 1; state.score = 0; state.streak = 0; state.maxStreak = 0;
  state.mistakes = 0; state.clears = 0; state.earnedFragments = 0;
  state.combo = 0; state.maxCombo = 0;
  updateComboUI();

  state.gridSize = 3; state.activeCount = 3; state.nBackActive = false;

  renderStatsBar();

  if (pPace.id === 'sprint') {
    // Sprint now applies to n-Back too: a 60s clock over a continuous stream.
    state.totalTime = 60000; state.timeLeft = 60000; state.timerActive = false;
    stressBarContainer.style.display = 'block';
    stressBar.style.width = '100%';
    stressBar.style.backgroundColor = 'var(--active)';
  } else if (pPace.id === 'zen' || pMode.id === 'nback') {
    // Classic n-Back has no per-level timer either — the stress bar would just
    // sit full and motionless, so it stays hidden.
    stressBarContainer.style.display = 'none'; state.timerActive = false;
  } else {
    stressBarContainer.style.display = 'block';
  }

  createBoard();
  await delay(200);
  if (isStale(runId)) return;
  gameplayHud.style.opacity = '1';  // fade HUD in (CSS transition: opacity 0.3s)
  await runCountdown(runId);
  if (isStale(runId)) return;

  if (pPace.id === 'sprint') {
    state.timerActive = true;
    state.lastFrameTime = performance.now();
    state.timerAnimationId = requestAnimationFrame(runTimer);
  }

  if (pMode.id === 'nback') startNBackLevel(runId);
  else startLevel(runId);
}

export async function startLevel(runId: number = state.runId): Promise<void> {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const stressBar = document.getElementById('stress-bar')!;

  state.isPlayable = false;
  state.userClicks = [];
  resetKeyboardCursor();
  updateStatsUI();
  pauseBtn.style.display = 'none';

  if (pPace.id === 'classic') {
    stopTimer();
    stressBar.style.width = '100%';
    stressBar.style.backgroundColor = 'var(--active)';
  }

  showMessage('Constructing', 'var(--text)');
  cubes.forEach(c => { setCubeState(c, 'base'); c.userData['targetY'] = 0; c.userData['targetScale'] = 1; });
  await delay(500);
  if (isStale(runId)) return;

  state.pattern = []; state.decoys = []; state.rhythmDelays = [];
  state.patternChannels = []; state.clickChannels = []; state.selectedChannel = 0;
  const totalTiles = state.gridSize * state.gridSize;
  while (state.pattern.length < state.activeCount) {
    const r = Math.floor(Math.random() * totalTiles);
    if (!state.pattern.includes(r)) state.pattern.push(r);
  }

  // Modifiers layer a second channel onto the same pattern rather than
  // replacing it, so everything above is untouched by which modifier is active.
  const mod = activeModifier();
  if (mod.id !== 'none') {
    state.patternChannels = assignChromaticChannels(state.pattern);
  }
  renderChannelSelector();

  if (pMode.id === 'interference') {
    let decoyCount = Math.floor(state.activeCount * 0.7) || 1;
    decoyCount = Math.min(decoyCount, totalTiles - state.pattern.length);
    while (state.decoys.length < decoyCount) {
      const r = Math.floor(Math.random() * totalTiles);
      if (!state.pattern.includes(r) && !state.decoys.includes(r)) state.decoys.push(r);
    }
  }

  showMessage('Observe', 'var(--active)');
  announcePhase('Observe. Watch the pattern.');
  _ob.onObserve?.();
  await delay(300);
  if (isStale(runId)) return;
  const speedMult = pPace.id === 'sprint' ? 0.6 : 1;

  // The Observe sequence must survive a pause rather than abandon the level:
  // bailing out here used to leave the run with isPlayable false and no path
  // back into Execute, so a pause landing mid-flash soft-locked the round.
  const awaitUnpaused = async (): Promise<boolean> => {
    while (state.isPaused) {
      await delay(100);
      if (isStale(runId)) return false;
    }
    return true;
  };

  if (pMode.id === 'interference') {
    state.pattern.forEach(i => { setCubeState(cubes[i], 'active'); announceFlash(i, 'active'); });
    state.decoys.forEach(i => { setCubeState(cubes[i], 'decoy'); announceFlash(i, 'decoy'); });
    playTone('active', spatialPan(state.pattern[0] ?? 0)); playTone('decoy');
    await delay(1200 * speedMult);
    if (isStale(runId) || !(await awaitUnpaused())) return;
    cubes.forEach(c => setCubeState(c, 'base'));
  } else {
    for (let i = 0; i < state.pattern.length; i++) {
      if (!(await awaitUnpaused())) return;
      const flashIdx = state.pattern[i];
      const channel = mod.id === 'none' ? null : channelFor(state.patternChannels[i] ?? 0);

      if (mod.id === 'resonant') {
        // Resonant deliberately shows nothing: position comes from the stereo
        // field and colour from pitch, so the tile itself never lights.
        playChannelTone(channel!.semitone, spatialPan(flashIdx));
        playTone('active', spatialPan(flashIdx));
        announceFlash(flashIdx, 'active');
      } else {
        if (channel) setCubeChannelTint(cubes[flashIdx], channel.num);
        setCubeState(cubes[flashIdx], 'active');
        announceFlash(flashIdx, 'active');
        if (channel) playChannelTone(channel.semitone, spatialPan(flashIdx));
        else playTone('active', spatialPan(flashIdx));
      }
      let pause = 200 * speedMult;
      if (pMode.id === 'rhythm') {
        const options = [200, 400, 600];
        pause = options[Math.floor(Math.random() * options.length)] * speedMult;
        state.rhythmDelays.push(pause);
      }
      await delay(pause);
      if (isStale(runId)) return;
      // Clear the tint before returning to base so no idle tile keeps a
      // channel colour after its flash.
      setCubeChannelTint(cubes[flashIdx], null);
      setCubeState(cubes[flashIdx], 'base');
      await delay(150 * speedMult);
      if (isStale(runId)) return;
    }
  }

  if (!(await awaitUnpaused())) return;
  showMessage('Execute', 'var(--text)');
  announcePhase('Execute. Reproduce the pattern.');
  _ob.onExecute?.();
  state.isPlayable = true;
  state.lastClickTime = 0;
  pauseBtn.style.display = 'flex';
  state.levelTimeStart = Date.now();

  if (pPace.id === 'classic') {
    state.totalTime = Math.max(3000, 5000 + (state.pattern.length * 800) - (state.level * 200));
    if (pMode.id === 'sequential' || pMode.id === 'rhythm') state.totalTime += 2000;
    state.timeLeft = state.totalTime;
    state.timerActive = true;
    state.lastFrameTime = performance.now();
    state.timerAnimationId = requestAnimationFrame(runTimer);
  }
}

export async function startNBackLevel(runId: number = state.runId): Promise<void> {
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const stressBarContainer = document.getElementById('stress-bar-container')!;
  const pPace = PACINGS[state.curPaceIdx];

  // Claim this stream. Any previously running stream loop sees the token change
  // and exits rather than racing this one.
  const streamId = ++state.nBackStreamId;
  const streamStale = () => isStale(runId) || state.nBackStreamId !== streamId;

  state.isPlayable = true; state.nBackActive = true;
  // Sprint's 60s clock spans the whole run and must survive a stream restart;
  // Classic and Zen n-Back have no timer at all, so the stress bar is hidden
  // rather than left sitting full and motionless.
  if (pPace.id !== 'sprint') {
    state.timerActive = false;
    stressBarContainer.style.display = 'none';
  }
  state.userClicks = [];
  updateStatsUI();
  pauseBtn.style.display = 'flex';
  cubes.forEach(c => { setCubeState(c, 'base'); c.userData['targetY'] = 0; c.userData['targetScale'] = 1; });
  showMessage('Stream Active', 'var(--text)');
  await delay(1000);
  if (streamStale()) return;

  const streamLength = 10 + state.level;
  state.nBackStream = [];
  for (let i = 0; i < streamLength; i++) {
    if (i >= 2 && Math.random() < 0.35) {
      state.nBackStream.push(state.nBackStream[i - 2]);
    } else {
      let r: number;
      do { r = Math.floor(Math.random() * (state.gridSize * state.gridSize)); }
      while (r === state.nBackStream[i - 2]);
      state.nBackStream.push(r);
    }
  }

  for (let i = 0; i < state.nBackStream.length; i++) {
    while (state.isPaused) { await delay(100); if (streamStale()) return; }
    if (!state.nBackActive || streamStale()) return;
    state.nBackStep = i;
    const idx = state.nBackStream[i];
    const isMatch = (i >= 2 && state.nBackStream[i] === state.nBackStream[i - 2]);
    let clickedDuringFlash = false;

    state.nBackIsFlashing = true;
    setCubeState(cubes[idx], 'active');
    announceFlash(idx, 'active');
    playTone('active', spatialPan(idx));

    const waitTime = Math.max(600, 1200 - (state.level * 50));
    // Pause time must not count toward the flash window, otherwise pausing
    // during a flash silently burns the player's whole reaction window.
    let elapsed = 0;
    let last = Date.now();
    while (elapsed < waitTime) {
      if (!state.nBackActive || streamStale()) return;
      if (state.isPaused) { await delay(100); last = Date.now(); continue; }
      await delay(20);
      const now = Date.now();
      elapsed += now - last;
      last = now;
      if (state.userClicks.includes(i)) { clickedDuringFlash = true; break; }
    }

    if (streamStale()) return;
    state.nBackIsFlashing = false;
    setCubeState(cubes[idx], 'base');
    if (isMatch && !clickedDuringFlash) { handleMistake(cubes[idx], 'MISSED'); return; }
    await delay(300);
    if (streamStale()) return;
  }
  if (state.nBackActive && !streamStale()) levelComplete();
}

/**
 * Restarts the n-Back stream after a non-fatal mistake (Zen and Sprint). Bumping
 * the stream token first guarantees the loop that just failed is retired before
 * its replacement starts.
 */
function restartNBackStream(runId: number, delayMs: number): void {
  state.nBackActive = false;
  state.isPlayable = false;
  state.nBackStreamId++;
  setTimeout(() => {
    if (isStale(runId)) return;
    createBoard();
    void startNBackLevel(runId);
  }, delayMs);
}

/**
 * Builds (or hides) the colour selector for the active modifier.
 *
 * Arming a colour and then tapping a tile keeps a tap to one gesture. The
 * alternative — tap tile, then pick colour — doubles every interaction in a
 * game whose Classic mode is on a countdown.
 */
export function renderChannelSelector(): void {
  const el = document.getElementById('channel-selector');
  if (!el) return;
  const mod = activeModifier();

  if (mod.id === 'none') {
    el.style.display = 'none';
    el.innerHTML = '';
    return;
  }

  el.style.display = 'flex';
  el.innerHTML = '';
  CHROMATIC_CHANNELS.forEach(ch => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'channel-chip';
    btn.dataset['channel'] = String(ch.id);
    btn.setAttribute('role', 'radio');
    btn.setAttribute('aria-checked', String(state.selectedChannel === ch.id));
    btn.setAttribute('aria-label', `${ch.name}, key ${ch.id + 1}`);
    btn.style.cssText =
      `width:auto;margin:0;padding:0;border-radius:4px;cursor:pointer;` +
      `width:38px;height:26px;background:${ch.hex};` +
      `border:2px solid ${state.selectedChannel === ch.id ? '#fff' : 'rgba(255,255,255,0.2)'};` +
      `box-shadow:${state.selectedChannel === ch.id ? `0 0 12px ${ch.hex}` : 'none'};`;
    btn.addEventListener('click', () => selectChannel(ch.id));
    el.appendChild(btn);
  });
}

export function selectChannel(id: number): void {
  state.selectedChannel = id;
  renderChannelSelector();
  const ch = channelFor(id);
  playChannelTone(ch.semitone);
  announcePhase(`${ch.name} selected`);
}

/**
 * The channel the pattern expects for a given board index. Spatial and
 * Interference accept any order, so the expected colour is whichever slot that
 * tile occupies in the pattern; ordered protocols use the current step.
 */
function expectedChannelFor(boardIndex: number): number {
  const pMode = PROTOCOLS[state.curProtIdx];
  const patternPos = (pMode.id === 'sequential' || pMode.id === 'rhythm')
    ? state.userClicks.length
    : state.pattern.indexOf(boardIndex);
  return state.patternChannels[patternPos] ?? 0;
}

export function handleInteraction(cube: THREE.Mesh): void {
  if (!state.isPlayable || state.isPaused) return;
  initAudio(); // ensure AudioContext exists; safe no-op if already initialised
  const pMode = PROTOCOLS[state.curProtIdx];
  const index = cube.userData['index'] as number;

  if (pMode.id === 'nback') {
    if (!state.nBackIsFlashing || state.userClicks.includes(state.nBackStep)) return;
    state.userClicks.push(state.nBackStep);
    const isMatch = (state.nBackStep >= 2 && state.nBackStream[state.nBackStep] === state.nBackStream[state.nBackStep - 2]);
    if (isMatch) processHit(cube, 1.5);
    else handleMistake(cube, 'WRONG TILE');
    return;
  }

  if (state.userClicks.includes(index)) return;
  let isCorrect = false;

  if (pMode.id === 'sequential' || pMode.id === 'rhythm') {
    if (index === state.pattern[state.userClicks.length]) isCorrect = true;
  } else {
    if (state.pattern.includes(index)) isCorrect = true;
  }

  // Under a modifier the tile must match on colour too. Checked after position
  // so a wrong-position tap still reports as a wrong tile rather than a wrong
  // colour, which would be misleading.
  if (isCorrect && activeModifier().id !== 'none') {
    if (state.selectedChannel !== expectedChannelFor(index)) {
      handleMistake(cube, 'WRONG COLOUR');
      return;
    }
  }

  if (isCorrect) {
    if (pMode.id === 'rhythm' && state.userClicks.length > 0) {
      const timeDelta = Date.now() - state.lastClickTime;
      const expectedDelta = state.rhythmDelays[state.userClicks.length - 1] + 150;
      if (Math.abs(timeDelta - expectedDelta) > 400) { handleMistake(cube, 'OFF RHYTHM'); return; }
    }
    state.userClicks.push(index);
    state.clickChannels.push(state.selectedChannel);
    state.lastClickTime = Date.now();
    processHit(cube, pMode.id === 'spatial' ? 1 : 1.5);

    if (state.userClicks.length === state.pattern.length) {
      state.isPlayable = false;
      const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
      pauseBtn.style.display = 'none';
      const pPace = PACINGS[state.curPaceIdx];
      if (pPace.id === 'classic') stopTimer();
      setTimeout(levelComplete, 400);
    }
  } else {
    handleMistake(cube, 'WRONG TILE');
  }
}

export function processHit(cube: THREE.Mesh, multiplier: number): void {
  state.combo++;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  const comboMult = Math.min(4, 1 + Math.floor(state.combo / 4) * 0.5);
  const gained = Math.floor(10 * comboMult * multiplier * activeModifier().scoreMultiplier);

  state.timeLeft = Math.min(state.totalTime, state.timeLeft + 400);
  state.score += gained;
  updateStatsUI();
  updateComboUI();

  const tier = Math.min(state.combo, 20);
  loopState.hitstopEndTime = Date.now() + (40 + tier * 1.2) * hitstopScale;

  playTone(state.combo > 0 && state.combo % 4 === 0 ? 'comboTick' : 'correct');
  haptic(state.combo % 4 === 0 && state.combo > 0 ? 'combo' : 'hit');
  setCubeState(cube, 'correct');
  spawnParticles(cube.getWorldPosition(new THREE.Vector3()), t.activeHex, 10 + Math.min(20, tier));
  spawnScorePopup(cube, gained, comboMult);

  cube.userData['targetY'] = 0.5;
  setTimeout(() => { cube.userData['targetY'] = 0; }, 150);
}

export function handleMistake(wrongCube: THREE.Mesh | null, reason: string): void {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const runId = state.runId;

  resetCombo();
  state.isPlayable = false;
  pauseBtn.style.display = 'none';
  playTone('wrong'); haptic('wrong');
  loopState.hitstopEndTime = Date.now() + 100 * hitstopScale;

  if (wrongCube) {
    setCubeState(wrongCube, 'wrong');
    spawnParticles(wrongCube.getWorldPosition(new THREE.Vector3()), t.wrongHex);
  }
  if (pMode.id !== 'nback') {
    state.pattern.forEach(i => {
      if (!state.userClicks.includes(i)) setCubeState(cubes[i], 'active');
    });
  }

  // Tutorial intercept: skip all pacing/game-over logic when onboarding is active
  if (_ob.onMistake) { const fn = _ob.onMistake; clearOnboardingHooks(); fn(); return; }

  // n-Back now honours the selected pacing like every other protocol. It used
  // to force Classic permadeath regardless, so picking "2-Back + Zen" showed
  // "No timer. Streak-based." and then ended the run on the first mistake.
  const isNBack = pMode.id === 'nback';

  if (pPace.id === 'classic') {
    state.nBackActive = false;
    gameOver(reason || 'RUN ENDED');
  } else if (pPace.id === 'zen') {
    state.mistakes++; state.streak = 0; updateStatsUI();
    showMessage(reason || 'OVERLOAD', 'var(--wrong)');
    if (state.level > 1 && state.mistakes % 2 === 0) {
      state.level--;
      if (isNBack) {
        // n-Back difficulty is stream length and flash speed, both derived from
        // level, so it needs no activeCount/gridSize walk-back.
        state.gridSize = Math.max(3, state.gridSize);
      } else {
        state.activeCount = Math.max(3, state.activeCount - 1);
        if (state.level % 3 === 0) state.gridSize = Math.max(3, state.gridSize - 1);
      }
      playTone('levelDown');
    }
    if (isNBack) { restartNBackStream(runId, 1500); return; }
    setTimeout(() => {
      if (isStale(runId)) return;
      createBoard(); startLevel(runId);
    }, 1500);
  } else if (pPace.id === 'sprint') {
    state.mistakes++; state.timeLeft -= 3000;
    showMessage('PENALTY −3s', 'var(--wrong)');
    flashScreen('var(--wrong)');
    if (state.level > 1 && state.mistakes % 3 === 0) {
      state.level--;
      if (!isNBack) {
        state.activeCount = Math.max(3, state.activeCount - 1);
        if (state.level % 3 === 0) state.gridSize = Math.max(3, state.gridSize - 1);
      }
      playTone('levelDown');
    }
    if (isNBack) { restartNBackStream(runId, 700); return; }
    cameraShake(0.4, 350, () => {
      if (isStale(runId)) return;
      createBoard(); startLevel(runId);
    });
  }
}

export async function levelComplete(): Promise<void> {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];
  const runId = state.runId;

  // Fire onboarding hook before animations. If a hook was registered we're in
  // the tutorial — return immediately after playing the success sound so that
  // startLevel() is never called underneath the tutorial UI.
  const obEnd = _ob.onRoundEnd;
  const wasTutorial = !!obEnd;
  clearOnboardingHooks();
  obEnd?.();

  playTone('levelUp'); haptic('levelUp');
  if (wasTutorial) return;
  const oldLevel = state.level;

  if (pPace.id === 'classic') { state.score += 50; state.level++; }
  else if (pPace.id === 'zen') {
    state.streak++;
    if (state.streak > state.maxStreak) state.maxStreak = state.streak;
    if (state.streak % 3 === 0) state.level++;
  } else if (pPace.id === 'sprint') {
    state.clears++; state.score += 100;
    if (state.clears % 2 === 0) state.level++;
  }
  updateStatsUI();

  cubes.forEach((cube, i) => {
    setTimeout(() => {
      cube.userData['targetY'] = 0.6;
      setTimeout(() => { cube.userData['targetY'] = 0; }, 200);
    }, i * 20);
  });
  await delay(800);
  if (isStale(runId)) return;

  // n-Back scales via stream length and flash speed (both level-derived), not
  // pattern size, so it skips the activeCount/gridSize growth entirely.
  if (state.level > oldLevel && pMode.id !== 'nback') {
    if (state.level % 2 === 0) state.activeCount = Math.min(10, state.activeCount + 1);
    if (state.level % 3 === 0 && state.gridSize < 6) {
      state.gridSize++;
      // activeCount must stay >= 3, or the grid grows while the pattern shrinks
      // below the floor every other growth step and the run gets easier.
      state.activeCount = Math.max(3, Math.floor(state.activeCount * 0.8));
      createBoard();
    }
  }
  if (pMode.id === 'nback') startNBackLevel(runId);
  else startLevel(runId);
}

export function gameOver(reasonText: string): void {
  const selectorEl = document.getElementById('channel-selector');
  if (selectorEl) selectorEl.style.display = 'none';

  const pPace = PACINGS[state.curPaceIdx];
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const endTitle = document.getElementById('end-title')!;

  // Retire the run before any of the below awaits: an Observe sequence or
  // n-Back stream still in flight would otherwise keep playing underneath the
  // results screen and re-enable input on a run that's already over.
  endRun();
  const runId = state.runId;
  stopTimer();
  const obEnd = _ob.onRoundEnd; clearOnboardingHooks(); obEnd?.();
  playTone('wrong'); haptic('wrong');
  pauseBtn.style.display = 'none';
  endTitle.innerText = reasonText;
  endTitle.style.color = pPace.id === 'sprint' ? 'var(--active)' : 'var(--wrong)';
  showMessage(reasonText, 'var(--wrong)');

  cameraShake(0.7, 500, () => {
    if (isStale(runId)) return;
    const aspect = window.innerWidth / window.innerHeight;
    const mobileFovAdjustment = aspect < 1 ? (1 / aspect) * 0.8 : 1;
    const dist = Math.max(12, state.gridSize * 2.5) * mobileFovAdjustment;
    camera.position.set(0, dist * 0.6, dist);
    // This pulls the camera back for a "survey the whole board" shot before the
    // results screen covers it, so it deliberately doesn't reuse
    // adjustCameraForViewport()'s framing — but it still has to aim at the grid
    // after moving. Without this the camera's rotation stayed wherever it was
    // before the jump, so the grid would visibly swing out of frame for the gap
    // before results screen appeared.
    camera.lookAt(0, 0, 0);
    setTimeout(() => {
      if (isStale(runId)) return;
      if (_showResultsScreen) _showResultsScreen();
    }, 500);
  });
}

export async function showResultsScreen(): Promise<void> {
  stopGameplayAudio();
  createBoard();

  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  // Onboarding rounds do not count toward streak, stats, or signal balance.
  // Daily runs overwrite this below with the real result from recordDailyCompletion().
  let streakResult: DailyStreakResult = {
    currentStreak: profile.currentStreak,
    longestStreak: profile.longestStreak,
    isNewRecord: false,
    isMilestone: false,
    milestoneValue: null,
  };

  const uiLayer = document.getElementById('ui-layer')!;
  const resultsScreen = document.getElementById('results-screen')!;
  const restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;
  const resEarnedFrags = document.getElementById('res-earned-frags')!;
  const grid = document.getElementById('final-stats-grid')!;
  const endTitle = document.getElementById('end-title')!;

  uiLayer.style.display = 'none';
  resultsScreen.style.display = 'flex';

  // Swap action buttons for onboarding path
  const enterSignalBtn = document.getElementById('enter-signal-btn') as HTMLButtonElement;
  const menuBtn        = document.getElementById('menu-btn')          as HTMLButtonElement;
  if (state.isOnboarding) {
    restartBtn.style.display    = 'none';
    menuBtn.style.display       = 'none';
    enterSignalBtn.style.display = 'block';
  } else {
    enterSignalBtn.style.display = 'none';
  }

  if (state.isDailyRun) {
    restartBtn.style.display = 'none';
    const todayDate = new Date().toISOString().split('T')[0];
    streakResult = recordDailyCompletion(todayDate);
    state.earnedFragments = Math.floor(state.score / 5);
    resEarnedFrags.innerText = `${state.earnedFragments} · DAILY BONUS`;
  } else if (!state.isOnboarding) {
    restartBtn.style.display = 'block';
    state.earnedFragments = Math.floor(state.score / 10);
    if (pPace.id === 'zen') state.earnedFragments = Math.floor(state.maxStreak * 2);
    resEarnedFrags.innerText = String(state.earnedFragments);
  } else {
    // Onboarding: zero signal, no restart
    state.earnedFragments = 0;
    resEarnedFrags.innerText = '0';
  }

  let mastery: MasteryResult | null = null;
  if (!state.isOnboarding) {
    addSignal(state.earnedFragments);
    recordRun({ score: state.score, level: state.level, signalEarned: state.earnedFragments, combo: state.maxCombo });
    track('run_end', {
      protocol: pMode.id,
      pacing: pPace.id,
      level: state.level,
      score: state.score,
      combo: state.maxCombo,
      daily: state.isDailyRun,
    });
    mastery = recordProtocolRun(
      pMode.id,
      state.score,
      state.level,
      new Date().toISOString().split('T')[0],
    );
  }
  updateStatsUI();

  const comboStat = `<div class="stat-box"><span class="stat-label">Best Combo</span><span class="stat-value" style="color:var(--combo)">${state.maxCombo}×</span></div>`;
  if (pPace.id === 'classic') {
    grid.innerHTML = `<div class="stat-box"><span class="stat-label">Score</span><span class="stat-value">${state.score}</span></div><div class="stat-box"><span class="stat-label">Level</span><span class="stat-value">${state.level}</span></div>${comboStat}`;
  } else if (pPace.id === 'zen') {
    grid.innerHTML = `<div class="stat-box"><span class="stat-label">Max Streak</span><span class="stat-value">${state.maxStreak}</span></div><div class="stat-box"><span class="stat-label">Mistakes</span><span class="stat-value" style="color:var(--wrong)">${state.mistakes}</span></div>${comboStat}`;
  } else if (pPace.id === 'sprint') {
    grid.innerHTML = `<div class="stat-box"><span class="stat-label">Clears</span><span class="stat-value">${state.clears}</span></div><div class="stat-box"><span class="stat-label">Score</span><span class="stat-value">${state.score}</span></div>${comboStat}`;
  }

  // A. Milestone title override
  if (streakResult.isMilestone) {
    endTitle.innerText = `${streakResult.milestoneValue}-DAY STREAK`;
    endTitle.style.color = 'var(--combo)';
  }

  // B. Streak line
  const streakLineEl = document.getElementById('streak-line')!;
  if (streakResult.currentStreak >= 2) {
    streakLineEl.style.display = 'block';
    const flame = streakResult.isMilestone ? ' 🔥' : '';
    streakLineEl.textContent = `${streakResult.currentStreak}-day streak${flame}`;
    streakLineEl.style.color = streakResult.isNewRecord ? 'var(--correct)' : 'var(--combo)';
  } else {
    streakLineEl.style.display = 'none';
  }

  // B2. Mastery — points earned this run and progress toward the next rank
  const masteryPanel = document.getElementById('mastery-panel') as HTMLElement;
  const rankUpLine   = document.getElementById('mastery-rankup-line') as HTMLElement;
  if (mastery) {
    const prog = rankProgress(mastery.totalPoints);
    masteryPanel.style.display = 'block';
    (document.getElementById('mastery-protocol') as HTMLElement).textContent = pMode.name.toUpperCase();
    (document.getElementById('mastery-rank') as HTMLElement).textContent =
      mastery.rank > 0 ? `${rankNumeral(mastery.rank)} · ${rankTitle(mastery.rank).toUpperCase()}` : 'UNRANKED';
    const bar = document.getElementById('mastery-bar') as HTMLElement;
    bar.style.width = `${prog.pct}%`;
    bar.setAttribute('aria-valuenow', String(Math.round(prog.pct)));
    (document.getElementById('mastery-detail') as HTMLElement).textContent =
      prog.span > 0
        ? `+${mastery.pointsGained} mastery · ${prog.into}/${prog.span} to next rank`
        : `+${mastery.pointsGained} mastery · max rank reached`;

    rankUpLine.style.display = mastery.rankedUp ? 'block' : 'none';
    if (mastery.rankedUp) {
      rankUpLine.textContent = `▲ ${pMode.name.toUpperCase()} RANK ${rankNumeral(mastery.rank)} — ${rankTitle(mastery.rank)}`;
    }
  } else {
    masteryPanel.style.display = 'none';
    rankUpLine.style.display = 'none';
  }

  // C. Daily nudge
  const today = new Date().toISOString().split('T')[0];
  const nudgeEl = document.getElementById('daily-nudge')!;
  if (profile.lastDailyDate === today) {
    nudgeEl.textContent = `◆ Streak: ${streakResult.currentStreak} day${streakResult.currentStreak !== 1 ? 's' : ''} · Next window opens tomorrow`;
  } else {
    nudgeEl.textContent = `◆ Daily Calibration available — play it to lock in your streak`;
  }
  nudgeEl.style.display = 'block';

  // Build the board key for this run
  // Modified runs get their own boards. A 1.8x Resonant score on the standard
  // board would make the standard board unwinnable without the modifier.
  const boardKey = state.isDailyRun
    ? dailyBoardKey(new Date().toISOString().split('T')[0])
    : modeBoardKey(pMode.id, pPace.id) + modifierBoardSuffix();

  let isNewBest = false;

  // Show the panel as loading before the submit round-trip, not after it.
  showLeaderboardSkeleton(boardKey);

  if (!state.isOnboarding) {
    // a. Display name — prompt on first run only
    if (!profile.display_name) {
      const name = await promptDisplayName();
      if (name) {
        profile.display_name = name;
        saveProfile();
      }
    }

    // b. Submit score — submitScore swallows its own errors, so this never throws
    if (profile.display_name) {
      isNewBest = await submitScore(boardKey, state.score, state.level, pMode.id, pPace.id);
    }
  }

  // d. New personal best banner
  const newBestEl = document.getElementById('new-best-line')!;
  newBestEl.style.display = isNewBest ? 'block' : 'none';

  // c. Leaderboard panel — skeleton shows immediately inside showLeaderboardPanel
  await showLeaderboardPanel(boardKey);
}