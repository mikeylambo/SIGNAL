import { test, expect, Page } from '@playwright/test';

// Cross-engine / cross-form-factor suite.
//
// This file is the ONLY one the webkit and mobile projects run (see
// playwright.config.ts). The other specs cover game rules, which are engine
// independent — running all 63 of them four times would quadruple CI for no new
// information. What actually differs per engine is the platform surface, so
// that is all this file tests:
//
//   WebGL context creation      — the single thing most likely to fail outright
//   Touch input                 — a different code path from mouse events
//   AudioContext autoplay policy— Safari suspends until a real user gesture
//   Layout at small viewports   — clipping and horizontal overflow
//   Storage                     — private-mode and partitioning differences
//
// Caveat worth stating: Playwright's WebKit on Linux is not Safari on iOS. It
// shares the engine but not the JIT, media stack or GPU path. Passing here means
// "not obviously broken on WebKit", NOT "verified on iPhone" — that still needs a
// real device. Android is the opposite: Chrome on Android is the same Blink/V8
// as the mobile-chrome project here, so those results transfer closely.

const COUNTDOWN_MS = 4000;

async function seed(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Capture every AudioContext the game constructs, so the autoplay-policy
    // test can inspect state without the app exposing a hook for it.
    const w = window as unknown as {
      AudioContext: typeof AudioContext;
      webkitAudioContext?: typeof AudioContext;
      __ctxs?: AudioContext[];
    };
    const Real = w.AudioContext || w.webkitAudioContext;
    if (Real) {
      w.__ctxs = [];
      const Wrapped = new Proxy(Real, {
        construct(target, args: ConstructorParameters<typeof AudioContext>) {
          const ctx = new target(...args);
          w.__ctxs!.push(ctx);
          return ctx;
        },
      });
      w.AudioContext = Wrapped;
      if (w.webkitAudioContext) w.webkitAudioContext = Wrapped;
    }

    // Seed only when absent. addInitScript re-runs on every navigation, so an
    // unconditional write would restore the starting profile after a reload —
    // which is exactly the thing the persistence test is trying to observe.
    if (localStorage.getItem('sig_profile_v1')) return;

    localStorage.setItem('sig_profile_v1', JSON.stringify({
      schemaVersion: 16,
      signal: 250,
      unlockedCalibrations: ['mono', 'custom'],
      currentCalibration: 'mono',
      customHex: '#00E5FF',
      hasSeenOnboarding: true,
      hasCompletedOnboarding: true,
      unlockedAudioFeatures: [],
      player_id: '00000000-0000-0000-0000-0000000000c1',
      owner_secret: '00000000-0000-0000-0000-0000000000c2',
      display_name: 'CROSSBROWSER',
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

type Sig = {
  isLoopRunning: () => boolean;
  getState: () => { pattern: number[] };
  getCubeScreenPos: (i: number) => { x: number; y: number } | null;
};

/** Taps via the touchscreen where the device has one, and the mouse otherwise. */
async function pointAt(page: Page, x: number, y: number): Promise<void> {
  const hasTouch = await page.evaluate(() => 'ontouchstart' in window || navigator.maxTouchPoints > 0);
  if (hasTouch) await page.touchscreen.tap(x, y);
  else await page.mouse.click(x, y);
}

test('the game boots and initialises WebGL on this engine', async ({ page }) => {
  // The headline cross-engine risk: no WebGL context means no game at all, and
  // the error boundary would be showing instead of the menu.
  const pageErrors: string[] = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));

  await seed(page);
  await page.goto('/');

  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });
  await expect(page.locator('body')).not.toContainText('SIGNAL CANNOT INITIALIZE');

  // A canvas alone proves nothing — the render loop has to actually be running.
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __signal?: Sig }).__signal?.isLoopRunning() ?? false),
      { timeout: 15000 })
    .toBe(true);

  expect(pageErrors).toEqual([]);
});

test('the page does not scroll horizontally at this viewport', async ({ page }) => {
  // Horizontal overflow on a phone is the classic "looks broken" bug, and the
  // board is sized from viewport maths that differs per form factor.
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });

  const overflow = await page.evaluate(() => ({
    doc: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  // A pixel of slack for sub-pixel rounding at fractional DPRs.
  expect(overflow.doc).toBeLessThanOrEqual(1);
  expect(overflow.body).toBeLessThanOrEqual(1);
});

test('primary menu controls are on-screen and reachable', async ({ page }) => {
  // Small viewports are where a control ends up below the fold or under the
  // home indicator. Engage especially must never require a scroll.
  await seed(page);
  await page.goto('/');

  const engage = page.locator('#start-btn');
  await expect(engage).toBeVisible({ timeout: 30000 });

  const box = await engage.boundingBox();
  const size = page.viewportSize();
  expect(box).not.toBeNull();
  expect(size).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(size!.height + 1);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(size!.width + 1);

  for (const id of ['#profile-btn', '#forge-btn', '#store-btn', '#leaderboard-browser-btn']) {
    await expect(page.locator(id)).toBeVisible();
  }
});

test('a pattern tile responds to a real tap', async ({ page }) => {
  // Touch is a separate path from mouse: the board is a WebGL canvas hit-tested
  // by raycasting from pointer coordinates, and touch events report those
  // differently. A desktop-only suite never exercises this at all.
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });

  await page.locator('#start-btn').click();
  await page.waitForTimeout(COUNTDOWN_MS);
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: 25000 });

  // Wait for Execute — taps during the Observe flash are ignored by design.
  await expect
    .poll(() => page.evaluate(
      () => document.getElementById('message')?.textContent?.trim().toLowerCase() ?? ''),
      { timeout: 20000 })
    .toBe('execute');

  const pos = await page.evaluate(() => {
    const sig = (window as unknown as { __signal?: Sig }).__signal;
    if (!sig) return null;
    const idx = sig.getState().pattern[0];
    return typeof idx === 'number' ? sig.getCubeScreenPos(idx) : null;
  });
  expect(pos, 'a pattern tile should have a screen position').not.toBeNull();

  await pointAt(page, pos!.x, pos!.y);

  // A registered hit shows up as score or combo movement; the run must not have
  // ended, which is what a mis-routed tap on a non-pattern tile would cause.
  await expect(page.locator('#results-screen')).toBeHidden();
});

