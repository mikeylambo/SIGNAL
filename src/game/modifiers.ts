import { state } from '../state';
import { PROTOCOLS } from './protocols';
import { getMastery, rankForPoints } from '../progression';
import { profile, saveProfile } from '../save';

/**
 * Modifiers — properties applied to existing protocols, not new protocols.
 *
 * Chromatic shipped once before as a sixth protocol and didn't work. Two
 * reasons, both structural rather than a matter of tuning:
 *
 *  1. It fought the Forge. If a player can recolour the game, a colour-memory
 *     protocol is standing on sand — either it overrides their palette (feels
 *     broken) or it ignores the theme (feels bolted on). The fix is that
 *     Chromatic's channel colours are FIXED and theme-exempt, and the game says
 *     so; they aren't "the theme", they're signal.
 *  2. As a standalone protocol it tested perception, while every other protocol
 *     tests memory. That reads as a different game wearing the same skin.
 *     As a modifier it instead *adds* a channel to a memory task: you already
 *     had to remember where, now you also have to remember which.
 *
 * The same argument makes the auditory idea a modifier rather than a protocol.
 *
 * Less is more was the brief, so there are two modifiers and one axis, not a
 * third menu of content. Two modifiers across four grid protocols is eight new
 * experiences from a small amount of new surface.
 */

export type ModifierId = 'none' | 'chromatic' | 'resonant';

export interface Modifier {
  id: ModifierId;
  name: string;
  hint: string;
  /** Mastery rank required on the selected protocol before this unlocks. */
  requiredRank: number;
  /** Score multiplier applied to every hit while active. */
  scoreMultiplier: number;
}

export const MODIFIERS: ReadonlyArray<Modifier> = [
  { id: 'none',      name: 'Standard',  hint: 'No modifier.',                requiredRank: 0, scoreMultiplier: 1 },
  { id: 'chromatic', name: 'Chromatic', hint: 'Match colour as well.',       requiredRank: 3, scoreMultiplier: 1.5 },
  { id: 'resonant',  name: 'Resonant',  hint: 'Tones only. No tile flash.',  requiredRank: 5, scoreMultiplier: 1.8 },
];

/**
 * Chromatic's three channels. Deliberately fixed and NOT derived from the
 * active theme: they are gameplay information, so a player's palette choice
 * must not be able to make two channels similar, and hue-rotating them would
 * do exactly that.
 *
 * Chosen to stay separable under the common colour-vision deficiencies — a
 * blue / amber / white triad, avoiding the red-green axis entirely, and varying
 * in lightness as well as hue so they remain distinguishable in greyscale.
 */
export interface ChromaticChannel {
  id: number;
  name: string;
  hex: string;
  num: number;
  /** Semitone offset, so the colour is also audible for non-visual play. */
  semitone: number;
}

export const CHROMATIC_CHANNELS: ReadonlyArray<ChromaticChannel> = [
  { id: 0, name: 'Azure', hex: '#3FA7FF', num: 0x3FA7FF, semitone: 0 },
  { id: 1, name: 'Amber', hex: '#FFB020', num: 0xFFB020, semitone: 4 },
  { id: 2, name: 'Pearl', hex: '#F2F6FF', num: 0xF2F6FF, semitone: 7 },
];

export function channelFor(id: number): ChromaticChannel {
  return CHROMATIC_CHANNELS[id] ?? CHROMATIC_CHANNELS[0];
}

export function getModifier(id: ModifierId): Modifier {
  return MODIFIERS.find(m => m.id === id) ?? MODIFIERS[0];
}

/**
 * Modifiers are gated on mastery of the protocol they're applied to, not on a
 * global level. Chromatic on Spatial is a different skill from Chromatic on
 * Rhythm, and earning it once shouldn't hand you both.
 */
export function isModifierUnlocked(id: ModifierId, protocolId: string): boolean {
  const mod = getModifier(id);
  if (mod.requiredRank === 0) return true;
  return rankForPoints(getMastery(protocolId).points) >= mod.requiredRank;
}

/**
 * 2-Back is excluded: its whole structure is a single stream of positions
 * compared against a running memory, and layering a second channel on top makes
 * it a 2-back-on-two-dimensions task — a genuinely different (and much harder)
 * exercise that deserves its own design pass rather than falling out of a
 * generic modifier.
 */
export function modifiersAvailableFor(protocolId: string): boolean {
  return protocolId !== 'nback';
}

/** The modifier actually in force this run, after availability and unlock checks. */
export function activeModifier(): Modifier {
  const protocolId = PROTOCOLS[state.curProtIdx]?.id ?? '';
  if (!modifiersAvailableFor(protocolId)) return MODIFIERS[0];
  const id = state.modifierId;
  if (!isModifierUnlocked(id, protocolId)) return MODIFIERS[0];
  return getModifier(id);
}

export function setModifier(id: ModifierId): void {
  state.modifierId = id;
  profile.lastModifier = id;
  saveProfile();
}

/**
 * Assigns a colour channel to each tile in the pattern. Runs once per level so
 * Observe and Execute agree on the answer.
 */
export function assignChromaticChannels(pattern: number[]): number[] {
  return pattern.map(() => Math.floor(Math.random() * CHROMATIC_CHANNELS.length));
}

/**
 * Board key suffix so modified runs get their own leaderboards. Mixing a 1.8×
 * Resonant score into the standard board would make the standard board
 * unwinnable without the modifier, which is precisely backwards.
 */
export function modifierBoardSuffix(): string {
  const mod = activeModifier();
  return mod.id === 'none' ? '' : `_${mod.id}`;
}
