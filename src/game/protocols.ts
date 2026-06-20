import type { Protocol, Pacing } from '../types';

export const PROTOCOLS: Protocol[] = [
  { id: 'spatial',      name: 'Spatial',      hint: "Recreate targets — order doesn't matter." },
  { id: 'sequential',   name: 'Sequential',   hint: 'Recreate the exact sequence.' },
  { id: 'interference', name: 'Interference', hint: 'Ignore decoys. Tap targets only.' },
  { id: 'rhythm',       name: 'Rhythm',       hint: 'Match the cadence, ±400ms.' },
  { id: 'nback',        name: '2-Back',        hint: 'Tap when it matches 2 steps back.' },
  { id: 'chromatic',   name: 'Chromatic',    hint: 'Recall position AND color of each tile.' },
];

// Fixed, maximally-distinct color set for Chromatic puzzles.
// Must NOT use the player's Custom Calibration palette — the challenge is
// color memory, not fighting whatever accent the player customized.
// Chosen to avoid red/green pairs so the mode remains playable for common CVDs.
export const CHROMATIC_COLORS = [
  { hex: '#FF6B35', label: 'AMBER'  },  // orange — CVD-safe axis
  { hex: '#4FC3F7', label: 'CYAN'   },  // blue/cyan
  { hex: '#CE93D8', label: 'VIOLET' },  // purple
  { hex: '#F9A825', label: 'GOLD'   },  // yellow-gold
  { hex: '#66BB6A', label: 'JADE'   },  // green (only at highest difficulty)
] as const;

export const PACINGS: Pacing[] = [
  { id: 'classic', name: 'Classic', hint: 'Timer resets each level. One mistake ends the run.' },
  { id: 'zen',     name: 'Zen',     hint: 'No timer. Mistakes break your streak.' },
  { id: 'sprint',  name: 'Sprint',  hint: '60s on the clock. Move fast.' },
];
