import { profile, saveProfile } from '../save';
import { state } from '../state';
import { cubes, setCubeState } from '../render/board';
import { setOnboardingHooks, clearOnboardingHooks, stopTimer } from '../game/runLoop';
import { showMessage } from './hud';
import { returnToMenu } from './modals';
import { delay } from '../utils';

// Top-left, centre, bottom-right of the 3×3 grid — clear diagonal pattern
const TUTORIAL_PATTERN = [0, 4, 8];

let cancelled = false;

// ── Public API ─────────────────────────────────────────────────────────────────

export function maybeStartOnboarding(): void {
  if (!profile.hasSeenOnboarding) startOnboarding();
}

export function replayOnboarding(): void {
  startOnboarding();
}

// ── Core flow ──────────────────────────────────────────────────────────────────

async function startOnboarding(): Promise<void> {
  cancelled = false;

  // Always begin from a clean Standby state so the board is in its idle pose
  returnToMenu();

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  overlay.querySelector<HTMLButtonElement>('#ob-skip')!
    .addEventListener('click', () => { cancelled = true; finish(overlay); });

  // ── Step 1: Intro card ─────────────────────────────────────────────────────
  if (!await showCard(overlay, {
    title: 'SIGNAL',
    titleColor: 'var(--active)',
    body: "A cognitive protocol trainer.<br>Let's run through one pattern.",
    primaryBtn: 'BEGIN',
  })) { finish(overlay); return; }

  // ── Step 2: What is the matrix? ────────────────────────────────────────────
  if (!await showCard(overlay, {
    body: 'This is your matrix. During <span style="color:var(--active)">Observe</span>, tiles flash a pattern — memorise which ones lit up. Then you recreate it.',
    primaryBtn: 'GOT IT',
    dim: 0.82,
  })) { finish(overlay); return; }

  // ── Step 3: Controlled observe — flash TUTORIAL_PATTERN slowly ─────────────
  hideCard(overlay);

  // Hide menu buttons so the board is uncluttered during live phases
  const centerDisplay = document.getElementById('center-display')!;
  centerDisplay.style.display = 'none';

  showMessage('Observe', 'var(--active)');
  showCallout(overlay, 'Watch carefully — these tiles are your targets.');

  for (const idx of TUTORIAL_PATTERN) {
    if (cancelled) { finish(overlay); return; }
    if (cubes[idx]) setCubeState(cubes[idx], 'active');
    await delay(600);
    if (cancelled) { finish(overlay); return; }
    if (cubes[idx]) setCubeState(cubes[idx], 'base');
    await delay(400);
  }
  if (cancelled) { finish(overlay); return; }
  hideCallout(overlay);

  // Post-flash confirmation card before unlocking the board
  showMessage('Execute', 'var(--text)');
  if (!await showCard(overlay, {
    body: "That was your pattern. Now tap the tiles that flashed — in any order.",
    primaryBtn: 'READY',
  })) { finish(overlay); return; }

  // ── Step 4: Live board — player taps the pattern, no timer running ──────────
  hideCard(overlay);

  // Minimal game state: enough for handleInteraction to work without initGame().
  // timerActive stays false throughout — no countdown during the tutorial.
  state.pattern = [...TUTORIAL_PATTERN];
  state.userClicks = [];
  state.isPlayable = true;
  state.isPaused = false;
  state.timerActive = false;
  state.curProtIdx = 0; // Spatial — any tap order accepted
  state.curPaceIdx = 0; // Classic — onMistake hook intercepts before gameOver fires

  let resolveRoundEnd!: () => void;
  const roundEndP = new Promise<void>(r => { resolveRoundEnd = r; });

  setOnboardingHooks({
    // Fired by handleMistake (before any pacing logic) — prevents gameOver/camera shake
    onMistake: () => { state.isPlayable = false; resolveRoundEnd(); },
    // Fired by levelComplete (success) — levelComplete returns immediately after
    onRoundEnd: () => { resolveRoundEnd(); },
  });

  showCallout(overlay, 'Tap the tiles that flashed — in any order.');

  // Detect the first tile tap: correct taps push to userClicks; wrong taps set isPlayable=false
  const firstTapP = new Promise<void>(resolve => {
    const poll = setInterval(() => {
      if (state.userClicks.length > 0 || !state.isPlayable || cancelled) {
        clearInterval(poll); resolve();
      }
    }, 50);
  });
  if (!await awaitOrCancel(firstTapP)) { finish(overlay); return; }
  hideCallout(overlay);

  // Wait for the round to end (success or mistake)
  if (!await awaitOrCancel(roundEndP)) { finish(overlay); return; }

  // ── Step 5: Timer explanation ───────────────────────────────────────────────
  if (!await showCard(overlay, {
    body: 'Good. In a real run, a timer bar counts down from full.',
    stressBarDemo: true,
    body2: 'Correct taps add time back. Let it empty — the run ends.',
    primaryBtn: 'UNDERSTOOD',
  })) { finish(overlay); return; }

  // ── Step 6: Final card ──────────────────────────────────────────────────────
  if (!await showCard(overlay, {
    title: 'READY',
    titleColor: 'var(--correct)',
    body: 'Protocols change the rules.<br>Pacing changes the pressure.<br>Calibration is yours to explore.',
    primaryBtn: 'START TRAINING',
  })) { finish(overlay); return; }

  finish(overlay);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Races a void Promise against the `cancelled` flag.
// Returns true if the promise resolved first, false if cancelled won.
function awaitOrCancel(p: Promise<void>): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const poll = setInterval(() => {
      if (cancelled && !done) { done = true; clearInterval(poll); resolve(false); }
    }, 50);
    p.then(() => { if (!done) { done = true; clearInterval(poll); resolve(true); } });
  });
}

