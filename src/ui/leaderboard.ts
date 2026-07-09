import { fetchBoard, modeBoardKey, dailyBoardKey } from '../game/leaderboard';
import { profile } from '../save';
import { isReducedMotion } from '../reducedMotion';
import type { LeaderboardRow } from '../types';
import { PROTOCOLS, PACINGS } from '../game/protocols';
import { state } from '../state';
import { returnToMenu } from './modals';

// ── Display name prompt ────────────────────────────────────────────────────────

export function promptDisplayName(): Promise<string | null> {
  return new Promise(resolve => {
    const modal   = document.getElementById('display-name-modal')!;
    const titleEl = document.getElementById('display-name-title')!;
    const input   = document.getElementById('display-name-input') as HTMLInputElement;
    const confirm = document.getElementById('display-name-confirm')!;
    const skip    = document.getElementById('display-name-skip')!;
    const errorEl = document.getElementById('display-name-error')!;

    // Same modal serves two contexts: first-run setup (no existing name) and
    // rename from the Stats screen (existing name present) — recomputed fresh
    // each open so it always matches current profile state.
    const hasExisting = !!profile.display_name;
    titleEl.textContent = hasExisting ? 'Change Callsign' : 'Choose a Name';
    skip.textContent = hasExisting ? 'Cancel' : 'Skip';
    input.value = profile.display_name ?? '';
    errorEl.style.display = 'none';
    modal.style.display = 'flex';
    setTimeout(() => input.focus(), 50);

    function cleanup() {
      modal.style.display = 'none';
      confirm.removeEventListener('click', onConfirm);
      skip.removeEventListener('click', onSkip);
      input.removeEventListener('keydown', onKeydown);
    }

    function onConfirm() {
      const name = input.value.trim();
      if (!name) {
        errorEl.textContent = 'Enter a callsign to continue, or skip.';
        errorEl.style.display = 'block';
        return;
      }
      if (name.length > 20) {
        errorEl.textContent = 'Callsign must be 20 characters or fewer.';
        errorEl.style.display = 'block';
        return;
      }
      cleanup();
      resolve(name);
    }

    function onSkip() {
      cleanup();
      resolve(null);
    }

    function onKeydown(e: KeyboardEvent) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onSkip();
    }

    confirm.addEventListener('click', onConfirm);
    skip.addEventListener('click', onSkip);
    input.addEventListener('keydown', onKeydown);
  });
}

// ── Leaderboard panel ──────────────────────────────────────────────────────────

/**
 * Fetches and renders `mode`'s top scores into an arbitrary body element,
 * with an optional title element. Shared by the end-of-run panel and the
 * standalone leaderboard browser so both stay in sync with one implementation.
 */
export async function renderBoardInto(
  mode: string,
  bodyEl: HTMLElement,
  titleEl?: HTMLElement | null,
  limit = 10,
): Promise<void> {
  if (titleEl) titleEl.textContent = formatModeTitle(mode);

  // Skeleton renders synchronously before the await so the panel fills immediately
  bodyEl.innerHTML = buildSkeleton();

  try {
    const scores = await fetchBoard(mode, limit);
    renderRows(scores, bodyEl);
  } catch {
    bodyEl.innerHTML = '<div style="padding:12px;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);">Could not load leaderboard.</div>';
  }
}

export async function showLeaderboardPanel(mode: string): Promise<void> {
  const body    = document.getElementById('leaderboard-body')!;
  const titleEl = document.getElementById('leaderboard-title');
  await renderBoardInto(mode, body, titleEl);
}

// "daily_2026-06-22" → "DAILY · JUN 22"
// "spatial_classic"  → "SPATIAL · CLASSIC"
function formatModeTitle(mode: string): string {
  if (mode.startsWith('daily_')) {
    const dateStr = mode.slice(6); // '2026-06-22'
    // Append T00:00:00 to force local-time parsing (bare date strings parse as UTC)
    const date = new Date(dateStr + 'T00:00:00');
    const formatted = date.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric',
    }).toUpperCase();
    return `DAILY · ${formatted}`;
  }
  return mode.split('_').map(s => s.toUpperCase()).join(' · ');
}

function buildSkeleton(): string {
  const anim = isReducedMotion() ? '' : 'animation:lbPulse 1.4s ease-in-out infinite;';
  return [0, 1, 2].map(i =>
    `<div style="height:28px;border-radius:2px;margin:6px;background:rgba(255,255,255,0.06);${anim}animation-delay:${i * 0.15}s;"></div>`
  ).join('');
}

