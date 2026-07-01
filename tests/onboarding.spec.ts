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
