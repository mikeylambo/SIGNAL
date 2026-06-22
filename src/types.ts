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
  display_name: string;  // player-chosen name shown on the leaderboard
  lastDailyDate: string | null;
  settings: {
    haptics: boolean;
    sfx: boolean;
  };
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
