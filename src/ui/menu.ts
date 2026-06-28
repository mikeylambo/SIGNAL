import { state } from '../state';
import { PROTOCOLS, PACINGS } from '../game/protocols';
import { getSignal, spendSignal, themes, currentThemeKey, applyTheme, profile, saveProfile, lightenHex } from '../save';
import { getStreakDisplay } from '../streaks';
import type { CustomPalette } from '../types';
import { playTone, initAudio, haptic, setMasterVolume } from '../audio';
import { AUDIO_UNLOCKS, isAudioUnlocked, buyAudioUnlock } from '../audioUnlocks';
import { renderStatsBar } from './hud';
import { returnToMenu, updateReducedMotionText } from './modals';
import { initGame, stopTimer, startOnboardingRound } from '../game/runLoop';

export function updateMenuText(): void {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  const protocolBtn = document.getElementById('protocol-btn') as HTMLButtonElement;
  const pacingBtn   = document.getElementById('pacing-btn')   as HTMLButtonElement;
  const hintEl      = document.getElementById('hint-message')!;
  const streakEl    = document.getElementById('streak-display')!;
  const balanceEl   = document.getElementById('header-signal-val');

  // Protocol / pacing — bare name, no prefix
  protocolBtn.textContent = pMode.name;
  protocolBtn.style.color = pMode.id === 'nback' ? 'var(--combo)' : 'var(--text)';
  pacingBtn.textContent = pPace.name;

  // Hint — two lines separated by <br>
  hintEl.innerHTML = `${pMode.hint}<br>${pPace.hint}`;

  // Streak column
  const { count: streakCount, protected: streakProtected } = getStreakDisplay();
  if (streakCount > 0) {
    streakEl.textContent = streakProtected ? `🔥 ${streakCount}·` : `🔥 ${streakCount}`;
    streakEl.style.color = 'var(--combo)';
    streakEl.style.cursor = 'pointer';
  } else {
    streakEl.textContent = '';
    streakEl.style.color = 'var(--text-muted)';
    streakEl.style.cursor = 'default';
  }

  // Header balance
  if (balanceEl) balanceEl.textContent = String(getSignal());

  // Daily row state
  const today = new Date().toISOString().split('T')[0];
  const done  = profile.lastDailyDate === today;
  const dailyRow   = document.getElementById('daily-row')   as HTMLElement;
  const dailyLabel = document.getElementById('daily-label') as HTMLElement;
  const dailySub   = document.getElementById('daily-sub')   as HTMLElement;
  if (dailyRow && dailyLabel && dailySub) {
    dailyRow.style.background   = done ? 'transparent'            : 'rgba(255,56,100,0.04)';
    dailyRow.style.borderColor  = done ? 'var(--edge)'            : 'rgba(255,56,100,0.25)';
    dailyRow.style.cursor       = done ? 'default'                : 'pointer';
    dailyLabel.style.color      = done ? 'var(--text-muted)'      : 'var(--wrong)';
    dailySub.textContent        = done ? 'complete · returns tomorrow' : 'available now';
    dailySub.style.color        = done ? 'rgba(107,119,133,0.5)'  : 'rgba(255,56,100,0.5)';
  }

  renderStatsBar();
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

  // ── Audio enhancements section ──────────────────────────────────────────────
  const audioHeader = document.createElement('div');
  audioHeader.style.cssText = 'font-family:var(--font-mono);font-size:0.62rem;color:var(--text-muted);letter-spacing:1.5px;padding:10px 0 4px;border-top:1px solid var(--edge);margin-top:4px;';
  audioHeader.textContent = 'AUDIO ENHANCEMENTS';
  cnt.appendChild(audioHeader);

  AUDIO_UNLOCKS.forEach(unlock => {
    const unlocked = isAudioUnlocked(unlock.id);

    const item = document.createElement('div');
    item.className = 'store-item';
    item.style.borderLeft = '4px solid var(--active)';

    const info = document.createElement('div');
    info.className = 'store-item-info';

    const titleEl = document.createElement('div');
    titleEl.className = 'store-item-title';
    titleEl.textContent = unlock.name;
    info.appendChild(titleEl);

    const descEl = document.createElement('div');
    descEl.style.cssText = 'font-family:var(--font-mono);font-size:0.68rem;color:var(--text-muted);margin-top:3px;line-height:1.4;';
    descEl.textContent = unlock.description;
    info.appendChild(descEl);

    if (!unlocked) {
      const priceEl = document.createElement('div');
      priceEl.className = 'store-item-price';
      priceEl.textContent = `${unlock.price} ⟠`;
      info.appendChild(priceEl);
    }

    const btn = document.createElement('button');
    btn.className = 'store-btn';
    if (unlocked) {
      btn.textContent = 'Active';
      btn.classList.add('purchased');
      btn.disabled = true;
    } else {
      btn.textContent = 'Buy';
      btn.classList.add('btn-store');
      btn.addEventListener('click', () => {
        if (buyAudioUnlock(unlock.id, unlock.price)) {
          populateStore();
          storeFragCount.innerText = String(getSignal());
        } else {
          playTone('wrong');
          alert('Insufficient Signal.');
        }
      });
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
  const pacingBtn   = document.getElementById('pacing-btn')   as HTMLButtonElement;
  const startBtn    = document.getElementById('start-btn')    as HTMLButtonElement;
  const dailyRow    = document.getElementById('daily-row')    as HTMLElement;
  const profileBtn  = document.getElementById('profile-btn')  as HTMLButtonElement;
  const forgeBtn    = document.getElementById('forge-btn')    as HTMLButtonElement;
  const storeBtn    = document.getElementById('store-btn')    as HTMLButtonElement;
  const pauseBtn    = document.getElementById('pause-btn')    as HTMLButtonElement;
  const rSlider     = document.getElementById('r-slider')     as HTMLInputElement;
  const gSlider     = document.getElementById('g-slider')     as HTMLInputElement;
  const bSlider     = document.getElementById('b-slider')     as HTMLInputElement;

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

  // Daily row — the entire div is clickable; guard if already completed today
  dailyRow.addEventListener('click', (_e: MouseEvent) => {
    const today = new Date().toISOString().split('T')[0];
    if (profile.lastDailyDate === today) return;
    initAudio();
    state.isDailyRun = true;
    const now = new Date();
    const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    state.curProtIdx = seed % PROTOCOLS.length;
    if (PROTOCOLS[state.curProtIdx].id === 'nback') state.curProtIdx = 0;
    state.curPaceIdx = 0;
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

  // Stats modal
  profileBtn.addEventListener('click', () => {
    initAudio();
    (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
    (document.getElementById('profile-screen') as HTMLElement).style.display = 'flex';
    (document.getElementById('prof-runs') as HTMLElement).innerText = String(profile.lifetime.runs);
    (document.getElementById('prof-score') as HTMLElement).innerText = String(profile.lifetime.score);
    (document.getElementById('prof-level') as HTMLElement).innerText = String(profile.lifetime.highestLevel);
    (document.getElementById('prof-frags') as HTMLElement).innerText = String(profile.lifetime.signalMined);
    const profStreak = document.getElementById('prof-streak');
    const profBestStreak = document.getElementById('prof-best-streak');
    if (profStreak) profStreak.innerText = String(profile.currentStreak);
    if (profBestStreak) profBestStreak.innerText = String(profile.longestStreak);
    updateReducedMotionText();
  });

  // Settings modal
  forgeBtn.addEventListener('click', () => {
    initAudio();
    (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
    (document.getElementById('forge-screen') as HTMLElement).style.display = 'flex';
    // Default to Audio tab on open
    switchSettingsTab('audio');
    initAudioTab();
    openForge();
  });

  document.getElementById('close-forge-btn')!.addEventListener('click', returnToMenu);
  document.getElementById('close-forge-btn-visual')!.addEventListener('click', returnToMenu);

  // Settings tab switching
  document.getElementById('settings-tab-audio')!.addEventListener('click', () => switchSettingsTab('audio'));
  document.getElementById('settings-tab-visual')!.addEventListener('click', () => switchSettingsTab('visual'));

  // Volume slider
  const volumeSlider = document.getElementById('volume-slider') as HTMLInputElement;
  volumeSlider.addEventListener('input', () => {
    const v = parseInt(volumeSlider.value) / 100;
    setMasterVolume(v);
    document.getElementById('volume-val')!.textContent = volumeSlider.value;
  });

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

  // RGB sliders — update the current slot and live-preview BG color on body
  const onSliderInput = () => {
    draftPalette[selectedSlot] = hexFromSliders();
    document.getElementById('r-val')!.innerText = (document.getElementById('r-slider') as HTMLInputElement).value;
    document.getElementById('g-val')!.innerText = (document.getElementById('g-slider') as HTMLInputElement).value;
    document.getElementById('b-val')!.innerText = (document.getElementById('b-slider') as HTMLInputElement).value;
    if (selectedSlot === 'bg') {
      document.documentElement.style.setProperty('--bg', draftPalette.bg);
    }
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

  // Shop modal
  storeBtn.addEventListener('click', () => {
    initAudio();
    (document.getElementById('ui-layer') as HTMLElement).style.display = 'none';
    (document.getElementById('store-screen') as HTMLElement).style.display = 'flex';
    populateStore();
  });

  document.getElementById('close-store-btn')!.addEventListener('click', returnToMenu);
  // Audio unlock buy buttons are wired dynamically in populateStore()

  // Streak inline expansion toggle
  let streakExpanded = false;
  let streakDetailEl: HTMLElement | null = null;
  document.getElementById('streak-display')!.addEventListener('click', () => {
    const { count } = getStreakDisplay();
    if (count === 0) return;
    streakExpanded = !streakExpanded;
    if (streakExpanded) {
      if (!streakDetailEl) {
        streakDetailEl = document.createElement('div');
        streakDetailEl.id = 'streak-detail';
        streakDetailEl.style.cssText = 'font-family:var(--font-mono);font-size:0.65rem;color:var(--text-muted);margin-top:4px;letter-spacing:0.5px;';
        document.getElementById('streak-display')!.insertAdjacentElement('afterend', streakDetailEl);
      }
      streakDetailEl.textContent = `${count} day streak · best ${profile.longestStreak}`;
      streakDetailEl.style.display = 'block';
    } else if (streakDetailEl) {
      streakDetailEl.style.display = 'none';
    }
  });

  // Auto-trigger onboarding for first-time players — runs after all listeners
  // are wired so the game is ready to handle input immediately.
  if (!profile.hasCompletedOnboarding) {
    void startOnboardingRound();
  }
}

function switchSettingsTab(tab: 'audio' | 'visual'): void {
  const audioContent = document.getElementById('settings-content-audio')!;
  const visualContent = document.getElementById('settings-content-visual')!;
  const audioTab = document.getElementById('settings-tab-audio')!;
  const visualTab = document.getElementById('settings-tab-visual')!;
  const isAudio = tab === 'audio';
  audioContent.style.display = isAudio ? '' : 'none';
  visualContent.style.display = isAudio ? 'none' : '';
  audioTab.classList.toggle('settings-tab-active', isAudio);
  visualTab.classList.toggle('settings-tab-active', !isAudio);
}

function initAudioTab(): void {
  const vol = Math.round((profile.settings.volume ?? 0.7) * 100);
  const slider = document.getElementById('volume-slider') as HTMLInputElement;
  slider.value = String(vol);
  document.getElementById('volume-val')!.textContent = String(vol);
  updateHapticsToggleText();
  updateSfxToggleText();
}

function updateSfxToggleText(): void {
  const btn = document.getElementById('sfx-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = `SFX: ${profile.settings.sfx ? 'On' : 'Off'}`;
}

function updateHapticsToggleText(): void {
  const btn = document.getElementById('haptics-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  // iOS devices don't support navigator.vibrate — hide the button rather than
  // showing "Unsupported", since that reads as a broken feature rather than N/A
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  if (isIOS) { btn.style.display = 'none'; return; }
  const supported = !!navigator.vibrate;
  if (!supported) { btn.style.display = 'none'; return; }
  btn.style.display = '';
  btn.innerText = `Haptics: ${profile.settings.haptics ? 'On' : 'Off'}`;
  btn.disabled = false;
}

// Re-export haptic so modals.ts can call it
export { haptic };
