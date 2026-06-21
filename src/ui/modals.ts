import { state } from '../state';
import { profile, saveProfile } from '../save';
import { initGame, showResultsScreen, registerShowResultsScreen, stopTimer, runTimer } from '../game/runLoop';
import { createBoard } from '../render/board';
import { updateComboUI, showMessage, renderStatsBar } from './hud';
import { resetAnimTime, loopState } from '../render/loop';
import { isReducedMotion, toggleReducedMotion } from '../reducedMotion';

// Register with runLoop so gameOver can call back without circular dep
registerShowResultsScreen(showResultsScreen);

export function returnToMenu(): void {
  (document.getElementById('results-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('pause-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('profile-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('forge-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('store-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('ui-layer') as HTMLElement).style.display = 'flex';
  (document.getElementById('center-display') as HTMLElement).style.display = 'flex';
  (document.getElementById('ui-layer') as HTMLElement).style.opacity = '1';

  const container = document.getElementById('canvas-container') as HTMLElement;
  container.style.filter = 'none';

  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  pauseBtn.style.display = 'none';

  const stressBarContainer = document.getElementById('stress-bar-container') as HTMLElement;
  stressBarContainer.style.display = 'none';

  updateComboUI();
  showMessage('Standby', 'var(--text)');
  renderStatsBar();
  stopTimer();
  createBoard();
}

export function setupModalListeners(): void {
  document.getElementById('menu-btn')!.addEventListener('click', returnToMenu);
  document.getElementById('pause-menu-btn')!.addEventListener('click', () => {
    state.isPaused = false;
    returnToMenu();
  });

  document.getElementById('restart-btn')!.addEventListener('click', () => {
    if (state.isDailyRun) returnToMenu();
    else initGame();
  });

  document.getElementById('resume-btn')!.addEventListener('click', () => {
    state.isPaused = false;
    loopState.hitstopEndTime = 0;
    (document.getElementById('pause-screen') as HTMLElement).style.display = 'none';
    (document.getElementById('ui-layer') as HTMLElement).style.opacity = '1';
    (document.getElementById('canvas-container') as HTMLElement).style.filter = 'none';
    state.lastFrameTime = performance.now();
    if (state.wasTimerActiveBeforePause) {
      state.timerActive = true;
      state.timerAnimationId = requestAnimationFrame(runTimer);
    }
    resetAnimTime();
  });

  // Daily & start buttons wired in menu.ts
  // Profile modal
  document.getElementById('close-profile-btn')!.addEventListener('click', returnToMenu);

  // Haptics toggle
  document.getElementById('haptics-toggle-btn')!.addEventListener('click', () => {
    profile.settings.haptics = !profile.settings.haptics;
    saveProfile();
    updateHapticsToggleText();
    if (profile.settings.haptics && navigator.vibrate) navigator.vibrate(12);
  });

  // Reduced-motion toggle
  document.getElementById('reduced-motion-btn')!.addEventListener('click', () => {
    toggleReducedMotion();
    updateReducedMotionText();
  });
}

export function updateReducedMotionText(): void {
  const btn = document.getElementById('reduced-motion-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = `Motion: ${isReducedMotion() ? 'Reduced' : 'Full'}`;
}

function updateHapticsToggleText(): void {
  const supported = !!navigator.vibrate;
  const btn = document.getElementById('haptics-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = supported ? `Haptics: ${profile.settings.haptics ? 'On' : 'Off'}` : 'Haptics: Unsupported';
  btn.disabled = !supported;
}
