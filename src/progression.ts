import { profile, saveProfile } from './save';
import { PROTOCOLS } from './game/protocols';
import type { ProtocolMastery } from './types';
import { historyLimit } from './entitlements';

/**
 * Per-protocol mastery — the game's long-arc progression.
 *
 * The economy (themes, audio unlocks) tops out after a few thousand Signal,
 * after which a run had nothing to advance. Mastery gives each of the five
 * protocols its own independent curve, so there is always a next rank on
 * something, and the Stats screen shows at a glance which protocol is lagging.
 *
 * Deliberately additive: nothing here gates content or changes run scoring.
 * It records what already happened and derives a rank from it.
 */

// The history window lives in entitlements.ts — it is an entitlement, and
// splitting it across both modules made their imports circular.
export { FREE_HISTORY_LIMIT as MASTERY_HISTORY_LIMIT } from './entitlements';

/**
 * Cumulative points needed to reach each rank. Index 0 is rank I.
 *
 * The first threshold is 1, not 0: a protocol you have never played must read
 * "Unranked" (rank 0), and the cheapest possible run is worth 6 points, so any
 * completed run earns rank I. With a 0 here every untouched protocol scored
 * rank I on a fresh save and the Stats total opened at 5/50 instead of 0/50.
 *
 * Roughly geometric beyond that: early ranks land within a session or two to
 * establish the loop, later ranks take sustained play. Reaching X is meant to
 * be a long-haul goal, not a weekend.
 */
const RANK_THRESHOLDS: ReadonlyArray<number> = [
  1, 120, 300, 620, 1100, 1800, 2900, 4400, 6500, 9400,
];

export const MAX_RANK = RANK_THRESHOLDS.length; // 10

/** Display titles per rank. Index 0 is unranked. */
const RANK_TITLES: ReadonlyArray<string> = [
  'Unranked', 'Initiate', 'Calibrated', 'Tuned', 'Attuned', 'Resonant',
  'Coherent', 'Phase-Locked', 'Harmonic', 'Lucid', 'Singular',
];

const ROMAN: ReadonlyArray<string> = [
  '', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X',
];

export function emptyMastery(): ProtocolMastery {
  return { points: 0, bestScore: 0, bestLevel: 0, runs: 0, history: [] };
}

export function getMastery(protocolId: string): ProtocolMastery {
  if (!profile.protocolMastery) profile.protocolMastery = {};
  let m = profile.protocolMastery[protocolId];
  if (!m) {
    m = emptyMastery();
    profile.protocolMastery[protocolId] = m;
  }
  // Backfill fields individually: a save written by an older build (or a
  // hand-edited one) can carry a partial object, and reading `.history.length`
  // off undefined would throw straight into load()'s reset-the-profile catch.
  if (typeof m.points !== 'number') m.points = 0;
  if (typeof m.bestScore !== 'number') m.bestScore = 0;
  if (typeof m.bestLevel !== 'number') m.bestLevel = 0;
  if (typeof m.runs !== 'number') m.runs = 0;
  if (!Array.isArray(m.history)) m.history = [];
  return m;
}

/**
 * Mastery points for one run. Level is weighted heavily relative to raw score
 * because score inflates with combo multipliers and pacing, while level is a
 * fairly honest read on how deep the player actually got.
 */
export function pointsForRun(score: number, level: number): number {
  return Math.max(0, Math.floor(score / 50) + level * 6);
}

export function rankForPoints(points: number): number {
  if (points <= 0) return 0;
  let rank = 0;
  for (let i = 0; i < RANK_THRESHOLDS.length; i++) {
    if (points >= RANK_THRESHOLDS[i]) rank = i + 1;
  }
  return Math.min(rank, MAX_RANK);
}

export function rankTitle(rank: number): string {
  return RANK_TITLES[Math.min(rank, RANK_TITLES.length - 1)] ?? 'Unranked';
}

export function rankNumeral(rank: number): string {
  return ROMAN[Math.min(rank, ROMAN.length - 1)] ?? '';
}

/** Points into the current rank, and points spanning it. Both 0 at max rank. */
export function rankProgress(points: number): { into: number; span: number; pct: number } {
  const rank = rankForPoints(points);
  if (rank >= MAX_RANK) return { into: 0, span: 0, pct: 100 };
  const floorPts = RANK_THRESHOLDS[rank - 1] ?? 0;
  const nextPts = RANK_THRESHOLDS[rank];
  const span = nextPts - floorPts;
  const into = points - floorPts;
  return { into, span, pct: span > 0 ? Math.min(100, (into / span) * 100) : 0 };
}

export interface MasteryResult {
  protocolId: string;
  pointsGained: number;
  totalPoints: number;
  rank: number;
  rankedUp: boolean;
  previousRank: number;
  isBestScore: boolean;
}

