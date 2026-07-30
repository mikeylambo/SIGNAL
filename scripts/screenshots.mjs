/**
 * Captures store/press screenshots from the real game.
 *
 * Runs against the dev server (npm run dev) so it needs no build:
 *   node scripts/screenshots.mjs
 *
 * Output: screenshots/<device>/<shot>.png
 *
 * The profile is seeded rather than played from scratch: store shots need a board
 * mid-run with a healthy combo and a populated Stats screen, and grinding to that
 * state on every capture would be slow and non-deterministic. Gameplay shots still
 * drive the real game loop — nothing here fakes a frame.
 *
 * Two things to know before using the output as final store art:
 *
 *  1. Run it against a server that HAS VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY
 *     configured, or the results screen captures the honest but unflattering
 *     "Could not reach the leaderboard" state instead of a populated board.
 *  2. Scripted clicking is slower than a human, so a Classic run can hit its
 *     per-level timer part-way through a capture and end on TIME EXPIRED. Set
 *     SHOT_PACING=zen to capture on the untimed pacing instead. Note Zen's HUD
 *     shows a streak where Classic shows points.
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from '@playwright/test';

const BASE = process.env.SHOT_BASE_URL ?? 'http://localhost:5173';
const OUT = path.resolve('screenshots');
const CHROMIUM = process.env.PLAYWRIGHT_CHROMIUM_PATH;
/** e.g. SHOT_PACING=zen — cycles the menu's pacing control to that mode first. */
const PACING = process.env.SHOT_PACING?.trim().toLowerCase() ?? '';

// Sizes chosen to match what the stores actually ask for.
const DEVICES = [
  { name: 'desktop',  width: 1280, height: 800,  dpr: 2 },  // web / press
  { name: 'phone',    width: 390,  height: 844,  dpr: 3 },  // iPhone 6.5"/6.7" ratio
  { name: 'tablet',   width: 834,  height: 1112, dpr: 2 },  // iPad 10.5"
];

const SEED = {
  schemaVersion: 16,
  signal: 4820,
  unlockedCalibrations: ['mono', 'custom', 'ferro', 'glacier'],
  currentCalibration: 'mono',
  customHex: '#00E5FF',
  hasSeenOnboarding: true,
  hasCompletedOnboarding: true,
  unlockedAudioFeatures: [],
  player_id: '00000000-0000-0000-0000-0000000000aa',
  owner_secret: '00000000-0000-0000-0000-0000000000bb',
  display_name: 'OPERATOR',
  currentStreak: 12,
  longestStreak: 21,
  lastRunDate: null,
  lastActivityDate: null,
  lastDailyDate: null,
  lifetime: { runs: 137, score: 284500, highestLevel: 14, signalMined: 21400, bestCombo: 23 },
  settings: { haptics: true, sfx: true, volume: 0.7, telemetry: false },
  protocolMastery: {
    spatial:      { runs: 41, bestLevel: 14, bestScore: 28400, totalScore: 96000 },
    sequential:   { runs: 28, bestLevel: 11, bestScore: 19800, totalScore: 61000 },
    interference: { runs: 22, bestLevel: 9,  bestScore: 15200, totalScore: 44000 },
    rhythm:       { runs: 26, bestLevel: 10, bestScore: 17600, totalScore: 52000 },
    nback:        { runs: 20, bestLevel: 8,  bestScore: 12900, totalScore: 38000 },
  },
  unlockedMaterials: ['chrome'],
  activeMaterial: 'standard',
  premium: false,
  lastModifier: 'none',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Waits until the run is in its Execute phase. Clicks land only then — during
 * the Observe flash the game ignores input, so clicking early does nothing and
 * silently produces a screenshot of an untouched board.
 */
async function waitForExecute(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const phase = await page.evaluate(
      () => document.getElementById('message')?.textContent?.trim().toLowerCase() ?? '',
    );
    if (phase === 'execute') return true;
    await sleep(120);
  }
  return false;
}

async function newPage(browser, device) {
  const ctx = await browser.newContext({
    viewport: { width: device.width, height: device.height },
    deviceScaleFactor: device.dpr,
    reducedMotion: 'no-preference',
  });
  const page = await ctx.newPage();
  await page.addInitScript((seed) => {
    localStorage.setItem('sig_profile_v1', JSON.stringify(seed));
  }, SEED);
  return { ctx, page };
}

