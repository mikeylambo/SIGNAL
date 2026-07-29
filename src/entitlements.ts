import { profile, saveProfile } from './save';
import { BOARD_MATERIALS } from './materials';

/**
 * One-time premium unlock.
 *
 * Deliberate boundaries, because this is a brain trainer and the genre's
 * reputation has already been damaged by the alternatives:
 *
 *  - Never gated: every protocol, every pacing, every modifier, the daily
 *    challenge, and the leaderboard. The game is complete without paying.
 *  - No energy timers, no ad-gated retries, no paid continues. In a game whose
 *    Classic mode is permadeath, charging for a retry is how you get uninstalled.
 *  - What it sells is breadth and depth of *record-keeping and cosmetics*, not
 *    advantage. A premium player and a free player post comparable scores.
 *
 * The purchase path is intentionally not wired to a provider here — that needs
 * the owner's App Store / Play / Stripe account. `isPremiumOfferAvailable()`
 * gates the UI on a configured provider so nothing ships a button that cannot
 * complete, the same way telemetry stays inert without an endpoint.
 */

const PROVIDER = import.meta.env.VITE_PURCHASE_PROVIDER as string | undefined;

/**
 * Run-history window per protocol.
 *
 * Both limits live here rather than in progression.ts. They were split across
 * the two modules and that made the imports circular — progression needed
 * historyLimit(), entitlements needed the free constant — which throws a TDZ
 * error at module init and white-screens the game. Entitlements is the right
 * owner: how much history you keep is the entitlement.
 */
export const FREE_HISTORY_LIMIT = 20;
export const PREMIUM_HISTORY_LIMIT = 500;

/** Custom palette slots. Free players get the original three. */
export const FREE_PALETTE_SLOTS = 3;
export const PREMIUM_PALETTE_SLOTS = 8;

export function hasPremium(): boolean {
  return profile.premium === true;
}

/** True when a purchase can actually be completed on this build. */
export function isPremiumOfferAvailable(): boolean {
  return !!PROVIDER && !hasPremium();
}

export function historyLimit(): number {
  return hasPremium() ? PREMIUM_HISTORY_LIMIT : FREE_HISTORY_LIMIT;
}

export function paletteSlotCount(): number {
  return hasPremium() ? PREMIUM_PALETTE_SLOTS : FREE_PALETTE_SLOTS;
}

/** Materials are all included with premium, on top of anything already bought. */
export function premiumGrantsMaterial(id: string): boolean {
  return hasPremium() && BOARD_MATERIALS.some(m => m.id === id);
}

/**
 * Records the entitlement after a provider confirms a purchase or a restore.
 * Never called speculatively — a client-set flag is not a receipt, and if this
 * ever needs to be authoritative it belongs behind the same server-side check
 * the leaderboard writes already use.
 */
export function grantPremium(): void {
  profile.premium = true;
  saveProfile();
}

export interface PremiumBenefit { title: string; detail: string; }

export const PREMIUM_BENEFITS: ReadonlyArray<PremiumBenefit> = [
  { title: 'Every board material', detail: 'All current and future treatments, unlocked.' },
  { title: `${PREMIUM_PALETTE_SLOTS} palette slots`, detail: `Up from ${FREE_PALETTE_SLOTS}.` },
  { title: 'Full performance history', detail: `${PREMIUM_HISTORY_LIMIT} runs per protocol instead of ${FREE_HISTORY_LIMIT}.` },
];
