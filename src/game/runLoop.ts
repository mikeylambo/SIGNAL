import * as THREE from 'three';
import { state } from '../state';
import { PROTOCOLS, PACINGS } from './protocols';
import { cubes, setCubeState, createBoard } from '../render/board';
import { camera, spawnParticles } from '../render/scene';
import { loopState, cameraShake, flashScreen } from '../render/loop';
import { playTone, haptic } from '../audio';
import { addSignal, recordRun, t, profile, saveProfile } from '../save';
import { showMessage, updateComboUI, resetCombo, spawnScorePopup, updateTimerUI, updateStatsUI, renderStatsBar } from '../ui/hud';
import { delay } from '../utils';
import { submitScore, modeBoardKey, dailyBoardKey } from './leaderboard';
import { promptDisplayName, showLeaderboardPanel } from '../ui/leaderboard';

// isTouchDevice / hitstopScale — duplicated from input.ts to avoid circular deps
const isTouchDevice = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;
const hitstopScale = isTouchDevice ? 0.35 : 1;

// Lazy import of showResultsScreen to break the circular chain
let _showResultsScreen: (() => void) | null = null;
export function registerShowResultsScreen(fn: () => void): void {
  _showResultsScreen = fn;
}

// Onboarding hooks — set by onboarding.ts for the single guided tutorial round,
// cleared immediately after firing so they never affect normal gameplay.
type ObHooks = {
  onObserve?: () => void;
  onExecute?: () => void;
  onRoundEnd?: () => void;
  // Intercepts handleMistake before any pacing logic fires (gameOver / zen restart).
  // Return early prevents camera shake, results screen, etc. during the tutorial.
  onMistake?: () => void;
};
let _ob: ObHooks = {};
export function setOnboardingHooks(h: ObHooks): void { _ob = h; }
export function clearOnboardingHooks(): void { _ob = {}; }

export async function runCountdown(): Promise<void> {
  return new Promise(async resolve => {
    const countdownEl = document.getElementById('countdown-overlay')!;
    countdownEl.style.opacity = '1';
    for (let i = 3; i > 0; i--) {
      countdownEl.innerText = String(i);
      countdownEl.style.transform = 'translate(-50%, -50%) scale(1.2)';
      playTone('tick');
      await delay(100);
      countdownEl.style.transform = 'translate(-50%, -50%) scale(1)';
      await delay(700);
    }
    countdownEl.innerText = 'GO';
    countdownEl.style.color = 'var(--correct)';
    playTone('go');
    await delay(500);
    countdownEl.style.opacity = '0';
    countdownEl.style.color = 'var(--active)';
    resolve();
  });
}

export function runTimer(timestamp: number): void {
  if (!state.timerActive || state.isPaused) return;
  const delta = timestamp - state.lastFrameTime;
  state.lastFrameTime = timestamp;
  state.timeLeft -= delta;
  if (state.timeLeft <= 0) {
    state.timeLeft = 0;
    updateTimerUI();
    gameOver('TIME EXPIRED');
    return;
  }
  updateTimerUI();
  state.timerAnimationId = requestAnimationFrame(runTimer);
}

export function stopTimer(): void {
  state.timerActive = false;
  if (state.timerAnimationId) cancelAnimationFrame(state.timerAnimationId);
}


export async function initGame(): Promise<void> {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  const resultsScreen = document.getElementById('results-screen')!;
  const uiLayer = document.getElementById('ui-layer')!;
  const centerDisplay = document.getElementById('center-display')!;
  const stressBarContainer = document.getElementById('stress-bar-container')!;
  const stressBar = document.getElementById('stress-bar')!;

  resultsScreen.style.display = 'none';
  uiLayer.style.display = 'flex';
  centerDisplay.style.display = 'none';

  state.level = 1; state.score = 0; state.streak = 0; state.maxStreak = 0;
  state.mistakes = 0; state.clears = 0; state.earnedFragments = 0;
  state.combo = 0; state.maxCombo = 0;
  updateComboUI();

  state.gridSize = 3; state.activeCount = 3; state.nBackActive = false;
  loopState.targetRot = { x: Math.PI / 6, y: -Math.PI / 8 };

  renderStatsBar();

  if (pPace.id === 'sprint' && pMode.id !== 'nback') {
    state.totalTime = 60000; state.timeLeft = 60000; state.timerActive = false;
    stressBarContainer.style.display = 'block';
    stressBar.style.width = '100%';
    stressBar.style.backgroundColor = 'var(--active)';
  } else if (pPace.id === 'zen') {
    stressBarContainer.style.display = 'none'; state.timerActive = false;
  } else {
    stressBarContainer.style.display = 'block';
  }

  createBoard();
  await delay(200);
  await runCountdown();

  if (pPace.id === 'sprint' && pMode.id !== 'nback') {
    state.timerActive = true;
    state.lastFrameTime = performance.now();
    state.timerAnimationId = requestAnimationFrame(runTimer);
  }

  if (pMode.id === 'nback') startNBackLevel();
  else startLevel();
}

