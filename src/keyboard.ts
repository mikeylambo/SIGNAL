import { state } from './state';
import { cubes } from './render/board';
import { handleInteraction, selectChannel } from './game/runLoop';
import { activeModifier, CHROMATIC_CHANNELS } from './game/modifiers';
import { PROTOCOLS } from './game/protocols';

/**
 * Keyboard and screen-reader access to the board.
 *
 * The board is a WebGL canvas marked aria-hidden, so before this the game was
 * unplayable without a pointer and completely opaque to assistive tech — a
 * notable gap next to the colour-vision support, which is otherwise thorough.
 *
 * Rather than trying to make the canvas itself accessible, this maintains a
 * cursor over the existing `cubes` array (which is already a row-major
 * gridSize × gridSize grid) and routes activation through the same
 * handleInteraction() the pointer path uses. There is exactly one code path for
 * "a tile was chosen", so keyboard play can't drift from pointer play.
 *
 * Announcements go to an aria-live region, since a sighted-free player needs to
 * know which tile flashed, not just where their cursor is.
 */

let cursor = 0;
let keyboardActive = false;

/** True once the player has used the keyboard; gates the cursor highlight. */
export function isKeyboardActive(): boolean { return keyboardActive; }

function announce(message: string): void {
  const el = document.getElementById('sr-board-announce');
  if (el) el.textContent = message;
}

/** 1-indexed row/column, which is what a person navigating a grid expects. */
function describe(index: number): string {
  const size = state.gridSize;
  const row = Math.floor(index / size) + 1;
  const col = (index % size) + 1;
  return `Row ${row}, column ${col}`;
}

function clampCursor(): void {
  const total = state.gridSize * state.gridSize;
  if (cursor >= total) cursor = total - 1;
  if (cursor < 0) cursor = 0;
}

/**
 * Draws the cursor as a scale bump on the focused tile, reusing the same
 * `targetScale` channel the mouse hover uses so the two can't fight over it.
 */
function paintCursor(): void {
  if (!keyboardActive) return;
  clampCursor();
  cubes.forEach((c, i) => {
    c.userData['targetScale'] = i === cursor ? 1.15 : 1;
  });
}

export function resetKeyboardCursor(): void {
  cursor = 0;
  if (keyboardActive) paintCursor();
}

function moveCursor(dRow: number, dCol: number): void {
  const size = state.gridSize;
  clampCursor();
  let row = Math.floor(cursor / size);
  let col = cursor % size;
  row = Math.max(0, Math.min(size - 1, row + dRow));
  col = Math.max(0, Math.min(size - 1, col + dCol));
  cursor = row * size + col;
  paintCursor();
  announce(describe(cursor));
}

function activateCursor(): void {
  clampCursor();
  const cube = cubes[cursor];
  if (!cube) return;
  // Same entry point as a pointer tap, so every protocol rule (n-Back's
  // flash-window gate, Rhythm's timing check, Sequential's ordering) applies
  // identically without being reimplemented here.
  handleInteraction(cube);
}

export function setupKeyboard(): void {
  window.addEventListener('keydown', (e: KeyboardEvent) => {
    // Never steal keys from a text field — the callsign modal has one.
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const key = e.key;
    const isMove =
      key === 'ArrowUp' || key === 'ArrowDown' || key === 'ArrowLeft' || key === 'ArrowRight' ||
      key === 'w' || key === 'a' || key === 's' || key === 'd' ||
      key === 'W' || key === 'A' || key === 'S' || key === 'D';
    const isActivate = key === 'Enter' || key === ' ';
    // 1-3 arm a Chromatic channel, so a keyboard player can supply the colour
    // half of a modified answer without reaching for the pointer.
    const channelKey = /^[1-9]$/.test(key) ? parseInt(key, 10) - 1 : -1;
    const isChannel = channelKey >= 0 && channelKey < CHROMATIC_CHANNELS.length
      && activeModifier().id !== 'none';

    if (!isMove && !isActivate && !isChannel) return;
    // Only claim these keys during play. Outside a run they belong to the
    // browser and to normal button focus.
    if (!state.isPlayable || state.isPaused) return;

    e.preventDefault();

    if (!keyboardActive) {
      keyboardActive = true;
      paintCursor();
      announce(`Keyboard control active. ${describe(cursor)}`);
      if (isMove) return;   // first press just reveals the cursor
    }

    if (isChannel) { selectChannel(channelKey); return; }

    switch (key) {
      case 'ArrowUp': case 'w': case 'W':    moveCursor(-1, 0); break;
      case 'ArrowDown': case 's': case 'S':  moveCursor(1, 0); break;
      case 'ArrowLeft': case 'a': case 'A':  moveCursor(0, -1); break;
      case 'ArrowRight': case 'd': case 'D': moveCursor(0, 1); break;
      default:
        if (isActivate) activateCursor();
    }
  });
}

