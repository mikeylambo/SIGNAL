import { getClient } from '../lib/supabase';
import { profile, saveProfile } from '../save';
import type { LeaderboardRow } from '../types';

// ── Board key helpers ──────────────────────────────────────────────────────────

/** e.g. "spatial_classic" */
export function modeBoardKey(protocol: string, pacing: string): string {
  return `${protocol}_${pacing}`;
}

/** e.g. "daily_2026-06-22" */
export function dailyBoardKey(date: string): string {
  return `daily_${date}`;
}

/**
 * How long to wait on any leaderboard round-trip before giving up.
 * Past ~6s on mobile, "couldn't reach the leaderboard" is a better answer than
 * a spinner that might never resolve — and the panel has no other upper bound.
 */
const FETCH_TIMEOUT_MS = 6000;

// ── Client-side profanity filter ───────────────────────────────────────────────
// A UX fast-path only: it gives immediate feedback in the naming modal without a
// round-trip, and is trivially bypassed. The authoritative check lives in the
// submit_score / update_display_name DB functions (see supabase/schema.sql),
// which reject the same content server-side no matter what the client sends.
const BLOCKED_WORDS: ReadonlyArray<string> = [
  'fuck', 'shit', 'cunt', 'bitch', 'dick', 'cock', 'pussy', 'ass',
  'nigger', 'nigga', 'faggot', 'fag', 'retard', 'chink', 'spic', 'kike', 'gook',
];

function containsProfanity(name: string): boolean {
  const normalised = name.toLowerCase().replace(/[^a-z]/g, '');
  return BLOCKED_WORDS.some(w => normalised.includes(w));
}

// ── Display name helper ────────────────────────────────────────────────────────

/**
 * Sets the player's display name, persists it to the save file, and propagates
 * it to every leaderboard row the player already appears on. Was previously
 * defined but never called anywhere — it's now wired up from the Stats screen.
 */
export function setDisplayName(name: string): void {
  profile.display_name = name.trim().slice(0, 32);
  saveProfile();
  void renameEverywhere(profile.display_name);
}

/**
 * Propagates a display-name change to every board the player already appears
 * on. This is separate from submitScore()'s upsert, which only touches
 * display_name when the incoming score also beats the stored one — without
 * this, a rename with no accompanying high score would never show up on
 * boards the player has already posted to. Fire-and-forget from the caller's
 * side: errors are logged, never thrown, matching submitScore()'s contract.
 */
async function renameEverywhere(displayName: string): Promise<void> {
  try {
    const supabase = await getClient();
    const { player_id, owner_secret } = profile;
    if (!player_id || !owner_secret) return;
    if (containsProfanity(displayName)) return;

    const { error } = await supabase.rpc('update_display_name', {
      p_player_id:    player_id,
      p_owner_secret: owner_secret,
      p_display_name: displayName.trim().slice(0, 32),
    }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));
    if (error) throw error;
  } catch (err) {
    console.warn('[leaderboard] renameEverywhere failed:', err);
  }
}

// ── Submit score ───────────────────────────────────────────────────────────────

/**
 * Upserts a score for the current player on `boardKey`.
 * The server only updates the row when the new score beats the stored one.
 * Returns whether this run was a new personal best on this board — always
 * `false` on any network or validation failure, never thrown; the game must
 * never crash or block on a leaderboard write, so a failure just means "no
 * new-best banner this time," not an error surfaced to the player.
 */
