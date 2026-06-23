import { profile, saveProfile } from '../save';
import { state } from '../state';
import { cubes, setCubeState } from '../render/board';
import { setOnboardingHooks, clearOnboardingHooks, stopTimer } from '../game/runLoop';
import { showMessage } from './hud';
import { returnToMenu } from './modals';
import { delay } from '../utils';
import { playTone, initAudio } from '../audio';

// Top-left, centre, bottom-right of the 3×3 grid — a clear diagonal
const TUTORIAL_PATTERN = [0, 4, 8];

let cancelled = false;

// ── Public API ─────────────────────────────────────────────────────────────────

// Called by the Engage button on first launch (menu.ts) and from Operator Log.
export async function startOnboarding(): Promise<void> {
  cancelled = false;

  // Initialise AudioContext while the user gesture is still on the call stack
  initAudio();

  // Begin from a clean Standby state
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

  // ── Step 2: Matrix introduction ────────────────────────────────────────────
  if (!await showCard(overlay, {
    body: 'This is your matrix. During <span style="color:var(--active)">Observe</span>, tiles flash a pattern — memorise which ones lit up. Then you recreate it.',
    primaryBtn: 'GOT IT',
    dim: 0.82,
  })) { finish(overlay); return; }

  // ── Step 3: Controlled observe — flash TUTORIAL_PATTERN slowly ─────────────
  hideCard(overlay);

  // Hide menu sheet so the board is uncluttered during live phases
  const menuSheet = document.getElementById('menu-sheet')!;
  menuSheet.style.display = 'none';

  showMessage('Observe', 'var(--active)');
  showCallout(overlay, 'Watch carefully — these tiles are your targets.');

  for (const idx of TUTORIAL_PATTERN) {
    if (cancelled) { finish(overlay); return; }
    if (cubes[idx]) { setCubeState(cubes[idx], 'active'); playTone('active'); }
    if (!await awaitOrCancel(delay(600))) { finish(overlay); return; }
    if (cubes[idx]) setCubeState(cubes[idx], 'base');
    if (!await awaitOrCancel(delay(400))) { finish(overlay); return; }
  }
  hideCallout(overlay);

  // Post-flash confirmation before unlocking the board
  showMessage('Execute', 'var(--text)');
  if (!await showCard(overlay, {
    body: "That was your pattern. Now tap the tiles that flashed — in any order.",
    primaryBtn: 'READY',
  })) { finish(overlay); return; }

  // ── Step 4: Live board with mistake-retry loop ─────────────────────────────
  // No initGame() call — script-driven, timer stays off throughout.
  // Wrong taps show explanation + re-flash. After 2 failures, auto-advance.
  hideCard(overlay);

  const MAX_ATTEMPTS = 2; // max failures before we auto-advance with a note
  let attempt = 0;

  while (true) {
    // Reset game state for this attempt
    state.pattern = [...TUTORIAL_PATTERN];
    state.userClicks = [];
    state.isPlayable = true;
    state.isPaused = false;
    state.timerActive = false;
    state.curProtIdx = 0; // Spatial — any order
    state.curPaceIdx = 0; // Classic — onMistake hook intercepts before gameOver

    let resolveRound!: (r: 'success' | 'mistake') => void;
    const roundP = new Promise<'success' | 'mistake'>(r => { resolveRound = r; });

    setOnboardingHooks({
      // Intercepts handleMistake before any pacing/gameOver/camera-shake logic
      onMistake: () => { state.isPlayable = false; resolveRound('mistake'); },
      // Intercepts levelComplete — tutorial returns immediately after hook
      onRoundEnd: () => { resolveRound('success'); },
    });

    showCallout(overlay, attempt === 0
      ? 'Tap the tiles that flashed — in any order.'
      : 'Try again — same pattern.');

    // Wait for the first tile tap (correct pushes to userClicks; wrong sets isPlayable=false)
    const firstTapP = new Promise<void>(resolve => {
      const poll = setInterval(() => {
        if (state.userClicks.length > 0 || !state.isPlayable || cancelled) {
          clearInterval(poll); resolve();
        }
      }, 50);
    });
    if (!await awaitOrCancel(firstTapP)) { finish(overlay); return; }
    hideCallout(overlay);

    // Wait for round end
    const roundResult = await new Promise<'success' | 'mistake' | 'cancelled'>(resolve => {
      let done = false;
      const cancelPoll = setInterval(() => {
        if (cancelled && !done) { done = true; clearInterval(cancelPoll); resolve('cancelled'); }
      }, 50);
      roundP.then(r => { if (!done) { done = true; clearInterval(cancelPoll); resolve(r); } });
    });

    if (roundResult === 'cancelled') { finish(overlay); return; }
    if (roundResult === 'success') break; // advance to step 5

    // ── Mistake path ───────────────────────────────────────────────────────────
    attempt++;

    if (attempt >= MAX_ATTEMPTS) {
      // Two failed attempts — reveal correct tiles then advance
      showCallout(overlay, "No problem — you'll get it in a real run.");
      TUTORIAL_PATTERN.forEach(idx => { if (cubes[idx]) setCubeState(cubes[idx], 'active'); });
      if (!await awaitOrCancel(delay(2500))) { finish(overlay); return; }
      hideCallout(overlay);
      cubes.forEach(c => setCubeState(c, 'base'));
      break;
    }

    // One failed attempt — explain and re-flash so the player can retry
    showCallout(overlay, "That tile wasn't in the pattern. In a real run this ends your streak — here, try again.");
    if (!await awaitOrCancel(delay(2500))) { finish(overlay); return; }
    hideCallout(overlay);

    cubes.forEach(c => setCubeState(c, 'base'));
    if (!await awaitOrCancel(delay(300))) { finish(overlay); return; }

    showMessage('Observe', 'var(--active)');
    for (const idx of TUTORIAL_PATTERN) {
      if (cancelled) { finish(overlay); return; }
      if (cubes[idx]) { setCubeState(cubes[idx], 'active'); playTone('active'); }
      if (!await awaitOrCancel(delay(600))) { finish(overlay); return; }
      if (cubes[idx]) setCubeState(cubes[idx], 'base');
      if (!await awaitOrCancel(delay(400))) { finish(overlay); return; }
    }
    if (cancelled) { finish(overlay); return; }
    showMessage('Execute', 'var(--text)');
  }

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
      position:absolute;top:16px;right:16px;z-index:210;pointer-events:auto;
      font-family:var(--font-mono);font-size:0.7rem;letter-spacing:1.5px;
      background:none;border:1px solid rgba(255,255,255,0.18);
      color:rgba(255,255,255,0.4);padding:6px 14px;border-radius:2px;cursor:pointer;">SKIP</button>
    <div id="ob-card" style="
      display:none;position:absolute;inset:0;z-index:201;
      backdrop-filter:blur(8px);pointer-events:auto;
      flex-direction:column;align-items:center;justify-content:center;padding:32px;"></div>
    <div id="ob-callout" style="
      display:none;position:absolute;bottom:90px;left:50%;transform:translateX(-50%);
      background:rgba(5,8,13,0.9);backdrop-filter:blur(10px);
      border:1px solid rgba(255,255,255,0.1);border-radius:4px;
      padding:14px 22px;text-align:center;max-width:320px;white-space:normal;
      pointer-events:none;z-index:1;"></div>`;
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
