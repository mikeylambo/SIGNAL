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

/** Called when a daily challenge run ends (success or failure). */
export function recordDailyCompletion(today: string): void {
  if (profile.lastDailyDate === today) return;

  const wasYesterday = profile.lastDailyDate === yesterday(today);
  profile.currentStreak = wasYesterday ? profile.currentStreak + 1 : 1;
  if (profile.currentStreak > profile.longestStreak) {
    profile.longestStreak = profile.currentStreak;
  }
  profile.lastDailyDate = today;
  saveProfile();
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