export async function startLevel(): Promise<void> {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const stressBar = document.getElementById('stress-bar')!;

  state.isPlayable = false;
  state.userClicks = [];
  updateStatsUI();
  pauseBtn.style.display = 'none';

  if (pPace.id === 'classic') {
    stopTimer();
    stressBar.style.width = '100%';
    stressBar.style.backgroundColor = 'var(--active)';
  }

  showMessage('Constructing', 'var(--text)');
  cubes.forEach(c => { setCubeState(c, 'base'); c.userData['targetY'] = 0; c.userData['targetScale'] = 1; });
  await delay(500);

  state.pattern = []; state.decoys = []; state.rhythmDelays = [];
  const totalTiles = state.gridSize * state.gridSize;
  while (state.pattern.length < state.activeCount) {
    const r = Math.floor(Math.random() * totalTiles);
    if (!state.pattern.includes(r)) state.pattern.push(r);
  }

  if (pMode.id === 'interference') {
    let decoyCount = Math.floor(state.activeCount * 0.7) || 1;
    decoyCount = Math.min(decoyCount, totalTiles - state.pattern.length);
    while (state.decoys.length < decoyCount) {
      const r = Math.floor(Math.random() * totalTiles);
      if (!state.pattern.includes(r) && !state.decoys.includes(r)) state.decoys.push(r);
    }
  }

  showMessage('Observe', 'var(--active)');
  _ob.onObserve?.();
  await delay(300);
  const speedMult = pPace.id === 'sprint' ? 0.6 : 1;

  if (pMode.id === 'interference') {
    state.pattern.forEach(i => setCubeState(cubes[i], 'active'));
    state.decoys.forEach(i => setCubeState(cubes[i], 'decoy'));
    playTone('active'); playTone('decoy');
    await delay(1200 * speedMult);
    if (state.isPaused) return;
    cubes.forEach(c => setCubeState(c, 'base'));
  } else {
    for (let i = 0; i < state.pattern.length; i++) {
      if (state.isPaused) return;
      setCubeState(cubes[state.pattern[i]], 'active');
      playTone('active');
      let pause = 200 * speedMult;
      if (pMode.id === 'rhythm') {
        const options = [200, 400, 600];
        pause = options[Math.floor(Math.random() * options.length)] * speedMult;
        state.rhythmDelays.push(pause);
      }
      await delay(pause);
      setCubeState(cubes[state.pattern[i]], 'base');
      await delay(150 * speedMult);
    }
  }

  if (state.isPaused) return;
  showMessage('Execute', 'var(--text)');
  _ob.onExecute?.();
  state.isPlayable = true;
  state.lastClickTime = 0;
  pauseBtn.style.display = 'flex';
  state.levelTimeStart = Date.now();

  if (pPace.id === 'classic') {
    state.totalTime = Math.max(3000, 5000 + (state.pattern.length * 800) - (state.level * 200));
    if (pMode.id === 'sequential' || pMode.id === 'rhythm') state.totalTime += 2000;
    state.timeLeft = state.totalTime;
    state.timerActive = true;
    state.lastFrameTime = performance.now();
    state.timerAnimationId = requestAnimationFrame(runTimer);
  }
}

