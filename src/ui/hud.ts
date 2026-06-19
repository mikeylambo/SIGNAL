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
  if (state.combo >= 3) {
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
  if (state.combo >= 3) {
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
  el.textContent = mult > 1 ? `+${amount} ×${mult.toFixed(1)}` : `+${amount}`;
  el.style.left = x + 'px';
  el.style.top = y + 'px';
  if (mult > 1) el.style.color = 'var(--combo)';
  document.body.appendChild(el);
  requestAnimationFrame(() => el.classList.add('rise'));
  setTimeout(() => el.remove(), 700);
}

export function updateTimerUI(): void {
  const stressBar = document.getElementById('stress-bar');
  if (!stressBar) return;
  const pct = Math.max(0, (state.timeLeft / state.totalTime) * 100);
  stressBar.style.width = pct + '%';
  stressBar.style.backgroundColor = pct > 50 ? 'var(--correct)' : pct > 20 ? 'var(--combo)' : 'var(--wrong)';
}

export function updateStatsUI(): void {
  const lvlEl = document.getElementById('val-lvl');
  const scoreEl = document.getElementById('val-score');
  const streakEl = document.getElementById('val-streak');
  const clearsEl = document.getElementById('val-clears');
  if (lvlEl) lvlEl.textContent = String(state.level);
  if (scoreEl) scoreEl.textContent = String(state.score);
  if (streakEl) streakEl.textContent = String(state.streak);
  if (clearsEl) clearsEl.textContent = String(state.clears);
  const fragDisplay = document.querySelector('.currency-display span');
  if (fragDisplay && !state.isDailyRun) fragDisplay.textContent = String(getSignal());
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
  const statsBar = document.getElementById('stats-bar');
  if (!statsBar) return;
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  let html = `<div class="currency-display"><span>${getSignal()}</span>&#x27E0;</div>`;
  if (pPace.id === 'classic') html += `<div>Lvl <span id="val-lvl">${state.level}</span></div><div>Pts <span id="val-score">${state.score}</span></div>`;
  if (pPace.id === 'zen')     html += `<div>Lvl <span id="val-lvl">${state.level}</span></div><div>Streak <span id="val-streak">${state.streak}</span></div>`;
  if (pPace.id === 'sprint')  html += `<div>Clears <span id="val-clears">${state.clears}</span></div><div>Pts <span id="val-score">${state.score}</span></div>`;
  if (pMode.id === 'nback')   html = `<div class="currency-display"><span>${getSignal()}</span>&#x27E0;</div><div>2-Back Lvl <span id="val-lvl">${state.level}</span></div><div>Pts <span id="val-score">${state.score}</span></div>`;
  if (state.isDailyRun)       html = `<div style="color:var(--wrong)">DAILY CALIBRATION</div><div>Lvl <span id="val-lvl">${state.level}</span></div><div>Pts <span id="val-score">${state.score}</span></div>`;

  statsBar.innerHTML = html;
}
