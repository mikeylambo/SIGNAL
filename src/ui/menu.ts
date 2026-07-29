import { state } from '../state';
import { PROTOCOLS, PACINGS } from '../game/protocols';
import { getSignal, spendSignal, themes, currentThemeKey, applyTheme, profile, saveProfile, lightenHex } from '../save';
import { getStreakDisplay } from '../streaks';
import type { CustomPalette } from '../types';
import {
  CURATED_PALETTES, ACCESSIBLE_PALETTES, findCurated, rotatePalette, paletteWarning,
} from '../palettes';
import { playTone, initAudio, haptic, setMasterVolume } from '../audio';
import { AUDIO_UNLOCKS, isAudioUnlocked, buyAudioUnlock, isAudioFeatureEnabled, setAudioFeatureEnabled } from '../audioUnlocks';
import { renderStatsBar } from './hud';
import { returnToMenu, updateReducedMotionText, pauseGame } from './modals';
import { toggleReducedMotion } from '../reducedMotion';
import { initGame, startOnboardingRound } from '../game/runLoop';
import { openLeaderboardBrowser, promptDisplayName } from './leaderboard';
import { setDisplayName } from '../game/leaderboard';
import { renderMasteryList } from '../progression';
import { showKeyboardHelp } from '../keyboard';

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
      const enabled = isAudioFeatureEnabled(unlock.id);
      btn.textContent = enabled ? 'On ✓' : 'Off';
      btn.style.color = enabled ? 'var(--correct)' : 'var(--text-muted)';
      btn.style.borderColor = enabled ? 'var(--correct)' : 'rgba(255,255,255,0.2)';
      btn.addEventListener('click', () => {
        setAudioFeatureEnabled(unlock.id, !enabled);
        populateStore();
      });
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

// ── Forge ─────────────────────────────────────────────────────────────────────
// Curated base + hue rotation. See src/palettes.ts for why this replaced five
// independent RGB sliders.

let draftBaseId = 'mono';
let draftHue = 0;

function draftPalette(): CustomPalette {
  const base = findCurated(draftBaseId) ?? CURATED_PALETTES[0];
  return rotatePalette(base.palette, draftHue);
}

/** Builds the base picker once; each button previews the palette it selects. */
function buildBaseGrid(): void {
  const grid = document.getElementById('forge-base-grid');
  if (!grid || grid.childElementCount > 0) return;

  CURATED_PALETTES.forEach(c => {
    const btn = document.createElement('button');
    btn.className = 'forge-base-btn';
    btn.type = 'button';
    btn.dataset['base'] = c.id;
    btn.setAttribute('aria-pressed', 'false');
    btn.setAttribute('aria-label', `${c.name} palette`);
    // Swatch shows the three roles a player actually distinguishes in play.
    btn.innerHTML =
      `<span class="forge-base-swatch">` +
      `<span style="background:${c.palette.active}"></span>` +
      `<span style="background:${c.palette.correct}"></span>` +
      `<span style="background:${c.palette.wrong}"></span>` +
      `</span><div class="forge-base-name">${c.name}</div>`;
    btn.addEventListener('click', () => {
      draftBaseId = c.id;
      refreshForgeUI();
    });
    grid.appendChild(btn);
  });
}

function refreshForgeUI(): void {
  const p = draftPalette();

  document.querySelectorAll<HTMLButtonElement>('.forge-base-btn').forEach(btn => {
    btn.setAttribute('aria-pressed', String(btn.dataset['base'] === draftBaseId));
  });

  const hueSlider = document.getElementById('forge-hue-slider') as HTMLInputElement | null;
  if (hueSlider) hueSlider.value = String(draftHue);
  const hueVal = document.getElementById('forge-hue-val');
  if (hueVal) hueVal.textContent = `${draftHue}°`;

  (document.getElementById('forge-prev-bg')      as HTMLElement).style.backgroundColor = p.bg;
  (document.getElementById('forge-prev-base')    as HTMLElement).style.backgroundColor = p.base;
  (document.getElementById('forge-prev-active')  as HTMLElement).style.backgroundColor = p.active;
  (document.getElementById('forge-prev-correct') as HTMLElement).style.backgroundColor = p.correct;
  (document.getElementById('forge-prev-wrong')   as HTMLElement).style.backgroundColor = p.wrong;

  // Checks every pair that matters for play, not just base-vs-bg as before.
  const warning = document.getElementById('forge-contrast-warning')!;
  const problem = paletteWarning(p);
  warning.style.display = problem ? 'block' : 'none';
  if (problem) warning.textContent = `\u26A0 ${problem}`;

  updateCustomSlotUI();
}

function openForge(): void {
  buildBaseGrid();
  const slot = profile.activeCustomSlot ?? 'custom1';
  const meta = profile.customPaletteMeta?.[slot];
  draftBaseId = meta?.baseId ?? 'mono';
  draftHue = meta?.hue ?? 0;
  if (!findCurated(draftBaseId)) draftBaseId = 'mono';
  refreshForgeUI();
}

