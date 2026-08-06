/**
 * What a finished run pays.
 *
 * Split out of runLoop.ts because it is policy, not mechanics: the numbers here
 * decide whether a new player ever reaches the shop, and they deserve to be
 * readable and testable without starting a game.
 *
 * ── The problem this replaced ────────────────────────────────────────────────
 *
 * Payout was `score / 10`, and score grows faster than linearly with level. So
 * against real leaderboard rows:
 *
 *     level 2,  score 95    →   9 Signal
 *     level 12, score 2160  → 216 Signal
 *
 * a 24x spread. The cheapest item in the shop is 400, so a strong player bought
 * something every other run while a beginner needed forty. **The player who most
 * needed a reason to come back earned the least**, and in a fifteen-minute
 * session nobody reached the shop at all.
 *
 * ── The shape now ───────────────────────────────────────────────────────────
 *
 * Two additions, both aimed at the bottom of the curve rather than the top:
 *
 *  - A FLOOR, so finishing a run is always worth something. This is what makes
 *    the first twenty minutes feel like progress instead of noise.
 *  - A flat per-level bonus, which is proportionally far larger for a short run
 *    than a long one — it more than doubles a beginner's payout and adds under a
 *    third to an expert's.
 *
 * The spread drops from ~24x to ~14x. Deliberately not to 1x: the leaderboard is
 * the reward for playing well, and flattening the economy completely would make
 * improvement pay nothing.
 *
 * ── Zen ─────────────────────────────────────────────────────────────────────
 *
 * Zen used to pay `maxStreak * 2`, which ignored the score it had actually
 * accumulated — a 30-streak run paid 60 where a comparable Classic run paid 200.
 * Zen is the no-pressure pacing, the one a tired or anxious player picks, and it
 * paid a quarter as much for the same work.
 *
 * It now uses the same formula, but capped, because Zen is the one pacing with
 * **no fail state** — a mistake resets the streak rather than ending the run, so
 * an unbounded rate would let a player mint Signal forever by never stopping.
 * The cap is what makes equal treatment safe rather than exploitable.
 */

/** Any completed run pays at least this. */
export const PAYOUT_FLOOR = 20;

/** Added per level reached. Flat on purpose — see the header. */
export const PAYOUT_PER_LEVEL = 5;

/** Divisor on score. The daily pays double, as the retention hook. */
export const PAYOUT_SCORE_DIVISOR = 10;
export const PAYOUT_SCORE_DIVISOR_DAILY = 5;

/**
 * Zen has no fail state, so its payout must be bounded or it is a money
 * printer. Set above a strong Classic run's typical payout minus a little, so
 * choosing Zen costs you some upside without feeling punished.
 */
export const ZEN_PAYOUT_CAP = 150;

/**
 * Signal granted to a brand-new profile.
 *
 * Not generosity — reachability. At the rates above a new player banks roughly
 * 250-350 in their first session, and the cheapest material is 400. Without a
 * seed the shop is something they read about and never touch, which is the same
 * as it not existing. With one, the first unlock lands inside the first sitting
 * and the economy becomes a thing they have participated in rather than a
 * screen full of prices.
 *
 * Applies at profile creation only, so it never grants anything retroactively.
 */
export const STARTING_SIGNAL = 150;

export interface PayoutInput {
  score: number;
  /** Level reached. Clamped to >= 1; a run that ended in level 1 still counts. */
  level: number;
  pacingId: string;
  isDaily: boolean;
}

/**
 * Signal earned by a finished run. Never negative, never fractional.
 *
 * Onboarding runs do not call this — the tutorial deliberately pays nothing, so
 * the first real run is the first payout a player ever sees.
 */
export function runPayout({ score, level, pacingId, isDaily }: PayoutInput): number {
  const safeScore = Number.isFinite(score) ? Math.max(0, score) : 0;
  const safeLevel = Number.isFinite(level) ? Math.max(1, level) : 1;

  const divisor = isDaily ? PAYOUT_SCORE_DIVISOR_DAILY : PAYOUT_SCORE_DIVISOR;
  const base = Math.floor(safeScore / divisor) + safeLevel * PAYOUT_PER_LEVEL;

  const earned = Math.max(PAYOUT_FLOOR, base);

  // The cap applies after the floor, so a very short Zen run still gets the
  // floor rather than being squeezed between the two.
  return pacingId === 'zen' ? Math.min(ZEN_PAYOUT_CAP, earned) : earned;
}