function finish(overlay: HTMLDivElement): void {
  clearOnboardingHooks();
  stopTimer();
  state.isPlayable = false;
  if (overlay.parentNode) overlay.remove();
  profile.hasSeenOnboarding = true;
  saveProfile();
  // returnToMenu resets all UI (screens, board, message → Standby) and re-shows center-display
  returnToMenu();
}

// ── DOM builders ───────────────────────────────────────────────────────────────

function buildOverlay(): HTMLDivElement {
  const el = document.createElement('div');
  el.id = 'ob-overlay';
  el.style.cssText = 'position:fixed;inset:0;z-index:200;pointer-events:none;';
  el.innerHTML = `
    <button id="ob-skip" style="
      position:absolute;top:16px;right:16px;pointer-events:auto;
      font-family:var(--font-mono);font-size:0.7rem;letter-spacing:1.5px;
      background:none;border:1px solid rgba(255,255,255,0.18);
      color:rgba(255,255,255,0.4);padding:6px 14px;border-radius:2px;cursor:pointer;">SKIP</button>
    <div id="ob-card" style="
      display:none;position:absolute;inset:0;
      backdrop-filter:blur(8px);pointer-events:auto;
      flex-direction:column;align-items:center;justify-content:center;padding:32px;"></div>
    <div id="ob-callout" style="
      display:none;position:absolute;bottom:90px;left:50%;transform:translateX(-50%);
      background:rgba(5,8,13,0.9);backdrop-filter:blur(10px);
      border:1px solid rgba(255,255,255,0.1);border-radius:4px;
      padding:14px 22px;text-align:center;max-width:300px;white-space:normal;
      pointer-events:none;"></div>`;
  return el;
}

interface CardOptions {
  title?: string;
  titleColor?: string;
  body: string;
  body2?: string;
  stressBarDemo?: boolean;
  primaryBtn: string;
  dim?: number; // card backdrop opacity, default 0.92
}

function showCard(overlay: HTMLDivElement, opts: CardOptions): Promise<boolean> {
  return new Promise(resolve => {
    const card = overlay.querySelector<HTMLDivElement>('#ob-card')!;
    const btnColor = opts.titleColor ?? 'var(--active)';

    const stressHtml = opts.stressBarDemo ? `
      <div style="width:260px;height:8px;background:rgba(255,255,255,0.08);
        border-radius:2px;margin-bottom:14px;overflow:hidden;">
        <div style="width:72%;height:100%;background:var(--active);
          box-shadow:0 0 8px var(--active);border-radius:2px;"></div>
      </div>` : '';

    const body2Html = opts.body2 ? `
      <div style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text);
        text-align:center;line-height:1.85;max-width:280px;margin-bottom:30px;">${opts.body2}</div>` : '';

    card.style.background = `rgba(5,8,13,${opts.dim ?? 0.92})`;
    card.innerHTML = `
      ${opts.title ? `<div style="font-family:var(--font-display);font-size:2rem;font-weight:700;
        letter-spacing:4px;color:${btnColor};margin-bottom:20px;">${opts.title}</div>` : ''}
      <div style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text);
        text-align:center;line-height:1.85;max-width:280px;
        margin-bottom:${opts.stressBarDemo ? '18px' : '30px'};">${opts.body}</div>
      ${stressHtml}${body2Html}
      <button id="ob-primary-btn" style="
        font-family:var(--font-mono);font-size:0.78rem;letter-spacing:2px;
        background:${btnColor};color:#000;border:none;
        padding:13px 32px;border-radius:2px;cursor:pointer;min-width:160px;">${opts.primaryBtn}</button>`;
    card.style.display = 'flex';

    let resolved = false;
    function done(v: boolean): void {
      if (resolved) return;
      resolved = true;
      clearInterval(cancelPoll);
      card.style.display = 'none';
      resolve(v);
    }
    const cancelPoll = setInterval(() => { if (cancelled) done(false); }, 50);
    card.querySelector('#ob-primary-btn')!.addEventListener('click', () => done(true));
  });
}

function hideCard(overlay: HTMLDivElement): void {
  overlay.querySelector<HTMLDivElement>('#ob-card')!.style.display = 'none';
}

function showCallout(overlay: HTMLDivElement, text: string): void {
  const el = overlay.querySelector<HTMLDivElement>('#ob-callout')!;
  el.innerHTML = `<div style="font-family:var(--font-mono);font-size:0.78rem;
    color:var(--text);line-height:1.6;">${text}</div>`;
  el.style.display = 'block';
}

function hideCallout(overlay: HTMLDivElement): void {
  overlay.querySelector<HTMLDivElement>('#ob-callout')!.style.display = 'none';
}