export async function startNBackLevel(): Promise<void> {
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const stressBar = document.getElementById('stress-bar')!;

  state.isPlayable = true; state.timerActive = false; state.nBackActive = true;
  state.userClicks = [];
  updateStatsUI();
  pauseBtn.style.display = 'flex';
  cubes.forEach(c => { setCubeState(c, 'base'); c.userData['targetY'] = 0; c.userData['targetScale'] = 1; });
  showMessage('Stream Active', 'var(--text)');
  await delay(1000);

  const streamLength = 10 + state.level;
  state.nBackStream = [];
  for (let i = 0; i < streamLength; i++) {
    if (i >= 2 && Math.random() < 0.35) {
      state.nBackStream.push(state.nBackStream[i - 2]);
    } else {
      let r: number;
      do { r = Math.floor(Math.random() * (state.gridSize * state.gridSize)); }
      while (r === state.nBackStream[i - 2]);
      state.nBackStream.push(r);
    }
  }

  stressBar.style.width = '100%';

  for (let i = 0; i < state.nBackStream.length; i++) {
    while (state.isPaused) await delay(100);
    if (!state.nBackActive) return;
    state.nBackStep = i;
    const idx = state.nBackStream[i];
    const isMatch = (i >= 2 && state.nBackStream[i] === state.nBackStream[i - 2]);
    let clickedDuringFlash = false;

    state.nBackIsFlashing = true;
    setCubeState(cubes[idx], 'active');
    playTone('active');

    const waitTime = Math.max(600, 1200 - (state.level * 50));
    const startTime = Date.now();
    while (Date.now() - startTime < waitTime) {
      if (!state.nBackActive) return;
      if (state.isPaused) { await delay(100); continue; }
      await delay(20);
      if (state.userClicks.includes(i)) { clickedDuringFlash = true; break; }
    }

    state.nBackIsFlashing = false;
    setCubeState(cubes[idx], 'base');
    if (isMatch && !clickedDuringFlash) { handleMistake(cubes[idx], 'MISSED TARGET'); return; }
    await delay(300);
  }
  if (state.nBackActive) levelComplete();
}

export function handleInteraction(cube: THREE.Mesh): void {
  if (!state.isPlayable || state.isPaused) return;
  const pMode = PROTOCOLS[state.curProtIdx];
  const index = cube.userData['index'] as number;

  if (pMode.id === 'nback') {
    if (!state.nBackIsFlashing || state.userClicks.includes(state.nBackStep)) return;
    state.userClicks.push(state.nBackStep);
    const isMatch = (state.nBackStep >= 2 && state.nBackStream[state.nBackStep] === state.nBackStream[state.nBackStep - 2]);
    if (isMatch) processHit(cube, 1.5);
    else handleMistake(cube, 'FALSE POSITIVE');
    return;
  }

  if (state.userClicks.includes(index)) return;
  let isCorrect = false;

  if (pMode.id === 'sequential' || pMode.id === 'rhythm') {
    if (index === state.pattern[state.userClicks.length]) isCorrect = true;
  } else {
    if (state.pattern.includes(index)) isCorrect = true;
  }

  if (isCorrect) {
    if (pMode.id === 'rhythm' && state.userClicks.length > 0) {
      const timeDelta = Date.now() - state.lastClickTime;
      const expectedDelta = state.rhythmDelays[state.userClicks.length - 1] + 150;
      if (Math.abs(timeDelta - expectedDelta) > 400) { handleMistake(cube, 'RHYTHM DE-SYNC'); return; }
    }
    state.userClicks.push(index);
    state.lastClickTime = Date.now();
    processHit(cube, pMode.id === 'spatial' ? 1 : 1.5);

    if (state.userClicks.length === state.pattern.length) {
      state.isPlayable = false;
      const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
      pauseBtn.style.display = 'none';
      const pPace = PACINGS[state.curPaceIdx];
      if (pPace.id === 'classic') stopTimer();
      setTimeout(levelComplete, 400);
    }
  } else {
    handleMistake(cube, 'INVALID NODE');
  }
}

export function processHit(cube: THREE.Mesh, multiplier: number): void {
  state.combo++;
  if (state.combo > state.maxCombo) state.maxCombo = state.combo;
  const comboMult = Math.min(4, 1 + Math.floor(state.combo / 4) * 0.5);
  const gained = Math.floor(10 * comboMult * multiplier);

  state.timeLeft = Math.min(state.totalTime, state.timeLeft + 400);
  state.score += gained;
  updateStatsUI();
  updateComboUI();

  const tier = Math.min(state.combo, 20);
  loopState.hitstopEndTime = Date.now() + (40 + tier * 1.2) * hitstopScale;

  playTone(state.combo > 0 && state.combo % 4 === 0 ? 'comboTick' : 'correct');
  haptic(state.combo % 4 === 0 && state.combo > 0 ? 'combo' : 'hit');
  setCubeState(cube, 'correct');
  spawnParticles(cube.getWorldPosition(new THREE.Vector3()), t.activeHex, 10 + Math.min(20, tier));
  spawnScorePopup(cube, gained, comboMult);

  cube.userData['targetY'] = 0.5;
  setTimeout(() => { cube.userData['targetY'] = 0; }, 150);
}

