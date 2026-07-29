export const state = {
  level: 1,
  score: 0,
  gridSize: 3,
  activeCount: 3,
  pattern: [] as number[],
  decoys: [] as number[],
  rhythmDelays: [] as number[],
  userClicks: [] as number[],
  isPlayable: false,
  isPaused: false,
  streak: 0,
  maxStreak: 0,
  mistakes: 0,
  clears: 0,
  earnedFragments: 0,
  combo: 0,
  maxCombo: 0,
  timerActive: false,
  totalTime: 0,
  timeLeft: 0,
  lastFrameTime: 0,
  timerAnimationId: 0,
  lastClickTime: 0,
  nBackStream: [] as number[],
  nBackStep: 0,
  nBackActive: false,
  nBackIsFlashing: false,
  levelTimeStart: 0,
  isDailyRun: false,
  wasTimerActiveBeforePause: false,
  curProtIdx: 0,
  curPaceIdx: 0,
  isOnboarding: false,
  // Monotonic run token. Bumped by endRun() whenever a run stops being the
  // current one (game over, abort to menu, starting a new run). Every async
  // step in runLoop.ts captures it and bails if it no longer matches, so an
  // in-flight Observe sequence / n-Back stream / level-complete timeout that
  // belongs to an abandoned run can't write to shared state or drive UI.
  runId: 0,
};

/** Invalidates the current run so any in-flight async gameplay step aborts. */
export function endRun(): void {
  state.runId++;
  state.isPlayable = false;
  state.nBackActive = false;
  state.timerActive = false;
}
