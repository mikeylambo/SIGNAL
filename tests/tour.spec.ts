import { test, expect, type Page } from '@playwright/test';

// Menu coach marks. No seed — these need a genuinely new profile, since the
// whole feature is about the first time someone lands on the menu.
//
// What is worth pinning here is not "the overlay appears" but the handful of
// properties that are invisible from inside a single run and easy to lose:
// that a skipper still gets it, that it never repeats, and that it says
// anything at all to a screen reader.

const SPLASH_TIMEOUT_MS = 8000;

async function skipTutorial(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#ob-skip-btn').waitFor({ timeout: 20000 });
  await page.locator('#ob-skip-btn').click();
}

async function completeTutorialToMenu(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#ob-next-1').waitFor({ timeout: 20000 });
  // Skipping is the supported quick path to the menu; completing the whole
  // tutorial is covered by onboarding.spec.ts and would only duplicate it here.
  await page.locator('#ob-skip-btn').click();
}

test('a player who skipped the tutorial still gets the menu tour', async ({ page }) => {
  // The important direction. Someone who skipped has been told *less* about the
  // game, so gating the tour behind tutorial completion would withhold it from
  // exactly the players who need it. Easy to get backwards.
  await skipTutorial(page);

  await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });
  await expect(page.locator('#tour-next')).toBeVisible();
  await expect(page.locator('#tour-skip')).toBeVisible();
});

test('the tour never runs a second time', async ({ page }) => {
  await skipTutorial(page);
  await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });

  // Leave partway through — the flag is set on start, not on completion, so a
  // player who closes the app mid-tour has still made their choice.
  await page.locator('#tour-skip').click();
  await expect(page.locator('#tour-overlay')).toHaveCount(0);

  await page.reload();
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });
  await page.waitForTimeout(800);
  await expect(page.locator('#tour-overlay')).toHaveCount(0);

  const seen = await page.evaluate(() => {
    const raw = localStorage.getItem('sig_profile_v1');
    return raw ? (JSON.parse(raw) as { hasSeenMenuTour: boolean }).hasSeenMenuTour : null;
  });
  expect(seen).toBe(true);
});

test('every step announces itself to a screen reader', async ({ page }) => {
  // A spotlight is the definition of a visual-only signal: without a live-region
  // announcement the tour does not exist for a screen-reader player. This is the
  // property most likely to be silently dropped by a later refactor, because
  // nothing about the visible UI changes when it breaks.
  await completeTutorialToMenu(page);
  await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });

  const announcements: string[] = [];
  for (let step = 1; step <= 5; step++) {
    const text = (await page.locator('#tour-announce').innerText()).trim();
    expect(text, `step ${step} must announce something`).not.toBe('');
    expect(text).toContain(`Step ${step} of`);
    announcements.push(text);
    if (step < 5) await page.locator('#tour-next').click();
  }

  // Each step must say something *different* — a live region that repeats one
  // string reads as a single unchanging message and conveys no progress.
  expect(new Set(announcements).size).toBe(5);

  await page.locator('#tour-next').click();
  await expect(page.locator('#tour-overlay')).toHaveCount(0);
});

test('the tour is escapable from the first step', async ({ page }) => {
  // Same contract as the tutorial's skip button. A tour you cannot leave is a
  // wall, and the players most likely to want out are the ones most likely to
  // abandon the game entirely.
  await skipTutorial(page);
  await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });

  await page.keyboard.press('Escape');
  await expect(page.locator('#tour-overlay')).toHaveCount(0);
  await expect(page.locator('#start-btn')).toBeVisible();
});

test('the spotlight lands on the control it is describing', async ({ page }) => {
  // The reason this is coach marks and not another card sequence: it teaches a
  // location. A highlight that drifts off its target teaches the wrong one, and
  // that failure is silent — the tour still looks like it works.
  await skipTutorial(page);
  await expect(page.locator('#tour-overlay')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });

  const overlaps = await page.evaluate(() => {
    const spot = document.querySelector('#tour-overlay > div') as HTMLElement | null;
    const target = document.getElementById('mode-row');
    if (!spot || !target) return null;
    const s = spot.getBoundingClientRect();
    const t = target.getBoundingClientRect();
    // The spotlight is padded, so it should fully contain the target.
    return s.top <= t.top + 1 && s.left <= t.left + 1 &&
           s.bottom >= t.bottom - 1 && s.right >= t.right - 1;
  });
  expect(overlaps, 'the spotlight must contain its target').toBe(true);
});
