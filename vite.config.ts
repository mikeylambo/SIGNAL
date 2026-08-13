import { defineConfig, loadEnv, type Plugin } from 'vite';

const IS_ITCH_BUILD = process.env['SIGNAL_ITCH_BUILD'] === '1';

/**
 * Fails a production build that would ship with no leaderboard code at all.
 *
 * This guards a genuinely silent failure mode. `getClient()` reads
 * `import.meta.env.VITE_SUPABASE_URL` and throws when it is missing; Vite
 * inlines that value at build time, so with no env vars the guard becomes
 * provably-always-throwing and Rollup dead-code-eliminates the dynamic
 * `import('@supabase/supabase-js')` that follows it. The SDK is then absent from
 * the bundle entirely — measured: 213 kB chunk with the vars set, 1 byte without
 * — and the only hint is a "Generated an empty chunk" notice that is easy to
 * scroll past. The result is a deployment whose leaderboards cannot work no
 * matter what is configured at runtime, because the code is not there.
 *
 * Building without a backend is still legitimate (a fork, or an offline-only
 * build), so this is an explicit decision rather than a hard block: set
 * SIGNAL_ALLOW_NO_BACKEND=1 to proceed deliberately.
 */
function requireBackendEnv(): Plugin {
  return {
    name: 'signal-require-backend-env',
    apply: 'build',
    config(_config, { mode }) {
      // loadEnv, NOT process.env. Vite inlines values from .env files, but it
      // does not copy them into process.env — so a process.env-only check failed
      // the build for anyone following the documented setup (`cp .env.example
      // .env`, fill it in), even though that build would have worked perfectly.
      // A guard that blocks the primary workflow gets deleted, not obeyed.
      // The '' prefix loads every key, and loadEnv folds in real environment
      // variables too, so CI and Vercel (which supply them that way) still work.
      const env = loadEnv(mode, process.cwd(), '');
      const url = env['VITE_SUPABASE_URL'] || process.env['VITE_SUPABASE_URL'];
      const key = env['VITE_SUPABASE_ANON_KEY'] || process.env['VITE_SUPABASE_ANON_KEY'];
      if (url && key) return;
      if (process.env['SIGNAL_ALLOW_NO_BACKEND'] === '1') {
        console.warn(
          '\n[SIGNAL] Building with no leaderboard backend (SIGNAL_ALLOW_NO_BACKEND=1).\n' +
          '         The Supabase SDK will be absent from this bundle and every\n' +
          '         leaderboard feature will be inert at runtime.\n',
        );
        return;
      }
      const missing = [!url && 'VITE_SUPABASE_URL', !key && 'VITE_SUPABASE_ANON_KEY']
        .filter(Boolean).join(', ');
      throw new Error(
        `\n[SIGNAL] Refusing to build "${mode}": missing ${missing}.\n\n` +
        '  Without these the Supabase SDK is dead-code-eliminated out of the\n' +
        '  bundle, so the leaderboard cannot work in the deployed build even if\n' +
        '  the variables are set later at runtime.\n\n' +
        '  Fix: set them in your shell, .env, or your host\'s environment\n' +
        '  settings (Vercel → Project → Settings → Environment Variables).\n' +
        '  Intentionally building without a leaderboard? Re-run with\n' +
        '  SIGNAL_ALLOW_NO_BACKEND=1.\n',
      );
    },
  };
}

export default defineConfig({
  plugins: [requireBackendEnv()],

  // itch.io serves HTML5 uploads from a project-specific subdirectory rather
  // than from the host root. The normal Vercel build intentionally stays on
  // `/`; only `npm run build:itch` flips this to a relative base so generated
  // asset/module URLs survive that embedding path.
  base: IS_ITCH_BUILD ? './' : '/',

  build: {
    // Three.js + postprocessing is large by design; suppress the warning
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id: string) {
          // Three.js renders the menu background, so it is needed at first
          // paint and splitting it does NOT improve time-to-interactive. It is
          // split for cache lifetime: it changes only on a dependency bump, so
          // repeat visits and every game-code deploy reuse the cached copy
          // instead of re-downloading ~200 KB gzipped of vendor code.
          if (id.includes('node_modules/three')) return 'three';

          // @supabase/supabase-js is genuinely deferred — nothing on the launch
          // path imports it. See src/lib/supabase.ts; it loads on the first
          // leaderboard read/write, which is after a run ends at the earliest.
          if (id.includes('node_modules/@supabase')) return 'supabase';

          return undefined;
        },
      },
    },
  },
});