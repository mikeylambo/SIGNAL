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

// ── Client-side profanity filter ───────────────────────────────────────────────
// This is a last-resort UX guard only — trivially bypassed by a motivated bad actor.
// For app-store compliance the submit_score DB function is the right place for
// stronger moderation: a content-classification call, manual report queue, or
// automated ban list surfaced in a moderation dashboard.
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
    const supabase = getClient();
    const { player_id, owner_secret } = profile;
    if (!player_id || !owner_secret) return;
    if (containsProfanity(displayName)) return;

    const { error } = await supabase.rpc('update_display_name', {
      p_player_id:    player_id,
      p_owner_secret: owner_secret,
      p_display_name: displayName.trim().slice(0, 32),
    });
    if (error) throw error;
  } catch (err) {
    console.warn('[leaderboard] renameEverywhere failed:', err);
  }
}

// ── Submit score ───────────────────────────────────────────────────────────────

/**
 * Upserts a score for the current player on `boardKey`.
 * The server only updates the row when the new score beats the stored one.
 * Any network or validation failure is caught and logged — the game never crashes.
 */
export async function submitScore(
  boardKey: string,
  score: number,
  levelReached: number,
  protocol?: string,
  pacing?: string,
): Promise<void> {
  try {
    const supabase = getClient();
    const { player_id, owner_secret, display_name } = profile;

    if (!player_id) throw new Error('player_id not initialised');
    if (!owner_secret) throw new Error('owner_secret not initialised');
    if (!display_name || display_name.trim().length === 0) {
      throw new Error('display_name is empty — set one before submitting to the leaderboard');
    }
    if (containsProfanity(display_name)) {
      throw new Error('display_name contains disallowed content');
    }

    const { error } = await supabase.rpc('submit_score', {
      p_board_key:     boardKey,
      p_player_id:     player_id,
      p_owner_secret:  owner_secret,
      p_display_name:  display_name.trim().slice(0, 32),
      p_score:         score,
      p_level_reached: levelReached,
      p_protocol:      protocol ?? null,
      p_pacing:        pacing ?? null,
    });

    if (error) throw error;
  } catch (err) {
    // Leaderboard failures must never surface to the player or crash the game.
    console.warn('[leaderboard] submitScore failed:', err);
  }
}

// ── Fetch top scores ───────────────────────────────────────────────────────────

/**
 * Returns the top `limit` scores for `boardKey`, ranked by score descending.
 * Returns an empty array on any error so callers need no special handling.
 */
export async function fetchBoard(
  boardKey: string,
  limit = 10,
): Promise<LeaderboardRow[]> {
  try {
    const supabase = getClient();
    const { data, error } = await supabase
      .from('leaderboard_scores')
      .select('display_name, score, player_id, created_at')
      .eq('board_key', boardKey)
      .order('score', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data ?? []).map((row, i) => ({
      rank:         i + 1,
      display_name: row.display_name as string,
      score:        row.score as number,
      player_id:    row.player_id as string,
      achieved_at:  row.created_at as string,
    }));
  } catch (err) {
    console.warn('[leaderboard] fetchBoard failed:', err);
    return [];
  }
}
