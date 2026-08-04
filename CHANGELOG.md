# Changelog

All notable changes to SIGNAL are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [Unreleased]

### Fixed — the header rendered over the iOS status bar
- Reported from a real iPhone, with screenshots: the SIGNAL wordmark drawn on top of the
  clock and wifi icons, and the bottom nav row clipped off the bottom edge. The *older*
  build looked correct, which is the clue — without `viewport-fit=cover`, iOS keeps content
  inside the safe area by itself.
- The cause: `main.ts` injected `viewport-fit=cover` into the viewport meta at runtime and
  then read `env(safe-area-inset-*)` **in the same synchronous task**. The browser has not
  re-evaluated the viewport at that point, so every inset measured `0`. The
  `if (inset > 0)` guards then skipped writing `--sat`/`--sab`, leaving cover mode active
  with no compensating padding — content extended under the status bar and home indicator
  with nothing to push it back.
- A second bug in the same code: it measured once at load, so the values went stale on
  rotation even when they were right.
- Fixed declaratively. `viewport-fit=cover` is now in the static meta tag, and
  `--sat`/`--sab`/`--sal`/`--sar` come straight from `env()` in `:root`. No JS, no ordering
  hazard, live on rotation, and it falls back to `0px` everywhere without insets. The ~25
  lines of measurement code are gone.

### Performance — resize no longer rebuilds the board on every event
- `onWindowResize()` called `createBoard()` whenever the menu was showing. That disposes
  every cube material and creates new ones, and each new material is a fresh shader program
  because of the fresnel rim injected via `onBeforeCompile` — tens of shader compiles.
- Fine once; not fine at the rate mobile browsers actually emit `resize`. iOS fires it
  repeatedly as the address bar collapses and expands, and the broken `viewport-fit` state
  above made that churn worse. Likely a contributor to the lag reported alongside the
  overlap, though that is a hypothesis rather than a profiled result — the sandbox has no
  iOS device to measure on.
- The cheap work (camera, renderer and bloom sizing) stays synchronous per event; only the
  board rebuild is debounced to the end of the burst. The `state.pattern.length === 0` check
  moved *inside* the timer, so a run starting during the debounce window can't have its
  board rebuilt out from under it.

### Fixed — the results screen's actions could not be found
- Reported from a real device as "no menu button after a run". They were there, just
  below the fold: the results screen is the tallest surface in the game, and on any short
  viewport (a 1280×720 desktop, or a phone once the browser chrome shows) *Run Again* and
  *Menu* sat past the bottom edge.
- I had already measured this while writing the cross-browser tests — ~13px below the fold
  at 720px — and judged it acceptable because `.modal-screen` scrolls. That judgement was
  wrong. A player has no reason to suspect content below the leaderboard panel, so the
  buttons may as well not exist. **Reachable after a scroll you don't know about is not
  reachable.**
- The action row is now `position: sticky` at the bottom of the modal, with a gradient
  backdrop so content scrolling underneath stays legible, and `--sab` padding so it clears
  the iOS home indicator.
- The test was tightened to match: it no longer calls `scrollIntoViewIfNeeded()` before
  measuring, so it asserts the buttons are on screen *without* scrolling. Confirmed it
  fails without the fix.

### Added — Turnstile attestation on identity creation
- The rate limits shipped earlier were only as strong as the cost of a new identity, and a
  `crypto.randomUUID()` costs nothing — so a per-player limit was decorative: mint a new
  UUID and it resets. **Making a new identity cost a solved challenge is what makes every
  other limit bind**, which is why this is the highest-leverage control of the set.
- Three pieces: `src/attestation.ts` (client), `supabase/functions/verify-attestation`
  (Deno Edge Function that checks the token with Cloudflare), and
  `claim_identity_attested()` in SQL, which only `service_role` may call.
- The Cloudflare check has to happen in the Edge Function: a client-side "verified" flag
  proves nothing since the bundle is editable, and Postgres has no synchronous outbound
  HTTP (`pg_net` is async) so it cannot make the call inline with the claim.
- **Enforcement is a database row, not a build flag** (`app_settings.require_attestation`,
  default `false`). If Cloudflare has a bad day, the fix has to be "flip a row", not "ship a
  build" — otherwise every new player is locked out until a deploy lands.
- **Only new identities are gated.** A returning player already has a row and never reaches
  the claim path, so turning the flag on cannot lock out anyone who has already posted.
  Asserted explicitly in `verify_hardening.sql`.
- **Found by the tests, not by reading the code:** `revoke execute … from anon` did nothing,
  because Postgres grants `EXECUTE` to `PUBLIC` by default and anon inherits it. The gate
  was one direct RPC call from being bypassed entirely. Fixed with a revoke from `PUBLIC`,
  and there is now a `has_function_privilege` assertion so it cannot regress.
- **CSP had to be widened, or the feature would have failed silently.** `script-src 'self'`
  blocks the Turnstile script outright; `challenges.cloudflare.com` is now allowed in
  `script-src` and `frame-src`, verified against the real production bundle behind the real
  headers.
- **Privacy policy updated to match.** With attestation on, Cloudflare receives an IP and
  some browser characteristics — so it is now disclosed as a processor, with the conditions
  stated. Leaving the policy saying "no third parties beyond hosting" would have made it
  inaccurate the moment the feature was switched on.
- Inert unless `VITE_TURNSTILE_SITE_KEY` is set, matching telemetry and the purchase button.
  A test asserts an unconfigured build makes **no third-party request at all**, which is the
  claim the privacy policy rests on.
- Never blocks play: a blocked domain, an ad blocker or a refused challenge costs that one
  leaderboard entry, never the run.
- Erasure clears the local `attested` flag, since the regenerated identity is unclaimed
  server-side; leaving it set would make the next submission skip the challenge and then
  fail the claim, silently.
- Schema v17 marks existing players attested — they already hold a claimed identity, so
  challenging them would be friction with nothing behind it.

### Added — terms of service
- **`public/terms.html`.** The privacy policy covered data; nothing covered conduct. With
  public user-generated content (callsigns), a virtual currency and a planned paid unlock,
  the terms are what actually grant the right to ban someone and disclaim liability.
- Written against what the code does, not from a template. The clauses that matter here are
  the ones a generic template would get wrong:
  - **No accounts means no recovery.** Stated plainly rather than buried: clear your browser
    data, switch device, or use private browsing and the save is gone, including the paid
    unlock. That is a real consequence of the design and players deserve it up front.
  - **Signal cannot be bought.** It is earned by playing only, has no monetary value, and is
    non-transferable. Verified against the code — `addSignal` is called from exactly one
    place, at the end of a run.
  - **The unlock never buys advantage.** Every protocol, pacing, modifier, the daily and the
    leaderboards stay free, and it says so, matching the boundary already stated in
    `entitlements.ts`.
  - **Not a medical device.** The strongest possible pairing with the store-copy rule: the
    game describes tasks studied in cognitive psychology and makes no claim about the player.
    Also flags flashing lights and points at the reduced-motion setting.
  - **Bans survive erasure**, restating in plain language what `delete_player_data` enforces
    in SQL, so the behaviour is disclosed rather than surprising.
