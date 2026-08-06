/**
 * Menu coach marks — a short guided tour of the home screen.
 *
 * The gameplay tutorial teaches the one thing you do with your hands: watch the
 * pattern, play it back. It teaches nothing about the screen you land on
 * afterwards, which is where every other decision in the game lives — which
 * protocol, which pacing, the daily, the boards, the shop. A player who finished
 * the tutorial still had to discover all of that by poking at it.
 *
 * ── Why coach marks rather than another card sequence ────────────────────────
 *
 * The tutorial's cards float over a dimmed screen and teach a rule. This teaches
 * a *location*, so it has to point at the real control in its real position. A
 * separate explainer screen would describe a menu the player then has to re-find
 * from memory; a spotlight on the actual button means the thing they learn is
 * the thing they will look at.
 *
 * ── Rules this follows ──────────────────────────────────────────────────────
 *
 *  - **Skippable from the first step.** Same as the tutorial. A tour you cannot
 *    leave is a wall, and the players most likely to bounce are the ones most
 *    likely to want out.
 *  - **Announced, not just drawn.** Each step writes to a live region. A
 *    spotlight is the definition of a visual-only signal, so without this the
 *    tour simply does not exist for a screen-reader player.
 *  - **Never twice.** `hasSeenMenuTour` is set the moment the tour starts, not
 *    when it finishes — a player who closes the app halfway through has still
 *    made their choice about it.
 *  - **Independent of the gameplay tutorial.** Someone who skipped that has been
 *    told *less*, so they need this more, not less.
 *  - **Degrades to nothing.** A missing target is skipped rather than throwing,
 *    so a future layout change can drop an element without breaking startup.
 */

import { profile, saveProfile } from './save';
import { isReducedMotion } from './reducedMotion';

interface TourStep {
  /** Element to spotlight. A step whose target is absent is skipped. */
  targetId: string;
  title: string;
  body: string;
}

/**
 * Ordered by what a new player needs to decide next, not by screen position:
 * what am I playing → how do I start → why come back tomorrow → where did my
 * score go → what is the currency for.
 */
const STEPS: TourStep[] = [
  {
    targetId: 'mode-row',
    title: 'Protocol and pacing',
    body: 'You just played Spatial on Classic. Tap either to switch — five protocols, three pacings, each with its own leaderboard.',
  },
  {
    targetId: 'start-btn',
    title: 'Engage',
    body: 'Starts a run with whatever is selected above. One mistake ends it, so every run is its own attempt.',
  },
  {
    targetId: 'daily-row',
    title: 'Daily Calibration',
    body: 'One shared challenge each day, worth double Signal. Playing it is the only thing that builds your streak.',
  },
  {
    targetId: 'leaderboard-browser-btn',
    title: 'Boards',
    body: 'Every protocol and pacing has its own board. Your callsign appears here once you post a score.',
  },
  {
    targetId: 'store-btn',
    title: 'Signal',
    body: 'Earned by playing, spent on how the board looks. It never buys an advantage — every protocol and pacing is free.',
  },
];

const OVERLAY_ID = 'tour-overlay';
const PAD = 8;

function announce(msg: string): void {
  const el = document.getElementById('tour-announce');
  if (el) el.textContent = msg;
}

/** True when the tour should run: menu is up, and the player has not seen it. */
export function shouldRunMenuTour(): boolean {
  return !profile.hasSeenMenuTour && document.getElementById(OVERLAY_ID) === null;
}

