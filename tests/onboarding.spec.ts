import { test, expect, type Page } from '@playwright/test';

// No beforeEach seed — these tests intentionally start with fresh localStorage
// to exercise the onboarding flow.

const ONBOARDING_TIMEOUT_MS = 20000; // countdown + constructing + observe phase
const SPLASH_TIMEOUT_MS = 5000;      // splash shows 2s + fade 0.5s + buffer

async function clickHowToPlay(page: Page) {
  // Splash blocks clicks for ~2s; Playwright retries until the element is actionable
  await page.click('#how-to-play-btn', { timeout: SPLASH_TIMEOUT_MS });
}

test('How to Play triggers onboarding — menu sheet is hidden, intro card appears', async ({ page }) => {
  await page.goto('/');

  // Trigger tutorial via opt-in button (waits for splash to clear)
  await clickHowToPlay(page);

  // Menu sheet must be hidden — onboarding round replaced it
  await expect(page.locator('#menu-sheet')).toBeHidden();

  // Onboarding intro card and skip button must be present
  await expect(page.locator('#ob-card')).toBeVisible();
  await expect(page.locator('#ob-skip-btn')).toBeVisible();

  // Advance past the intro card — countdown should not appear until Step 3
  await page.locator('#ob-next-1').click();
});

test('double-tapping How to Play does not start two concurrent onboarding runs', async ({ page }) => {
  await page.goto('/');
  await page.waitForSelector('#how-to-play-btn', { state: 'visible', timeout: SPLASH_TIMEOUT_MS });

  // Fire two rapid clicks — the button disables itself on first click, so the
  // second should be a no-op rather than starting a second concurrent run.
  await page.click('#how-to-play-btn');
  await page.click('#how-to-play-btn', { force: true, timeout: 500 }).catch(() => {});

  // Exactly one skip button and one card should exist, not duplicates.
  await expect(page.locator('#ob-skip-btn')).toHaveCount(1);
  await expect(page.locator('#ob-card')).toHaveCount(1);
});

test('skip button on onboarding lands on main menu and persists the flag', async ({ page }) => {
  await page.goto('/');

  // Trigger onboarding via How to Play
  await clickHowToPlay(page);

  // Wait for the skip button to render
  await expect(page.locator('#ob-skip-btn')).toBeVisible({ timeout: 3000 });

  // Click Skip
  await page.locator('#ob-skip-btn').click();

  // Menu sheet must reappear and start button must be visible
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#menu-sheet')).toBeVisible();

  // Flag must be persisted to localStorage
  const completed = await page.evaluate(() => {
    const saved = localStorage.getItem('sig_profile_v1');
    return saved ? (JSON.parse(saved) as { hasCompletedOnboarding: boolean }).hasCompletedOnboarding : null;
  });
  expect(completed).toBe(true);
});

test('tutorial pattern only ever references real board tiles', async ({ page }) => {
  // Regression test for a bug where the tutorial generated pattern indices
  // using gridSize³ (treating the board as a full 3D cube) instead of gridSize²
  // (the board is actually a flat grid — see createBoard()'s x/z loop). That
  // meant most pattern indices pointed at cubes that didn't exist: they never
  // flashed during Observe and could never be tapped during Execute, so the
  // round could only complete by pure luck and otherwise hung forever.
  await page.goto('/');
  await clickHowToPlay(page);
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });

  type SignalHandle = { getState: () => { pattern: number[]; gridSize: number } };
  const { pattern, gridSize } = await page.evaluate(() => {
    const sig = (window as Window & { __signal?: SignalHandle }).__signal;
    return sig ? sig.getState() : { pattern: [], gridSize: 0 };
  });

  expect(pattern.length).toBeGreaterThan(0);
  for (const idx of pattern) {
    expect(idx).toBeLessThan(gridSize * gridSize);
  }
});

test('tapping every pattern tile in the tutorial completes the round', async ({ page }) => {
  await page.goto('/');
  await clickHowToPlay(page);
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });

  type SignalHandle = {
    getState: () => { pattern: number[] };
    getCubeScreenPos: (idx: number) => { x: number; y: number } | null;
  };
  const { pattern, positions } = await page.evaluate(() => {
    const sig = (window as Window & { __signal?: SignalHandle }).__signal;
    if (!sig) return { pattern: [], positions: [] };
    const pattern = sig.getState().pattern;
    return { pattern, positions: pattern.map(idx => sig.getCubeScreenPos(idx)) };
  });

  expect(pattern.length).toBeGreaterThan(0);
  for (const pos of positions) {
    expect(pos).not.toBeNull();
    if (pos) {
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(150);
    }
  }

  // Round should complete and advance to Step 5 (timer explanation) then
  // Step 6's final card — not hang waiting for a tap on a tile that isn't there.
  await expect(page.locator('#ob-next-6')).toBeVisible({ timeout: 15000 });
  await page.locator('#ob-next-6').click();

  // Lands on results screen with the onboarding-specific CTA
  await expect(page.locator('#enter-signal-btn')).toBeVisible({ timeout: 8000 });
});

test('completing the onboarding round shows "Enter SIGNAL →" and landing on menu sets the flag', async ({ page }) => {
  await page.goto('/');

  // Trigger onboarding via How to Play
  await clickHowToPlay(page);

  // Wait for Execute phase — pause button becomes visible
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: ONBOARDING_TIMEOUT_MS });

  // Verify normal run-again/menu buttons are absent during onboarding
  await expect(page.locator('#restart-btn')).toBeHidden();

  // Trigger game over by clicking a wrong tile
  type SignalHandle = {
    getState: () => { pattern: number[] };
    getCubeScreenPos: (idx: number) => { x: number; y: number } | null;
  };
  const wrongPos = await page.evaluate(() => {
    const sig = (window as Window & { __signal?: SignalHandle }).__signal;
    if (!sig) return null;
    const { pattern } = sig.getState();
    for (let i = 0; i < 9; i++) {
      if (!pattern.includes(i)) return sig.getCubeScreenPos(i);
    }
    return null;
  });

  if (wrongPos) {
    await page.mouse.click(wrongPos.x, wrongPos.y);
  } else {
    // Fallback: click canvas corner (guaranteed wrong)
    const box = await page.locator('canvas').boundingBox();
    if (box) await page.mouse.click(box.x + 2, box.y + 2);
  }

  // Results screen appears with "Enter SIGNAL →" CTA
  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 8000 });
  await expect(page.locator('#enter-signal-btn')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#restart-btn')).toBeHidden();
  await expect(page.locator('#menu-btn')).toBeHidden();

  // Tap "Enter SIGNAL →"
  await page.locator('#enter-signal-btn').click();

  // Normal menu must be visible
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#menu-sheet')).toBeVisible();

  // Flag persisted
  const completed = await page.evaluate(() => {
    const saved = localStorage.getItem('sig_profile_v1');
    return saved ? (JSON.parse(saved) as { hasCompletedOnboarding: boolean }).hasCompletedOnboarding : null;
  });
  expect(completed).toBe(true);

  // Signal balance must still be 0 — onboarding awards nothing
  const signal = await page.evaluate(() => {
    const saved = localStorage.getItem('sig_profile_v1');
    return saved ? (JSON.parse(saved) as { signal: number }).signal : null;
  });
  expect(signal).toBe(0);
});
