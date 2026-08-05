import { test, expect, Page } from '@playwright/test';

// Failure paths that must degrade rather than white-screen.
//
// Both of these are states a real player hits and cannot self-diagnose: a device
// with WebGL disabled, and a leaderboard that is unreachable. The assertion in
// each case is that the player is told something true.

const COUNTDOWN_MS = 4000;

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    localStorage.setItem('sig_profile_v1', JSON.stringify({
      schemaVersion: 16,
      signal: 0,
      unlockedCalibrations: ['mono', 'custom'],
      currentCalibration: 'mono',
      customHex: '#00E5FF',
      hasSeenOnboarding: true,
      hasCompletedOnboarding: true,
      unlockedAudioFeatures: [],
      player_id: '00000000-0000-0000-0000-000000000001',
      owner_secret: '00000000-0000-0000-0000-0000000000ff',
      display_name: 'TestPlayer',
      currentStreak: 0,
      longestStreak: 0,
      lastRunDate: null,
      lastActivityDate: null,
      lastDailyDate: null,
      lifetime: { runs: 0, score: 0, highestLevel: 1, signalMined: 0, bestCombo: 0 },
      settings: { haptics: true, sfx: true, volume: 0.7, telemetry: false },
    }));
  });
}

test('a device without WebGL gets a readable error, not a white screen', async ({ page }) => {
  await seed(page);
  // Deny every WebGL context, as a locked-down browser or a device with
  // hardware acceleration switched off does.
  await page.addInitScript(() => {
    const real = HTMLCanvasElement.prototype.getContext;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, ...rest: unknown[]): unknown {
      if (type === 'webgl' || type === 'webgl2' || type === 'experimental-webgl') return null;
      return (real as (t: string, ...r: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof HTMLCanvasElement.prototype.getContext;
  });

  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await page.goto('/');

  // The failure is announced, and names the actual cause.
  await expect(page.locator('body')).toContainText('SIGNAL CANNOT INITIALIZE', { timeout: 20000 });
  await expect(page.locator('body')).toContainText('WebGL is not supported');
  // And it offers a next step rather than a dead end.
  await expect(page.locator('body')).toContainText('hardware acceleration');

  // The normal UI must be hidden, not left floating behind the error.
  await expect(page.locator('#start-btn')).toBeHidden();

  // Handled, not thrown: an uncaught error here is what a white screen looks like.
  expect(pageErrors).toEqual([]);
});

test('an unreachable leaderboard says so instead of claiming the board is empty', async ({ page }) => {
  // The distinction matters: "No scores yet — you might be first." tells the
  // player something false about a board that may well be full.
  await seed(page);
  await page.goto('/');

  await page.locator('#leaderboard-browser-btn').click();
  const body = page.locator('#lb-browser-body');

  await expect(body).toContainText('Could not reach the leaderboard', { timeout: 20000 });
  await expect(body).not.toContainText('No scores yet');
  // The reassurance matters as much as the error — the run was not lost.
  await expect(body).toContainText('saved locally');
});

test('a run still completes and reports with the leaderboard unreachable', async ({ page }) => {
  // Leaderboard failure must never block gameplay or the results screen.
  await seed(page);
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(COUNTDOWN_MS);
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: 20000 });

  // Force a mistake to reach the results screen.
  const wrongPos = await page.evaluate(() => {
    const sig = (window as Window & {
      __signal?: {
        getState: () => { pattern: number[] };
        getCubeScreenPos: (i: number) => { x: number; y: number } | null;
      };
    }).__signal;
    if (!sig) return null;
    const { pattern } = sig.getState();
    for (let i = 0; i < 9; i++) if (!pattern.includes(i)) return sig.getCubeScreenPos(i);
    return null;
  });
  if (wrongPos) await page.mouse.click(wrongPos.x, wrongPos.y);

  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 15000 });
});

test('a score that never posted says so rather than showing a board without it', async ({ page }) => {
  // The gap this closes: submitScore used to return a bare boolean, so "posted
  // but not a personal best" and "never posted at all" rendered identically —
  // a leaderboard the player was simply absent from. That reads as a broken
  // leaderboard rather than as something that happened to them, and it stopped
  // being a rare case the moment Turnstile enforcement went on: a refused
  // challenge is routine on a locked-down network.
  //
  // No stubbing needed. This build has no VITE_SUPABASE_* configured, so
  // getClient() rejects and the submission genuinely fails — the same code path
  // a real failure takes.
  await seed(page);
  await page.goto('/');
  await page.locator('#start-btn').click();
  await page.waitForTimeout(COUNTDOWN_MS);
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: 20000 });

  const wrongPos = await page.evaluate(() => {
    const sig = (window as Window & {
      __signal?: {
        getState: () => { pattern: number[] };
        getCubeScreenPos: (i: number) => { x: number; y: number } | null;
      };
    }).__signal;
    if (!sig) return null;
    const { pattern } = sig.getState();
    for (let i = 0; i < 9; i++) if (!pattern.includes(i)) return sig.getCubeScreenPos(i);
    return null;
  });
  if (wrongPos) await page.mouse.click(wrongPos.x, wrongPos.y);

  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 15000 });

  const status = page.locator('#submit-status');
  await expect(status).toBeVisible({ timeout: 15000 });
  await expect(status).toContainText('Score not posted');
  // Must also say the run itself was not lost, or the message trades one wrong
  // conclusion for a worse one.
  await expect(status).toContainText('progress is saved');

  // It belongs above the board it is explaining, not below it.
  const statusBox = (await status.boundingBox())!;
  const panelBox  = (await page.locator('#leaderboard-panel').boundingBox())!;
  expect(statusBox.y).toBeLessThan(panelBox.y);
});