- Linked both ways with the privacy policy, reachable from **Settings → Data**, and
  precached by the service worker. Cache bumped to `signal-v3`: without it an installed
  client keeps its v2 cache and never fetches the new page, so the terms would be missing
  offline for exactly the returning players most likely to look.
- Opens in a new tab rather than navigating — leaving the page mid-session tears down the
  WebGL context and cold-boots the game on return.
- **It is a draft and says so.** The liability, warranty and governing-law clauses need a
  lawyer before anyone relies on them.

### Added — pre-launch placeholder gate
- `npm run check:launch` fails while `YOURDOMAIN.com`, `[OPERATOR NAME]` or `[JURISDICTION]`
  remain in the policy pages or the licence, and prints what each one costs if it ships
  unfilled.
- Deliberately **not** in CI. It fails by design until launch day, and wiring it in would
  mean either a permanently red pipeline or someone disabling the one check whose entire job
  is to be noticed.

### Added — cross-browser and mobile test coverage
- The suite ran on **Desktop Chrome only**, in a game that is mobile-first and leans on
  WebGL, Web Audio, touch and service workers — the four things most likely to differ per
  engine. Four Playwright projects now: `chromium` (full suite), plus `mobile-chrome`,
  `webkit` and `mobile-safari` running `tests/crossbrowser.spec.ts`.
- Only the cross-browser spec runs on the extra projects. The other specs cover game rules,
  which don't vary by engine; running all of them four times would quadruple CI for no new
  information. The new file tests only what genuinely differs: WebGL context creation, touch
  input (a separate path from mouse — the board is raycast from pointer coordinates and had
  no touch coverage at all), the AudioContext autoplay policy (Safari suspends until a real
  user gesture, so getting it wrong is silent on Apple platforms and fine everywhere else),
  layout at small viewports, and storage across a reload.
- **Stated in the file and the README so it can't be misread: `mobile-safari` is not iOS.**
  Playwright's WebKit on Linux shares the engine with Safari but not the JIT, media stack or
  GPU path. Passing means "not obviously broken on WebKit", not "works on iPhone". Android
  is the opposite — `mobile-chrome` is the same Blink/V8 as Chrome on Android, so those
  results transfer closely.
- `playwright.config.ts` drops the WebKit projects when `PLAYWRIGHT_CHROMIUM_PATH` is set,
  since that variable exists precisely because the environment cannot download browsers.
  Better than failing with "executable doesn't exist" in every sandbox.
- One finding from writing these: on a 1280×720 desktop viewport the results screen's
  actions sit ~13px below the fold. Not a defect — `.modal-screen` is deliberately
  `overflow-y: auto` — so the test asserts the real contract (the actions stay *reachable*,
  and the modal scrolls rather than the page, which would drag the WebGL canvas) instead of
  the stricter "everything fits" that the design never promised.

### Added — leaderboard abuse controls
- The anon key ships in the client bundle by design, so every RPC is reachable with `curl`.
  Ownership checking stopped one player editing another's row and nothing else: a script
  could mint fresh `player_id`s in a loop and bury every board, or post a perfect-looking
  score at level 1 and permanently ruin one — including a dated daily board, which is a
  historical record and cannot be rebuilt.
- **Score plausibility** (`max_plausible_score`). The old ceiling was a flat 9,999,999,
  which is not a check so much as an integer bound. The new one is derived from the actual
  scoring rules — per-hit value, combo/protocol/modifier multipliers, hits per level,
  level bonuses, Zen's three-completions-per-level — with ~2.5× headroom on top, verified
  against the theoretical maximum run at every level 1–60 so no honest player is rejected.
- **`level_reached` is now required** and bounded 1–500. It was optional and unvalidated,
  which would have made the plausibility check bypassable by simply omitting it.
- **Rate limiting** (`bump_rate_limit`), per player and per IP, as a fixed window. Sliding
  windows need a row per event, which is itself write amplification on the path being
  protected. Claiming a *new* identity is limited per IP specifically, since that is the
  step an attacker repeats to escape a per-player limit; returning players never hit it, so
  shared connections are unaffected.
- The per-player submit cap is **300/hour**, and the reasoning is worth keeping: the binding
  case is not a long run but a player failing immediately and retrying, a ~15–20s cycle that
  real frustrated play can push to 180–240/hour. A tighter cap would have punished exactly
  the player having a bad session. An earlier 120/hour figure was wrong for this reason.
- `suspicious_scores` surfaces the *improbable* for a human to judge, since submit_score can
  only reject the *impossible*. Not exposed to anon — a "how close to the limit am I"
  readout is a calibration aid for cheating.
- `purge_rate_limits()` for housekeeping. Deliberately not self-scheduling: pg_cron is an
  extension the owner has to enable, and silently depending on it would mean the cleanup
  simply never runs on a project that hasn't.
- Stated plainly, because the boundary matters: this is mitigation, not prevention. A
  distributed attacker with many IPs still gets through, and a *slightly* inflated score is
  undetectable without a server-authoritative simulation. It makes single-source flooding
  and board defacement non-trivial, and caps what any one accepted row can do.
- `supabase/verify_hardening.sql` asserts all of it against real Postgres, including that
  the limiter stays latched at its cap — when `bump_rate_limit` raises, PL/pgSQL rolls back
  its own increment, so the limit holds by *staying at* the maximum rather than exceeding
  it, and a wrong reset branch would show up as a limiter that quietly reopens.

### Added — CI
- `.github/workflows/ci.yml`. Until now nothing ran the suite on push; every check was
  local and by hand.
- The **web** job type-checks, builds, and then asserts two things about the build that no
  unit test can: that the Supabase chunk is genuinely in the bundle (~213 kB, not the 1 byte
  a mis-set build emits), and that a build with no backend env vars still refuses to run. If
  either regresses, a silently-broken deployment becomes possible again.
- The **database** job applies `schema.sql` to a Postgres 16 service container **twice** —
  it is pasted into the Supabase SQL editor by hand and re-run after every change, so
  idempotency is a property it has to keep — then runs both verification scripts. The schema
  checks that were previously manual now run on every push.

---

## [1.0.0] — 2026-07-30

First public release. Everything below this heading shipped in it.

