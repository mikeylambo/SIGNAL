import { profile, saveProfile, spendSignal, getSignal } from './save';

export function isAudioFeatureEnabled(id: string): boolean {
  return profile.audioFeatureEnabled?.[id] !== false;
}

export function setAudioFeatureEnabled(id: string, enabled: boolean): void {
  if (!profile.audioFeatureEnabled) profile.audioFeatureEnabled = {};
  profile.audioFeatureEnabled[id] = enabled;
  saveProfile();
}
import { getAudioCtx, playTone, getVolume } from './audio';

// ── Unlock catalogue ───────────────────────────────────────────────────────────

export interface AudioUnlock {
  id: string;
  name: string;
  price: number;
  description: string;
}

export const AUDIO_UNLOCKS: AudioUnlock[] = [
  {
    id: 'spatial',
    name: 'Spatial Audio',
    price: 500,
    description: 'Position-aware stereo panning — each tile sounds from its column in the grid.',
  },
  {
    id: 'binaural',
    name: 'Binaural Focus',
    price: 1000,
    description: '40 Hz binaural beats during training. Requires headphones.',
  },
  {
    id: 'gamma',
    name: 'Gamma Protocol',
    price: 2500,
    description: '40 Hz gamma-band isochronic entrainment during runs. Experimental.',
  },
];

export function isAudioUnlocked(id: string): boolean {
  return (profile.unlockedAudioFeatures ?? []).includes(id);
}

export function buyAudioUnlock(id: string, price: number): boolean {
  if (getSignal() < price) return false;
  spendSignal(price);
  if (!profile.unlockedAudioFeatures) profile.unlockedAudioFeatures = [];
  profile.unlockedAudioFeatures.push(id);
  saveProfile();
  playTone('buy');
  return true;
}

// ── Spatial panning ────────────────────────────────────────────────────────────
// Returns a stereo pan value (-0.75 left … 0 centre … 0.75 right) based on
// the cube's column in the 3×3 grid. No-ops (returns 0) when unlocked feature
// "spatial" is not purchased.

export function spatialPan(cubeIndex: number): number {
  if (!isAudioUnlocked('spatial') || !isAudioFeatureEnabled('spatial')) return 0;
  const col = cubeIndex % 3;        // 0, 1, 2
  return (col - 1) * 0.75;          // -0.75 | 0 | 0.75
}

// ── Binaural beats ─────────────────────────────────────────────────────────────
// 200 Hz in left ear, 240 Hz in right ear → brain perceives a 40 Hz (gamma)
// phantom beat. Runs at low gain during gameplay when "binaural" is unlocked.

let binauralL: OscillatorNode | null = null;
let binauralR: OscillatorNode | null = null;
let binauralOut: GainNode | null = null;
let binauralRunning = false;

export function startBinaural(): void {
  if (binauralRunning || !isAudioUnlocked('binaural') || !isAudioFeatureEnabled('binaural')) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  binauralRunning = true;
  const now = ctx.currentTime;

  // Separate L/R channels via ChannelMerger
  const merger = ctx.createChannelMerger(2);
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(0.07 * getVolume(), now + 2.5);
  merger.connect(out);
  out.connect(ctx.destination);

  const left = ctx.createOscillator();
  left.type = 'sine';
  left.frequency.setValueAtTime(200, now);
  const lGain = ctx.createGain();
  lGain.gain.setValueAtTime(1, now);
  left.connect(lGain);
  lGain.connect(merger, 0, 0);   // → left channel

  const right = ctx.createOscillator();
  right.type = 'sine';
  right.frequency.setValueAtTime(240, now);  // 200 + 40 Hz offset = 40 Hz beat
  const rGain = ctx.createGain();
  rGain.gain.setValueAtTime(1, now);
  right.connect(rGain);
  rGain.connect(merger, 0, 1);  // → right channel

  left.start(now);
  right.start(now);
  binauralL = left;
  binauralR = right;
  binauralOut = out;
}

export function stopBinaural(): void {
  if (!binauralRunning) return;
  binauralRunning = false;
  const ctx = getAudioCtx();
  const now = ctx?.currentTime ?? 0;
  if (binauralOut && ctx) {
    binauralOut.gain.setValueAtTime(binauralOut.gain.value, now);
    binauralOut.gain.linearRampToValueAtTime(0, now + 0.5);
  }
  const l = binauralL, r = binauralR;
  setTimeout(() => { try { l?.stop(); r?.stop(); } catch { /* already stopped */ } }, 600);
  binauralL = binauralR = binauralOut = null;
}

// ── Gamma isochronic ───────────────────────────────────────────────────────────
// 320 Hz carrier amplitude-modulated at 40 Hz. Stronger and more audible than
// the menu ambient layer — this is what the user actively paid for.

let gammaCarrier: OscillatorNode | null = null;
let gammaLfo: OscillatorNode | null = null;
let gammaOut: GainNode | null = null;
let gammaRunning = false;

export function startGamma(): void {
  if (gammaRunning || !isAudioUnlocked('gamma') || !isAudioFeatureEnabled('gamma')) return;
  const ctx = getAudioCtx();
  if (!ctx) return;
  gammaRunning = true;
  const now = ctx.currentTime;

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(320, now);

  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(40, now);

  const lfoDepth = ctx.createGain();
  lfoDepth.gain.setValueAtTime(0.5, now);    // LFO ±0.5

  const ampMod = ctx.createGain();
  ampMod.gain.setValueAtTime(0.5, now);      // DC offset → swings 0→1
  lfo.connect(lfoDepth);
  lfoDepth.connect(ampMod.gain);

  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(0.04 * getVolume(), now + 2.5);

  carrier.connect(ampMod);
  ampMod.connect(out);
  out.connect(ctx.destination);

  carrier.start(now);
  lfo.start(now);
  gammaCarrier = carrier;
  gammaLfo = lfo;
  gammaOut = out;
}

export function stopGamma(): void {
  if (!gammaRunning) return;
  gammaRunning = false;
  const ctx = getAudioCtx();
  const now = ctx?.currentTime ?? 0;
  if (gammaOut && ctx) {
    gammaOut.gain.setValueAtTime(gammaOut.gain.value, now);
    gammaOut.gain.linearRampToValueAtTime(0, now + 0.5);
  }
  const c = gammaCarrier, l = gammaLfo;
  setTimeout(() => { try { c?.stop(); l?.stop(); } catch { /* already stopped */ } }, 600);
  gammaCarrier = gammaLfo = gammaOut = null;
}

// ── Convenience: start/stop all unlocked gameplay layers ──────────────────────

export function startGameplayAudio(): void {
  startBinaural();
  startGamma();
}

export function stopGameplayAudio(): void {
  stopBinaural();
  stopGamma();
}