export function startMenuTour(): void {
  if (!shouldRunMenuTour()) return;

  // Set before the first frame, not on completion. A player who closes the app
  // mid-tour has still decided how much of it they wanted.
  profile.hasSeenMenuTour = true;
  saveProfile();

  const steps = STEPS.filter(s => {
    const el = document.getElementById(s.targetId);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });
  if (steps.length === 0) return;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Guided tour of the menu');
  overlay.style.cssText = [
    'position:fixed;inset:0;z-index:400;',
    'pointer-events:auto;',
  ].join('');

  // The dim is a giant spread shadow on the highlight box rather than four
  // separate panels or an SVG mask: one element, and the "hole" is just the
  // box's own area, so it follows the target exactly with no seams.
  const spot = document.createElement('div');
  spot.style.cssText = [
    'position:absolute;border-radius:6px;pointer-events:none;',
    'box-shadow:0 0 0 9999px rgba(5,8,13,0.86);',
    'border:1px solid var(--active);',
    isReducedMotion() ? '' : 'transition:top 0.25s ease,left 0.25s ease,width 0.25s ease,height 0.25s ease;',
  ].join('');

  const card = document.createElement('div');
  card.style.cssText = [
    'position:absolute;left:16px;right:16px;',
    'background:rgba(10,15,22,0.97);border:1px solid var(--active);',
    'border-radius:6px;padding:16px 18px;',
    'box-shadow:0 12px 40px rgba(0,0,0,0.7);',
  ].join('');

  const live = document.createElement('div');
  live.id = 'tour-announce';
  live.setAttribute('aria-live', 'polite');
  live.setAttribute('aria-atomic', 'true');
  live.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;';

  overlay.append(spot, card, live);
  document.body.appendChild(overlay);

  let i = 0;
  const end = (): void => {
    overlay.remove();
    window.removeEventListener('resize', place);
    document.removeEventListener('keydown', onKey);
  };

  function place(): void {
    const step = steps[i];
    const el = document.getElementById(step.targetId);
    if (!el) { end(); return; }
    const r = el.getBoundingClientRect();

    spot.style.top    = `${r.top - PAD}px`;
    spot.style.left   = `${r.left - PAD}px`;
    spot.style.width  = `${r.width + PAD * 2}px`;
    spot.style.height = `${r.height + PAD * 2}px`;

    // Card goes above the target when there is room below it, and below when
    // there is not — the menu sheet lives at the bottom of the screen, so most
    // steps put the card above and out of the way of what it is describing.
    card.style.top = '';
    card.style.bottom = '';
    const spaceAbove = r.top;
    if (spaceAbove > 200) card.style.bottom = `${window.innerHeight - r.top + PAD + 12}px`;
    else card.style.top = `${r.bottom + PAD + 12}px`;
  }

  function render(): void {
    const step = steps[i];
    const last = i === steps.length - 1;
    card.innerHTML = [
      `<div style="font-family:var(--font-mono);font-size:0.6rem;letter-spacing:2px;`,
      `color:var(--text-muted);margin-bottom:8px;">${i + 1} / ${steps.length}</div>`,
      `<div style="font-family:var(--font-display);font-size:0.95rem;font-weight:700;`,
      `color:var(--active);letter-spacing:1px;margin-bottom:8px;">${step.title}</div>`,
      `<div style="font-family:var(--font-mono);font-size:0.75rem;color:var(--text);`,
      `line-height:1.65;margin-bottom:14px;">${step.body}</div>`,
      `<div style="display:flex;gap:10px;align-items:center;">`,
      `<button id="tour-next" style="flex:1;background:var(--active);color:#001016;`,
      `border:none;border-radius:3px;padding:11px;font-family:var(--font-display);`,
      `font-size:0.8rem;font-weight:800;letter-spacing:2px;cursor:pointer;">`,
      `${last ? 'Got it' : 'Next'}</button>`,
      `<button id="tour-skip" style="width:auto;background:none;border:none;padding:11px 4px;`,
      `font-family:var(--font-mono);font-size:0.66rem;letter-spacing:1.5px;`,
      `color:var(--text-muted);cursor:pointer;">${last ? '' : 'Skip'}</button>`,
      `</div>`,
    ].join('');

    place();
    announce(`Step ${i + 1} of ${steps.length}. ${step.title}. ${step.body}`);

    card.querySelector<HTMLButtonElement>('#tour-next')!.addEventListener('click', next);
    const skip = card.querySelector<HTMLButtonElement>('#tour-skip')!;
    if (last) skip.style.display = 'none';
    else skip.addEventListener('click', end);
    // Focus the primary action so a keyboard or screen-reader player lands on
    // the control that advances, rather than at the top of the document.
    card.querySelector<HTMLButtonElement>('#tour-next')!.focus();
  }

  function next(): void {
    i += 1;
    if (i >= steps.length) { end(); return; }
    render();
  }

  function onKey(e: KeyboardEvent): void {
    if (e.key === 'Escape') { e.preventDefault(); end(); }
    else if (e.key === 'Enter' || e.key === ' ') {
      // Only when the card's button isn't already handling it.
      if (document.activeElement?.id !== 'tour-next') { e.preventDefault(); next(); }
    }
  }

  window.addEventListener('resize', place);
  document.addEventListener('keydown', onKey);
  render();
}
