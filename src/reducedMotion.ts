// Reduced-motion mode: respects the OS/browser prefers-reduced-motion media
// query on first load, and can be toggled explicitly by the player in-game.
// When active: camera drift, grid scroll, and camera shake are all disabled.
// Cube scale/position animations are kept because they are the primary game
// feedback signal — disabling them would make correct/wrong hits invisible.

const MQ = window.matchMedia('(prefers-reduced-motion: reduce)');

let _reduced = MQ.matches;

// Keep in sync if the user changes their OS setting while the tab is open.
MQ.addEventListener('change', (e) => { _reduced = e.matches; });

export function isReducedMotion(): boolean { return _reduced; }

export function setReducedMotion(on: boolean): void { _reduced = on; }

export function toggleReducedMotion(): boolean {
  _reduced = !_reduced;
  return _reduced;
}
