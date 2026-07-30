import { test, expect, Page } from '@playwright/test';

// Privacy disclosure and the right-to-erasure control.
//
// Coverage note: these tests run without VITE_SUPABASE_* configured, so
// getClient() rejects and the erasure RPC is never reached. That makes the
// *failure* path and the no-identity path directly testable here, which are the
// two that must not silently claim success. The server side of a successful
// erasure — rows removed, identity forgotten, ban preserved, wrong secret
// rejected — is verified against a real Postgres by supabase/verify_delete.sql.

type StoredProfile = {
  player_id?: string;
  owner_secret?: string;
  display_name?: string;
};

/** Seeds a profile past onboarding, with a known leaderboard identity. */
async function seed(page: Page): Promise<void> {
  await page.addInitScript((hasIdentity: boolean) => {
    const profile: Record<string, unknown> = {
      schemaVersion: 8,
      signal: 0,
      unlockedCalibrations: ['mono'],
      currentCalibration: 'mono',
      customHex: '#00E5FF',
      hasSeenOnboarding: true,
      hasCompletedOnboarding: true,
      unlockedAudioFeatures: [],
      currentStreak: 0,
      longestStreak: 0,
      lastRunDate: null,
      lastActivityDate: null,
      lifetime: { runs: 0, score: 0, highestLevel: 1, signalMined: 0, bestCombo: 0 },
      lastDailyDate: null,
      settings: { haptics: true, sfx: true },
    };
    if (hasIdentity) {
      profile['player_id'] = '00000000-0000-0000-0000-000000000001';
      profile['owner_secret'] = '00000000-0000-0000-0000-0000000000ff';
      profile['display_name'] = 'TestPlayer';
    }
    localStorage.setItem('sig_profile_v1', JSON.stringify(profile));
  }, true);
}

function readProfile(page: Page): Promise<StoredProfile | null> {
  return page.evaluate(() => {
    const raw = localStorage.getItem('sig_profile_v1');
    return raw ? (JSON.parse(raw) as StoredProfile) : null;
  });
}

async function openDataTab(page: Page): Promise<void> {
  await page.goto('/');
  await page.locator('#forge-btn').click();
  await page.locator('#settings-tab-data').click();
  await expect(page.locator('#settings-content-data')).toBeVisible();
}

test('the Data tab discloses what is stored and links the policy', async ({ page }) => {
  await seed(page);
  await openDataTab(page);

  // The summary is inlined rather than living only in the linked policy, so it
  // is still readable with no connection.
  const pane = page.locator('#settings-content-data');
  await expect(pane).toContainText('On this device');
  await expect(pane).toContainText('On the leaderboard');
  await expect(pane).toContainText('Diagnostics');
  await expect(page.locator('#privacy-policy-btn')).toBeVisible();
  await expect(page.locator('#delete-data-btn')).toBeVisible();
});

test('the privacy policy page loads standalone and covers the required ground', async ({ page }) => {
  // Reached by URL, not through the game, because that is how a store listing
  // and a data-protection request will both arrive at it.
  const res = await page.goto('/privacy.html');
  expect(res?.status()).toBe(200);

  const body = page.locator('body');
  await expect(body).toContainText('Privacy Policy');
  // The claims the game actually relies on.
  await expect(body).toContainText('no cookies');
  await expect(body).toContainText('sig_profile_v1');
  await expect(body).toContainText('Delete my leaderboard data');
  // Erasure, retention and children's data all have to be addressed somewhere.
  await expect(body).toContainText('Your rights');
  await expect(body).toContainText('How long it is kept');
  await expect(body).toContainText('Children');
});

test('erasure needs a second tap — one tap only arms it', async ({ page }) => {
  await seed(page);
  await openDataTab(page);

  const btn = page.locator('#delete-data-btn');
  await btn.click();

  // Armed, not fired: the warning is showing and the button is still enabled.
  await expect(btn).toHaveText('Tap again to confirm');
  await expect(page.locator('#delete-data-status')).toContainText('cannot be undone');
  await expect(btn).toBeEnabled();

  // Nothing has been touched locally, and crucially no attempt was made — with
  // no backend configured an attempt would have surfaced the failure message.
  await expect(page.locator('#delete-data-status')).not.toContainText('Could not reach');
  const profile = await readProfile(page);
  expect(profile?.display_name).toBe('TestPlayer');
  expect(profile?.player_id).toBe('00000000-0000-0000-0000-000000000001');
});

test('leaving and reopening the tab disarms a primed delete', async ({ page }) => {
  await seed(page);
  await openDataTab(page);

  await page.locator('#delete-data-btn').click();
  await expect(page.locator('#delete-data-btn')).toHaveText('Tap again to confirm');

  // Away and back — a live one-tap delete must not be sitting there waiting.
  await page.locator('#settings-tab-access').click();
  await page.locator('#settings-tab-data').click();

  await expect(page.locator('#delete-data-btn')).toHaveText('Delete my leaderboard data');
  await expect(page.locator('#delete-data-status')).toHaveText('');
});

test('a failed erasure says so and keeps the local identity intact', async ({ page }) => {
  // The important negative: telling a player their data is gone when the request
  // never landed is the one leaderboard failure that must not be swallowed.
  await seed(page);
  await openDataTab(page);

  const btn = page.locator('#delete-data-btn');
  await btn.click();
  await btn.click();

  await expect(page.locator('#delete-data-status')).toContainText('Nothing was deleted', { timeout: 15000 });
  await expect(btn).toBeEnabled();
  await expect(btn).toHaveText('Delete my leaderboard data');

  // Identity must survive, or a retry would target a player_id the server never saw.
  const profile = await readProfile(page);
  expect(profile?.player_id).toBe('00000000-0000-0000-0000-000000000001');
  expect(profile?.display_name).toBe('TestPlayer');
});

// Not covered here: the "no leaderboard identity" branch of deletePlayerData().
// It is unreachable through a normal boot — save.ts backfills both player_id and
// owner_secret on load, so a loaded profile always carries an identity. The guard
// stays as defence for a profile that failed to load, but asserting on it would
// mean asserting on a state the game cannot actually be in.