### Added — privacy and data rights
- **A privacy policy** (`public/privacy.html`), written against what the code actually does
  rather than from a template: the two `localStorage` keys by name, the exact leaderboard
  columns, and the precise telemetry payload. It can state plainly that there are no cookies,
  no third-party trackers, no ads and no accounts, because there are none. Reachable from
  **Settings → Data** and precached by the service worker, since a policy that needs a
  connection isn't reachable at the moment an offline player looks for it.
- **The right to erasure** — `delete_player_data()` in `supabase/schema.sql`, wired to
  **Settings → Data → Delete my leaderboard data**. Every other write path only ever *added*
  a player to the backend; someone who typed a callsign onto a public board had no way to
  take it back. Two-stage confirm, because it is irreversible and server-side.
- A player's `reported_name` copies are deleted along with their score rows — erasing only
  `leaderboard_scores` would have left the callsign sitting in the reports table.
- **Bans deliberately survive erasure.** Otherwise "delete my data" doubles as a ban-reset
  button. A ban row holds a random id and a moderator note and nothing the player supplied,
  so this erases everything personal while keeping the moderation decision.
- Erasure regenerates the local identity instead of reusing it. Keeping the old `player_id`
  would silently re-claim the erased identity on the next score submission.
- Erasure is the **one** leaderboard call that reports failure to the player. The others fail
  quietly because a lost score is cosmetic; telling someone their data is gone when the
  request never landed is not.
- `supabase/verify_delete.sql` asserts the guarantees against a real Postgres — wrong
  `owner_secret` rejected, one player's delete cannot touch another's rows, ban preserved,
  idempotent. Verified on PostgreSQL 16, applying `schema.sql` end to end first.

### Fixed — a partial save could wipe a player's profile
- `migrate()` ran before `load()`'s backfill, so a branch that dereferenced a missing
  sub-object threw, and `load()`'s catch treated the save as corrupt and **reset the entire
  profile** — progress, Signal and purchases. The v8→v9 branch guarded `settings` for exactly
  this reason, but a guard inside one branch only protects saves *below* that version: a save
  at **v9–v13** with no `settings` skipped it and hit `raw.settings.telemetry` in v13→v14.
- Fixed by repairing the shape **before** any version branch runs, so the class is gone rather
  than patched one branch at a time — any future branch can assume its sub-objects exist.
- `tests/migration.spec.ts` covers v8 through v16 and asserts the player's data *survives*,
  which is the property that matters. Confirmed the tests fail without the fix.

### Fixed — a build could ship with no leaderboard code at all
- `getClient()` throws when `VITE_SUPABASE_URL` is missing, and Vite inlines that value at
  build time — so with no env vars the guard became provably-always-throwing and Rollup
  dead-code-eliminated the dynamic `import('@supabase/supabase-js')` after it. Measured:
  a **213 kB** chunk with the vars set, **1 byte** without. The deployment's leaderboards
  then could not work whatever was configured at runtime, and the only signal was an
  easy-to-miss "Generated an empty chunk" notice.
- A Vite plugin now fails the production build instead. Building without a backend is still
  legitimate, so it is an explicit choice: `SIGNAL_ALLOW_NO_BACKEND=1`.

### Fixed — service worker could serve the wrong page as the game
- The navigation handler wrote **every** successful navigation into the shell cache slot, so
  visiting any second page would make that page the offline response for the game itself.
  Latent with only one page; adding `/privacy.html` would have activated it. Navigations are
  now cached under their own URL, the shell slot is only written by a real shell navigation,
  and an offline navigation prefers the page actually requested. Cache bumped to `signal-v2`
  so an already-installed client drops a poisoned entry.

### Added — release hygiene
- `README.md`: setup, commands, every environment variable and what happens without it,
  deploy steps, the Postgres verification recipe, and a pre-launch checklist.
- `LICENSE`: proprietary, all rights reserved, with third-party dependencies excluded.
- **Security headers** in `vercel.json` — a Content-Security-Policy plus
  `Permissions-Policy`, `Cross-Origin-Opener-Policy` and `no-cache` on `/sw.js`. Verified
  against the real production bundle behind the actual headers: game boots, service worker
  registers, zero violations on both routes. `connect-src` stays `'self' https:` because the
  Supabase origin is only known at build time; narrowing it is noted in the README.
- Display names were already escaped everywhere they reach `innerHTML`, so the CSP is
  defence-in-depth rather than a fix.
- `tests/resilience.spec.ts` covers the paths a player cannot self-diagnose: WebGL denied
  gives a readable error and no uncaught exception, an unreachable leaderboard says so
  instead of claiming the board is empty, and a run still reaches its results screen with the
  backend down.
- `playwright.config.ts` accepts `PLAYWRIGHT_CHROMIUM_PATH`, so the suite runs in sandboxes
  and CI images that ship a Chromium which doesn't match the pinned build and cannot download
  one. `channel` is cleared alongside it, or the channel wins and the run still fails.

### Changed — economy
- **The shop no longer sells colour.** Once the Forge shipped eight designed palettes and a full hue
  slider for free, every paid Calibration was a rotation away — that isn't a pricing problem, it's
  having nothing to sell. Signal now buys **board materials** (`src/materials.ts`): surface
  character, glow falloff, transparency, flat shading, wireframe. None of it is expressible as a
  palette, so it is genuinely additional to what the Forge produces. Six treatments, 0–3000 Signal.
- **Paid Calibrations now bundle a palette and a signature material** — Ferro/Chrome,
  Glacier/Glass, Redline/Facet — and say so in the listing. Existing purchases therefore *gained*
  value instead of being devalued. Owning a Calibration deliberately does not grant its material for
  general use, or a 500-Signal theme would be a cheap route to a 3000-Signal treatment.
- Material ownership is re-checked at render time, so a hand-edited save cannot equip a treatment
  that was never bought.
- The economy no longer dead-ends: ~7,700 Signal of new sinks on top of the existing ~8,000, and
  modifier score multipliers feed Signal earnings automatically.

### Added — premium (scaffolding)
- A single one-time **SIGNAL Complete** unlock (`src/entitlements.ts`): every board material,
  8 palette slots instead of 3, and 500 runs of per-protocol history instead of 20.
- Hard boundaries, stated in code: every protocol, pacing, modifier, the daily challenge and the
  leaderboard stay free permanently. No energy timers, no ad-gated retries, no paid continues — in a
  permadeath game, charging for a retry is how you get uninstalled. It sells cosmetics and
  record-keeping, never advantage.
- The purchase button renders **only** when `VITE_PURCHASE_PROVIDER` is configured, so no build ships
  a button that cannot complete. Wiring an actual provider needs the owner's store/Stripe account;
  `grantPremium()` is deliberately reserved for a confirmed receipt rather than a click.