export async function submitScore(
  boardKey: string,
  score: number,
  levelReached: number,
  protocol?: string,
  pacing?: string,
): Promise<boolean> {
  try {
    const supabase = await getClient();
    const { player_id, owner_secret, display_name } = profile;

    if (!player_id) throw new Error('player_id not initialised');
    if (!owner_secret) throw new Error('owner_secret not initialised');
    if (!display_name || display_name.trim().length === 0) {
      throw new Error('display_name is empty — set one before submitting to the leaderboard');
    }
    if (containsProfanity(display_name)) {
      throw new Error('display_name contains disallowed content');
    }

    const { data, error } = await supabase.rpc('submit_score', {
      p_board_key:     boardKey,
      p_player_id:     player_id,
      p_owner_secret:  owner_secret,
      p_display_name:  display_name.trim().slice(0, 32),
      p_score:         score,
      p_level_reached: levelReached,
      p_protocol:      protocol ?? null,
      p_pacing:        pacing ?? null,
    }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

    if (error) throw error;
    return data === true;
  } catch (err) {
    // Leaderboard failures must never surface to the player or crash the game.
    console.warn('[leaderboard] submitScore failed:', err);
    return false;
  }
}

// ── Reporting ──────────────────────────────────────────────────────────────────

/**
 * Flags another player's display name for moderator review.
 *
 * The server dedupes by (reported, reporter) and verifies the reporter's
 * owner_secret, so this can't be used to brigade someone — calling it twice is
 * a no-op, and a client can only report as an identity it actually owns.
 *
 * Resolves `true` when the report was accepted. Never throws: a failed report
 * should show a neutral message, not break the leaderboard the player is
 * looking at.
 */
export async function reportPlayer(reportedPlayerId: string): Promise<boolean> {
  try {
    const supabase = await getClient();
    const { player_id, owner_secret } = profile;
    if (!player_id || !owner_secret) return false;
    if (reportedPlayerId === player_id) return false;

    const { error } = await supabase.rpc('report_player', {
      p_reported_player_id: reportedPlayerId,
      p_reporter_player_id: player_id,
      p_owner_secret:       owner_secret,
    }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

    if (error) throw error;
    return true;
  } catch (err) {
    console.warn('[leaderboard] reportPlayer failed:', err);
    return false;
  }
}

// ── Erasure ────────────────────────────────────────────────────────────────────

/**
 * Deletes everything the backend holds for this player: their rows on every
 * board, any reports referencing them, and the stored identity itself.
 *
 * This is the player's right-to-erasure path, and it is the one leaderboard call
 * that deliberately **does** report failure to the caller. Every other function
 * here fails quietly because a lost score is a cosmetic loss; telling someone
 * their data is gone when the request never landed is not cosmetic, so the UI
 * needs a real result to show.
 *
 * After a successful delete the local leaderboard identity is regenerated rather
 * than reused: keeping the old `player_id` would silently re-claim the erased
 * identity on the next submit, quietly resurrecting the association the player
 * just asked to remove. `display_name` is cleared too, so the next submission
 * prompts for a callsign like a fresh install.
 *
 * Resolves the number of score rows removed, or rejects with a reportable error.
 */
export async function deletePlayerData(): Promise<number> {
  const { player_id, owner_secret } = profile;
  // Checked before getClient(): with no identity there is nothing to erase, and
  // a player in that state should be told "nothing to remove" rather than shown
  // a connection error from a client they never needed.
  if (!player_id || !owner_secret) return 0;

  const supabase = await getClient();
  const { data, error } = await supabase.rpc('delete_player_data', {
    p_player_id:    player_id,
    p_owner_secret: owner_secret,
  }).abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

  if (error) throw error;

  profile.player_id    = crypto.randomUUID();
  profile.owner_secret = crypto.randomUUID();
  profile.display_name = '';
  saveProfile();

  return typeof data === 'number' ? data : 0;
}

// ── Fetch top scores ───────────────────────────────────────────────────────────

/**
 * Returns the top `limit` scores for `boardKey`, ranked by score descending.
 *
 * Throws on network/validation failure rather than returning `[]`. Swallowing
 * the error here meant an unreachable backend rendered as the empty-board state
 * — "No scores yet — you might be first." — which tells the player something
 * false about a board that may be full. Callers distinguish the two: an empty
 * array means the board really is empty; a rejection means we don't know.
 */
export async function fetchBoard(
  boardKey: string,
  limit = 10,
): Promise<LeaderboardRow[]> {
  const supabase = await getClient();
  // Without this a hung connection leaves the panel on its loading skeleton
  // indefinitely — there was no upper bound on how long a read could pend.
  const { data, error } = await supabase
    .from('leaderboard_scores')
    .select('display_name, score, player_id, created_at')
    .eq('board_key', boardKey)
    .order('score', { ascending: false })
    .limit(limit)
    .abortSignal(AbortSignal.timeout(FETCH_TIMEOUT_MS));

  if (error) throw error;

  return (data ?? []).map((row, i) => ({
    rank:         i + 1,
    display_name: row.display_name as string,
    score:        row.score as number,
    player_id:    row.player_id as string,
    achieved_at:  row.created_at as string,
  }));
}
