import type { SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;
let _loading: Promise<SupabaseClient> | null = null;

/**
 * Returns the Supabase client, loading the SDK on first use.
 *
 * The import is dynamic so @supabase/supabase-js lands in its own chunk rather
 * than the main bundle. Nothing on the launch path touches the leaderboard —
 * every caller (submitScore, fetchBoard, renameEverywhere) is already async and
 * only runs once a player finishes a run or opens the Boards screen — so the
 * SDK no longer costs anything at startup.
 *
 * Concurrent callers share one in-flight load via `_loading`; without it, a
 * results screen that submits a score and renders a board at the same time
 * would kick off two parallel imports and build two clients.
 *
 * Still lazy about env vars for the same reason as before: the module must be
 * importable without a .env (e.g. in tests), with the throw surfacing only when
 * a leaderboard function is actually called.
 */
export async function getClient(): Promise<SupabaseClient> {
  if (_client) return _client;
  if (_loading) return _loading;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !key) {
    throw new Error(
      '[SIGNAL] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project credentials.'
    );
  }

  _loading = import('@supabase/supabase-js')
    .then(({ createClient }) => {
      _client = createClient(url, key);
      return _client;
    })
    .catch(err => {
      // Let the next call retry rather than caching a failed load forever —
      // this fires on a flaky connection, not just a genuinely broken build.
      _loading = null;
      throw err;
    });

  return _loading;
}
