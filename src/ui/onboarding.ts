import { profile, saveProfile } from '../save';
import { state } from '../state';
import { initGame, setOnboardingHooks, clearOnboardingHooks } from '../game/runLoop';
import { delay } from '../utils';

let cancelled = false;

// ── Public API ─────────────────────────────────────────────────────────────────

export function maybeStartOnboarding(): void {
  if (!profile.hasSeenOnboarding) startOnboarding();
}

// Called from the "Replay Intro" button in Operator Log.
export function replayOnboarding(): void {
  startOnboarding();
}

// ── Core flow ──────────────────────────────────────────────────────────────────

async function startOnboarding(): Promise<void> {
  cancelled = false;

  const overlay = buildOverlay();
  document.body.appendChild(overlay);

  overlay.querySelector<HTMLButtonElement>('#ob-skip')!
    .addEventListener('click', () => { cancelled = true; finish(overlay); });

  // ── Intro card ────────────────────────────────────────────────────────────
  const began = await showIntroCard(overlay);
  if (!began || cancelled) { finish(overlay); return; }

  // Lock to Spatial / Classic for the tutorial — the simplest protocol
  state.curProtIdx = 0;
  state.curPaceIdx = 0;

  // Wire up one-shot hooks before calling initGame so they're in place for
  // the very first Observe message
  let resolveObserve!: () => void;
  let resolveExecute!: () => void;
  let resolveRoundEnd!: () => void;
  const observeP  = new Promise<void>(r => { resolveObserve  = r; });
  const executeP  = new Promise<void>(r => { resolveExecute  = r; });
  const roundEndP = new Promise<void>(r => { resolveRoundEnd = r; });

  setOnboardingHooks({
    onObserve:  resolveObserve,
    onExecute:  resolveExecute,
    onRoundEnd: resolveRoundEnd,
  });

  initGame();

  // ── Observe callout ───────────────────────────────────────────────────────
  if (!await awaitHookOrCancel(observeP)) { finish(overlay); return; }
  showCallout(overlay, 'OBSERVE', 'These tiles are your targets — memorise their positions.');

  // ── Execute callout ───────────────────────────────────────────────────────
  if (!await awaitHookOrCancel(executeP)) { finish(overlay); return; }
  showCallout(overlay, 'EXECUTE', "Tap the tiles you saw. In Spatial mode, order doesn't matter.");

  // ── Round end (level complete or game over) ────────────────────────────────
  if (!await awaitHookOrCancel(roundEndP)) { finish(overlay); return; }
  hideCallout(overlay);
  await delay(300);
  if (cancelled) { finish(overlay); return; }

  // ── Final card ────────────────────────────────────────────────────────────
  await showFinalCard(overlay);
  finish(overlay);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

// Races a void Promise against the `cancelled` flag.
// Returns true if the promise resolved first, false if cancelled won.
function awaitHookOrCancel(p: Promise<void>): Promise<boolean> {
  return new Promise(resolve => {
    let done = false;
    const id = setInterval(() => {
      if (cancelled && !done) { done = true; clearInterval(id); resolve(false); }
    }, 50);
    p.then(() => { if (!done) { done = true; clearInterval(id); resolve(true); } });
  });
}

function finish(overlay: HTMLDivElement): void {
  clearOnboardingHooks();
  if (overlay.parentNode) overlay.remove();
  profile.hasSeenOnboarding = true;
  saveProfile();
}

// ── DOM ────────────────────────────────────────────────────────────────────────

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
      background:rgba(5,8,13,0.94);backdrop-filter:blur(8px);pointer-events:auto;
      flex-direction:column;align-items:center;justify-content:center;padding:32px;"></div>
    <div id="ob-callout" style="
      display:none;position:absolute;bottom:90px;left:50%;transform:translateX(-50%);
      background:rgba(5,8,13,0.9);backdrop-filter:blur(10px);
      border:1px solid rgba(255,255,255,0.1);border-radius:4px;
      padding:14px 22px;text-align:center;max-width:300px;white-space:normal;
      pointer-events:none;"></div>`;
  return el;
}