/**
 * Records a completed run against its protocol. Called once per run from the
 * results screen, alongside recordRun(). Onboarding and aborted runs never
 * reach here.
 */
export function recordProtocolRun(
  protocolId: string,
  score: number,
  level: number,
  dateISO: string,
): MasteryResult {
  const m = getMastery(protocolId);
  const previousRank = rankForPoints(m.points);

  const pointsGained = pointsForRun(score, level);
  m.points += pointsGained;
  m.runs += 1;

  const isBestScore = score > m.bestScore;
  if (isBestScore) m.bestScore = score;
  if (level > m.bestLevel) m.bestLevel = level;

  m.history.push({ d: dateISO, s: score, l: level });
  // Premium widens the window rather than unlocking a separate feature — the
  // free tier still gets a real trend line, just a shorter one.
  const limit = historyLimit();
  if (m.history.length > limit) {
    m.history.splice(0, m.history.length - limit);
  }

  const rank = rankForPoints(m.points);
  saveProfile();

  return {
    protocolId,
    pointsGained,
    totalPoints: m.points,
    rank,
    rankedUp: rank > previousRank,
    previousRank,
    isBestScore,
  };
}

/** Overall progression: summed rank across all protocols, for the Stats header. */
export function overallMastery(): { totalRank: number; maxTotal: number } {
  const totalRank = PROTOCOLS.reduce((sum, p) => sum + rankForPoints(getMastery(p.id).points), 0);
  return { totalRank, maxTotal: PROTOCOLS.length * MAX_RANK };
}

/**
 * Inline SVG sparkline of a protocol's recent run scores.
 *
 * Normalised to the protocol's own min/max rather than a global scale — the
 * question this answers is "am I improving at this protocol", and Sprint scores
 * are an order of magnitude off Zen's, so a shared axis would flatten every
 * curve into a straight line. Returns '' when there isn't enough history to
 * show a trend, so callers can fall back to a placeholder.
 */
export function sparklineSVG(history: ReadonlyArray<{ s: number }>, color: string): string {
  if (history.length < 2) return '';
  const w = 72, h = 18, pad = 1.5;
  const scores = history.map(r => r.s);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const span = max - min || 1;
  const stepX = (w - pad * 2) / (scores.length - 1);

  const pts = scores.map((s, i) => {
    const x = pad + i * stepX;
    const y = h - pad - ((s - min) / span) * (h - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const last = pts[pts.length - 1].split(',');
  return [
    `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true" style="display:block;">`,
    `<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.25"`,
    ` stroke-linejoin="round" stroke-linecap="round" opacity="0.85" />`,
    `<circle cx="${last[0]}" cy="${last[1]}" r="1.8" fill="${color}" />`,
    `</svg>`,
  ].join('');
}

/** Renders the Stats screen's mastery breakdown. Safe to call repeatedly. */
export function renderMasteryList(): void {
  const list = document.getElementById('prof-mastery-list');
  const totalEl = document.getElementById('prof-mastery-total');
  if (!list) return;

  const { totalRank, maxTotal } = overallMastery();
  if (totalEl) totalEl.textContent = `${totalRank} / ${maxTotal}`;

  list.innerHTML = PROTOCOLS.map(p => {
    const m = getMastery(p.id);
    const rank = rankForPoints(m.points);
    const prog = rankProgress(m.points);
    const spark = sparklineSVG(m.history, rank > 0 ? 'var(--active)' : 'var(--text-muted)');
    const rankLabel = rank > 0 ? `${rankNumeral(rank)} · ${rankTitle(rank)}` : 'Unranked';
    const detail = m.runs === 0
      ? 'No runs yet'
      : `${m.runs} run${m.runs === 1 ? '' : 's'} · best ${m.bestScore.toLocaleString()} · Lv ${m.bestLevel}`;

    return [
      '<div style="padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.05);">',
      '<div style="display:flex; align-items:center; justify-content:space-between; gap:10px;">',
      `<span style="font-family:var(--font-display); font-size:0.8rem; font-weight:700;">${p.name}</span>`,
      `<span style="font-family:var(--font-mono); font-size:0.68rem; color:${rank > 0 ? 'var(--active)' : 'var(--text-muted)'}; letter-spacing:1px;">${rankLabel}</span>`,
      '</div>',
      '<div style="display:flex; align-items:center; gap:10px; margin-top:6px;">',
      '<div style="flex:1; height:4px; border-radius:2px; background:rgba(255,255,255,0.07); overflow:hidden;">',
      `<div style="height:100%; width:${prog.pct}%; background:var(--active); opacity:0.8;"></div>`,
      '</div>',
      spark || '<div style="width:72px;"></div>',
      '</div>',
      `<div style="font-family:var(--font-mono); font-size:0.62rem; color:var(--text-muted); margin-top:5px; letter-spacing:0.5px;">${detail}</div>`,
      '</div>',
    ].join('');
  }).join('');
}
