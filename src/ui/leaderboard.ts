import { fetchBoard } from '../game/leaderboard';
import { profile } from '../save';
import { isReducedMotion } from '../reducedMotion';
import type { LeaderboardRow } from '../types';

// ── Display name prompt ────────────────────────────────────────────────────────

export function promptDisplayName(): Promise<string | null> {
  return new Promise(resolve => {
    const modal   = document.getElementById('display-name-modal')!;
    const input   = document.getElementById('display-name-input') as HTMLInputElement;
    const confirm = document.getElementById('display-name-confirm')!;
    const skip    = document.getElementById('display-name-skip')!;
    const errorEl = document.getElementById('display-name-error')!;

    input.value = '';
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

export async function showLeaderboardPanel(mode: string): Promise<void> {
  const body  = document.getElementById('leaderboard-body')!;
  const title = document.getElementById('leaderboard-title')!;

  title.textContent = mode.startsWith('daily:')
    ? 'Daily Challenge'
    : mode.replace('mode:', '').replace(':', ' · ').toUpperCase();

  // Skeleton renders synchronously before the await so the panel fills immediately
  body.innerHTML = buildSkeleton();

  try {
    const scores = await fetchBoard(mode, 10);
    renderRows(scores, body);
  } catch {
    body.innerHTML = '<div style="padding:12px;font-family:var(--font-mono);font-size:0.78rem;color:var(--text-muted);">Could not load leaderboard.</div>';
  }
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
