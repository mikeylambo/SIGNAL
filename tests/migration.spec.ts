import { test, expect, Page } from '@playwright/test';

// Save-migration safety.
//
// The failure mode being guarded is specific and severe: migrate() runs before
// load()'s backfill, so a migration branch that dereferences a missing
// sub-object throws, load()'s catch treats the save as corrupt, and the player
// loses progress, Signal and purchases. A partial save at v9–v13 did exactly
// that by hitting `raw.settings.telemetry` in the v13→v14 branch.
//
// These tests assert the player's data SURVIVES, which is the property that
// matters; asserting on the migration's internals would pass even while a reset
// was happening.

const CURRENT_SCHEMA = 18;

type Stored = {
  schemaVersion?: number;
  signal?: number;
  lifetime?: { runs?: number };
  unlockedCalibrations?: string[];
  settings?: Record<string, unknown>;
  hasSeenMenuTour?: boolean;
};

/**
 * Seeds a deliberately partial save: valuable player data present, the
 * `settings` sub-object missing entirely, as a truncated write or a hand-edit
 * would leave it.
 */
async function seedPartial(page: Page, schemaVersion: number): Promise<void> {
  await page.addInitScript((v: number) => {
    localStorage.setItem('sig_profile_v1', JSON.stringify({
      schemaVersion: v,
      signal: 7777,
      unlockedCalibrations: ['mono', 'custom', 'ferro', 'glacier'],
      currentCalibration: 'ferro',
      lifetime: { runs: 42, score: 123456, highestLevel: 11, signalMined: 9000, bestCombo: 17 },
      hasSeenOnboarding: true,
      hasCompletedOnboarding: true,
      display_name: 'SURVIVOR',
      // No `settings` key at all — this is the whole point of the fixture.
    }));
  }, schemaVersion);
}

function readProfile(page: Page): Promise<Stored | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('sig_profile_v1');
    return raw ? (JSON.parse(raw) as Stored) : null;
  });
}

// Every version from the one that introduced `settings` through the last one
// that could still trip over it, plus current. 9–13 were the broken window.
for (const version of [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18]) {
  test(`a partial v${version} save migrates without wiping the player`, async ({ page }) => {
    await seedPartial(page, version);
    await page.goto('/');
    // Wait for the menu, which means load() completed and the game booted.
    await expect(page.locator('#start-btn')).toBeVisible({ timeout: 20000 });

    const profile = await readProfile(page);
    expect(profile).not.toBeNull();

    // The reset signature: signal back to 0 and calibrations back to defaults.
    expect(profile?.signal).toBe(7777);
    expect(profile?.lifetime?.runs).toBe(42);
    expect(profile?.unlockedCalibrations).toContain('ferro');
    expect(profile?.unlockedCalibrations).toContain('glacier');

    // Repaired, not merely survived: the missing sub-object is now present and
    // the save has been carried up to the current schema.
    expect(profile?.settings).toBeTruthy();
    expect(profile?.schemaVersion).toBe(CURRENT_SCHEMA);

    // An established player must not be handed the menu tour by an update.
    // They already know where things are, and a tour appearing after a version
    // bump reads as the app breaking rather than as help.
    expect(profile?.hasSeenMenuTour, 'migrated saves must not trigger the tour').toBe(true);
  });
}

test('a genuinely corrupt save resets instead of white-screening', async ({ page }) => {
  // The other half of the contract: unparseable input must still boot the game.
  await page.addInitScript(() => {
    localStorage.setItem('sig_profile_v1', '{ this is not json');
  });
  await page.goto('/');
  await expect(page.locator('#start-btn')).toBeVisible({ timeout: 20000 });

  const profile = await readProfile(page);
  expect(profile?.schemaVersion).toBe(CURRENT_SCHEMA);
});