### Fixed
- **Store copy made implied cognitive-benefit claims.** "Gamma Protocol — 40 Hz gamma-band
  isochronic entrainment" and "Binaural Focus" are exactly the wording Apple and Google reject for an
  app that cannot substantiate it. Renamed to Pulse Layer and Binaural Layer, described by what they
  sound like. The audio itself is unchanged; only the promise is gone.
- **Circular import between `progression.ts` and `entitlements.ts`** — each needed a symbol from the
  other, which throws a TDZ error at module init and white-screens the game. Caught by running it,
  not by the type-checker, which was happy with it.

### Fixed
- **Menu layout**: the modifier control landed inside the Pacing column, breaking the
  PROTOCOL / PACING / STREAK alignment. It now has its own column and matches the other controls.

### Not done — Three.js upgrade (deliberately deferred)
Attempted 0.128 → 0.185 and reverted. It compiles, runs, and passes the suite, but the authored look
cannot be recovered by configuration:

- r152 turned colour management on by default, r155 switched lighting to physical units, and
  `UnrealBloomPass` was reworked. All three change how existing colours, lights and glow resolve.
- Measured against a pixel baseline (board-region mean brightness; baseline **39.69**): raw upgrade
  **58.24** (background washed to slate grey, glow gone); `ColorManagement` off + linear output
  **25.17** (too dark); light intensities × π **64.56** (blown out).
- Swept light scale 1.6–2.9 against bloom threshold 0.08–0.18. Best was **RMSE 22.29** at scale 2.4,
  still visibly off — and the response is *discontinuous* across the bloom threshold, so no constant
  lands on the original.

Conclusion: palettes, emissive intensities, light units and bloom strength/radius/threshold have to
be re-authored **together**. That is an art decision, not a dependency bump, and smuggling a visual
regression into a version upgrade would be worse than staying current-but-old. Reverted to the
pinned 0.128.0 and verified pixel-identical to baseline (RMSE 0.00).

### Added — modifiers
- **A modifier axis** (`src/game/modifiers.ts`): properties applied to existing protocols rather
  than new protocols. Two modifiers across four grid protocols is eight new experiences from a small
  amount of new surface, which is the opposite trade from adding a sixth protocol silo.
- **Chromatic** — tiles flash in one of three channels and you must reproduce colour as well as
  position. Its channel colours are **fixed and theme-exempt**: they are information, not
  decoration, so the Forge cannot rotate two channels into each other. This is why the earlier
  standalone Chromatic protocol didn't work — it fought the theming system and tested perception
  where every other protocol tests memory. Score ×1.5.
- **Resonant** — the same colour channel, but nothing is shown at all: position comes from the
  stereo field and colour from pitch. Score ×1.8. Verified that no tile ever lights during a
  Resonant run.
- Each channel carries a semitone as well as a hex, so colour is audible as well as visible — which
  is what makes Resonant possible and keeps Chromatic playable without colour vision. Channels are
  chosen on a blue/amber/white triad that avoids the red-green axis and varies in lightness, so they
  stay separable under colour-vision deficiency and in greyscale.
- Modifiers unlock through **per-protocol mastery rank** (Chromatic at 3, Resonant at 5), giving the
  mastery system something to pay out and the currency-free economy a real progression hook. Locked
  modifiers are shown with the unlock requirement rather than hidden, and can never be applied to a
  run even if selected.
- Modified runs post to their own leaderboards — a ×1.8 score on the standard board would make the
  standard board unwinnable without the modifier.
- Keyboard players arm a channel with 1–3, so a modified run is fully playable without a pointer.
- 2-Back is excluded: layering a second channel onto a running 2-back comparison is a materially
  different (and much harder) exercise that deserves its own design pass.

### Added — observability
- **Anonymous telemetry** (`src/telemetry.ts`), replacing the `TODO` in `errorBoundary.ts`. Crash
  rate, WebGL init failures, and run start/end were previously unobservable in the field — "check
  the console" only works for players you can reach. Deliberately constrained: inert unless
  `VITE_TELEMETRY_URL` is set (so forks and local builds send nothing), player-toggleable under
  Settings → Accessibility, and it never sends `player_id`, `owner_secret`, display name, or
  anything the player typed. The install id is separate from the leaderboard identity precisely so
  crash data cannot be joined to a named leaderboard row. Repeated errors collapse after three of
  the same signature, so a render-loop exception can't drown the queue.

