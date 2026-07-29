/**
 * Minimal, privacy-conscious telemetry.
 *
 * Without this the game is unobservable in the field: no crash rate, no idea
 * which devices fail WebGL init, no idea where players stop. You cannot run a
 * live game blind, and "check the console" only works for players you can reach.
 *
 * Design constraints, in priority order:
 *  1. Never break the game. Every path is wrapped, failures are swallowed, and
 *     nothing here is ever awaited by gameplay.
 *  2. Never send anything identifying. No player_id, no display name, no
 *     leaderboard identity, no free text from the player. Events carry a
 *     per-install random id that is not the leaderboard `player_id`, so
 *     telemetry cannot be joined to a public leaderboard row.
 *  3. Off unless configured. With no VITE_TELEMETRY_URL the whole module is
 *     inert, so forks and local builds send nothing by default.
 *  4. Player-controllable. `profile.settings.telemetry === false` disables it.
 */

import { profile, saveProfile } from './save';

const ENDPOINT = import.meta.env.VITE_TELEMETRY_URL as string | undefined;

/** Cap on queued events, so a pathological error loop can't grow unbounded. */
const MAX_QUEUE = 20;
/** Identical errors repeat constantly; only the first few of each are useful. */
const MAX_PER_SIGNATURE = 3;

type EventName =
  | 'session_start'
  | 'run_start'
  | 'run_end'
  | 'webgl_failed'
  | 'error'
  | 'unhandled_rejection';

interface TelemetryEvent {
  name: EventName;
  ts: number;
  props?: Record<string, string | number | boolean | null>;
}

let installId: string | null = null;
let queue: TelemetryEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const signatureCounts = new Map<string, number>();

const INSTALL_ID_KEY = 'sig_telemetry_id';

export function isTelemetryEnabled(): boolean {
  if (!ENDPOINT) return false;
  return profile.settings.telemetry !== false;
}

export function setTelemetryEnabled(on: boolean): void {
  profile.settings.telemetry = on;
  saveProfile();
  if (!on) {
    queue = [];
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  }
}

/**
 * A random id scoped to telemetry only. Deliberately NOT `profile.player_id` —
 * that one appears on public leaderboard rows, and reusing it would let crash
 * data be joined to a named player.
 */
function getInstallId(): string {
  if (installId) return installId;
  try {
    let id = localStorage.getItem(INSTALL_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(INSTALL_ID_KEY, id);
    }
    installId = id;
  } catch {
    // Private-mode / storage-disabled: fall back to a session-scoped id rather
    // than failing. Slightly worse aggregation, no crash.
    installId = crypto.randomUUID();
  }
  return installId;
}

/** Coarse device context. Nothing here narrows to an individual. */
function deviceContext(): Record<string, string | number | boolean | null> {
  return {
    ua: navigator.userAgent.slice(0, 180),
    lang: navigator.language,
    dpr: window.devicePixelRatio ?? 1,
    cores: navigator.hardwareConcurrency ?? 0,
    // Bucketed, not exact: exact viewport dimensions are a fingerprinting vector
    // and the useful signal is only "phone / tablet / desktop".
    viewport: window.innerWidth < 500 ? 'sm' : window.innerWidth < 900 ? 'md' : 'lg',
  };
}

export function track(name: EventName, props?: TelemetryEvent['props']): void {
  try {
    if (!isTelemetryEnabled()) return;
    if (queue.length >= MAX_QUEUE) return;
    queue.push({ name, ts: Date.now(), props });
    scheduleFlush();
  } catch {
    // Telemetry must never be the reason something breaks.
  }
}

/**
 * Records an error, collapsing repeats. A render-loop exception can fire every
 * frame; without the signature cap that alone would fill the queue and drown
 * out everything else.
 */
export function trackError(name: 'error' | 'unhandled_rejection', message: string, stack?: string): void {
  try {
    if (!isTelemetryEnabled()) return;
    const signature = `${name}:${message.slice(0, 120)}`;
    const seen = signatureCounts.get(signature) ?? 0;
    if (seen >= MAX_PER_SIGNATURE) return;
    signatureCounts.set(signature, seen + 1);

    track(name, {
      message: message.slice(0, 300),
      // Stacks can contain URLs but not player data; truncated to keep payloads small.
      stack: stack ? stack.slice(0, 800) : null,
      repeat: seen,
    });
  } catch { /* never throw from telemetry */ }
}

function scheduleFlush(): void {
  if (flushTimer) return;
  // Batch briefly so a burst of events costs one request, not one each.
  flushTimer = setTimeout(() => { flushTimer = null; void flush(); }, 4000);
}

export async function flush(useBeacon = false): Promise<void> {
  if (!ENDPOINT || queue.length === 0) return;
  const batch = queue;
  queue = [];

  const payload = JSON.stringify({
    install_id: getInstallId(),
    sent_at: Date.now(),
    device: deviceContext(),
    events: batch,
  });

  try {
    // sendBeacon survives page teardown, which is the only way to capture the
    // final events of a session; fetch is used for normal in-session flushes
    // because beacon gives no failure signal.
    if (useBeacon && navigator.sendBeacon) {
      navigator.sendBeacon(ENDPOINT, new Blob([payload], { type: 'application/json' }));
      return;
    }
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload,
      keepalive: true,
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    // Dropped rather than retried: a retry loop against a failing endpoint is
    // worse than losing a batch of analytics.
  }
}

export function initTelemetry(): void {
  if (!ENDPOINT) return;
  try {
    track('session_start', {
      returning: profile.hasSeenOnboarding,
      runs: profile.lifetime.runs,
    });
    // Flush on the way out so end-of-session events aren't lost.
    window.addEventListener('pagehide', () => { void flush(true); });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void flush(true);
    });
  } catch { /* never throw from telemetry */ }
}
