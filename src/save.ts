import type { CustomPalette, SavedProfile, Theme } from './types';

const STORAGE_KEY = 'sig_profile_v1';
const SCHEMA_VERSION = 8;

// Derive an edge color by lightening a base hex color.
// Factor ~1.7 matches the ratio used in all built-in themes.
function lightenHex(hex: string, factor: number): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = Math.min(255, Math.round(((n >> 16) & 0xff) * factor));
  const g = Math.min(255, Math.round(((n >> 8) & 0xff) * factor));
  const b = Math.min(255, Math.round((n & 0xff) * factor));
  return (r << 16) | (g << 8) | b;
}
export { lightenHex };

const SaveSystem = (() => {
  const DEFAULT_PALETTE: CustomPalette = {
    base: '#1C2733', active: '#00E5FF', correct: '#39FF88', wrong: '#FF3864', bg: '#05080D',
  };

  function defaultProfile(): SavedProfile {
    return {
      schemaVersion: SCHEMA_VERSION,
      signal: 0,
      unlockedCalibrations: ['mono', 'custom'],
      currentCalibration: 'mono',
      customHex: '#00E5FF',
      customPalette: { ...DEFAULT_PALETTE },
      lifetime: { runs: 0, score: 0, highestLevel: 1, signalMined: 0, bestCombo: 0 },
      hasSeenOnboarding: false,
      player_id: crypto.randomUUID(),
      display_name: '',
      currentStreak: 0,
      longestStreak: 0,
      lastRunDate: null,
      lastActivityDate: null,
      lastDailyDate: null,
      settings: { haptics: true, sfx: true },
      unlockedAudioFeatures: [],
      hasCompletedOnboarding: false,
    };
  }

  function migrate(raw: SavedProfile): SavedProfile {
    if (!raw.schemaVersion || raw.schemaVersion < 2) {
      // v1 → v2: build a full palette from the single customHex accent
      raw.customPalette = {
        active: raw.customHex || '#00E5FF',
        base: '#1C2733',
        correct: '#39FF88',
        wrong: '#FF3864',
        bg: '#05080D',
      };
      raw.schemaVersion = 2;
    }
    if (raw.schemaVersion < 3) {
      // v2 → v3: existing players have already seen the app — skip onboarding for them
      raw.hasSeenOnboarding = true;
      raw.schemaVersion = 3;
    }
    if (raw.schemaVersion < 4) {
      // v3 → v4: leaderboard identity fields
      raw.player_id = crypto.randomUUID();
      raw.display_name = '';
      raw.schemaVersion = 4;
    }
    if (raw.schemaVersion < 5) {
      // v4 → v5: streak tracking; existing players start fresh from today
      raw.currentStreak = 0;
      raw.longestStreak = 0;
      raw.lastRunDate = null;
      raw.schemaVersion = 5;
    }
    if (raw.schemaVersion < 6) {
      // v5 → v6: audio feature unlocks
      raw.unlockedAudioFeatures = [];
      raw.schemaVersion = 6;
    }
    if (raw.schemaVersion < 7) {
      // v6 → v7: simple onboarding gate; all users (new and existing) see the new flow
      raw.hasCompletedOnboarding = false;
      raw.schemaVersion = 7;
    }
    if (raw.schemaVersion < 8) {
      // v7 → v8: daily-challenge-only streak semantics; reset legacy any-run streak counts
      raw.lastActivityDate = null;
      raw.currentStreak = 0;
      raw.longestStreak = 0;
      raw.schemaVersion = 8;
    }
    return raw;
  }

  function load(): SavedProfile {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaultProfile();
      let parsed = JSON.parse(raw) as SavedProfile;
      if (!parsed.schemaVersion) return defaultProfile();
      parsed = migrate(parsed);
      const def = defaultProfile();
      return Object.assign(def, parsed, {
        lifetime: Object.assign(def.lifetime, parsed.lifetime || {}),
        settings: Object.assign(def.settings, parsed.settings || {}),
      });
    } catch (e) {
      console.warn('SaveSystem: corrupt save, resetting.', e);
      return defaultProfile();
    }
  }

  function persist(p: SavedProfile): void {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(p)); }
    catch (e) { console.warn('SaveSystem: failed to persist.', e); }
  }

  return { load, persist };
})();

export let profile: SavedProfile = SaveSystem.load();
export function saveProfile(): void { SaveSystem.persist(profile); }

export function getSignal(): number { return profile.signal; }
export function addSignal(amount: number): void { profile.signal += amount; saveProfile(); }
export function spendSignal(amount: number): void { profile.signal -= amount; saveProfile(); }

export function recordRun({ score, level, signalEarned, combo }: { score: number; level: number; signalEarned: number; combo: number }): void {
  const l = profile.lifetime;
  l.runs++; l.score += score; l.signalMined += signalEarned;
  if (level > l.highestLevel) l.highestLevel = level;
  if (combo > l.bestCombo) l.bestCombo = combo;
  saveProfile();
}