### Added — installable and offline
- **PWA manifest, icons, and a service worker.** Now that every asset is same-origin, offline play
  was nearly free. Navigations are network-first with a cached-shell fallback; content-hashed
  `/assets/*`, fonts and icons are cache-first (the hash is the version, so a hit can't be stale).
  Cross-origin requests are never intercepted — a cached leaderboard would be worse than none, and
  score submissions must not be replayed from cache. Verified booting fully offline.
- Icons are rendered from the existing favicon artwork, including a maskable variant inset for
  Android's circular crop, plus an Apple touch icon and the iOS-specific meta tags (iOS ignores the
  manifest's display mode).

### Changed — Forge
- **The Forge is now "pick a designed base, rotate its hue"** instead of five independent RGB
  sliders across five colour roles. The old control let a player reach thousands of states that
  looked nothing like the game, and guarded exactly one pair (base vs background) for contrast.
  Eight hand-tuned bases ship; a uniform hue rotation preserves the hue *distances* between active,
  correct and wrong, so no reachable palette can make them collide. The contrast check now covers
  every pair that matters for play, not just one.
- The Forge remembers the controls that produced a slot (`customPaletteMeta`, schema v13), so
  reopening it restores the base and rotation rather than showing defaults over colours the player
  can no longer edit coherently. Pre-existing hand-mixed palettes are left untouched and keep working.

### Added — accessibility
- **Settings → Accessibility**, a new tab. Colour-vision palettes moved out of the Forge, because
  burying access support inside a cosmetic screen puts it where the players who need it are least
  likely to look. Adds tritanopia alongside deuteranopia and protanopia — the first two get a
  blue/orange success axis, tritanopia gets red/cyan, since blue/orange is exactly what it cannot
  separate. The setting is re-applied at startup, not only when Settings is opened.
- **The board is playable with the keyboard** (`src/keyboard.ts`). It was a WebGL canvas marked
  aria-hidden, so the game was unplayable without a pointer and opaque to assistive tech. Arrow
  keys/WASD move a cursor, Enter/Space selects, and activation routes through the same
  `handleInteraction()` the pointer uses, so protocol rules can't drift between input methods.
- **Screen-reader announcements** for tile positions, pattern flashes, decoys and phase changes via
  an aria-live region — the pattern a player has to memorise was previously conveyed only in colour.
- A keyboard controls reference in Settings → Accessibility.

### Added — content and progression
- **2-Back honours all three pacings.** It previously overrode pacing entirely: "2-Back + Zen"
  advertised "No timer. Streak-based." and then ended the run on the first mistake, and
  "2-Back + Sprint" could not even be selected — the menu bounced it back to Classic. Zen now
  restarts the stream on a mistake with level walk-back, Sprint runs the 60s clock with a −3s
  penalty, Classic keeps permadeath. The stress bar is hidden for Classic/Zen 2-Back, where it
  previously sat full and motionless because nothing drove it. 2-Back also rejoins the daily
  rotation. This turns "5 protocols × 3 pacings" from a claim into a fact.
- **Per-protocol mastery ranks** (`src/progression.ts`, schema v12). Each protocol carries its own
  rank I–X earned through cumulative mastery points, so there is always a next rank on something
  after the economy tops out. The results screen shows points earned and progress to the next rank;
  Stats shows all five protocols with progress bars and a sparkline of recent scores, normalised
  per protocol so a Sprint curve and a Zen curve are both readable. Purely additive: it records
  what happened and derives a rank, it does not gate content or change run scoring.

### Added — moderation
- **Server-side display-name moderation** (`supabase/schema.sql`). The client blocklist ships in the
  bundle and can be edited out, so the authoritative check now runs inside the SECURITY DEFINER
  write path. Includes leet/spacer normalisation (`n1gg3r`, `f.u.c.k`, `Ｆｕｃｋ` all fold), and a
  two-mode blocklist: unambiguous slurs match as substrings, while terms that occur inside ordinary
  words match whole-word only — so Scunthorpe, Assassin, Dickinson and Cockburn are not blocked.
- **Player reports and bans.** `report_player()` RPC (owner-verified, deduped per reporter), a
  `moderation_queue` view ordered by report count, a `banned_players` table whose trigger purges the
  offender's existing rows immediately, and a ⚑ control on every leaderboard row but your own.
- The whole schema was validated against a live PostgreSQL 16 instance, including evasion cases,
  false positives, ban purging, and forged-reporter rejection.

### Changed — performance and delivery
- **Fonts are self-hosted.** The Google Fonts `<link>` was a render-blocking third-party request on
  every launch; the game fell back to system fonts offline and every player hit Google before the
  first frame. The same three families now ship as variable fonts (latin subset) — 105 KB total for
  every weight, from our own origin. Also collapses 13 weight requests into 3 files.
- **Bundle split.** Was one 805 KB / 205.8 KB gzip chunk. Now: game code 24.0 KB gzip, Three.js
  128.9 KB gzip (own chunk — needed at first paint since it renders the menu background, so this
  buys cache lifetime across deploys rather than TTI), and Supabase 55.3 KB gzip **fully deferred**
  until the first leaderboard read or write. Launch payload is 150.8 KB gzip, down 27%.

### Fixed
- **Modals could not be scrolled.** `.modal-screen` centred its content with no overflow handling,
  so any modal taller than the viewport was clipped at both ends with no way to reach either — on a
  short screen the Close button on Stats or Results was simply unreachable. Now scrolls, still
  centred when it fits, with safe-area padding.
- **Tutorial timer demo could appear hung.** Step 5 drained the bar with 61 chained `setTimeout`s;
  under CPU contention those stretch badly and a 3s animation could take 15s+. Replaced with a
  single CSS transition — smoother and one timer instead of 61.
- **Zen level-down could shrink the pattern below the floor** while the grid kept growing, making
  later levels easier than earlier ones.

### Fixed — run lifecycle
- **Run clock billed the player for time no frame rendered**: `runTimer()` subtracted the raw
  `requestAnimationFrame` inter-frame delta. rAF timestamps track wall-clock even across gaps where
  no frame fires (a backgrounded tab, a sleeping device, main-thread jank), so the first frame after
  a gap charged the entire gap to the run. Measured: a 3,088 ms stall drained 3,150 ms of clock;
  after clamping the per-frame delta to 100 ms, the same stall costs 167 ms.
- **Backgrounding no longer abandons a live run**: `visibilitychange` previously stopped only the
  renderer, so Observe flashes and the n-Back stream played out unwatched and timed modes kept
  burning clock. It now calls the new shared `pauseGame()`, which the pause button also uses.
- **Abandoned runs kept driving the game**: introduced a monotonic run token (`state.runId` /
  `endRun()`). Every async gameplay step captures it and bails when it no longer matches. Aborting
  a 2-Back run used to leave the stream advancing in the background; it would hit a missed match and
  throw a game-over results screen over the main menu ~9 s after the player quit. The same class of
  bug affected level transitions racing a sprint timer expiry.
- **Pausing mid-Observe soft-locked the round**: the flash sequence returned early on pause with no
  path back into Execute. It now waits out the pause instead of abandoning the level. The n-Back
  flash window likewise no longer counts paused time against the player's reaction window.

### Fixed — settings that did nothing
- **SFX toggle**: persisted to the profile and updated its own label, but `playTone()` never read it.
  Turning SFX off changed nothing.
- **Master volume**: applied per-case inside `playTone()`, and roughly half the cases (hover, decoy,
  tick, buy, levelDown, and the second layer of every stacked cue) never applied it — dragging the
  slider to 0 left those audible. All SFX now route through a single `sfxBus` gain node.

### Fixed — leaderboard and results
- **Network failure reported as an empty board**: `fetchBoard()` swallowed errors and returned `[]`,
  rendering an unreachable backend as "No scores yet — you might be first." It now throws, and the
  panel distinguishes "empty" from "couldn't load".
- **No timeout on leaderboard round-trips**: a hung connection left the panel on its loading skeleton
  indefinitely. Reads and writes now abort after 6 s.
- **Blank panel during score submission**: the leaderboard didn't begin rendering until the submit
  round-trip finished. The skeleton now paints immediately.
- **Streak milestones were unreachable**: the results screen built its streak result with
  `isNewRecord`/`isMilestone` hardcoded to `false`, so the milestone title and new-record colour
  could never fire — a 7-day streak looked identical to a 6-day one. `recordDailyCompletion()` now
  returns the real result.
- **Tutorial never reached its own ending**: `showResultsScreen()`'s onboarding path, the
  `#enter-signal-btn` element and its listener were all built but unreachable, because finishing the
  tutorial returned straight to the menu. Completing it now lands on the results screen as designed.

### Fixed — other
- **Save wipe on a profile missing `settings`**: the v8→v9 migration read `raw.settings.volume`
  unguarded; the throw was caught by `load()`, which resets the profile — so a missing sub-object
  silently erased progress instead of being backfilled.
- **GPU resource leaks**: `createBoard()` reallocated cube and edge geometry on every call (level-up,
  every Zen/Sprint mistake, every menu return) and never disposed the old materials; `spawnParticles()`
  allocated a fresh material per burst, never disposed. Geometry is now shared, materials are disposed
  on rebuild, and particle materials are cached per colour.
- **Daily challenge was keyboard-inaccessible**: the row carries `role="button" tabindex="0"` but a
  div gets no Enter/Space activation for free. Added the keyboard handler that makes that ARIA
  promise true.
- **Splash re-showed for players who skipped the tutorial**: keyed on `hasCompletedOnboarding`; now
  keyed on `hasSeenOnboarding`.

### Removed
- `src/ui/onboarding.ts` — never imported by anything.
- `recordStreakForToday()` in `save.ts` — a second, unused streak implementation using the any-run
  semantics that v8 deliberately replaced with daily-only streaks.
- `updateHapticsToggleText()` in `ui/hud.ts` — read the profile off a `window.__signalProfile` global
  nothing ever assigned, so it always rendered "Haptics: On".
- Stray root-level copies of `board.ts` / `loop.ts` / `modals.ts` / `scene.ts`, superseded by `src/`.
- `.env` is no longer tracked by git (it was committed despite being in `.gitignore`).

### Fixed
- **Onboarding skip flag**: `hasSeenOnboarding` and `hasCompletedOnboarding` are now persisted to
  localStorage at the very start of the skip-button handler, before `returnToMenu()` re-reads the
  profile. Added a `hasSeenOnboarding` guard in `startOnboardingRound()` to prevent double-entry.
- **Score submit timing**: confirmed `submitScore()` fires only after `await promptDisplayName()`
  resolves, so the display name is always saved before the leaderboard entry is created.
- **iOS safe-area insets**: on iOS devices the viewport meta gains `viewport-fit=cover` at runtime
  and `env(safe-area-inset-top/bottom)` values are read once and stored as `--sat`/`--sab` CSS
  custom properties. `.header` and `#menu-sheet` reference these via `calc()`. Non-iOS / headless
  environments are unaffected (no DOM overhead, CSS fallback is `0px`).
- **Hint text wrapping**: protocol and pacing hint strings shortened to fit narrow screens without
  wrapping; `#hint-message` gained `max-width: 320px` and auto side margins.
- **Test reliability**: removed auto-start of menu ambient from `initAudio()`. The ambient now
  starts exclusively from `returnToMenu()`, eliminating CPU contention between Web Audio oscillators
  and the SwiftShader software WebGL renderer that was causing `setTimeout` delays to stretch past
  Playwright's 8 s assertion windows. All 17 tests now pass reliably.
- **Defensive opacity**: `initGame()` now explicitly resets `#ui-layer` opacity to `1`, matching
  the same guard already present in `startOnboardingRound()`.



### Changed — Menu redesign
- **Bottom sheet menu**: replaced the centre-display overlay with a sliding
  bottom sheet. The 3D board is now visible and interactive behind the menu at
  all times. Sheet hides during gameplay and reappears on return to menu.
- **Protocol / Pacing / Streak** displayed as three equal columns in the sheet
  header — bare name only (no "Protocol:" / "Pace:" prefix).
- **Hint text** updated to two centred lines (protocol hint + pacing hint) using
  `<br>` rather than the single compressed `·`-joined string.
- **Streak column** in mode row: shows `N days ◆` in combo colour when streak ≥ 1,
  dash in muted colour otherwise.
- **Daily row**: replaced button with a full-width clickable div; shows
  "available now" vs "complete · returns tomorrow" state without disabling
  interaction.
- **Currency balance** moved to top-right header, visible during menu only
  (gameplay shows the stats bar instead).
- **Label renames**: "Operator Log" → "Stats", "Exchange" → "Shop",
  "Calibrate Signal" → "Style", "Signal Balance:" → "Balance:",
  "Name Your Signal" → "Choose a Name". Subtext on name modal simplified
  (removed "Choose carefully — it can't be changed.").
- **Mistake reason strings** simplified: "INVALID NODE" / "FALSE POSITIVE" →
  "WRONG TILE"; "MISSED TARGET" → "MISSED"; "RHYTHM DE-SYNC" → "OFF RHYTHM";
  "RUN FAILED" → "RUN ENDED".

### Fixed
- **Skip button z-index** in onboarding overlay was `z-index:2` — below the
  sheet's `z-index:200` backdrop — so the button was invisible on mobile.
  Fixed to `z-index:210`; `#ob-card` set to `z-index:201`.
- **Orientation-change zoom drift** (`onWindowResize`): `camera.zoom` is now
  reset to `1` before `updateProjectionMatrix()` so a pinch-zoom from one
  orientation doesn't carry a stale multiplier into the other.
- **Tutorial audio**: `initAudio()` is now called at the start of
  `startOnboarding()` (while the user-gesture call stack is live) and
  `playTone('active')` fires on each tile flash during both observe sequences.
- **iOS haptics button**: hidden entirely instead of showing "Unsupported" —
  detected via `navigator.userAgent` for iPhone/iPad/iPod.
- **Forge BG slot live preview**: when `selectedSlot === 'bg'`, the slider
  now also updates `--bg` on `:root` immediately so the page background
  transitions live while dragging.

### Fixed
- **Daily leaderboard mode key** was `"daily"` (a single shared bucket for all
  dates); changed to `"daily_YYYY-MM-DD"` so each day's daily challenge has its
  own isolated leaderboard. Standard mode keys changed from `"mode:spatial:classic"`
  (colon-separated with `"mode:"` prefix) to `"spatial_classic"` (underscore, no
  prefix) to match the title-formatter's expectations.
- **Leaderboard title** now shows human-readable text: `"DAILY · JUN 22"` for daily
  runs and `"SPATIAL · CLASSIC"` for standard runs. Previously used a broken
  colon-split fallback. Date parsing uses `T00:00:00` suffix to force local-time
  interpretation and avoid off-by-one in negative-UTC-offset timezones.

### Added
- **Streak & habit loop** (schema v5):
  - `currentStreak`, `longestStreak`, `lastRunDate` added to `SavedProfile`; v4→v5
    migration sets all three to zero/null so existing players start a fresh streak
    from today without losing any other data.
  - `recordStreakForToday()` in `save.ts` — idempotent (safe to call multiple times
    in one day), handles first run, continuation, and gap-day reset. Returns
    `StreakResult` with `isNewRecord` and `isMilestone` flags.
  - Milestone titles: on days 3, 7, 14, 30, 60, 100 the results-screen `#end-title`
    is overridden to `"N-DAY STREAK"` in `var(--combo)` gold.
  - `#streak-line` in the results screen shows `"N-day streak"` (hidden on day 1);
    turns `var(--correct)` green when a new personal best is set.
  - `#daily-nudge` below the leaderboard panel: tells the player whether the Daily
    Calibration is still available or already done, always visible after a run.
  - Streak badge in the stats bar (`N🔥`) when `currentStreak ≥ 2`.
  - Operator Log modal shows two new stat boxes: Current Streak and Best Streak.
  - Two new smoke tests: streak increments from yesterday's run; streak resets after
    a gap day while preserving `longestStreak`. Tests use `__signal.getCubeScreenPos`
    to click a guaranteed-wrong tile (deterministic game-over, no timer dependency).
- **Leaderboard UI** (wired end-to-end on the results screen):
  - First-run display name prompt: `#display-name-modal` appears after the first game
    ends. Player enters a callsign (1–20 chars); Skip skips the name and suppresses
    score submission. Name is stored in `profile.display_name` and never prompted again.
  - Score auto-submitted to Supabase via `submitScore()` (fire-and-forget) after each
    run, but only when a display name has been set.
  - Leaderboard panel (`#leaderboard-panel`) rendered inside the results screen below
    the SIGNAL payout. Shows skeleton rows immediately, fills with live board data once
    the fetch resolves. Handles network failures silently (shows error text, never crashes).
  - Player's own row highlighted in `var(--active)` with a left-border accent.
  - Board key is mode-specific (`mode:spatial:classic`) or `daily:YYYY-MM-DD` for the
    daily calibration run.
  - Skeleton animation respects `isReducedMotion()` — static bars when reduced motion
    is on.
  - `window.__signal.leaderboard` debug shim removed now that the UI is wired.
  - `LeaderboardRow` interface added to `types.ts`; `fetchBoard()` updated to select
    `created_at` and expose it as `achieved_at`.
- **Leaderboard data layer** (backend plumbing, no UI yet):
  - `@supabase/supabase-js` installed; lazy `getClient()` in `src/lib/supabase.ts` —
    throws a clear error only when actually called, so the game runs fine without env vars.
  - `supabase/schema.sql`: `leaderboard_scores` table with RLS, public SELECT policy,
    post-May-2026 Data API grants, and a `submit_score` SECURITY DEFINER function that
    validates inputs and upserts only when the new score beats the stored one.
  - `src/game/leaderboard.ts`: `modeBoardKey()`, `dailyBoardKey()`, `submitScore()`,
    `fetchBoard()`, `setDisplayName()`. All network calls are wrapped in try/catch —
    leaderboard failures never crash the game.
  - Client-side profanity filter in `submitScore` (normalised string match); comment
    notes that the DB function is the authoritative place for stronger moderation.
  - `SCHEMA_VERSION` bumped to 4; `player_id` (stable UUID) and `display_name` added to
    `SavedProfile`; v3→v4 migration in `save.ts` generates a UUID for existing players.
  - `src/vite-env.d.ts` added to type `import.meta.env.VITE_SUPABASE_URL/ANON_KEY`.
  - `.env.example` added; `.gitignore` already covered `.env`.
  - `window.__signal.leaderboard` exposes `{submitScore, fetchBoard, modeBoardKey,
    dailyBoardKey, setDisplayName}` **temporarily** for console testing — to be removed
    once the leaderboard UI is built.

### Changed
- **Onboarding four-fix pass** (Phase 3c): four confirmed issues from real fresh-launch
  playtesting, all fixed in one pass:
  1. **Trigger point**: tutorial no longer fires on page load as a blocking interstitial.
     It now fires on the player's first Engage press — `start-btn` in `menu.ts` checks
     `hasSeenOnboarding` and routes to `startOnboarding()` or `initGame()` accordingly.
     The player has already made an active choice to play before being guided.
  2. **Wrong tile in Step 4** fully redesigned: wrong tap → briefly show the red-tile
     highlight (same visual as a real mistake, already provided by `handleMistake`) →
     display callout "That tile wasn't in the pattern. In a real run this ends your
     streak — here, try again." → reset board and re-flash the same pattern → let the
     player retry. After 2 failed attempts the correct tiles are revealed for 2.5 s
     and the tutorial auto-advances with "No problem — you'll get it in a real run."
     `onMistake` hook fully intercepts before any pacing logic so `gameOver`, camera
     shake, and `returnToMenu` never fire during the tutorial under any circumstance.
  3. **Skip button always visible**: was rendered below `#ob-card` in the DOM stacking
     order; added `z-index:2` to the skip button and `z-index:1` to `#ob-card` so the
     button is always reachable regardless of which card is displayed.
  4. **Step 4 routing to main menu**: root cause was #2 — the old single-shot `onMistake`
     resolved `roundEndP` immediately, fast-pathing through steps 5 and 6 to `finish()`
     which calls `returnToMenu()`. The retry loop eliminates this path: wrong taps now
     stay in Step 4 until success or the attempt ceiling is reached.
- **Onboarding redesign** (Phase 3b): replaced the hook-driven live-game tutorial
  with a fully script-driven, step-by-step flow. The board is now frozen and
  controlled at each beat — no live game timer runs underneath the tutorial.
  Six steps: Intro card → matrix introduction → controlled Observe flash (tiles
  flash at 600ms/400ms cadence) → live Execute with no timer (first tile tap
  dismisses the callout) → timer explanation with a visual stress-bar demo →
  final card. Both Skip and "Start Training" land on Standby via `returnToMenu()`.
  Fixes three playtesting issues: (1) the original flow was too passive and
  competed with live gameplay; (2) letting the timer expire during the final card
  triggered an immediate game-over; (3) skipping left the player on the main menu
  instead of Standby.
- `runLoop.ts`: added `onMistake` hook to `ObHooks` — fires at the start of
  `handleMistake` before any pacing logic, preventing camera shake / results
  screen / game-over during the tutorial. `levelComplete` now returns immediately
  after firing `onRoundEnd` when a tutorial hook was registered, preventing
  `startLevel()` from running underneath the tutorial UI.

### Removed
- **Chromatic protocol** cut after playtesting revealed it couldn't hold up
  under real use conditions. Two rounds of fixes (color contrast recompute in
  Oklch/CIELAB with CVD simulation; redundant shape cues per swatch) addressed
  individual symptoms but didn't fix the underlying issue: the colour-recall
  mechanic is hard to make accessible and legible at the same time. The board
  rotates freely during Execute, which means shape cues printed on flat swatches
  don't map cleanly to rotated 3D tiles, breaking the shape-as-fallback guarantee.
  Colour contrast was also only barely adequate (floor 5.5:1) without obvious
  headroom to improve further without sacrificing visual differentiation. Protocol
  removed cleanly: `CHROMATIC_COLORS` and `id: 'chromatic'` from `protocols.ts`,
  all picker/color-assignment logic from `runLoop.ts`, `setChromaticObserveColor`
  from `board.ts`, `chromaticColors`/`chromaticPending` from `state.ts`, and the
  `#chromatic-picker` DOM node from `index.html`. Custom Calibration is unaffected.

---

## [0.4.0] — 2026-06-20

### Added
- **Chromatic protocol** (Phase 2b): new cognitive protocol where each target tile
  lights up in one of N distinct colors during Observe, and the player must recall both
  position AND color during Execute. Tap a tile → color picker appears → tap the matching
  swatch. Wrong tile or wrong color = mistake via the existing `handleMistake()` path.
- **Fixed color set for Chromatic** (`CHROMATIC_COLORS` in `protocols.ts`): 5 colors
  (Amber, Cyan, Violet, Gold, Jade) chosen for maximum perceptual distinctiveness and
  CVD-safety (no pure red/green axis). 3 colors in play at level 1, scaling to 4 at
  level 4 and 5 at level 7. Explicitly does not use the player's Custom Calibration
  palette — the challenge must be color memory, not fighting a lucky/unlucky custom accent.
- **`setChromaticObserveColor()`** in `board.ts`: sets cube emissive to an arbitrary
  hex color, bypassing the theme-color lookup used by `setCubeState`. Needed so
  Chromatic observe tiles render in their fixed puzzle colors.
- **Interaction pattern rationale documented**: implemented tap-tile-then-color (Pattern A)
  over pre-select-color-then-tap (Pattern B). Pattern A keeps the tile-first interaction
  identical to every other protocol; the color picker is a confirmation step. Pattern B
  breaks the spatial-first mental model and creates awkward hand movement on mobile
  (reach to bottom for color strip, back up to board for tile). Pattern A is also easier
  to teach: "tap the tile, then pick its color."

### Changed
- Forge Reset button sits alongside the two colorblind preset buttons (same visual
  treatment, muted styling). Restores all 5 slots to Mono theme values.

---

## [0.3.0] — 2026-06-20

### Added
- **Full custom palette in Forge** (Phase 2.1 / Custom Calibration): the Forge now
  exposes all five color slots — Base (idle cube), Active (flash), Correct, Wrong, and
  Background — instead of a single accent color. Each slot has its own RGB sliders;
  clicking a slot tab loads its current values.
- **Colorblind-safe presets**: two one-tap starting points — Deuteranopia (blue/orange,
  replaces the red/green axis) and Protanopia (high-contrast blue/orange variant) —
  which the player can then further customize. Both are selectable from the Forge modal.
- **Contrast validation**: if Base and Background colors are too similar (relative
  luminance contrast ratio below 2:1 per WCAG formula), a warning is shown in the Forge
  before the player saves. Saving is not blocked — the warning is informational.
- **`CustomPalette` interface** in `types.ts` enforces the five-slot shape at compile time.
- **CLAUDE.md** project guidance file for future Claude Code sessions.

### Changed
- **Save schema bumped to v2**: existing saves migrate automatically — `customHex` is
  preserved and used as the `active` slot of the new palette; remaining slots backfill
  from Mono defaults.
- **`Theme` interface** gains `baseHex: string` so the Forge can read and write the
  cube base color without parsing the integer form.
- **Custom calibration is always free** (unlocked by default). Documented in code:
  it's an accessibility tool as much as a cosmetic one; contrast-gating it would
  undermine colorblind-preset support.

---

## [0.2.0] — 2026-06-19

### Added
- **Error boundary**: `window.onerror` and `unhandledrejection` handlers log structured
  errors to console with a TODO hook for a future telemetry endpoint.
- **WebGL availability check**: if WebGL is unavailable or disabled, `initScene` now
  throws a typed error caught in `main.ts`, which renders a readable "cannot initialize"
  overlay instead of a white screen.
- **Reduced-motion mode**: respects `prefers-reduced-motion: reduce` OS/browser setting
  on load, and stays in sync if the user changes it mid-session. An explicit in-game
  toggle (Motion: Full / Reduced) is exposed in the Operator Log modal. When active,
  camera drift, grid scroll, and camera shake are all disabled; cube animations are
  preserved as they are the primary game-feedback signal.
- **`bloomResScale()`**: bloom render resolution now scales with detected device tier
  (hardware concurrency + pixel ratio) — low-end gets 1/4 screen, mid gets 1/3, high
  keeps the original 1/2. Exported so `onWindowResize` stays consistent on resize.

### Fixed
- **Pause/resume timer desync** (real bug, found in Classic and Sprint pacing): calling
  `stopTimer()` on pause set `state.timerActive = false`, so the resume handler's
  `if (state.timerActive)` guard was always false — the run timer never restarted after
  any pause. Fixed by capturing `wasTimerActiveBeforePause` before `stopTimer()` and
  using that flag on resume to restore both `timerActive` and the rAF chain.
- **Missing `initAudio()` on primary entry points** (real bug, silent on first load):
  the Engage button, Daily Calibration button, and Pause button all bypassed
  `initAudio()`, meaning the `AudioContext` was never created on the most common game
  entry paths. Sound never started unless the user happened to click Protocol or Pace
  first.
- **Concurrent `cameraShake` calls corrupting camera position** (real bug, reproducible
  in Sprint mode where `handleMistake` and `gameOver` can both trigger shakes in rapid
  succession): two independent `requestAnimationFrame` tick closures both writing to
  `camera.position` with different `restX/Y/Z` origins produced erratic, oscillating
  camera movement. Fixed with a `shakeGeneration` counter — the older tick exits
  immediately when a newer shake starts.
- **Hitstop freeze persisting through pause/resume**: if a correct tap's brief
  freeze-frame (`hitstopEndTime`) was in progress at the moment of pause, resuming left
  the render loop appearing stuck until the hitstop timer naturally elapsed (up to
  ~100ms). Fixed by clearing `loopState.hitstopEndTime = 0` on resume.

### Changed
- **Modularized from single-file HTML to Vite + TypeScript** (Phase 0): `signal.html`
  split into 14 typed modules under `src/`. `tsconfig.json` uses `strict: true`.
  `CubeUserData` interface enforces the shape of `THREE.Mesh.userData` at compile time,
  catching the class of shape-mismatch bug that previously required a real device to surface.
- **Playwright smoke suite added**: 9 tests covering load, countdown, level increment
  via real pointer events, pause/resume, background/foreground-while-paused regression,
  abort run, store, profile, and daily calibration.

---

## [0.1.0] — prototype

Initial single-file prototype (`signal.html`). Feature-complete for v1 scope:
5 cognitive protocols × 3 pacing modes, combo system, Signal currency + calibration
store, custom Forge, daily challenge, versioned save system, bloom post-processing,
fresnel rim lighting, deltaTime-corrected render loop.
