import * as THREE from 'three';
import { state } from '../state';
import { getSignal } from '../save';
import { camera } from '../render/scene';
import { PROTOCOLS, PACINGS } from '../game/protocols';

export function showMessage(text: string, color: string): void {
  const el = document.getElementById('message');
  if (!el) return;
  el.textContent = text;
  el.style.color = color;
  el.style.opacity = text ? '1' : '0';
}

export function updateComboUI(): void {
  const el = document.getElementById('combo-readout');
  if (!el) return;
  if (state.combo >= 2) {
    el.style.display = 'flex';
    const numEl = el.querySelector('.combo-num');
    if (numEl) numEl.textContent = String(state.combo);
    el.classList.remove('combo-pulse');
    void (el as HTMLElement).offsetWidth;
    el.classList.add('combo-pulse');
  } else {
    el.style.display = 'none';
  }
}

export function resetCombo(): void {
  if (state.combo >= 2) {
    const el = document.getElementById('combo-readout');
    if (el) {
      el.classList.add('combo-break');
      setTimeout(() => el.classList.remove('combo-break'), 300);
    }
  }
  state.combo = 0;
  updateComboUI();
}

export function spawnScorePopup(cube: THREE.Mesh, amount: number, mult: number): void {
  const worldPos = cube.getWorldPosition(new THREE.Vector3());
  const screenPos = worldPos.clone().project(camera);
  const x = (screenPos.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-screenPos.y * 0.5 + 0.5) * window.innerHeight;

  const el = document.createElement('div');
  el.className = 'score-popup';
  el.setAttribute('aria-hidden', 'true');
  el.textContent = mult > 1 ? `+${amount} ×${mult.toFixed(1)}` : `+${amount}`;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  if (mult > 1) el.style.color = 'var(--combo)';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 700);

  const announce = document.getElementById('sr-score-announce');
  if (announce) announce.textContent = mult > 1 ? `+${amount}, ${mult.toFixed(1)}x combo` : `+${amount}`;
}

export function updateTimerUI(): void {
  const stressBar = document.getElementById('stress-bar');
  if (!stressBar) return;
  const pct = Math.max(0, (state.timeLeft / state.totalTime) * 100);
  stressBar.style.width = pct + '%';
  stressBar.style.backgroundColor = pct > 50 ? 'var(--correct)' : pct > 20 ? 'var(--combo)' : 'var(--wrong)';
  stressBar.setAttribute('aria-valuenow', String(Math.round(pct)));
}

export function updateStatsUI(): void {
  const lvlEl    = document.getElementById('val-lvl');
  const scoreEl  = document.getElementById('val-score');
  const streakEl = document.getElementById('val-streak');
  const clearsEl = document.getElementById('val-clears');
  if (lvlEl)    lvlEl.textContent    = String(state.level);
  if (scoreEl)  scoreEl.textContent  = String(state.score);
  if (streakEl) streakEl.textContent = String(state.streak);
  if (clearsEl) clearsEl.textContent = String(state.clears);
}

export function updateHapticsToggleText(): void {
  const supported = !!navigator.vibrate;
  const btn = document.getElementById('haptics-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  // profile is imported lazily via save to avoid circular deps
  const profile = (window as unknown as { __signalProfile?: { settings: { haptics: boolean } } }).__signalProfile;
  const hapticOn = profile?.settings.haptics ?? true;
  btn.innerText = supported ? `Haptics: ${hapticOn ? 'On' : 'Off'}` : 'Haptics: Unsupported';
  btn.disabled = !supported;
}

export function renderStatsBar(): void {
  const hudMode  = document.getElementById('hud-mode');
  const hudStats = document.getElementById('hud-right-stats');
  if (!hudMode || !hudStats) return;

  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  // Left zone: mode label
  if (state.isDailyRun) {
    hudMode.textContent = 'Daily Cal';
    hudMode.style.color = 'var(--wrong)';
  } else if (pMode.id === 'nback') {
    hudMode.textContent = '2-Back';
    hudMode.style.color = 'var(--combo)';
  } else {
    hudMode.textContent = pMode.name;
    hudMode.style.color = 'var(--text-muted)';
  }

  // Right zone: pacing-specific stats
  if (pPace.id === 'zen') {
    hudStats.innerHTML = `Lv <span id="val-lvl">${state.level}</span> · <span id="val-streak">${state.streak}</span>`;
  } else if (pPace.id === 'sprint') {
    hudStats.innerHTML = `×<span id="val-clears">${state.clears}</span> · Pts <span id="val-score">${state.score}</span>`;
  } else {
    hudStats.innerHTML = `Lv <span id="val-lvl">${state.level}</span> · Pts <span id="val-score">${state.score}</span>`;
  }

  void getSignal; // suppress unused import until signal display is added to HUD
}