function updateCustomSlotUI(): void {
  const active = profile.activeCustomSlot ?? 'custom1';
  document.querySelectorAll<HTMLButtonElement>('.custom-slot-btn').forEach(btn => {
    const isActive = btn.dataset['slot'] === active;
    btn.style.borderColor = isActive ? 'var(--active)' : 'rgba(255,255,255,0.14)';
    btn.style.color = isActive ? 'var(--active)' : '';
  });
}

function applyForge(): void {
  const slot = profile.activeCustomSlot ?? 'custom1';
  const p = draftPalette();

  if (!profile.customPalettes) profile.customPalettes = {};
  if (!profile.customPaletteMeta) profile.customPaletteMeta = {};
  profile.customPalettes[slot] = { ...p };
  profile.customPaletteMeta[slot] = { baseId: draftBaseId, hue: draftHue };
  profile.customPalette = { ...p };   // keep legacy field in sync
  profile.customHex = p.active;
  // Choosing a cosmetic palette is an explicit override of the accessibility
  // one; leaving both set would make the Forge preview lie about what the
  // player is about to see.
  profile.accessiblePalette = '';
  saveProfile();

  syncCustomTheme(p);
  applyTheme('custom');
  playTone('buy');
  returnToMenu();
}

/** Pushes a palette into the live `custom` theme object. */
function syncCustomTheme(p: CustomPalette): void {
  const h = (hex: string) => parseInt(hex.replace('#', ''), 16);
  themes.custom.primary    = p.active;
  themes.custom.bg         = h(p.bg);      themes.custom.bgHex      = p.bg;
  themes.custom.active     = h(p.active);  themes.custom.activeHex  = p.active;
  themes.custom.correct    = h(p.correct); themes.custom.correctHex = p.correct;
  themes.custom.wrong      = h(p.wrong);   themes.custom.wrongHex   = p.wrong;
  themes.custom.base       = h(p.base);    themes.custom.baseHex    = p.base;
  themes.custom.edge       = lightenHex(p.base, 1.7);
}

// ── Accessibility ─────────────────────────────────────────────────────────────
// Colour-vision palettes live here rather than in the Forge: they are an access
// need, not a cosmetic, and the players who need them are the least likely to go
// looking inside a customisation screen.

function buildAccessList(): void {
  const list = document.getElementById('access-palette-list');
  if (!list) return;
  list.innerHTML = '';

  const render = (id: string, name: string, desc: string, swatch: string[] | null) => {
    const selected = (profile.accessiblePalette ?? '') === id;
    const btn = document.createElement('button');
    btn.className = 'btn-small';
    btn.type = 'button';
    btn.setAttribute('aria-pressed', String(selected));
    btn.style.cssText =
      'width:100%; text-align:left; padding:10px 12px; display:flex; align-items:center; gap:10px;' +
      `border-color:${selected ? 'var(--active)' : 'rgba(255,255,255,0.14)'};` +
      `color:${selected ? 'var(--active)' : ''};`;
    const chips = swatch
      ? `<span style="display:flex;gap:2px;flex-shrink:0;">${swatch
          .map(c => `<span style="width:12px;height:12px;border-radius:2px;background:${c};"></span>`)
          .join('')}</span>`
      : '<span style="width:38px;flex-shrink:0;"></span>';
    btn.innerHTML =
      chips +
      `<span style="flex:1;"><span style="display:block;font-size:0.74rem;">${name}</span>` +
      `<span style="display:block;font-size:0.62rem;color:var(--text-muted);margin-top:2px;">${desc}</span></span>` +
      (selected ? '<span style="flex-shrink:0;">\u2713</span>' : '');
    btn.addEventListener('click', () => applyAccessiblePalette(id));
    list.appendChild(btn);
  };

  render('', 'Off', 'Use your chosen calibration', null);
  ACCESSIBLE_PALETTES.forEach(a =>
    render(a.id, a.name, 'Blue/orange success axis', [a.palette.active, a.palette.correct, a.palette.wrong]),
  );
}

function applyAccessiblePalette(id: string): void {
  profile.accessiblePalette = id;
  saveProfile();

  if (!id) {
    // Back to whatever calibration was selected before.
    applyTheme(profile.currentCalibration || 'mono');
    buildAccessList();
    return;
  }

  const preset = ACCESSIBLE_PALETTES.find(a => a.id === id);
  if (!preset) return;
  syncCustomTheme(preset.palette);
  applyTheme('custom');
  playTone('buy');
  buildAccessList();
}

/**
 * Re-applies the accessibility palette at startup. Without this the setting
 * would persist but only take effect the next time the player opened Settings.
 */
