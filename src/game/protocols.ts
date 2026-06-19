import type { Protocol, Pacing } from '../types';

export const PROTOCOLS: Protocol[] = [
  { id: 'spatial',      name: 'Spatial',      hint: "Recreate targets — order doesn't matter." },
  { id: 'sequential',   name: 'Sequential',   hint: 'Recreate the exact sequence.' },
  { id: 'interference', name: 'Interference', hint: 'Ignore decoys. Tap targets only.' },
  { id: 'rhythm',       name: 'Rhythm',       hint: 'Match the cadence, ±400ms.' },
  { id: 'nback',        name: '2-Back',        hint: 'Tap when it matches 2 steps back.' },
];

export const PACINGS: Pacing[] = [
  { id: 'classic', name: 'Classic', hint: 'Timer resets each level. One mistake ends the run.' },
  { id: 'zen',     name: 'Zen',     hint: 'No timer. Mistakes break your streak.' },
  { id: 'sprint',  name: 'Sprint',  hint: '60s on the clock. Move fast.' },
];