// Returns true if the user clicked Begin, false if they clicked Skip or cancelled.
function showIntroCard(overlay: HTMLDivElement): Promise<boolean> {
  return new Promise(resolve => {
    const card = overlay.querySelector<HTMLDivElement>('#ob-card')!;
    card.innerHTML = `
      <div style="font-family:var(--font-display);font-size:2rem;font-weight:700;
        letter-spacing:4px;color:var(--active);margin-bottom:20px;">SIGNAL</div>
      <div style="font-family:var(--font-mono);font-size:0.82rem;color:var(--text);
        text-align:center;line-height:1.8;max-width:260px;margin-bottom:36px;">
        A cognitive protocol trainer.<br>One real round to show you the pattern.
      </div>
      <div style="display:flex;gap:14px;">
        <button id="ob-begin" style="
          font-family:var(--font-mono);font-size:0.78rem;letter-spacing:2px;
          background:var(--active);color:#000;border:none;
          padding:13px 30px;border-radius:2px;cursor:pointer;">BEGIN</button>
        <button id="ob-intro-skip" style="
          font-family:var(--font-mono);font-size:0.78rem;letter-spacing:2px;
          background:none;border:1px solid rgba(255,255,255,0.18);
          color:rgba(255,255,255,0.4);padding:13px 30px;border-radius:2px;cursor:pointer;">SKIP</button>
      </div>`;
    card.style.display = 'flex';

    let resolved = false;
    function done(v: boolean): void {
      if (resolved) return;
      resolved = true;
      clearInterval(cancelPoll);
      card.style.display = 'none';
      resolve(v);
    }

    // Also resolve if globally cancelled (e.g. top-right skip during intro card)
    const cancelPoll = setInterval(() => { if (cancelled) done(false); }, 50);

    card.querySelector('#ob-begin')!.addEventListener('click', () => done(true));
    card.querySelector('#ob-intro-skip')!.addEventListener('click', () => done(false));
  });
}

function showCallout(overlay: HTMLDivElement, title: string, body: string): void {
  const el = overlay.querySelector<HTMLDivElement>('#ob-callout')!;
  el.innerHTML = `
    <div style="font-family:var(--font-mono);font-size:0.62rem;letter-spacing:2.5px;
      color:var(--active);margin-bottom:7px;">${title}</div>
    <div style="font-family:var(--font-mono);font-size:0.76rem;
      color:var(--text);line-height:1.6;">${body}</div>`;
  el.style.display = 'block';
}

function hideCallout(overlay: HTMLDivElement): void {
  overlay.querySelector<HTMLDivElement>('#ob-callout')!.style.display = 'none';
}

// Resolves when the user clicks "Start Training" or if cancelled.
function showFinalCard(overlay: HTMLDivElement): Promise<void> {
  return new Promise(resolve => {
    const card = overlay.querySelector<HTMLDivElement>('#ob-card')!;
    card.innerHTML = `
      <div style="font-family:var(--font-display);font-size:1.3rem;font-weight:700;
        letter-spacing:3px;color:var(--correct);margin-bottom:20px;">CALIBRATED</div>
      <div style="font-family:var(--font-mono);font-size:0.8rem;color:var(--text);
        text-align:center;line-height:1.85;max-width:290px;margin-bottom:32px;">
        That's the loop.<br><br>
        <span style="color:var(--active);">Protocol</span> sets the rules —
        Spatial, Sequential, Interference, Rhythm, 2-Back.<br><br>
        <span style="color:var(--active);">Pacing</span> sets the pressure —
        Classic, Zen, Sprint.
      </div>
      <button id="ob-done" style="
        font-family:var(--font-mono);font-size:0.78rem;letter-spacing:2px;
        background:var(--correct);color:#000;border:none;
        padding:13px 36px;border-radius:2px;cursor:pointer;">START TRAINING</button>`;
    card.style.display = 'flex';

    let resolved = false;
    function done(): void {
      if (resolved) return;
      resolved = true;
      clearInterval(cancelPoll);
      resolve();
    }

    const cancelPoll = setInterval(() => { if (cancelled) done(); }, 50);
    card.querySelector('#ob-done')!.addEventListener('click', done);
  });
}
