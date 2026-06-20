import { state } from '../state';
import { PROTOCOLS, PACINGS } from '../game/protocols';
import { getSignal, spendSignal, themes, currentThemeKey, applyTheme, profile, saveProfile, lightenHex } from '../save';
import type { CustomPalette } from '../types';
import { playTone, initAudio, haptic } from '../audio';
import { renderStatsBar } from './hud';
import { returnToMenu, updateReducedMotionText } from './modals';
import { initGame, stopTimer } from '../game/runLoop';

export function updateMenuText(): void {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  const protocolBtn = document.getElementById('protocol-btn') as HTMLButtonElement;
  const pacingBtn = document.getElementById('pacing-btn') as HTMLButtonElement;
  const hintMessageEl = document.getElementById('hint-message')!;
  const dailyBtn = document.getElementById('daily-btn') as HTMLButtonElement;

  protocolBtn.innerText = `Protocol: ${pMode.name}`;
  protocolBtn.style.borderColor = pMode.id === 'nback' ? 'var(--combo)' : '';
  protocolBtn.style.color = pMode.id === 'nback' ? 'var(--combo)' : '';
  pacingBtn.innerText = `Pace: ${pPace.name}`;
  hintMessageEl.innerText = `${pMode.hint} · ${pPace.hint}`;
  renderStatsBar();

  const today = new Date().toISOString().split('T')[0];
  if (profile.lastDailyDate === today) {
    dailyBtn.innerText = 'Calibration Complete';
    dailyBtn.disabled = true;
  } else {
    dailyBtn.innerText = '◆ Daily Calibration';
    dailyBtn.disabled = false;
  }
}

export function populateStore(): void {
  const storeFragCount = document.getElementById('store-frag-count')!;
  storeFragCount.innerText = String(getSignal());

  const cnt = document.getElementById('store-items-container')!;
  cnt.innerHTML = '';

  Object.keys(themes).forEach(key => {
    if (key === 'custom') return;
    const th = themes[key];
    const isUnlocked = profile.unlockedCalibrations.includes(key);
    const isActive = currentThemeKey === key;

    const item = document.createElement('div');
    item.className = 'store-item';
    item.style.borderLeft = `4px solid ${th.activeHex}`;

    const info = document.createElement('div');
    info.className = 'store-item-info';
    const title = document.createElement('div');
    title.className = 'store-item-title';
    title.textContent = th.name;
    info.appendChild(title);
    if (!isUnlocked) {
      const priceEl = document.createElement('div');
      priceEl.className = 'store-item-price';
      priceEl.textContent = `${th.price} ⟠`;
      info.appendChild(priceEl);
    }

    const btn = document.createElement('button');
    btn.className = 'store-btn';
    if (isActive) {
      btn.textContent = 'Equipped';
      btn.classList.add('purchased');
      btn.disabled = true;
    } else if (isUnlocked) {
      btn.textContent = 'Equip';
      btn.addEventListener('click', () => { applyTheme(key); populateStore(); });
    } else {
      btn.textContent = 'Buy';
      btn.classList.add('btn-store');
      btn.addEventListener('click', () => buyTheme(key, th.price));
    }

    item.appendChild(info);
    item.appendChild(btn);
    cnt.appendChild(item);
  });
}

function buyTheme(key: string, price: number): void {
  if (getSignal() >= price) {
    spendSignal(price);
    profile.unlockedCalibrations.push(key);
    saveProfile();
    playTone('buy');
    applyTheme(key);
    populateStore();
  } else {
    playTone('wrong');
    alert('Insufficient Signal.');
  }
}

// ── Forge helpers ─────────────────────────────────────────────────────────────

// Colorblind-safe presets the player can select then further customize.
// Deuteranopia and protanopia both struggle with red/green contrast, so
// these palettes replace that axis with blue/orange, which remains distinct
// under the most common forms of color-vision deficiency.
const MONO_DEFAULT: CustomPalette = { bg: '#05080D', base: '#1C2733', active: '#00E5FF', correct: '#39FF88', wrong: '#FF3864' };

const PRESETS: Record<string, CustomPalette> = {
  deuteranopia: { bg: '#05080D', base: '#1A2A38', active: '#FFD60A', correct: '#3FA7FF', wrong: '#FF7800' },
  protanopia:   { bg: '#05080D', base: '#1F2D3B', active: '#E8F5FF', correct: '#5BC4FF', wrong: '#FF8C42' },
};

type PaletteSlot = keyof CustomPalette;
let draftPalette: CustomPalette = { base: '#1C2733', active: '#00E5FF', correct: '#39FF88', wrong: '#FF3864', bg: '#05080D' };
let selectedSlot: PaletteSlot = 'active';

function relativeLuminance(hex: string): number {
  const n = parseInt(hex.replace('#', ''), 16);
  const toLinear = (c: number) => { const s = c / 255; return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); };
  return 0.2126 * toLinear((n >> 16) & 0xff) + 0.7152 * toLinear((n >> 8) & 0xff) + 0.0722 * toLinear(n & 0xff);
}