// ── Streak tracking ────────────────────────────────────────────────────────────

export interface StreakResult {
  currentStreak: number;
  longestStreak: number;
  isNewRecord: boolean;
  isMilestone: boolean;
  milestoneValue: number | null;
}

const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100] as const;

export function recordStreakForToday(): StreakResult {
  const today = new Date().toISOString().split('T')[0];

  if (profile.lastRunDate === today) {
    // Already counted today — return current values unchanged
    return {
      currentStreak: profile.currentStreak,
      longestStreak: profile.longestStreak,
      isNewRecord: false,
      isMilestone: false,
      milestoneValue: null,
    };
  }

  const yesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split('T')[0];
  })();

  if (profile.lastRunDate === yesterday) {
    profile.currentStreak++;
  } else {
    profile.currentStreak = 1;
  }

  const isNewRecord = profile.currentStreak > profile.longestStreak;
  if (isNewRecord) profile.longestStreak = profile.currentStreak;
  profile.lastRunDate = today;
  saveProfile();

  const isMilestone = (STREAK_MILESTONES as ReadonlyArray<number>).includes(profile.currentStreak);
  return {
    currentStreak: profile.currentStreak,
    longestStreak: profile.longestStreak,
    isNewRecord,
    isMilestone,
    milestoneValue: isMilestone ? profile.currentStreak : null,
  };
}

// Themes — built after profile is loaded so custom theme reads profile.customPalette.
// Custom calibration is always unlocked (free) — it's as much an accessibility
// tool (colorblind presets) as a cosmetic one. Contrast-gating it defeats that purpose.
function buildThemes(): Record<string, Theme> {
  const p = profile.customPalette;
  const h = (hex: string) => parseInt(hex.replace('#', ''), 16);
  return {
    mono:    { name: 'Mono',       price: 0,    primary: '#00E5FF', bg: 0x05080D, bgHex: '#05080D', text: '#E8FAFF', active: 0x00E5FF, activeHex: '#00E5FF', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x1C2733, baseHex: '#1C2733', edge: 0x33455A },
    ferro:   { name: 'Ferro',      price: 500,  primary: '#FFB454', bg: 0x0A0704, bgHex: '#0A0704', text: '#FFF4E5', active: 0xFFB454, activeHex: '#FFB454', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x2E2013, baseHex: '#2E2013', edge: 0x4D3A1F },
    glacier: { name: 'Glacier',    price: 1000, primary: '#9DEEFF', bg: 0x040A0F, bgHex: '#040A0F', text: '#F0FCFF', active: 0xC6F6FF, activeHex: '#C6F6FF', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x16303D, baseHex: '#16303D', edge: 0x265066 },
    redline: { name: 'Redline',    price: 2500, primary: '#FF3864', bg: 0x0A0405, bgHex: '#0A0405', text: '#FFE5EA', active: 0xFF3864, activeHex: '#FF3864', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF7A93, wrongHex: '#FF7A93', base: 0x2E1620, baseHex: '#2E1620', edge: 0x4D2433 },
    custom:  { name: 'Calibrated', price: 0,    primary: p.active,  bg: h(p.bg),  bgHex: p.bg,      text: '#E8FAFF', active: h(p.active), activeHex: p.active, correct: h(p.correct), correctHex: p.correct, wrong: h(p.wrong), wrongHex: p.wrong, base: h(p.base), baseHex: p.base, edge: lightenHex(p.base, 1.7) },
  };
}

export const themes: Record<string, Theme> = buildThemes();

export let currentThemeKey: string = (() => {
  const key = profile.currentCalibration || 'mono';
  return profile.unlockedCalibrations.includes(key) ? key : 'mono';
})();

export let t: Theme = themes[currentThemeKey];

// Callback registered after scene init so applyTheme can update Three.js objects
type ThemeChangeCallback = () => void;
let themeChangeCallback: ThemeChangeCallback | null = null;
export function setThemeChangeCallback(cb: ThemeChangeCallback): void {
  themeChangeCallback = cb;
}

export function applyTheme(key: string): void {
  currentThemeKey = key;
  t = themes[key];
  profile.currentCalibration = key;
  saveProfile();

  const root = document.documentElement;
  root.style.setProperty('--primary', t.primary);
  root.style.setProperty('--bg', t.bgHex);
  root.style.setProperty('--bg-modal', `${t.bgHex}F2`);
  root.style.setProperty('--text', t.text);
  root.style.setProperty('--active', t.activeHex);
  root.style.setProperty('--correct', t.correctHex);
  root.style.setProperty('--wrong', t.wrongHex);

  if (themeChangeCallback) themeChangeCallback();
}
