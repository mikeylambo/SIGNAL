import { profile } from './save';

let audioCtx: AudioContext | null = null;

export function initAudio(): void {
  if (!audioCtx) {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new AudioCtx();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

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

export function playTone(type: string): void {
  if (!audioCtx) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime;

  if (type === 'hover') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(400, now);
    gain.gain.setValueAtTime(0.02, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'active') {
    osc.type = 'square'; osc.frequency.setValueAtTime(440, now);
    gain.gain.setValueAtTime(0.05, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
    osc.start(now); osc.stop(now + 0.15);
  } else if (type === 'decoy') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(150, now);
    gain.gain.setValueAtTime(0.08, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'correct') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(800, now); osc.frequency.exponentialRampToValueAtTime(1600, now + 0.1);
    gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
    osc.start(now); osc.stop(now + 0.2);
  } else if (type === 'wrong') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(100, now); osc.frequency.linearRampToValueAtTime(40, now + 0.4);
    gain.gain.setValueAtTime(0.2, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now); osc.stop(now + 0.4);
  } else if (type === 'levelUp') {
    osc.type = 'square'; osc.frequency.setValueAtTime(400, now); osc.frequency.setValueAtTime(600, now + 0.1); osc.frequency.setValueAtTime(800, now + 0.2);
    gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.5);
    osc.start(now); osc.stop(now + 0.5);
  } else if (type === 'buy') {
    osc.type = 'sine'; osc.frequency.setValueAtTime(1000, now); osc.frequency.setValueAtTime(1500, now + 0.1);
    gain.gain.setValueAtTime(0.1, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);
    osc.start(now); osc.stop(now + 0.4);
  } else if (type === 'tick') {
    osc.type = 'square'; osc.frequency.setValueAtTime(800, now);
    gain.gain.setValueAtTime(0.03, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
    osc.start(now); osc.stop(now + 0.1);
  } else if (type === 'go') {
    osc.type = 'square'; osc.frequency.setValueAtTime(1200, now);
    gain.gain.setValueAtTime(0.08, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
    osc.start(now); osc.stop(now + 0.3);
  } else if (type === 'levelDown') {
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(200, now); osc.frequency.setValueAtTime(100, now + 0.1);
    gain.gain.setValueAtTime(0.1, now); gain.gain.linearRampToValueAtTime(0, now + 0.4);
    osc.start(now); osc.stop(now + 0.4);
  } else if (type === 'comboTick') {
    osc.type = 'triangle'; osc.frequency.setValueAtTime(900, now); osc.frequency.exponentialRampToValueAtTime(1800, now + 0.12);
    gain.gain.setValueAtTime(0.12, now); gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc.start(now); osc.stop(now + 0.25);
    const osc2 = audioCtx.createOscillator(); const gain2 = audioCtx.createGain();
    osc2.connect(gain2); gain2.connect(audioCtx.destination); osc2.type = 'sine';
    osc2.frequency.setValueAtTime(1350, now); gain2.gain.setValueAtTime(0.06, now); gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.25);
    osc2.start(now); osc2.stop(now + 0.25);
  }
}