/**
 * Announces a tile flashing during Observe. Without this the entire pattern —
 * the thing the player has to memorise — is conveyed only in colour.
 */
export function announceFlash(index: number, kind: 'active' | 'decoy'): void {
  if (!keyboardActive) return;
  announce(kind === 'decoy' ? `Decoy. ${describe(index)}` : describe(index));
}

/** Announces phase changes so a non-visual player knows when to act. */
export function announcePhase(phase: string): void {
  if (!keyboardActive) return;
  announce(phase);
}

/** Keyboard controls reference, shown from Settings → Accessibility. */
export function showKeyboardHelp(): void {
  document.getElementById('keyboard-help-overlay')?.remove();

  const protocolNote = PROTOCOLS[state.curProtIdx].id === 'nback'
    ? 'In 2-Back, press Enter only while a tile is lit.'
    : 'Move to a tile, then press Enter to select it.';

  const overlay = document.createElement('div');
  overlay.id = 'keyboard-help-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Keyboard controls');
  overlay.style.cssText =
    'position:fixed;inset:0;z-index:400;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(5,8,13,0.92);backdrop-filter:blur(10px);padding:1.5rem;';

  const rows: Array<[string, string]> = [
    ['Arrow keys / WASD', 'Move between tiles'],
    ['Enter or Space', 'Select the focused tile'],
    ['Tab', 'Move between buttons'],
  ];

  overlay.innerHTML =
    '<div style="background:rgba(10,15,22,0.95);border:1px solid var(--active);border-radius:6px;' +
    'padding:28px 32px;max-width:340px;width:100%;text-align:left;">' +
    '<div style="font-family:var(--font-display);font-size:0.95rem;font-weight:800;letter-spacing:2px;' +
    'color:var(--active);margin-bottom:16px;text-transform:uppercase;">Keyboard Controls</div>' +
    rows.map(([k, v]) =>
      '<div style="display:flex;gap:12px;margin-bottom:10px;align-items:baseline;">' +
      `<span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text);min-width:132px;">${k}</span>` +
      `<span style="font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);flex:1;">${v}</span>` +
      '</div>').join('') +
    `<div style="font-family:var(--font-mono);font-size:0.66rem;color:var(--text-muted);line-height:1.6;` +
    `margin-top:14px;padding-top:12px;border-top:1px solid var(--edge);">${protocolNote}<br>` +
    'Tile positions and flashes are announced to screen readers.</div>' +
    '<button id="keyboard-help-close" style="margin-top:18px;background:var(--active);color:#001016;' +
    'border:none;border-radius:3px;padding:10px 22px;font-family:var(--font-display);font-size:0.78rem;' +
    'font-weight:800;letter-spacing:1.5px;cursor:pointer;">Close</button></div>';

  document.body.appendChild(overlay);
  const closeBtn = overlay.querySelector('#keyboard-help-close') as HTMLButtonElement;
  closeBtn.focus();
  const close = () => overlay.remove();
  closeBtn.addEventListener('click', close);
  overlay.addEventListener('keydown', (e) => {
    if ((e as KeyboardEvent).key === 'Escape') close();
  });
}
