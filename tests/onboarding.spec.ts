import { test, expect, type Page } from '@playwright/test';

// No beforeEach seed — these tests intentionally start with fresh localStorage
// to exercise the onboarding flow.

const ONBOARDING_TIMEOUT_MS = 20000; // intro cards + observe flash sequence
const SPLASH_TIMEOUT_MS = 5000;      // splash shows 2s + fade 0.5s + buffer

/** Dismisses Step 1's intro card, which blocks on its button rather than a timer. */
async function dismissIntroCard(page: Page) {
  await page.locator('#ob-next-1').click({ timeout: 5000 });
}

/**
 * Waits until the tutorial hands control to the player (Step 4, "Now tap them
 * back"). These tests used to wait on #pause-btn, but the tutorial is a
 * hand-rolled sequence that never calls startLevel() and so never shows the
 * pause button — the wait could only ever time out.
 */
async function waitForTutorialExecute(page: Page) {
  await page.waitForFunction(
    () => Boolean((window as unknown as { __signal?: { getState: () => { isPlayable: boolean } } })
      .__signal?.getState().isPlayable),
    undefined,
    { timeout: ONBOARDING_TIMEOUT_MS },
  );
}

/**
 * Waits for the tutorial that first launch starts on its own.
 *
 * This replaced `clickHowToPlay` for every test that just needs the tutorial
 * running: on a fresh profile the menu sheet is hidden before the button can be
 * clicked, so clicking it was no longer possible — nor the path a new player
 * takes.
 */
async function awaitAutoTutorial(page: Page) {
  await expect(page.locator('#ob-card')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });
}

/**
 * Marks the tutorial as already seen, so it does NOT auto-start.
 *
 * Used only by the tests that are specifically about the "How to Play" button,
 * which is now what a *returning* player uses to replay the tutorial — a new
 * player is shown it without asking.
 */
async function seedReturningPlayer(page: Page) {
  await page.addInitScript(() => {
    if (localStorage.getItem('sig_profile_v1')) return;
    localStorage.setItem('sig_profile_v1', JSON.stringify({
      schemaVersion: 17,
      signal: 0,
      unlockedCalibrations: ['mono'],
      currentCalibration: 'mono',
      customHex: '#00E5FF',
      hasSeenOnboarding: true,
      hasCompletedOnboarding: true,
      unlockedAudioFeatures: [],
      currentStreak: 0, longestStreak: 0,
      lastRunDate: null, lastActivityDate: null, lastDailyDate: null,
      lifetime: { runs: 0, score: 0, highestLevel: 1, signalMined: 0, bestCombo: 0 },
      settings: { haptics: true, sfx: true, volume: 0.7, telemetry: false },
    }));
  });
}

async function clickHowToPlay(page: Page) {
  // Splash blocks clicks for ~2s; Playwright retries until the element is actionable
  await page.click('#how-to-play-btn', { timeout: SPLASH_TIMEOUT_MS });
}

test('first launch presents the tutorial without being asked', async ({ page }) => {
  // The tutorial used to be reachable only by tapping "How to Play", so a new
  // player who tapped Engage went straight into a permadeath run having read one
  // line of hint text. Every other spec seeds hasCompletedOnboarding: true, so
  // this path went untested while being the only one a first-time player sees.
  await page.goto('/');

  // Nothing is clicked here — this is the whole assertion.
  await expect(page.locator('#ob-card')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });
  await expect(page.locator('#menu-sheet')).toBeHidden();

  // Presented, not imposed: the way out is on screen from the first frame.
  await expect(page.locator('#ob-skip-btn')).toBeVisible();
});

test('a returning player is never shown the tutorial again', async ({ page }) => {
  // The other half of the contract. Auto-start keys on hasSeenOnboarding, which
  // skipping also sets — so opting out has to be permanent, or the tutorial
  // reappears on every launch for exactly the player who declined it.
  await seedReturningPlayer(page);
  await page.goto('/');

  await expect(page.locator('#start-btn')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });
  await expect(page.locator('#menu-sheet')).toBeVisible();
  await expect(page.locator('#ob-card')).toHaveCount(0);
});

test('skipping is remembered across a reload', async ({ page }) => {
  // Skip sets hasSeenOnboarding on a real first run; the reload proves the flag
  // is what auto-start reads, not just what the skip handler writes.
  await page.goto('/');
  await awaitAutoTutorial(page);
  await page.locator('#ob-skip-btn').click();
  await expect(page.locator('#menu-sheet')).toBeVisible({ timeout: 3000 });

  await page.reload();

  await expect(page.locator('#start-btn')).toBeVisible({ timeout: SPLASH_TIMEOUT_MS });
  await expect(page.locator('#ob-card')).toHaveCount(0);
});

