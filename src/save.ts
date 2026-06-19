import type { SavedProfile, Theme } from './types';

const STORAGE_KEY = 'sig_profile_v1';
const SCHEMA_VERSION = 1;

const SaveSystem = (() => {
  function defaultProfile(): SavedProfile {
    return {
      schemaVersion: SCHEMA_VERSION,
      signal: 0,
      unlockedCalibrations: ['mono', 'custom'],
      currentCalibration: 'mono',
      customHex: '#00E5FF',
      lifetime: { runs: 0, score: 0, highestLevel: 1, signalMined: 0, bestCombo: 0 },
      lastDailyDate: null,
      settings: { haptics: true, sfx: true },
    };
  }

  function migrate(raw: SavedProfile): SavedProfile {
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

// Themes — built after profile is loaded so custom theme can read profile.customHex
function buildThemes(): Record<string, Theme> {
  return {
    mono:    { name: 'Mono',       price: 0,    primary: '#00E5FF', bg: 0x05080D, bgHex: '#05080D', text: '#E8FAFF', active: 0x00E5FF, activeHex: '#00E5FF', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x1C2733, edge: 0x33455A },
    ferro:   { name: 'Ferro',      price: 500,  primary: '#FFB454', bg: 0x0A0704, bgHex: '#0A0704', text: '#FFF4E5', active: 0xFFB454, activeHex: '#FFB454', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x2E2013, edge: 0x4D3A1F },
    glacier: { name: 'Glacier',    price: 1000, primary: '#9DEEFF', bg: 0x040A0F, bgHex: '#040A0F', text: '#F0FCFF', active: 0xC6F6FF, activeHex: '#C6F6FF', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x16303D, edge: 0x265066 },
    redline: { name: 'Redline',    price: 2500, primary: '#FF3864', bg: 0x0A0405, bgHex: '#0A0405', text: '#FFE5EA', active: 0xFF3864, activeHex: '#FF3864', correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF7A93, wrongHex: '#FF7A93', base: 0x2E1620, edge: 0x4D2433 },
    custom:  { name: 'Calibrated', price: 0,    primary: profile.customHex, bg: 0x05080D, bgHex: '#05080D', text: '#E8FAFF', active: parseInt(profile.customHex.replace('#', ''), 16), activeHex: profile.customHex, correct: 0x39FF88, correctHex: '#39FF88', wrong: 0xFF3864, wrongHex: '#FF3864', base: 0x1C2733, edge: 0x33455A },
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
