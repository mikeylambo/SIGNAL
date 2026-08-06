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
    /** Opt-out for anonymous crash/usage reporting. See telemetry.ts. */
    telemetry: boolean;
  };
  unlockedAudioFeatures: string[];
  audioFeatureEnabled: Record<string, boolean>;
  customPalettes: Record<string, CustomPalette>;
  activeCustomSlot: string;
  hasCompletedOnboarding: boolean;
  /** Keyed by protocol id ('spatial', 'sequential', …). See progression.ts. */
  protocolMastery: Record<string, ProtocolMastery>;
  /**
   * What the Forge's controls were set to, per custom slot. The resulting
   * colours live in `customPalettes`; this is what regenerates them, so
   * reopening the Forge restores the base and hue the player chose rather than
   * showing defaults over a palette they can no longer edit coherently.
   */
  customPaletteMeta: Record<string, ForgeSelection>;
  /**
   * Colour-vision palette from Settings → Accessibility, or '' for none.
   * Separate from the Forge because it is an access need, not a cosmetic.
   */
  accessiblePalette: string;
  /** Last modifier chosen in the menu, restored on launch. */
  lastModifier: string;
  /** Board materials bought with Signal. See materials.ts. */
  unlockedMaterials: string[];
  /** Material applied to custom (Forge) palettes. Calibrations use their own. */
  activeMaterial: string;
  /** One-time premium unlock. Cosmetics and record-keeping only — see entitlements.ts. */
  premium: boolean;
  /**
   * Whether this device has passed a Turnstile challenge and holds an attested
   * leaderboard identity. A local fast path only — the server is the authority,
   * so editing this by hand costs you a redundant challenge rather than granting
   * a bypass. See attestation.ts.
   */
  attested: boolean;
  /**
   * Whether the menu coach marks have run. Deliberately separate from
   * `hasSeenOnboarding`: a player who skipped the gameplay tutorial has been
   * told *less*, not more, so they should still be shown where things are. See
   * tour.ts.
   */
  hasSeenMenuTour: boolean;
}

export interface ForgeSelection {
  baseId: string;   // id from CURATED_PALETTES
  hue: number;      // degrees of rotation applied to that base, 0-359
}

export interface Theme {
  name: string;
  price: number;
  /**
   * Signature material this Calibration equips. Paid Calibrations pair a
   * palette with a treatment the Forge cannot produce — that pairing is what
   * they sell, now that colour alone is free.
   */
  materialId: string;
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