export function handleMistake(wrongCube: THREE.Mesh | null, reason: string): void {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;

  resetCombo();
  state.isPlayable = false;
  pauseBtn.style.display = 'none';
  playTone('wrong'); haptic('wrong');
  loopState.hitstopEndTime = Date.now() + 100 * hitstopScale;

  if (wrongCube) {
    setCubeState(wrongCube, 'wrong');
    spawnParticles(wrongCube.getWorldPosition(new THREE.Vector3()), t.wrongHex);
  }
  if (pMode.id !== 'nback') {
    state.pattern.forEach(i => {
      if (!state.userClicks.includes(i)) setCubeState(cubes[i], 'active');
    });
  }

  // Tutorial intercept: skip all pacing/game-over logic when onboarding is active
  if (_ob.onMistake) { const fn = _ob.onMistake; clearOnboardingHooks(); fn(); return; }

  if (pPace.id === 'classic' || pMode.id === 'nback') {
    state.nBackActive = false;
    gameOver(reason || 'RUN FAILED');
  } else if (pPace.id === 'zen') {
    state.mistakes++; state.streak = 0; updateStatsUI();
    showMessage(reason || 'OVERLOAD', 'var(--wrong)');
    if (state.level > 1 && state.mistakes % 2 === 0) {
      state.level--; state.activeCount = Math.max(3, state.activeCount - 1);
      if (state.level % 3 === 0) state.gridSize = Math.max(3, state.gridSize - 1);
      playTone('levelDown');
    }
    setTimeout(() => { createBoard(); startLevel(); }, 1500);
  } else if (pPace.id === 'sprint') {
    state.mistakes++; state.timeLeft -= 3000;
    showMessage('PENALTY −3s', 'var(--wrong)');
    flashScreen('var(--wrong)');
    if (state.level > 1 && state.mistakes % 3 === 0) {
      state.level--; state.activeCount = Math.max(3, state.activeCount - 1);
      if (state.level % 3 === 0) state.gridSize = Math.max(3, state.gridSize - 1);
      playTone('levelDown');
    }
    cameraShake(0.4, 350, () => { createBoard(); startLevel(); });
  }
}

export async function levelComplete(): Promise<void> {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  // Fire onboarding hook before animations. If a hook was registered we're in
  // the tutorial — return immediately after playing the success sound so that
  // startLevel() is never called underneath the tutorial UI.
  const obEnd = _ob.onRoundEnd;
  const wasTutorial = !!obEnd;
  clearOnboardingHooks();
  obEnd?.();

  playTone('levelUp'); haptic('levelUp');
  if (wasTutorial) return;
  const oldLevel = state.level;

  if (pPace.id === 'classic' || pMode.id === 'nback') { state.score += 50; state.level++; }
  else if (pPace.id === 'zen') {
    state.streak++;
    if (state.streak > state.maxStreak) state.maxStreak = state.streak;
    if (state.streak % 3 === 0) state.level++;
  } else if (pPace.id === 'sprint') {
    state.clears++; state.score += 100;
    if (state.clears % 2 === 0) state.level++;
  }
  updateStatsUI();

  cubes.forEach((cube, i) => {
    setTimeout(() => {
      cube.userData['targetY'] = 0.6;
      setTimeout(() => { cube.userData['targetY'] = 0; }, 200);
    }, i * 20);
  });
  await delay(800);

  if (state.level > oldLevel) {
    if (state.level % 2 === 0) state.activeCount = Math.min(10, state.activeCount + 1);
    if (state.level % 3 === 0 && state.gridSize < 6) {
      state.gridSize++;
      state.activeCount = Math.floor(state.activeCount * 0.8);
      createBoard();
    }
  }
  if (pMode.id === 'nback') startNBackLevel();
  else startLevel();
}

