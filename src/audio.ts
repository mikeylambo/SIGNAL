import { profile } from './save';

let audioCtx: AudioContext | null = null;

// ── Ambient state ──────────────────────────────────────────────────────────────

let menuAmbientCarrier: OscillatorNode | null = null;
let menuAmbientLfo: OscillatorNode | null = null;
let menuAmbientOut: GainNode | null = null;
let menuAmbientRunning = false;

export function getAudioCtx(): AudioContext | null { return audioCtx; }

export function initAudio(): void {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === 'suspended') void audioCtx.resume();
  // Auto-start menu ambient on first gesture if we're in menu state
  const menuSheet = document.getElementById('menu-sheet');
  if (menuSheet?.style.display !== 'none' && !menuAmbientRunning) {
    startMenuAmbient();
  }
}

// ── Menu ambient: 40 Hz isochronic (amplitude-modulated 200 Hz carrier) ────────
// Carrier at 200 Hz, pulsed at 40 Hz via LFO → gamma entrainment cue.
// Kept inaudibly soft (peak ~0.016) so it sits below conscious awareness.

export function startMenuAmbient(): void {
  if (menuAmbientRunning || !audioCtx) return;
  menuAmbientRunning = true;
  const ctx = audioCtx;
  const now = ctx.currentTime;

  const carrier = ctx.createOscillator();
  carrier.type = 'sine';
  carrier.frequency.setValueAtTime(200, now);

  // LFO drives amplitude to pulse at 40 Hz
  const lfo = ctx.createOscillator();
  lfo.type = 'sine';
  lfo.frequency.setValueAtTime(40, now);

  const lfoDepth = ctx.createGain();
  lfoDepth.gain.setValueAtTime(0.5, now);      // ±0.5 swing

  // amplitudeMod has base 0.5 so LFO swings it 0→1
  const ampMod = ctx.createGain();
  ampMod.gain.setValueAtTime(0.5, now);
  lfo.connect(lfoDepth);
  lfoDepth.connect(ampMod.gain);

  // Master output gain — very quiet fade-in
  const out = ctx.createGain();
  out.gain.setValueAtTime(0, now);
  out.gain.linearRampToValueAtTime(0.016, now + 3);

  carrier.connect(ampMod);
  ampMod.connect(out);
  out.connect(ctx.destination);

  carrier.start(now);
  lfo.start(now);

  menuAmbientCarrier = carrier;
  menuAmbientLfo = lfo;
  menuAmbientOut = out;
}

export function stopMenuAmbient(): void {
  if (!menuAmbientRunning || !audioCtx) return;
  menuAmbientRunning = false;
  const now = audioCtx.currentTime;
  if (menuAmbientOut) {
    menuAmbientOut.gain.setValueAtTime(menuAmbientOut.gain.value, now);
    menuAmbientOut.gain.linearRampToValueAtTime(0, now + 0.5);
  }
  const c = menuAmbientCarrier, l = menuAmbientLfo;
  setTimeout(() => { try { c?.stop(); l?.stop(); } catch { /* already stopped */ } }, 600);
  menuAmbientCarrier = menuAmbientLfo = menuAmbientOut = null;
}

// ── Haptic ─────────────────────────────────────────────────────────────────────

export function haptic(type: string): void {
  if (!profile.settings.haptics || !navigator.vibrate) return;
  switch (type) {
    case 'hit':     navigator.vibrate(12); break;
    case 'combo':   navigator.vibrate([10, 30, 16]); break;
    case 'wrong':   navigator.vibrate([0, 60, 40, 60]); break;
    case 'levelUp': navigator.vibrate([10, 20, 10, 20, 30]); break;
    case 'tick':    navigator.vibrate(6); break;
  }
}

// ── Synthesis helpers ──────────────────────────────────────────────────────────

// Creates an oscillator routed through optional stereo panner → gain → destination.
// Returns osc and gain so the caller can schedule frequency/gain automation.
function voice(
  ctx: AudioContext,
  type: OscillatorType,
  freq: number,
  pan: number,
): { osc: OscillatorNode; gain: GainNode } {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, ctx.currentTime);
  gain.gain.setValueAtTime(0, ctx.currentTime);

  const clampedPan = Math.max(-1, Math.min(1, pan));
  if (clampedPan !== 0 && typeof ctx.createStereoPanner === 'function') {
    const panner = ctx.createStereoPanner();
    panner.pan.setValueAtTime(clampedPan, ctx.currentTime);
    osc.connect(panner);
    panner.connect(gain);
  } else {
    osc.connect(gain);
  }
  gain.connect(ctx.destination);
  return { osc, gain };
}

// ── playTone ───────────────────────────────────────────────────────────────────
// pan: stereo position -1 (left) to +1 (right), default 0 (center).
// Used by audioUnlocks.ts spatial feature to position sounds by cube column.