async function shoot(page, device, name) {
  const dir = path.join(OUT, device.name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.png`);
  await page.screenshot({ path: file });
  console.log(`  ✓ ${device.name}/${name}.png`);
}

async function captureFor(browser, device) {
  console.log(`\n── ${device.name} (${device.width}×${device.height} @${device.dpr}x) ──`);
  const { ctx, page } = await newPage(browser, device);

  // 1. Main menu — the hero shot. Let bloom and the idle drift settle.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForSelector('#start-btn', { state: 'visible', timeout: 30000 });
  await sleep(2500);
  await shoot(page, device, '01-menu');

  // Optional: switch to an untimed pacing so a slow scripted run can't end on
  // TIME EXPIRED part-way through the capture. #pacing-btn cycles the options.
  if (PACING) {
    for (let i = 0; i < 4; i++) {
      const label = (await page.locator('#pacing-btn').textContent())?.trim().toLowerCase();
      if (label === PACING) break;
      await page.locator('#pacing-btn').click();
      await sleep(200);
    }
  }

  // 2. Mid-run board with a live combo.
  //
  // Taps during the Observe flash are ignored by design, so this waits for the
  // Execute phase before clicking — an earlier version fired during Observe and
  // captured an idle board at level 1 with a score of 0. It then plays several
  // levels for real so the HUD shows a level and score worth looking at, and
  // shoots mid-Execute with the combo readout up.
  await page.locator('#start-btn').click();
  await sleep(4200);

  // Clear the first few levels outright to build level, score and combo.
  for (let level = 0; level < 3; level++) {
    if (!(await waitForExecute(page))) break;
    const pattern = await page.evaluate(() => window.__signal?.getState().pattern ?? []);
    for (const idx of pattern) {
      const pos = await page.evaluate((i) => window.__signal?.getCubeScreenPos(i) ?? null, idx);
      if (!pos) break;
      await page.mouse.click(pos.x, pos.y);
      await sleep(240);
    }
    await sleep(1100);   // level-complete animation
  }

  // Then capture mid-solve: solved tiles are lit, one is still outstanding, so
  // the phase cannot tick over to the next Observe before the shutter. Shooting
  // without this left the board idle mid-Observe with nothing lit at all.
  if (await waitForExecute(page)) {
    const pattern = await page.evaluate(() => window.__signal?.getState().pattern ?? []);
    for (let i = 0; i < Math.max(1, pattern.length - 1); i++) {
      const pos = await page.evaluate((idx) => window.__signal?.getCubeScreenPos(idx) ?? null, pattern[i]);
      if (!pos) break;
      await page.mouse.click(pos.x, pos.y);
      await sleep(200);
    }
  }
  await shoot(page, device, '02-gameplay');

  // 3. Results screen, reached by a real mistake.
  const wrong = await page.evaluate(() => {
    const sig = window.__signal;
    if (!sig) return null;
    const { pattern } = sig.getState();
    for (let i = 0; i < 9; i++) if (!pattern.includes(i)) return sig.getCubeScreenPos(i);
    return null;
  });
  if (wrong) {
    await page.mouse.click(wrong.x, wrong.y);
    await page.waitForSelector('#results-screen', { state: 'visible', timeout: 15000 }).catch(() => {});
    await sleep(1200);
    await shoot(page, device, '03-results');
  }

  // 4–7. Menu screens. Reloading between them keeps each capture independent of
  // whatever the previous one left open.
  const screens = [
    { name: '04-stats',    open: async () => { await page.locator('#profile-btn').click(); } },
    { name: '05-forge',    open: async () => { await page.locator('#forge-btn').click(); await page.locator('#settings-tab-visual').click(); } },
    { name: '06-shop',     open: async () => { await page.locator('#store-btn').click(); } },
    { name: '07-boards',   open: async () => { await page.locator('#leaderboard-browser-btn').click(); } },
  ];
  for (const s of screens) {
    await page.goto(BASE, { waitUntil: 'load' });
    await page.waitForSelector('#start-btn', { state: 'visible', timeout: 30000 });
    await sleep(1200);
    try {
      await s.open();
      await sleep(900);
      await shoot(page, device, s.name);
    } catch (e) {
      console.log(`  ! skipped ${s.name}: ${e.message.split('\n')[0]}`);
    }
  }

  await ctx.close();
}

const browser = await chromium.launch(CHROMIUM ? { executablePath: CHROMIUM } : {});
try {
  for (const device of DEVICES) await captureFor(browser, device);
  console.log(`\nDone → ${OUT}`);
} finally {
  await browser.close();
}
