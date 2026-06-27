import type { Protocol, Pacing } from '../types';

export const PROTOCOLS: Protocol[] = [
  { id: 'spatial',      name: 'Spatial',      hint: "Any order." },
  { id: 'sequential',   name: 'Sequential',   hint: 'Exact sequence.' },
  { id: 'interference', name: 'Interference', hint: 'Ignore decoys.' },
  { id: 'rhythm',       name: 'Rhythm',       hint: 'Match the timing.' },
  { id: 'nback',        name: '2-Back',        hint: '2 steps back.' },
];

export const PACINGS: Pacing[] = [
  { id: 'classic', name: 'Classic', hint: 'One mistake ends the run.' },
  { id: 'zen',     name: 'Zen',     hint: 'No timer. Streak-based.' },
  { id: 'sprint',  name: 'Sprint',  hint: '60 seconds. Move fast.' },
];
