import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

// Lazily initialised so the module can be imported without crashing when env
// vars are absent (e.g. running tests without a .env).  The throw surfaces the
// first time a leaderboard function is actually called.
export function getClient(): SupabaseClient {
  if (_client) return _client;

  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

  if (!url || !key) {
    throw new Error(
      '[SIGNAL] Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. ' +
      'Copy .env.example to .env and fill in your Supabase project credentials.'
    );
  }

  _client = createClient(url, key);
  return _client;
}
