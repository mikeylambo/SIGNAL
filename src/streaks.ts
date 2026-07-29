import { profile, saveProfile } from './save';

function yesterday(today: string): string {
  const d = new Date(today + 'T00:00:00');
  d.setDate(d.getDate() - 1);
  return d.toISOString().split('T')[0];
}

/** Called at the start of any game session (any mode). */
export function recordActivity(today: string): void {
  if (profile.lastActivityDate === today) return;
  profile.lastActivityDate = today;
  saveProfile();
}

export interface DailyStreakResult {
  currentStreak: number;
  longestStreak: number;
  isNewRecord: boolean;
  isMilestone: boolean;
  milestoneValue: number | null;
}

const STREAK_MILESTONES: ReadonlyArray<number> = [3, 7, 14, 30, 60, 100];

/**
 * Called when a daily challenge run ends (success or failure).
 *
 * Returns the resulting streak state. The results screen used to build this
 * object itself with `isNewRecord`/`isMilestone` hardcoded to false, which made
 * the milestone title and the new-record streak colour unreachable — hitting a
 * 7-day streak looked identical to hitting a 6-day one.
 */
export function recordDailyCompletion(today: string): DailyStreakResult {
  const unchanged = (): DailyStreakResult => ({
    currentStreak: profile.currentStreak,
    longestStreak: profile.longestStreak,
    isNewRecord: false,
    isMilestone: false,
    milestoneValue: null,
  });

  if (profile.lastDailyDate === today) return unchanged();

  const wasYesterday = profile.lastDailyDate === yesterday(today);
  profile.currentStreak = wasYesterday ? profile.currentStreak + 1 : 1;
  const isNewRecord = profile.currentStreak > profile.longestStreak;
  if (isNewRecord) profile.longestStreak = profile.currentStreak;
  profile.lastDailyDate = today;
  saveProfile();

  const isMilestone = STREAK_MILESTONES.includes(profile.currentStreak);
  return {
    currentStreak: profile.currentStreak,
    longestStreak: profile.longestStreak,
    isNewRecord,
    isMilestone,
    milestoneValue: isMilestone ? profile.currentStreak : null,
  };
}

/**
 * A streak is "protected" for the rest of the day after the player has opened
 * any session today but hasn't yet completed today's daily challenge.
 * This gives them a visual indicator that their streak will survive if they
 * play the daily before midnight.
 */
export function isStreakProtected(today: string): boolean {
  return profile.lastActivityDate === today && profile.lastDailyDate !== today && profile.currentStreak > 0;
}

export function getStreakDisplay(): { count: number; protected: boolean } {
  const today = new Date().toISOString().split('T')[0];
  return { count: profile.currentStreak, protected: isStreakProtected(today) };
}
