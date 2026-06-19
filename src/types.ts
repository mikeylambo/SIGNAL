export interface CubeUserData {
  index: number;
  targetScale: number;
  targetY: number;
  state: CubeState;
}

export type CubeState = 'base' | 'active' | 'correct' | 'wrong' | 'decoy';

export interface SavedProfile {
  schemaVersion: number;
  signal: number;
  unlockedCalibrations: string[];
  currentCalibration: string;
  customHex: string;
  lifetime: {
    runs: number;
    score: number;
    highestLevel: number;
    signalMined: number;
    bestCombo: number;
  };
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