export function initAccessiblePalette(): void {
  const id = profile.accessiblePalette;
  if (!id) return;
  const preset = ACCESSIBLE_PALETTES.find(a => a.id === id);
  if (!preset) return;
  syncCustomTheme(preset.palette);
  applyTheme('custom');
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

  protocolBtn.addEventListener('click', () => {
    initAudio();
    state.curProtIdx = (state.curProtIdx + 1) % PROTOCOLS.length;
    updateMenuText();
  });

  pacingBtn.addEventListener('click', () => {
    initAudio();
    state.curPaceIdx = (state.curPaceIdx + 1) % PACINGS.length;
    updateMenuText();
  });

  startBtn.addEventListener('click', () => {
    initAudio();
    state.isDailyRun = false;
    initGame();
  });

  // Daily row — the entire div is clickable; guard if already completed today.
  // It carries role="button" tabindex="0", but a div doesn't get Enter/Space
  // activation for free the way a real <button> does, so the keyboard handler
  // below is what makes that ARIA promise true rather than decorative.
  dailyRow.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    dailyRow.click();
  });

  dailyRow.addEventListener('click', (_e: MouseEvent) => {
    const today = new Date().toISOString().split('T')[0];
    if (profile.lastDailyDate === today) return;
    initAudio();
    state.isDailyRun = true;
    const now = new Date();
    const seed = now.getFullYear() * 10000 + (now.getMonth() + 1) * 100 + now.getDate();
    // 2-Back is no longer excluded from the daily rotation — it was skipped
    // because it ignored pacing and behaved unpredictably; now that it honours
    // all three, it's a legitimate daily draw like any other protocol.
    state.curProtIdx = seed % PROTOCOLS.length;
    state.curPaceIdx = 0;
    initGame();
  });

  // Pause — shares pauseGame() with the backgrounding handler in main.ts
  pauseBtn.addEventListener('click', () => {
    initAudio();
    pauseGame();
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
    const profCallsign = document.getElementById('prof-callsign');
    if (profCallsign) profCallsign.textContent = profile.display_name || '— not set —';
    renderMasteryList();
    updateReducedMotionText();
  });

  // Change callsign — reuses the same modal as first-run naming, in rename mode
  document.getElementById('change-callsign-btn')!.addEventListener('click', () => {
    initAudio();
    void promptDisplayName().then(name => {
      if (!name) return; // user cancelled — no change
      setDisplayName(name);
      const profCallsign = document.getElementById('prof-callsign');
      if (profCallsign) profCallsign.textContent = name;
      playTone('buy');
    });
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
  document.getElementById('settings-tab-access')!.addEventListener('click', () => {
    switchSettingsTab('access');
    buildAccessList();
    updateReducedMotionText();
  });
  document.getElementById('close-forge-btn-access')!.addEventListener('click', returnToMenu);
  document.getElementById('keyboard-help-btn')!.addEventListener('click', showKeyboardHelp);
  document.getElementById('reduced-motion-btn-access')!.addEventListener('click', () => {
    toggleReducedMotion();
    updateReducedMotionText();
  });

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

  // Hue slider — the Forge's only continuous control now
  const hueSlider = document.getElementById('forge-hue-slider') as HTMLInputElement;
  hueSlider.addEventListener('input', () => {
    draftHue = parseInt(hueSlider.value, 10) || 0;
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

  // Leaderboards browser
  document.getElementById('leaderboard-browser-btn')!.addEventListener('click', () => {
    initAudio();
    openLeaderboardBrowser();
  });

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

  // "How to Play" — opt-in tutorial from the menu sheet
  const howToPlayBtn = document.getElementById('how-to-play-btn');
  if (howToPlayBtn) {
    howToPlayBtn.addEventListener('click', () => {
      // Disable immediately — createBoard() inside startOnboardingRound() does
      // synchronous Three.js work with no loading indicator, so without this a
      // fast second tap can fire before any visual change appears.
      (howToPlayBtn as HTMLButtonElement).disabled = true;
      initAudio();
      profile.hasCompletedOnboarding = false;
      profile.hasSeenOnboarding = false;
      saveProfile();
      void startOnboardingRound().finally(() => {
        (howToPlayBtn as HTMLButtonElement).disabled = false;
      });
    });
  }

  // Custom palette slot selector
  document.querySelectorAll<HTMLButtonElement>('.custom-slot-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const slot = btn.dataset['slot'] ?? 'custom1';
      profile.activeCustomSlot = slot;
      saveProfile();
      // Load that slot's saved Forge controls, not its raw colours — the
      // controls are what the UI edits now.
      const meta = profile.customPaletteMeta?.[slot];
      draftBaseId = findCurated(meta?.baseId ?? '') ? meta!.baseId : 'mono';
      draftHue = meta?.hue ?? 0;
      refreshForgeUI();
    });
  });
}

function switchSettingsTab(tab: 'audio' | 'visual' | 'access'): void {
  const panes: Record<string, string> = {
    audio:  'settings-content-audio',
    visual: 'settings-content-visual',
    access: 'settings-content-access',
  };
  const tabs: Record<string, string> = {
    audio:  'settings-tab-audio',
    visual: 'settings-tab-visual',
    access: 'settings-tab-access',
  };
  for (const key of Object.keys(panes)) {
    const pane = document.getElementById(panes[key]);
    const pill = document.getElementById(tabs[key]);
    if (pane) pane.style.display = key === tab ? '' : 'none';
    if (pill) pill.classList.toggle('settings-tab-active', key === tab);
  }
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
