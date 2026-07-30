# SIGNAL — Cognitive Calibration Engine

A 3D working-memory training game. Five cognitive protocols × three pacing modes, plus
two modifiers, a date-seeded daily challenge, shared leaderboards, and an offline-capable
PWA build.

Built with Vite + TypeScript (strict) and Three.js. Leaderboards are backed by Supabase;
everything else runs entirely on the device.

> **Licence:** proprietary — all rights reserved. The source is published for reference,
> not for reuse. See [LICENSE](./LICENSE).

---

## Quick start

```bash
npm install
cp .env.example .env      # then fill in your Supabase URL + anon key
npm run dev               # http://localhost:5173
```

The game runs without a `.env` — every leaderboard call fails soft and the rest of the
game is unaffected. You only need credentials to exercise leaderboards.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Vite dev server at `http://localhost:5173` |
| `npm run build` | `tsc` + production bundle into `dist/` |
| `npm run preview` | Serve the built bundle locally |
| `npm test` | Playwright suite (63 tests) |
| `npx tsc --noEmit` | Type-check only |

Run a single test by name:

```bash
npx playwright test -g "pause and resume"
```

### If Playwright can't find a browser

Sandboxes and CI images often ship a Chromium that doesn't match the build
`@playwright/test` wants, and can't download one. Point at the browser that exists:

```bash
PLAYWRIGHT_CHROMIUM_PATH=/opt/pw-browsers/chromium npm test
```

Otherwise `npx playwright install chromium` once is enough.

## Environment variables

All are optional, and each subsystem is inert without its own — so a fork or a local
build never phones home by accident.

| Variable | Effect if unset |
| --- | --- |
| `VITE_SUPABASE_URL` | **Blocks a production build** (see below). Leaderboards inert. |
| `VITE_SUPABASE_ANON_KEY` | Same as above. |
| `VITE_TELEMETRY_URL` | Telemetry is fully inert; the Diagnostics toggle is hidden. |
| `VITE_PURCHASE_PROVIDER` | The premium purchase button is not rendered at all. |
| `SIGNAL_ALLOW_NO_BACKEND=1` | Build-time only: permits a deliberate build with no leaderboard. |

### Why a missing Supabase var fails the build

`getClient()` throws when `VITE_SUPABASE_URL` is missing. Vite inlines that value at build
time, so with no env vars the guard becomes provably-always-throwing and Rollup
dead-code-eliminates the dynamic `import('@supabase/supabase-js')` after it. The SDK then
isn't in the bundle at all — 213 kB chunk with the vars set, **1 byte** without — and the
resulting deployment can never do leaderboards, whatever you configure at runtime.

A Vite plugin (`vite.config.ts`) turns that silent trap into a failed build. To build
without a backend on purpose, set `SIGNAL_ALLOW_NO_BACKEND=1`.

## Deploying

Vercel picks up `vercel.json` as-is: build command, output directory, cache headers, and
the security headers (CSP, `Permissions-Policy`, `Referrer-Policy`, COOP, `nosniff`,
`X-Frame-Options`).

1. Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in **Project → Settings →
   Environment Variables**, or the build will fail by design.
2. Apply the database schema: paste `supabase/schema.sql` into the Supabase SQL editor and
   run it. It's idempotent, so re-running after a change is safe.
3. Deploy.

### Tightening the CSP

`connect-src` is `'self' https:` because the Supabase origin is only known at build time
and `vercel.json` can't interpolate. Once your project URL is fixed, narrowing it to that
one origin is a worthwhile one-line change:

```
connect-src 'self' https://YOUR-PROJECT.supabase.co;
```

## Database

`supabase/schema.sql` is the whole backend: the scores table, per-device identity claiming,
moderation (blocklist, reports, bans) and erasure. Every write goes through a
`SECURITY DEFINER` function — the client bundle is editable by the player, so no validation
that must actually hold belongs there.

Verify schema changes against a real Postgres rather than by eye:

```bash
# as an unprivileged user; initdb refuses to run as root
initdb -D pgdata -U postgres --auth=trust
pg_ctl -D pgdata -l pglog -o "-p 55432" start
createdb -p 55432 -U postgres sigtest
psql -p 55432 -U postgres -d sigtest -c "create role anon nologin; create role authenticated nologin;"
psql -p 55432 -U postgres -d sigtest -v ON_ERROR_STOP=1 -f supabase/schema.sql
psql -p 55432 -U postgres -d sigtest -v ON_ERROR_STOP=1 -f supabase/verify_delete.sql
```

`verify_delete.sql` asserts the erasure guarantees: a wrong `owner_secret` is rejected, one
player's delete can't touch another's rows, a ban survives erasure (so it can't be used for
ban evasion), and the call is idempotent.

## Privacy and data

`public/privacy.html` is the published policy, and it is accurate to what the code does —
if you change what is collected, change it there too. In-game, **Settings → Data** shows the
same disclosure and holds the erasure control (`delete_player_data`).

There are no cookies, no third-party trackers, no ads, and no accounts. Two `localStorage`
keys (`sig_profile_v1`, `sig_telemetry_id`) and, only if you post a score, one leaderboard
row keyed by a random ID.

## Architecture

See [CLAUDE.md](./CLAUDE.md) for the module map, the deliberate circular-dependency breaks,
run-lifecycle invariants (`state.runId` / `isStale()`), the render-loop rules (`dt60`,
double-loop guard), and why Three.js is pinned to 0.128.0.

`CHANGELOG.md` records what changed and, more usefully, what was tried and rejected.

Legacy prototypes (`signal.html`, `version_3_ultimate.html`) and the original GDD are kept
at the repo root for reference. Nothing in the build or the tests references them.

---

## Pre-launch checklist

Placeholders that must be replaced before going public — each is deliberately visible in
the rendered output rather than hidden in a comment, so shipping without filling them in is
obvious:

- [ ] `public/privacy.html` — `YOURDOMAIN.com`, `[OPERATOR NAME]`, and the "Last updated" date
- [ ] `LICENSE` — `[OPERATOR NAME]`
- [ ] Create the `privacy@` mailbox and confirm mail arrives
- [ ] Set `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` on the host
- [ ] Apply `supabase/schema.sql` to the production project
- [ ] Confirm `dist/assets/supabase-*.js` is ~213 kB, not 1 byte, in the deployed build
- [ ] Narrow `connect-src` in `vercel.json` to your Supabase origin
- [ ] Decide on telemetry: leave `VITE_TELEMETRY_URL` unset to ship with none

Verify before tagging:

```bash
npx tsc --noEmit && npm test
```