function renderRows(scores: LeaderboardRow[], body: HTMLElement): void {
  if (scores.length === 0) {
    body.innerHTML = '<div style="padding:12px;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);">No scores yet — you might be first.</div>';
    return;
  }

  body.innerHTML = scores.map(row => {
    const isMe = row.player_id === profile.player_id;
    const highlight = isMe
      ? 'color:var(--active);border-left:2px solid var(--active);padding-left:10px;'
      : 'padding-left:12px;';
    return [
      `<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;`,
      `border-bottom:1px solid rgba(255,255,255,0.04);${highlight}">`,
      `<span style="font-family:var(--font-mono);font-size:0.72rem;color:var(--text-muted);min-width:20px;">${row.rank}</span>`,
      `<span style="font-family:var(--font-display);font-size:0.82rem;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(row.display_name)}</span>`,
      `<span style="font-family:var(--font-mono);font-size:0.82rem;font-weight:700;">${row.score.toLocaleString()}</span>`,
      `</div>`,
    ].join('');
  }).join('');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ── Standalone leaderboard browser ───────────────────────────────────────────
// Lets players check any board from the menu, independent of playing a run.
// Reuses renderBoardInto() so rendering never drifts from the end-of-run panel.

let browserProtocolIdx = 0;
let browserPacingIdx = 0;
let browserIsDaily = false;

function currentBrowserMode(): string {
  if (browserIsDaily) return dailyBoardKey(new Date().toISOString().split('T')[0]);
  return modeBoardKey(PROTOCOLS[browserProtocolIdx].id, PACINGS[browserPacingIdx].id);
}

function refreshBrowserChips(): void {
  const dailyChip = document.getElementById('lb-daily-chip') as HTMLButtonElement;
  dailyChip.style.borderColor = browserIsDaily ? 'var(--active)' : 'rgba(255,255,255,0.12)';
  dailyChip.style.color       = browserIsDaily ? 'var(--active)' : 'var(--text-muted)';

  document.querySelectorAll<HTMLButtonElement>('.lb-protocol-chip').forEach((btn, i) => {
    const active = !browserIsDaily && i === browserProtocolIdx;
    btn.style.borderColor = active ? 'var(--active)' : 'rgba(255,255,255,0.12)';
    btn.style.color       = active ? 'var(--active)' : 'var(--text-muted)';
  });
  document.querySelectorAll<HTMLButtonElement>('.lb-pacing-chip').forEach((btn, i) => {
    const active = !browserIsDaily && i === browserPacingIdx;
    btn.style.borderColor = active ? 'var(--active)' : 'rgba(255,255,255,0.12)';
    btn.style.color       = active ? 'var(--active)' : 'var(--text-muted)';
  });
}

async function refreshBrowserBoard(): Promise<void> {
  refreshBrowserChips();
  const body    = document.getElementById('lb-browser-body')!;
  const titleEl = document.getElementById('lb-browser-title');
  await renderBoardInto(currentBrowserMode(), body, titleEl, 25);
}

function chipStyle(): string {
  return 'background:none; border:1px solid rgba(255,255,255,0.12); border-radius:3px; ' +
    'padding:7px 11px; font-family:var(--font-mono); font-size:0.7rem; letter-spacing:0.5px; ' +
    'color:var(--text-muted); cursor:pointer; white-space:nowrap;';
}

/** Builds the protocol/pacing chip rows once. Safe to call multiple times — clears first. */
function buildBrowserChips(): void {
  const protocolRow = document.getElementById('lb-protocol-row')!;
  const pacingRow   = document.getElementById('lb-pacing-row')!;
  protocolRow.innerHTML = '';
  pacingRow.innerHTML = '';

  PROTOCOLS.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'lb-protocol-chip';
    btn.style.cssText = chipStyle();
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      browserProtocolIdx = i;
      browserIsDaily = false;
      void refreshBrowserBoard();
    });
    protocolRow.appendChild(btn);
  });

  PACINGS.forEach((p, i) => {
    const btn = document.createElement('button');
    btn.className = 'lb-pacing-chip';
    btn.style.cssText = chipStyle();
    btn.textContent = p.name;
    btn.addEventListener('click', () => {
      browserPacingIdx = i;
      browserIsDaily = false;
      void refreshBrowserBoard();
    });
    pacingRow.appendChild(btn);
  });
}

let browserChipsBuilt = false;

/** Opens the leaderboard browser, defaulting to whatever mode is currently selected in the menu. */
export function openLeaderboardBrowser(): void {
  if (!browserChipsBuilt) {
    buildBrowserChips();
    browserChipsBuilt = true;
  }

  browserProtocolIdx = state.curProtIdx;
  browserPacingIdx = state.curPaceIdx;
  browserIsDaily = false;

  (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
  (document.getElementById('leaderboard-browser-screen') as HTMLElement).style.display = 'flex';

  void refreshBrowserBoard();
}

export function setupLeaderboardBrowser(): void {
  document.getElementById('lb-daily-chip')!.addEventListener('click', () => {
    browserIsDaily = true;
    void refreshBrowserBoard();
  });
  document.getElementById('close-leaderboard-browser-btn')!.addEventListener('click', returnToMenu);
}
