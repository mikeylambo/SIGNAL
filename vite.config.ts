import { defineConfig } from 'vite';

export default defineConfig({
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
