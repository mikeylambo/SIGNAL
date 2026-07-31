/**
 * Cloudflare Turnstile attestation for creating a leaderboard identity.
 *
 * The problem it solves: the Supabase anon key ships in the bundle by design, so
 * every RPC is reachable with curl. Per-player rate limits are decorative on
 * their own, because a fresh `crypto.randomUUID()` resets them. Making a NEW
 * identity cost a solved challenge is what makes those limits bind.
 *
 * Three properties, in the same spirit as telemetry and the purchase provider:
 *
 *  1. **Inert unless configured.** With no VITE_TURNSTILE_SITE_KEY the whole
 *     module is a no-op and the game behaves exactly as before. Forks and local
 *     builds load nothing from Cloudflare.
 *  2. **Once per device, not once per run.** Attestation happens when the
 *     identity is first claimed. A returning player never sees a challenge —
 *     they already have a row server-side.
 *  3. **Never blocks play.** A failed or unavailable challenge costs the player
 *     a leaderboard entry, not their run. Gameplay never awaits this.
 *
 * The script is loaded lazily, on first need, rather than at boot: a player who
 * never posts a score should not pay for a third-party request, and it keeps
 * Cloudflare off the launch path.
 */

import { profile, saveProfile } from './save';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Past this, a player waiting on an invisible challenge deserves to move on. */
const CHALLENGE_TIMEOUT_MS = 20000;
const CLAIM_TIMEOUT_MS = 8000;

interface TurnstileApi {
  render: (el: HTMLElement, opts: {
    sitekey: string;
    callback: (token: string) => void;
    'error-callback': () => void;
    'timeout-callback'?: () => void;
    size?: 'normal' | 'compact' | 'flexible' | 'invisible';
    appearance?: 'always' | 'execute' | 'interaction-only';
    theme?: 'auto' | 'light' | 'dark';
  }) => string;
  remove: (id: string) => void;
}

function turnstile(): TurnstileApi | undefined {
  return (window as unknown as { turnstile?: TurnstileApi }).turnstile;
}

export function isAttestationConfigured(): boolean {
  return !!SITE_KEY;
}

/**
 * True when this device already holds an attested identity, so no challenge is
 * needed. Tracked locally only as a fast path — the server is the authority, and
 * a hand-edited save just means a redundant challenge, never a bypass.
 */
export function isAttested(): boolean {
  return profile.attested === true;
}

let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise<void>((resolve, reject) => {
    if (turnstile()) { resolve(); return; }
    const el = document.createElement('script');
    el.src = SCRIPT_SRC;
    el.async = true;
    el.defer = true;
    el.onload = () => resolve();
    el.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever —
      // this fires on a flaky connection, not just a blocked domain.
      scriptPromise = null;
      reject(new Error('Turnstile script failed to load'));
    };
    document.head.appendChild(el);
  });
  return scriptPromise;
}

/**
 * Runs the challenge and resolves with a token.
 *
 * Rendered into an off-screen container in `interaction-only` mode: most players
 * are never shown anything, and the ones Cloudflare wants to challenge get the
 * widget. It is positioned rather than `display:none` because a hidden widget is
 * one Turnstile can refuse to run.
 */
function getToken(): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const api = turnstile();
    if (!api || !SITE_KEY) { reject(new Error('Turnstile unavailable')); return; }

    const host = document.createElement('div');
    host.setAttribute('aria-hidden', 'false');
    host.style.cssText = 'position:fixed;left:50%;top:12px;transform:translateX(-50%);z-index:9999;';
    document.body.appendChild(host);

    let widgetId: string | undefined;
    let settled = false;

    const cleanup = () => {
      if (widgetId !== undefined) { try { api.remove(widgetId); } catch { /* already gone */ } }
      host.remove();
    };
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      fn();
    };

    const timer = setTimeout(
      () => finish(() => reject(new Error('challenge timed out'))),
      CHALLENGE_TIMEOUT_MS,
    );

    try {
      widgetId = api.render(host, {
        sitekey: SITE_KEY,
        size: 'flexible',
        appearance: 'interaction-only',
        theme: 'dark',
        callback: (token: string) => finish(() => resolve(token)),
        'error-callback': () => finish(() => reject(new Error('challenge errored'))),
        'timeout-callback': () => finish(() => reject(new Error('challenge expired'))),
      });
    } catch (err) {
      finish(() => reject(err instanceof Error ? err : new Error(String(err))));
    }
  });
}

/**
 * Ensures this device holds an attested identity, running a challenge if needed.
 *
 * Resolves `true` when the identity is attested (or attestation is switched off,
 * which is the same thing from the caller's point of view: proceed). Resolves
 * `false` when a challenge was required and did not succeed — the caller should
 * skip the leaderboard write, not fail the run.
 *
 * Never throws, and never blocks gameplay.
 */
export async function ensureAttested(): Promise<boolean> {
  // Unconfigured build: nothing to do, and the server's require_attestation flag
  // will be off to match.
  if (!SITE_KEY) return true;
  if (isAttested()) return true;
  if (!SUPABASE_URL || !SUPABASE_ANON) return true;

  const { player_id, owner_secret } = profile;
  if (!player_id || !owner_secret) return true;

  try {
    await loadScript();
    const token = await getToken();

    const res = await fetch(`${SUPABASE_URL}/functions/v1/verify-attestation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON}`,
        apikey: SUPABASE_ANON,
      },
      body: JSON.stringify({ player_id, owner_secret, token }),
      signal: AbortSignal.timeout(CLAIM_TIMEOUT_MS),
    });

    if (!res.ok) {
      console.warn('[attestation] verification rejected:', res.status);
      return false;
    }

    profile.attested = true;
    saveProfile();
    return true;
  } catch (err) {
    // Blocked domain, offline, ad blocker, challenge refused — all the same
    // outcome for the player: no leaderboard entry this time, run intact.
    console.warn('[attestation] failed:', err);
    return false;
  }
}