function contrastRatio(a: string, b: string): number {
  const l1 = relativeLuminance(a), l2 = relativeLuminance(b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

function hexFromSliders(): string {
  const r = parseInt((document.getElementById('r-slider') as HTMLInputElement).value);
  const g = parseInt((document.getElementById('g-slider') as HTMLInputElement).value);
  const b = parseInt((document.getElementById('b-slider') as HTMLInputElement).value);
  return '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
}

function loadSlotIntoSliders(hex: string): void {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff;
  (document.getElementById('r-slider') as HTMLInputElement).value = String(r);
  (document.getElementById('g-slider') as HTMLInputElement).value = String(g);
  (document.getElementById('b-slider') as HTMLInputElement).value = String(b);
  document.getElementById('r-val')!.innerText = String(r);
  document.getElementById('g-val')!.innerText = String(g);
  document.getElementById('b-val')!.innerText = String(b);
}

function refreshForgeUI(): void {
  // Tab highlights
  document.querySelectorAll<HTMLButtonElement>('.forge-slot-tab').forEach(btn => {
    const active = btn.dataset['slot'] === selectedSlot;
    btn.style.borderColor = active ? 'var(--active)' : 'rgba(255,255,255,0.14)';
    btn.style.color = active ? 'var(--active)' : '';
  });
  // Large swatch for the selected slot
  const hex = draftPalette[selectedSlot];
  const preview = document.getElementById('forge-preview')!;
  preview.style.backgroundColor = hex;
  preview.style.boxShadow = selectedSlot !== 'bg' ? `0 0 14px ${hex}` : 'none';
  // Full palette strip
  (document.getElementById('forge-prev-bg')      as HTMLElement).style.backgroundColor = draftPalette.bg;
  (document.getElementById('forge-prev-base')    as HTMLElement).style.backgroundColor = draftPalette.base;
  (document.getElementById('forge-prev-active')  as HTMLElement).style.backgroundColor = draftPalette.active;
  (document.getElementById('forge-prev-correct') as HTMLElement).style.backgroundColor = draftPalette.correct;
  (document.getElementById('forge-prev-wrong')   as HTMLElement).style.backgroundColor = draftPalette.wrong;
  // Contrast warning: base cubes vs background (WCAG-adjacent threshold of 2:1)
  const warning = document.getElementById('forge-contrast-warning')!;
  warning.style.display = contrastRatio(draftPalette.base, draftPalette.bg) < 2.0 ? 'block' : 'none';
}

function openForge(): void {
  draftPalette = { ...profile.customPalette };
  selectedSlot = 'active';
  loadSlotIntoSliders(draftPalette[selectedSlot]);
  refreshForgeUI();
}

function applyForge(): void {
  profile.customPalette = { ...draftPalette };
  profile.customHex = draftPalette.active;  // keep legacy field in sync
  saveProfile();

  const h = (hex: string) => parseInt(hex.replace('#', ''), 16);
  const p = draftPalette;
  themes.custom.primary    = p.active;
  themes.custom.bg         = h(p.bg);    themes.custom.bgHex      = p.bg;
  themes.custom.active     = h(p.active); themes.custom.activeHex  = p.active;
  themes.custom.correct    = h(p.correct); themes.custom.correctHex = p.correct;
  themes.custom.wrong      = h(p.wrong);  themes.custom.wrongHex   = p.wrong;
  themes.custom.base       = h(p.base);   themes.custom.baseHex    = p.base;
  themes.custom.edge       = lightenHex(p.base, 1.7);

  applyTheme('custom');
  playTone('buy');
  returnToMenu();
}

export function setupMenuListeners(): void {
  const protocolBtn = document.getElementById('protocol-btn') as HTMLButtonElement;
  const pacingBtn = document.getElementById('pacing-btn') as HTMLButtonElement;
  const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
  const dailyBtn = document.getElementById('daily-btn') as HTMLButtonElement;
  const profileBtn = document.getElementById('profile-btn') as HTMLButtonElement;
  const forgeBtn = document.getElementById('forge-btn') as HTMLButtonElement;
  const storeBtn = document.getElementById('store-btn') as HTMLButtonElement;
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const rSlider = document.getElementById('r-slider') as HTMLInputElement;
  const gSlider = document.getElementById('g-slider') as HTMLInputElement;
  const bSlider = document.getElementById('b-slider') as HTMLInputElement;

  protocolBtn.addEventListener('click', () => {
    initAudio();
    state.curProtIdx = (state.curProtIdx + 1) % PROTOCOLS.length;
    if (PROTOCOLS[state.curProtIdx].id === 'nback' && PACINGS[state.curPaceIdx].id === 'sprint') {
      state.curPaceIdx = 0;
    }
    updateMenuText();
  });

  pacingBtn.addEventListener('click', () => {
    initAudio();
    state.curPaceIdx = (state.curPaceIdx + 1) % PACINGS.length;
    if (PROTOCOLS[state.curProtIdx].id === 'nback' && PACINGS[state.curPaceIdx].id === 'sprint') {
      state.curPaceIdx = 0;
    }
    updateMenuText();
  });

  startBtn.addEventListener('click', () => {
    initAudio();
    state.isDailyRun = false;
    initGame();
  });

  dailyBtn.addEventListener('click', () => {
    initAudio();
    state.isDailyRun = true;
    const today = new Date();
    const seed = today.getFullYear() * 10000 + (today.getMonth() + 1) * 100 + today.getDate();
    state.curProtIdx = seed % PROTOCOLS.length;
    if (PROTOCOLS[state.curProtIdx].id === 'nback') state.curProtIdx = 0; // n-back not great for daily
    state.curPaceIdx = 0; // Classic for daily
    initGame();
  });

  // Pause
  pauseBtn.addEventListener('click', () => {
    if (!state.isPlayable && !state.timerActive && !state.nBackActive) return;
    initAudio();
    state.wasTimerActiveBeforePause = state.timerActive;
    state.isPaused = true;
    stopTimer();
    (document.getElementById('pause-screen') as HTMLElement).style.display = 'flex';
    (document.getElementById('ui-layer') as HTMLElement).style.opacity = '0';
    (document.getElementById('canvas-container') as HTMLElement).style.filter = 'blur(15px)';
  });

  // Profile modal
  profileBtn.addEventListener('click', () => {
    initAudio();
    (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
    (document.getElementById('profile-screen') as HTMLElement).style.display = 'flex';
    (document.getElementById('prof-runs') as HTMLElement).innerText = String(profile.lifetime.runs);
    (document.getElementById('prof-score') as HTMLElement).innerText = String(profile.lifetime.score);
    (document.getElementById('prof-level') as HTMLElement).innerText = String(profile.lifetime.highestLevel);
    (document.getElementById('prof-frags') as HTMLElement).innerText = String(profile.lifetime.signalMined);
    updateHapticsToggleText();
    updateReducedMotionText();
  });

  // Forge modal
  forgeBtn.addEventListener('click', () => {
    initAudio();
    (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
    (document.getElementById('forge-screen') as HTMLElement).style.display = 'flex';
    openForge();
  });

  document.getElementById('close-forge-btn')!.addEventListener('click', returnToMenu);

  document.getElementById('apply-forge-btn')!.addEventListener('click', () => {
    initAudio();
    applyForge();
  });

  // Color slot tabs
  document.querySelectorAll<HTMLButtonElement>('.forge-slot-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      selectedSlot = (btn.dataset['slot'] as PaletteSlot);
      loadSlotIntoSliders(draftPalette[selectedSlot]);
      refreshForgeUI();
    });
  });

  // RGB sliders update the current slot
  const onSliderInput = () => {
    draftPalette[selectedSlot] = hexFromSliders();
    document.getElementById('r-val')!.innerText = (document.getElementById('r-slider') as HTMLInputElement).value;
    document.getElementById('g-val')!.innerText = (document.getElementById('g-slider') as HTMLInputElement).value;
    document.getElementById('b-val')!.innerText = (document.getElementById('b-slider') as HTMLInputElement).value;
    refreshForgeUI();
  };
  rSlider.addEventListener('input', onSliderInput);
  gSlider.addEventListener('input', onSliderInput);
  bSlider.addEventListener('input', onSliderInput);

  // Colorblind presets + reset
  document.getElementById('preset-deuteranopia-btn')!.addEventListener('click', () => {
    draftPalette = { ...PRESETS['deuteranopia'] };
    loadSlotIntoSliders(draftPalette[selectedSlot]);
    refreshForgeUI();
  });
  document.getElementById('preset-protanopia-btn')!.addEventListener('click', () => {
    draftPalette = { ...PRESETS['protanopia'] };
    loadSlotIntoSliders(draftPalette[selectedSlot]);
    refreshForgeUI();
  });
  document.getElementById('preset-reset-btn')!.addEventListener('click', () => {
    draftPalette = { ...MONO_DEFAULT };
    loadSlotIntoSliders(draftPalette[selectedSlot]);
    refreshForgeUI();
  });

  // Store modal
  storeBtn.addEventListener('click', () => {
    initAudio();
    (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
    (document.getElementById('store-screen') as HTMLElement).style.display = 'flex';
    populateStore();
  });

  document.getElementById('close-store-btn')!.addEventListener('click', returnToMenu);
}

function updateHapticsToggleText(): void {
  const supported = !!navigator.vibrate;
  const btn = document.getElementById('haptics-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = supported ? `Haptics: ${profile.settings.haptics ? 'On' : 'Off'}` : 'Haptics: Unsupported';
  btn.disabled = !supported;
}

// Re-export haptic so modals.ts can call it
export { haptic };