export function gameOver(reasonText: string): void {
  const pPace = PACINGS[state.curPaceIdx];
  const pauseBtn = document.getElementById('pause-btn') as HTMLButtonElement;
  const endTitle = document.getElementById('end-title')!;

  state.isPlayable = false;
  stopTimer();
  const obEnd = _ob.onRoundEnd; clearOnboardingHooks(); obEnd?.();
  playTone('wrong'); haptic('wrong');
  pauseBtn.style.display = 'none';
  endTitle.innerText = reasonText;
  endTitle.style.color = pPace.id === 'sprint' ? 'var(--active)' : 'var(--wrong)';
  showMessage(reasonText, 'var(--wrong)');

  cameraShake(0.7, 500, () => {
    const aspect = window.innerWidth / window.innerHeight;
    const mobileFovAdjustment = aspect < 1 ? (1 / aspect) * 0.8 : 1;
    const dist = Math.max(12, state.gridSize * 2.5) * mobileFovAdjustment;
    camera.position.set(0, dist * 0.6, dist);
    setTimeout(() => { if (_showResultsScreen) _showResultsScreen(); }, 500);
  });
}

export async function showResultsScreen(): Promise<void> {
  const pMode = PROTOCOLS[state.curProtIdx];
  const pPace = PACINGS[state.curPaceIdx];

  const uiLayer = document.getElementById('ui-layer')!;
  const centerDisplay = document.getElementById('center-display')!;
  const resultsScreen = document.getElementById('results-screen')!;
  const restartBtn = document.getElementById('restart-btn') as HTMLButtonElement;
  const resEarnedFrags = document.getElementById('res-earned-frags')!;
  const grid = document.getElementById('final-stats-grid')!;

  uiLayer.style.display = 'none';
  centerDisplay.style.display = 'none';
  resultsScreen.style.display = 'flex';

  if (state.isDailyRun) {
    restartBtn.style.display = 'none';
    profile.lastDailyDate = new Date().toISOString().split('T')[0];
    saveProfile();
    state.earnedFragments = Math.floor(state.score / 5);
    resEarnedFrags.innerText = `${state.earnedFragments} · DAILY BONUS`;
  } else {
    restartBtn.style.display = 'block';
    state.earnedFragments = Math.floor(state.score / 10);
    if (pPace.id === 'zen') state.earnedFragments = Math.floor(state.maxStreak * 2);
    resEarnedFrags.innerText = String(state.earnedFragments);
  }

  addSignal(state.earnedFragments);
  recordRun({ score: state.score, level: state.level, signalEarned: state.earnedFragments, combo: state.maxCombo });
  updateStatsUI();

  const comboStat = `<div class="stat-box"><span class="stat-label">Best Combo</span><span class="stat-value" style="color:var(--combo)">${state.maxCombo}×</span></div>`;
  if (pPace.id === 'classic' || pMode.id === 'nback') {
    grid.innerHTML = `<div class="stat-box"><span class="stat-label">Score</span><span class="stat-value">${state.score}</span></div><div class="stat-box"><span class="stat-label">Level</span><span class="stat-value">${state.level}</span></div>${comboStat}`;
  } else if (pPace.id === 'zen') {
    grid.innerHTML = `<div class="stat-box"><span class="stat-label">Max Streak</span><span class="stat-value">${state.maxStreak}</span></div><div class="stat-box"><span class="stat-label">Mistakes</span><span class="stat-value" style="color:var(--wrong)">${state.mistakes}</span></div>${comboStat}`;
  } else if (pPace.id === 'sprint') {
    grid.innerHTML = `<div class="stat-box"><span class="stat-label">Clears</span><span class="stat-value">${state.clears}</span></div><div class="stat-box"><span class="stat-label">Score</span><span class="stat-value">${state.score}</span></div>${comboStat}`;
  }

  // Build the board key for this run
  const boardKey = state.isDailyRun
    ? dailyBoardKey(new Date().toISOString().split('T')[0])
    : modeBoardKey(pMode.id, pPace.id);

  // a. Display name — prompt on first run only
  if (!profile.display_name) {
    const name = await promptDisplayName();
    if (name) {
      profile.display_name = name;
      saveProfile();
    }
  }

  // b. Submit score — fire-and-forget; board loads regardless of outcome
  if (profile.display_name) {
    submitScore(boardKey, state.score, state.level, pMode.id, pPace.id).catch(err => {
      console.warn('[SIGNAL] leaderboard submit failed', err);
    });
  }

  // c. Leaderboard panel — skeleton shows immediately inside showLeaderboardPanel
  await showLeaderboardPanel(boardKey);
}
