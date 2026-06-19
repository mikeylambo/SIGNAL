import { state } from '../state';
import { PROTOCOLS, PACINGS } from '../game/protocols';
import { getSignal, spendSignal, themes, currentThemeKey, applyTheme, profile, saveProfile } from '../save';
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

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16),
  } : null;
}

function updateForgePreview(): string {
  const rSlider = document.getElementById('r-slider') as HTMLInputElement;
  const gSlider = document.getElementById('g-slider') as HTMLInputElement;
  const bSlider = document.getElementById('b-slider') as HTMLInputElement;
  const rVal = document.getElementById('r-val')!;
  const gVal = document.getElementById('g-val')!;
  const bVal = document.getElementById('b-val')!;
  const forgePreview = document.getElementById('forge-preview')!;

  const r = parseInt(rSlider.value);
  const g = parseInt(gSlider.value);
  const b = parseInt(bSlider.value);
  rVal.innerText = String(r); gVal.innerText = String(g); bVal.innerText = String(b);
  const hex = '#' + (1 << 24 | r << 16 | g << 8 | b).toString(16).slice(1).toUpperCase();
  forgePreview.style.backgroundColor = hex;
  forgePreview.style.boxShadow = `0 0 15px ${hex}`;
  return hex;
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
    const rgb = hexToRgb(themes.custom.activeHex);
    if (rgb) {
      rSlider.value = String(rgb.r); gSlider.value = String(rgb.g); bSlider.value = String(rgb.b);
    }
    updateForgePreview();
  });

  document.getElementById('close-forge-btn')!.addEventListener('click', returnToMenu);

  document.getElementById('apply-forge-btn')!.addEventListener('click', () => {
    initAudio();
    const hex = updateForgePreview();
    themes.custom.activeHex = hex;
    themes.custom.active = parseInt(hex.replace('#', ''), 16);
    themes.custom.primary = hex;
    profile.customHex = hex;
    saveProfile();
    applyTheme('custom');
    playTone('buy');
    returnToMenu();
  });

  rSlider.addEventListener('input', updateForgePreview);
  gSlider.addEventListener('input', updateForgePreview);
  bSlider.addEventListener('input', updateForgePreview);

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
