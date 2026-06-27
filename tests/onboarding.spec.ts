import { test, expect } from '@playwright/test';

// No beforeEach seed — these tests intentionally start with fresh localStorage
// to exercise the onboarding flow.

const ONBOARDING_TIMEOUT_MS = 20000; // countdown + constructing + observe phase

test('fresh localStorage triggers onboarding — menu sheet is hidden, countdown appears', async ({ page }) => {
  await page.goto('/');

  // Menu sheet must be hidden — onboarding round replaced it
  await expect(page.locator('#menu-sheet')).toBeHidden();

  // Countdown overlay appears immediately
  await expect(page.locator('#countdown-overlay')).toBeVisible();

  // Onboarding hint overlay must be present
  await expect(page.locator('#onboarding-hint')).toBeVisible();
});

test('skip button on onboarding hint lands on main menu and persists the flag', async ({ page }) => {
  await page.goto('/');

  // Wait for the hint overlay to render
  await expect(page.locator('#onboarding-hint')).toBeVisible({ timeout: 3000 });

  // Click Skip
  await page.locator('#onboarding-hint button').click();

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

  // Onboarding round starts automatically — wait for Execute phase
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
