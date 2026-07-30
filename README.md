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
| `npm test` | Playwright suite (77 tests across 4 browser projects) |
| `npx tsc --noEmit` | Type-check only |

Run a single test by name:

```bash
npx playwright test -g "pause and resume"
```

### CI

`.github/workflows/ci.yml` runs on every push and pull request:

- **web** — `tsc`, production build, then two assertions about the build itself: that the
  Supabase chunk is really in the bundle (~213 kB, not the 1 byte a mis-set build produces),
  and that a build with no backend env vars still *refuses* to run. Then the Playwright
  suite across all four browser projects, uploading the report on failure.
- **database** — applies `supabase/schema.sql` to a Postgres 16 service container twice
  (it must stay idempotent, since it is re-pasted into the SQL editor by hand), then runs
  `verify_delete.sql` and `verify_hardening.sql`.

### Browser matrix

Four Playwright projects:

| Project | Engine | Runs |
| --- | --- | --- |
| `chromium` | Blink | the full suite |
| `mobile-chrome` | Blink, Pixel 7, touch | `crossbrowser.spec.ts` only |
| `webkit` | WebKit, desktop | `crossbrowser.spec.ts` only |
| `mobile-safari` | WebKit, iPhone 14, touch | `crossbrowser.spec.ts` only |

Only `crossbrowser.spec.ts` runs on the non-default projects. The other specs cover game
rules, which don't vary by engine — running all of them four times would quadruple CI for
no new signal. That file tests what *does* differ per engine: WebGL context creation, touch
input, the AudioContext autoplay policy, layout at small viewports, and storage.

```bash
npx playwright test --project=mobile-safari      # one project
npx playwright test --project=chromium           # the full suite only
```

### Testing on real devices

**Android is well covered by `mobile-chrome`.** Chrome on Android is the same Blink/V8 as
the emulated project, so results transfer closely — what you lose in emulation is real GPU
behaviour, thermal throttling and true touch latency, not correctness. For a real device:
enable USB debugging, connect, and open `chrome://inspect#devices` on the desktop to
inspect and profile the page running on the phone. Playwright can also drive a real device
over ADB with `_android` (`chromium.launchServer` via `adb`), though `chrome://inspect` is
usually enough. Note Android WebView (in-app browsers) lags Chrome — if you care about
links opened inside another app, test that separately.

**iOS is not covered by `mobile-safari`, and it's important not to believe otherwise.**
Playwright's WebKit on Linux shares the engine with Safari but not the JIT, media stack or
GPU path. Passing there means "not obviously broken on WebKit"; it does not mean "works on
iPhone". The things most likely to differ are exactly the things this game leans on — WebGL
under memory pressure, the AudioContext unlock, PWA install and standalone display, and
safe-area insets. That needs a real iPhone (Safari → Develop menu from a Mac), or a device
farm (BrowserStack, Sauce Labs, LambdaTest) if you don't have one.

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
ban evasion), and the call is idempotent. `verify_hardening.sql` asserts the anti-abuse
controls below. Both run automatically in CI against Postgres 16.

### Leaderboard abuse controls

The Supabase anon key ships inside the client bundle — that is what it is for, and it means
every RPC is reachable with `curl`, not only from the game. Ownership checking stops one
player editing another's row; on its own it stops nothing else. Three controls bound the
rest:

- **Score plausibility.** `max_plausible_score(level)` derives a ceiling from the real
  scoring rules (per-hit value, combo and modifier multipliers, hits per level, level
  bonuses) and leaves roughly 2.5× headroom, so no honest run is ever rejected. A flat
  9,999,999 cap previously let anyone post a perfect-looking score at level 1 and
  permanently ruin a board — including dated daily boards, which cannot be rebuilt.
- **`level_reached` is required** and bounded to 1–500. It was optional and unvalidated,
  which would have made the plausibility check trivially bypassable.
- **Rate limiting** (`bump_rate_limit`), counted per player and per IP. The per-player
  submit cap is 300/hour: the binding case is not a long run but a player repeatedly failing
  and retrying, which real frustrated play can push to 180–240/hour, so the cap sits above
  that. Claiming a *new* identity is limited per IP — that is the step an attacker repeats
  to escape a per-player limit.

This is mitigation, not prevention, and worth being clear about: a distributed attacker with
many IPs still gets through, and a *slightly* inflated score is not detectable without a
server-authoritative simulation. What it buys is that single-source flooding and board
defacement stop being trivial. `select * from suspicious_scores;` surfaces the improbable
rows for a human to judge; `select purge_rate_limits();` clears spent buckets (schedule it
with pg_cron if you enable that extension).

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