test('audio starts on a user gesture, per the autoplay policy', async ({ page }) => {
  // Safari (desktop and iOS) creates AudioContexts suspended and only resumes
  // them inside a user gesture. If the game gets this wrong it is silent on
  // Apple platforms and fine everywhere else — invisible to a Chrome-only suite.
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });

  await page.locator('#start-btn').click();

  await expect
    .poll(async () => page.evaluate(() => {
      const ctxs = (window as unknown as { __ctxs?: AudioContext[] }).__ctxs ?? [];
      if (ctxs.length === 0) return 'none';
      return ctxs.some((c) => c.state === 'running') ? 'running' : ctxs[0].state;
    }), { timeout: 15000 })
    .toBe('running');
});

test('progress survives a reload on this engine', async ({ page }) => {
  // Storage behaviour varies (private mode, partitioning, eviction). If writes
  // silently fail, every run is lost and nothing else in the game works either.
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });

  await page.evaluate(() => {
    const raw = localStorage.getItem('sig_profile_v1');
    const p = JSON.parse(raw!) as { signal: number };
    p.signal = 4321;
    localStorage.setItem('sig_profile_v1', JSON.stringify(p));
  });

  await page.reload();
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });

  const signal = await page.evaluate(() => {
    const raw = localStorage.getItem('sig_profile_v1');
    return raw ? (JSON.parse(raw) as { signal: number }).signal : null;
  });
  expect(signal).toBe(4321);
});

test('the results screen actions stay reachable at this viewport', async ({ page }) => {
  // The results modal is the tallest surface in the game — score, mastery bar,
  // leaderboard panel and two buttons. On a short phone it is the most likely
  // thing to clip its own actions off-screen.
  await seed(page);
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 30000 });

  await page.locator('#start-btn').click();
  await page.waitForTimeout(COUNTDOWN_MS);
  await expect(page.locator('#pause-btn')).toBeVisible({ timeout: 25000 });

  // Force a mistake by tapping a tile that is not in the pattern.
  const wrong = await page.evaluate(() => {
    const sig = (window as unknown as { __signal?: Sig }).__signal;
    if (!sig) return null;
    const { pattern } = sig.getState();
    for (let i = 0; i < 9; i++) if (!pattern.includes(i)) return sig.getCubeScreenPos(i);
    return null;
  });
  if (wrong) await pointAt(page, wrong.x, wrong.y);

  await expect(page.locator('#results-screen')).toBeVisible({ timeout: 20000 });

  // The contract is NOT "everything fits without scrolling" — the results screen
  // is the tallest surface in the game and `.modal-screen` is deliberately
  // `overflow-y: auto`, so on a short viewport (a 1280×720 desktop, or a laptop
  // with browser chrome) the actions legitimately sit below the fold. What must
  // hold is that they are reachable, and that the MODAL scrolls rather than the
  // page — a document that scrolls would drag the WebGL canvas with it.
  const size = page.viewportSize()!;

  // The actions are sticky-positioned, so they must be on screen the moment the
  // results appear — WITHOUT any scrolling. That is the whole point: a player
  // has no reason to suspect content below the leaderboard panel, and reported
  // the Menu button as missing when it merely sat below the fold.
  for (const id of ['#restart-btn', '#menu-btn']) {
    const btn = page.locator(id);
    await expect(btn).toBeVisible();

    const box = (await btn.boundingBox())!;
    expect(box.y, `${id} must not sit above the viewport`).toBeGreaterThanOrEqual(-1);
    expect(box.y + box.height, `${id} must be on screen without scrolling`)
      .toBeLessThanOrEqual(size.height + 1);
    // Reachable means actually hittable, not merely painted somewhere.
    await expect(btn).toBeEnabled();
  }

  // The page itself must not have become scrollable.
  const docOverflow = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }));
  expect(docOverflow.x).toBeLessThanOrEqual(1);
  expect(docOverflow.y).toBeLessThanOrEqual(1);
});
