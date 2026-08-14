# Releasing SIGNAL on itch.io

itch.io runs HTML5 games natively in the browser — no wrapper, no entity, no
seller name, no fee for a free game. It is the closest thing to "the web build,
but with a store page," and a far better first storefront than the App Store for
exactly that reason.

The build tooling already exists and is CI-certified (`npm run build:itch`).
One decision and one verification are yours.

---

## What the itch build does differently, and why

itch serves an uploaded game from an arbitrary subpath on
`html-classic.itch.zone`, not from a domain root. Three things follow, all
handled by `build:itch` (`SIGNAL_ITCH_BUILD=1 … && node
scripts/prepare-itch-build.mjs`):

- **Relative asset base.** Vite's default `/assets/…` would resolve to the
  itch.zone root and 404 into a blank screen. The itch build emits `./assets/…`,
  and the post-build pass normalizes any remaining root-absolute `href`/`src`/
  `url()` references (fonts, favicon, policy links) the same way — while leaving
  `https://` URLs untouched.
- **PWA manifest stripped.** The manifest is root-scoped for `signalcc.app`;
  advertising it from an itch subdirectory would offer a broken "install"
  target. The itch copy omits it. The game itself is unaffected.
- **Service worker compiled out.** Its `/sw.js` path resolves to the itch.zone
  root and its scope is meaningless inside itch's frame, so it was pure 404
  noise. Gated off via `VITE_ITCH_BUILD`.

None of this touches the Vercel build — it is a separate command, not a mode the
deploy path can take.

---

## Build the upload

1. A local `.env` with the three **public** build vars. All three already ship
   in the production bundle, so none is a secret. Copy them from Vercel →
   Project → Settings → Environment Variables (reveal values):

   ```
   VITE_SUPABASE_URL=https://rzpjciflydbkpxcimdhb.supabase.co
   VITE_SUPABASE_ANON_KEY=<the anon JWT, copy from Vercel>
   VITE_TURNSTILE_SITE_KEY=0x4AAAAAAEGgG-C4JF4KuKjp
   ```

   Do NOT add the service-role key or the Turnstile *secret* — neither belongs in
   a client build, and the service role would bypass every RLS rule if it did.

2. Build and zip. itch wants `index.html` at the **root of the zip**, not inside
   a `dist/` folder:

   ```bash
   npm run build:itch
   cd dist && zip -r ../signal-itch.zip . && cd ..
   ```

---

## Create the project on itch.io

Dashboard → **Create new project**.

- **Title:** SIGNAL
- **Project URL:** `signalcc` (or `signal` if free)
- **Classification:** Games
- **Kind of project:** **HTML** — this is the setting that makes it play in the
  browser rather than being a download. Getting this wrong is the most common
  first mistake.
- **Pricing:** No payments (free), or "Name your own price" with a $0 minimum if
  you want to allow tips. A free game costs itch nothing and you owe no cut.
- **Upload** `signal-itch.zip`, then tick **"This file will be played in the
  browser."**
- **Embed:** set a portrait frame — 480 × 854 is a good phone-shaped default —
  and enable **Fullscreen button** and **Mobile friendly**. Leave "automatically
  start on page load" **off**: itch's click-to-run is the user gesture the audio
  engine needs to start, and skipping it can leave the game silent.

### Page copy — same discipline as everywhere else

- **Tagline:** `Watch the pattern, play it back.`
- **Description:** describe what the game *is*. No "sharpen your memory," no
  "cognitive training," no implied benefit — the same claims Apple, Google, and
  now this store page must not carry. The `<meta name="description">` already in
  the build is a clean starting point.
- **Tags:** memory, puzzle, minimalist, arcade, mobile, singleplayer, leaderboard.
- **Cover image** (630 × 500) and a few screenshots — you will need to make these;
  itch shows the cover everywhere the game is listed. This is the one asset the
  repo cannot produce for you.

---

## The one thing to verify before going public

**Does Turnstile accept itch's frame?** Attestation is enforced server-side, so
if Cloudflare rejects the itch hostname, a new player's score does not post.

Two things make this low-risk now:

1. **It is no longer silent.** If a submission is refused, the results screen
   says so — "Score not posted — this device couldn't be verified. Your progress
   is saved." A tester will tell you in plain words.
2. **itch's frame origin is stable:** `html-classic.itch.zone`, shared by every
   itch HTML5 game. Add it to the Turnstile widget's hostname list up front
   (Cloudflare dashboard → Turnstile → the widget → Settings → Hostname
   Management) and the first test should pass.

Then verify with the same loop as the domain move, using itch's **Draft** or
**Restricted** visibility so the public never sees an unverified build:

1. Save the project as Draft; open its secret page URL.
2. Play one run, enter a callsign, reach the results screen.
3. If the leaderboard shows your entry — publish. (The row landing and a
   `POST | 200` in the `verify-attestation` edge log confirm the whole chain.)
4. If you see the "Score not posted" notice — the hostname is still wrong. The
   edge log carries Cloudflare's error code and the exact hostname it saw; add
   that to the widget and re-test.

Boards are keyed by board, not by origin, so itch players post to the **same**
`spatial_classic` (etc.) boards as `signalcc.app` players — itch play enriches
the shared leaderboard rather than forking it. Their local save is separate
(per-origin localStorage), so every itch player is a new identity, and therefore
every one hits the Turnstile challenge once — which is exactly why the hostname
has to be right.

---

## Fallback: offline-only itch build

If Turnstile genuinely cannot run inside itch's sandboxed iframe, ship itch
without the leaderboard rather than with a broken one:

```bash
SIGNAL_ALLOW_NO_BACKEND=1 npm run build:itch
```

This dead-code-eliminates the Supabase SDK entirely; the game is fully playable
offline, which has been a design property from the start. The one rough edge is
that the results screen's leaderboard panel would show a "couldn't reach"
message — if we take this route, the panel should be hidden when no backend is
configured, a small separate change worth making first.

---

## What itch does NOT need

- No Apple/Google account, no fee, no entity, no seller name.
- No native wrapper — this is the web build, served in a frame.
- No CSP work: the `vercel.json` headers are not applied on itch (itch serves the
  file), and the game runs fine under itch's own headers. A too-strict meta CSP
  could actually block Turnstile's nested frame, so do not add one here.
