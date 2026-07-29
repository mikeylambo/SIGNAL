export interface CubeUserData {
  index: number;
  targetScale: number;
  targetY: number;
  state: CubeState;
}

export type CubeState = 'base' | 'active' | 'correct' | 'wrong' | 'decoy';

export interface CustomPalette {
  base: string;
  active: string;
  correct: string;
  wrong: string;
  bg: string;
}

/** One completed run, kept for the per-protocol trend sparkline. */
export interface MasteryRunRecord {
  d: string;  // ISO date (short keys — this array is persisted per protocol)
  s: number;  // score
  l: number;  // level reached
}

/** Long-arc progression state for a single protocol. */
export interface ProtocolMastery {
  points: number;      // cumulative mastery points; drives rank
  bestScore: number;
  bestLevel: number;
  runs: number;
  history: MasteryRunRecord[];  // most recent last, capped at MASTERY_HISTORY_LIMIT
}

export interface SavedProfile {
  schemaVersion: number;
  signal: number;
  unlockedCalibrations: string[];
  currentCalibration: string;
  customHex: string;       // legacy v1 field; kept so old saves migrate cleanly
  customPalette: CustomPalette;
  lifetime: {
    runs: number;
    score: number;
    highestLevel: number;
    signalMined: number;
    bestCombo: number;
  };
  hasSeenOnboarding: boolean;
  player_id: string;     // stable UUID generated once; used as leaderboard identity
  owner_secret: string;  // private per-device secret; proves ownership of player_id server-side, never displayed
  display_name: string;  // player-chosen name shown on the leaderboard
  currentStreak: number;          // consecutive daily challenges completed
  longestStreak: number;          // all-time best daily-challenge streak
  lastRunDate: string | null;     // ISO date of last completed run (any mode, legacy)
  lastActivityDate: string | null; // ISO date of any game session start
  lastDailyDate: string | null;
  settings: {
    haptics: boolean;
    sfx: boolean;
    volume: number;
  };
  unlockedAudioFeatures: string[];
  audioFeatureEnabled: Record<string, boolean>;
  customPalettes: Record<string, CustomPalette>;
  activeCustomSlot: string;
  hasCompletedOnboarding: boolean;
  /** Keyed by protocol id ('spatial', 'sequential', …). See progression.ts. */
  protocolMastery: Record<string, ProtocolMastery>;
}

export interface Theme {
  name: string;
  price: number;
  primary: string;
  bg: number;
  bgHex: string;
  text: string;
  active: number;
  activeHex: string;
  correct: number;
  correctHex: string;
  wrong: number;
  wrongHex: string;
  base: number;
  baseHex: string;
  edge: number;
}

export interface LeaderboardRow {
  rank: number;
  display_name: string;
  score: number;
  player_id: string;
  achieved_at: string;  // ISO timestamp (maps to created_at in DB)
}

export interface Protocol {
  id: string;
  name: string;
  hint: string;
}

export interface Pacing {
  id: string;
  name: string;
  hint: string;
}