test('How to Play replays the tutorial for a returning player', async ({ page }) => {
  // Seeded as returning, so the tutorial does NOT auto-start and the button is
  // genuinely what triggers it — which is the whole point of this test.
  await seedReturningPlayer(page);
  await page.goto('/');

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
  await seedReturningPlayer(page);
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

  await awaitAutoTutorial(page);

  // Wait for the skip button to render
  await expect(page.locator('#ob-skip-btn')).toBeVisible({ timeout: 3000 });

  // Click Skip
  await page.locator('#ob-skip-btn').click();

  // Menu sheet must reappear and start button must be visible
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 2000 });
  await expect(page.locator('#menu-sheet')).toBeVisible();

  // Skipping marks the tutorial seen but explicitly NOT completed — the two
  // flags are distinct, and only hasSeenOnboarding gates re-showing it.
  const flags = await page.evaluate(() => {
    const saved = localStorage.getItem('sig_profile_v1');
    return saved
      ? (JSON.parse(saved) as { hasSeenOnboarding: boolean; hasCompletedOnboarding: boolean })
      : null;
  });
  expect(flags?.hasSeenOnboarding).toBe(true);
  expect(flags?.hasCompletedOnboarding).toBe(false);
});

test('tutorial pattern only ever references real board tiles', async ({ page }) => {
  // Regression test for a bug where the tutorial generated pattern indices
  // using gridSize³ (treating the board as a full 3D cube) instead of gridSize²
  // (the board is actually a flat grid — see createBoard()'s x/z loop). That
  // meant most pattern indices pointed at cubes that didn't exist: they never
  // flashed during Observe and could never be tapped during Execute, so the
  // round could only complete by pure luck and otherwise hung forever.
  await page.goto('/');
  await awaitAutoTutorial(page);
  await dismissIntroCard(page);
  await waitForTutorialExecute(page);

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
  await awaitAutoTutorial(page);
  await dismissIntroCard(page);
  await waitForTutorialExecute(page);

  type SignalHandle = {
    getState: () => { pattern: number[] };
    getCubeScreenPos: (idx: number) => { x: number; y: number } | null;
  };
  const pattern = await page.evaluate(
    () => (window as Window & { __signal?: SignalHandle }).__signal?.getState().pattern ?? [],
  );

  expect(pattern.length).toBeGreaterThan(0);
  for (const idx of pattern) {
    // Recompute immediately before each tap rather than projecting all tiles
    // up front. Moving the mouse drives the board's parallax drift, so the very
    // act of clicking the first tile shifts the rest — pre-computed coordinates
    // for later tiles go stale and the taps land on empty space.
    const pos = await page.evaluate(
      (i: number) => (window as Window & { __signal?: SignalHandle }).__signal?.getCubeScreenPos(i) ?? null,
      idx,
    );
    expect(pos).not.toBeNull();
    if (pos) {
      await page.mouse.click(pos.x, pos.y);
      await page.waitForTimeout(200);
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

  await awaitAutoTutorial(page);

  // Captured rather than hardcoded. This assertion used to read `toBe(0)`,
  // which only passed because new profiles happened to start empty — so
  // seeding a starting balance broke a test about something else entirely.
  // What it actually means is "the tutorial pays nothing", and comparing
  // before against after says that directly, whatever the starting value is.
  const signalBefore = await page.evaluate(() => {
    const saved = localStorage.getItem('sig_profile_v1');
    return saved ? (JSON.parse(saved) as { signal: number }).signal : null;
  });
  expect(signalBefore).not.toBeNull();

  // Wait for the tutorial to hand control to the player
  await dismissIntroCard(page);
  await waitForTutorialExecute(page);

  // Verify normal run-again/menu buttons are absent during onboarding
  await expect(page.locator('#restart-btn')).toBeHidden();

  // Reach the end of the tutorial via the mistake path rather than the clean
  // one (covered by the test above). A wrong tap must NOT end the tutorial —
  // it re-flashes the pattern and hands control back, twice, before giving up
  // gracefully. So this taps wrong repeatedly and expects to still arrive at
  // the final card.
  type SignalHandle = {
    getState: () => { pattern: number[]; isPlayable: boolean };
    getCubeScreenPos: (idx: number) => { x: number; y: number } | null;
  };
  const tapWrongTile = async () => {
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
      const box = await page.locator('canvas').boundingBox();
      if (box) await page.mouse.click(box.x + 2, box.y + 2);
    }
  };

  await tapWrongTile();

  // The tutorial forgives the first mistake: it replays the pattern and makes
  // the board playable again instead of ending the round.
  await page.waitForFunction(
    () => (window as unknown as { __signal?: SignalHandle }).__signal?.getState().isPlayable === false,
    undefined, { timeout: 5000 },
  );
  await waitForTutorialExecute(page);
  await expect(page.locator('#results-screen')).toBeHidden();

  // Second mistake exhausts the retries and the tutorial bows out gracefully.
  await tapWrongTile();

  // Final card, then the results screen with the "Enter SIGNAL →" CTA
  await expect(page.locator('#ob-next-6')).toBeVisible({ timeout: 20000 });
  await page.locator('#ob-next-6').click();

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

  // Onboarding awards nothing: the balance is exactly what it was before.
  const signalAfter = await page.evaluate(() => {
    const saved = localStorage.getItem('sig_profile_v1');
    return saved ? (JSON.parse(saved) as { signal: number }).signal : null;
  });
  expect(signalAfter, 'the tutorial must not pay out').toBe(signalBefore);
});
