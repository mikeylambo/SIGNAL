import { state } from '../state';
import { profile, saveProfile } from '../save';
import { initGame, showResultsScreen, registerShowResultsScreen, stopTimer, runTimer, registerReturnToMenu } from '../game/runLoop';
import { createBoard } from '../render/board';
import { updateComboUI, showMessage, renderStatsBar } from './hud';
import { resetAnimTime, loopState } from '../render/loop';
import { isReducedMotion, toggleReducedMotion } from '../reducedMotion';
import { updateMenuText } from './menu';
import { stopGameplayAudio } from '../audioUnlocks';
import { adjustCameraForViewport } from '../render/scene';

// Register with runLoop so gameOver can call back without circular dep
registerShowResultsScreen(showResultsScreen);
// Register returnToMenu so startOnboardingRound() can navigate back after tutorial
registerReturnToMenu(returnToMenu);

export function returnToMenu(): void {
  (document.getElementById('results-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('pause-screen')   as HTMLElement).style.display = 'none';
  (document.getElementById('profile-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('forge-screen')   as HTMLElement).style.display = 'none';
  (document.getElementById('store-screen')   as HTMLElement).style.display = 'none';
  (document.getElementById('leaderboard-browser-screen') as HTMLElement).style.display = 'none';
  (document.getElementById('ui-layer')       as HTMLElement).style.display = 'flex';
  (document.getElementById('ui-layer')       as HTMLElement).style.opacity  = '1';

  // Hide gameplay HUD; show menu header and sheet
  (document.getElementById('gameplay-hud')  as HTMLElement).style.display = 'none';
  (document.getElementById('menu-topbar')   as HTMLElement).style.display = 'flex';
  (document.getElementById('menu-sheet')    as HTMLElement).style.display = 'flex';
  (document.getElementById('controls-hint') as HTMLElement).style.display = 'block';

  (document.getElementById('canvas-container') as HTMLElement).style.filter = 'none';

  // Sheet is visible again with its real height — recompute the camera offset so
  // the grid re-centers above it instead of keeping gameplay's centered framing.
  adjustCameraForViewport();

  // Clear gameplay message and combo
  showMessage('', 'var(--text)');
  updateComboUI();
  renderStatsBar();
  stopTimer();
  createBoard();

  // Refresh streak display and daily row state
  updateMenuText();

  // Stop any active gameplay audio layers
  stopGameplayAudio();
}


export function setupModalListeners(): void {
  // "Enter SIGNAL →" shown on results screen when coming from an onboarding round
  document.getElementById('enter-signal-btn')!.addEventListener('click', () => {
    profile.hasCompletedOnboarding = true;
    profile.hasSeenOnboarding = true;
    saveProfile();
    state.isOnboarding = false;
    returnToMenu();
  });

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

  document.getElementById('close-profile-btn')!.addEventListener('click', returnToMenu);

  // Haptics toggle (now in Settings → Audio tab)
  document.getElementById('haptics-toggle-btn')!.addEventListener('click', () => {
    profile.settings.haptics = !profile.settings.haptics;
    saveProfile();
    updateHapticsToggleText();
    if (profile.settings.haptics && navigator.vibrate) navigator.vibrate(12);
  });

  // SFX toggle
  document.getElementById('sfx-toggle-btn')!.addEventListener('click', () => {
    profile.settings.sfx = !profile.settings.sfx;
    saveProfile();
    updateSfxToggleText();
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
  const btn = document.getElementById('haptics-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = `Haptics: ${profile.settings.haptics ? 'On' : 'Off'}`;
}

function updateSfxToggleText(): void {
  const btn = document.getElementById('sfx-toggle-btn') as HTMLButtonElement | null;
  if (!btn) return;
  btn.innerText = `SFX: ${profile.settings.sfx ? 'On' : 'Off'}`;
}