export function playTone(type: string, pan = 0): void {
  if (!audioCtx) return;
  const ctx = audioCtx;
  const now = ctx.currentTime;

  switch (type) {

    case 'hover': {
      const { osc, gain } = voice(ctx, 'sine', 440, pan);
      gain.gain.setValueAtTime(0.018, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
      osc.start(now); osc.stop(now + 0.1);
      break;
    }

    case 'active': {
      // Layered: triangle fundamental + sine 5th for shimmer
      const { osc, gain } = voice(ctx, 'triangle', 528, pan);
      gain.gain.linearRampToValueAtTime(0.06, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now); osc.stop(now + 0.2);

      const { osc: o2, gain: g2 } = voice(ctx, 'sine', 792, pan);
      g2.gain.linearRampToValueAtTime(0.022, now + 0.008);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      o2.start(now); o2.stop(now + 0.15);
      break;
    }

    case 'decoy': {
      const { osc, gain } = voice(ctx, 'sawtooth', 150, pan);
      gain.gain.setValueAtTime(0.07, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      osc.start(now); osc.stop(now + 0.2);
      break;
    }

    case 'correct': {
      // Rising ping: sine sweep + high harmonic sparkle
      const { osc, gain } = voice(ctx, 'sine', 880, pan);
      osc.frequency.exponentialRampToValueAtTime(1760, now + 0.12);
      gain.gain.linearRampToValueAtTime(0.1, now + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
      osc.start(now); osc.stop(now + 0.22);

      const { osc: o2, gain: g2 } = voice(ctx, 'triangle', 1320, pan);
      g2.gain.linearRampToValueAtTime(0.04, now + 0.015);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.18);
      o2.start(now); o2.stop(now + 0.18);
      break;
    }

    case 'wrong': {
      // Descending crunch + dissonant rumble
      const { osc, gain } = voice(ctx, 'sawtooth', 110, pan);
      osc.frequency.linearRampToValueAtTime(40, now + 0.4);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
      osc.start(now); osc.stop(now + 0.4);

      const { osc: o2, gain: g2 } = voice(ctx, 'square', 73, pan);
      g2.gain.setValueAtTime(0.08, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      o2.start(now); o2.stop(now + 0.3);
      break;
    }

    case 'levelUp': {
      // Ascending arpeggio — no pan, always centered for dramatic impact
      const freqs = [523, 659, 784, 1047];
      freqs.forEach((f, i) => {
        const t0 = now + i * 0.09;
        const { osc, gain } = voice(ctx, 'triangle', f, 0);
        gain.gain.linearRampToValueAtTime(0.1, t0 + 0.02);
        gain.gain.linearRampToValueAtTime(0, t0 + 0.16);
        osc.start(t0); osc.stop(t0 + 0.18);
      });
      break;
    }

    case 'buy': {
      const { osc, gain } = voice(ctx, 'sine', 1047, 0);
      osc.frequency.setValueAtTime(1047, now);
      osc.frequency.setValueAtTime(1319, now + 0.1);
      osc.frequency.setValueAtTime(1568, now + 0.2);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.45);
      osc.start(now); osc.stop(now + 0.45);
      break;
    }

    case 'tick': {
      const { osc, gain } = voice(ctx, 'square', 880, 0);
      gain.gain.setValueAtTime(0.025, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
      osc.start(now); osc.stop(now + 0.08);
      break;
    }

    case 'go': {
      const { osc, gain } = voice(ctx, 'square', 1320, 0);
      gain.gain.setValueAtTime(0.08, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
      osc.start(now); osc.stop(now + 0.3);

      const { osc: o2, gain: g2 } = voice(ctx, 'sine', 1980, 0);
      g2.gain.linearRampToValueAtTime(0.04, now + 0.02);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
      o2.start(now + 0.02); o2.stop(now + 0.2);
      break;
    }

    case 'levelDown': {
      const { osc, gain } = voice(ctx, 'sawtooth', 220, 0);
      osc.frequency.setValueAtTime(220, now);
      osc.frequency.setValueAtTime(110, now + 0.12);
      gain.gain.setValueAtTime(0.1, now);
      gain.gain.linearRampToValueAtTime(0, now + 0.4);
      osc.start(now); osc.stop(now + 0.4);
      break;
    }

    case 'comboTick': {
      const { osc, gain } = voice(ctx, 'triangle', 900, 0);
      osc.frequency.exponentialRampToValueAtTime(1800, now + 0.12);
      gain.gain.setValueAtTime(0.12, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      osc.start(now); osc.stop(now + 0.25);

      const { osc: o2, gain: g2 } = voice(ctx, 'sine', 1350, 0);
      g2.gain.setValueAtTime(0.06, now);
      g2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
      o2.start(now); o2.stop(now + 0.25);
      break;
    }
  }
}
