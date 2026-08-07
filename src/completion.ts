/**
 * "Has this player bought everything?" — and what the balance means once they have.
 *
 * ── The problem ──────────────────────────────────────────────────────────────
 *
 * Signal has a fixed sink: 7,700 in materials, 4,000 in Calibrations, 4,000 in
 * audio layers. 15,700 total, and nothing renewable behind it. At the payout
 * curve in economy.ts a strong player clears all of it in roughly 56 runs.
 *
 * After that the currency keeps accruing and can never be spent. The header goes
 * on counting up a number with no use, and the Shop stays in the nav as a room
 * with nothing in it. That is the actual flaw — not that the economy saturates
 * (nearly every cosmetic economy does; saturation is completion) but that the
 * game had no answer for what happens when it does.
 *
 * ── The answer ───────────────────────────────────────────────────────────────
 *
 * The balance stops being a wallet and becomes a record. Once everything is
 * owned, the header shows lifetime Signal mined instead of a spendable balance —
 * a number that only ever grows, means "how long I have been at this", and is
 * shown next to the player's leaderboard entry where other people can see it.
 *
 * That deliberately adds no new content and grants no advantage: `lifetime
 * .signalMined` is already tracked, and the change is what the number *is*, not
 * what it buys. Premium never gates play and Signal never buys an edge — a
 * public record of time invested is the one kind of value a leaderboard game can
 * add here without touching either rule.
 *
 * ── Why this file exists at all ──────────────────────────────────────────────
 *
 * It cannot live in economy.ts. save.ts imports STARTING_SIGNAL from there, so
 * economy.ts must import nothing — and this check needs materials.ts and
 * audioUnlocks.ts, both of which import save.ts. Putting it in economy.ts would
 * close the loop save → economy → materials → save, and a cycle through save.ts
 * throws a TDZ error at init and white-screens the game. That has happened once
 * already, with FREE_HISTORY_LIMIT. This module is a leaf: it imports downward
 * and nothing imports it except UI.
 */

import { profile, themes } from './save';
import { BOARD_MATERIALS, isMaterialUnlocked } from './materials';
import { AUDIO_UNLOCKS, isAudioUnlocked } from './audioUnlocks';

/** Every Calibration with a price — the free ones are not part of the sink. */
function paidCalibrationIds(): string[] {
  return Object.entries(themes)
    .filter(([, theme]) => (theme.price ?? 0) > 0)
    .map(([key]) => key);
}

/**
 * True when there is nothing left in the shop this player can buy.
 *
 * Counts only priced items. Premium-granted materials count as owned, because
 * from the player's side the Shop is equally empty either way — the question
 * this answers is "is there anything left to spend on", not "did you pay".
 */
export function hasBoughtEverything(): boolean {
  const materials = BOARD_MATERIALS
    .filter(m => m.price > 0)
    .every(m => isMaterialUnlocked(m.id));

  const audio = AUDIO_UNLOCKS.every(a => isAudioUnlocked(a.id));

  const owned = profile.unlockedCalibrations ?? [];
  const calibrations = paidCalibrationIds().every(id => owned.includes(id));

  return materials && audio && calibrations;
}

/**
 * What the header should show, and how to label it.
 *
 * Returned together rather than as two calls so the value and its label can
 * never disagree — showing a lifetime total under a "balance" label would be
 * worse than either alone.
 */
export function headerSignal(): { value: number; label: string; isRecord: boolean } {
  if (hasBoughtEverything()) {
    return {
      value: profile.lifetime?.signalMined ?? 0,
      label: 'Signal mined, lifetime',
      isRecord: true,
    };
  }
  return { value: profile.signal, label: 'Signal balance', isRecord: false };
}
