# SIGNAL — launch pack

Store copy, data-disclosure answers, screenshots and the go-live sequence.
Engineering setup lives in [README.md](./README.md).

---

## 1. The copy rule that governs everything here

**Describe what the game is. Never promise what it does to the player.**

"Sharpen your working memory", "improve your focus", "boost cognition" and
"scientifically proven to…" are implied cognitive-benefit claims. Apple and Google both
scrutinise them, and an app that cannot substantiate them gets rejected or pulled. This is
the same reason the shop's audio layers were renamed from "40 Hz gamma-band entrainment"
to Pulse Layer, and why the page metadata was rewritten before launch.

Safe: naming the task ("a 2-back task"), citing what a task *is* ("the Corsi block-tapping
test, used in neuropsychology since 1972"), describing the game.
Not safe: any sentence where the player's brain is the object of a verb.

If in doubt, describe the screen, not the outcome.

---

## 2. Store listing copy

### Name
`SIGNAL — Cognitive Calibration Engine`
Short/icon name: `SIGNAL`

### Subtitle (30 chars, Apple)
`Memory, rendered in 3D`

Alternatives: `Watch. Remember. Repeat.` · `Five protocols. One mistake.`

### Short description (80 chars, Google Play)
`A 3D memory game. Watch the pattern, play it back. One mistake ends the run.`

### Full description

```
Watch the pattern. Play it back. One mistake ends the run.

SIGNAL is a memory game built as a real 3D board — bloom lighting, rim-lit tiles,
combo juice and haptics — instead of the flat grid of coloured squares this genre
usually settles for.

FIVE PROTOCOLS
Each one asks for something different.
· Spatial — reproduce the lit tiles, any order
· Sequential — reproduce them in the exact order shown
· Interference — decoys flash alongside the real pattern
· Rhythm — the timing between flashes is part of the pattern
· 2-Back — a running comparison: does this tile match the one two steps back?

THREE PACINGS
· Classic — a timer, and permadeath
· Zen — no clock, no pressure, streak-based
· Sprint — 60 seconds, as far as you can get

TWO MODIFIERS
Applied on top of a protocol, not bolted on beside it.
· Chromatic — tiles flash in one of three channels; reproduce colour as well as
  position. Each channel carries its own tone, so it plays without colour vision.
· Resonant — nothing is shown at all. Position comes from the stereo field,
  colour from pitch. Played entirely by ear.

DAILY CALIBRATION
One date-seeded run per day, the same for everyone, with its own leaderboard and a
streak that only the daily can extend.

LEADERBOARDS
Per protocol, per pacing, and per day. Modified runs get their own boards, so a
score multiplier never distorts the standard ones.

MAKE IT YOURS
Eight designed palettes and a full hue rotation, free. Earn Signal by playing and
spend it on board materials — surface, glow, transparency, wireframe.

BUILT TO BE PLAYABLE
· Full keyboard control, and the board is announced to screen readers
· Colour-vision palettes that avoid the red/green axis
· A reduced-motion mode that respects your system setting
· Works offline once loaded, and installs to your home screen

No accounts. No ads. No energy timers, no paid retries. Every protocol, pacing,
modifier, the daily and the leaderboards are free, permanently.
```

### Keywords (Apple, 100 chars, comma-separated, no spaces)
```
memory,pattern,recall,brain,puzzle,sequence,daily,leaderboard,3d,nback,spatial,rhythm,focus
```

### Category
Primary: **Games → Puzzle**. Secondary: **Education**.
Prefer Puzzle over "Medical" or "Health & Fitness" — those categories invite exactly the
substantiation scrutiny §1 is about.

### What's New (1.0.0)
```
First release.
Five protocols, three pacings, two modifiers, a daily challenge and shared
leaderboards. Plays offline, installs to your home screen, and is fully
playable with a keyboard.
```

---

## 3. Age rating

Expect **4+ / PEGI 3 / ESRB Everyone**, with one qualifier: the game has
**user-generated content** (public leaderboard callsigns), which raises the rating on some
questionnaires and requires you to declare moderation.

You have the moderation answers, and they are real:

| Question | Answer |
| --- | --- |
| Can users interact / share content? | Yes — a public display name on a leaderboard. Nothing else; no chat, no messaging, no images. |
| Is there a filter? | Yes — a server-side blocklist with substring and word-boundary matching, in `SECURITY DEFINER` functions the client cannot bypass. |
| Can users report content? | Yes — a report control on every leaderboard row, feeding a moderation queue. |
| Can you ban a user? | Yes — a ban removes their rows immediately via trigger and survives a data-deletion request. |
| Does it share location? | No. |
| Ads? | None. |

---

## 4. Data disclosure (Apple App Privacy / Google Data Safety)

Answers below are what the code actually does — see `public/privacy.html` and §Privacy in
the README. Answer for the build you ship: if `VITE_TELEMETRY_URL` is unset, the
diagnostics row is "not collected".

| Data type | Collected | Linked to identity | Used for tracking | Notes |
| --- | --- | --- | --- | --- |
| Name, email, phone, address | No | — | — | No accounts exist |
| User ID | No | — | — | The leaderboard ID is a random per-device UUID, not an account |
| Contacts, photos, files, location | No | — | — | Never requested |
| Purchase history | No | — | — | Entitlement is a local flag; no receipts stored by us |
| **User content** — display name | **Yes** | No | No | Public on the leaderboard. Player-chosen, not a real name. |
| **Gameplay content** — score, level, board | **Yes** | No | No | Only when a score is posted |
| **Diagnostics** — crash data | Only if configured | No | No | Anonymous; separate random install ID |
| **Identifiers** — advertising ID | No | — | — | No ad SDKs |

Key declarations that follow from the above:

- **Not used for tracking.** No third-party SDKs, no ad networks, no cross-app or
  cross-site identifiers, no cookies.
- **Not linked to identity.** Both IDs are random and unconnected to any personal detail,
  and the telemetry install ID is deliberately *different* from the leaderboard player ID
  so crash data cannot be joined to a named row.
- **Data deletion:** required by both stores, and available in-app —
  Settings → Data → Delete my leaderboard data. Give the privacy policy URL as the
  deletion-request page; it documents both the in-app route and the email route.
- **Encrypted in transit:** yes, HTTPS.

Privacy policy URL: `https://YOURDOMAIN.com/privacy.html`

---

## 5. Screenshots

```bash
npm run dev
# in another shell:
SHOT_PACING=zen node scripts/screenshots.mjs
```

Writes `screenshots/{desktop,phone,tablet}/01-menu … 07-boards.png`. Output is gitignored —
the script is the source of truth, so regenerate rather than committing stale art.

Sizes captured: desktop 1280×800 @2x (press/web), phone 390×844 @3x (Apple 6.5"/6.7"
ratio), tablet 834×1112 @2x (iPad 10.5").

Two things to get right before treating these as final art:

1. **Run against a server with Supabase configured.** Otherwise the results screen captures
   the honest but unflattering "Could not reach the leaderboard" state, and `07-boards`
   comes out empty.
2. **Use `SHOT_PACING=zen`.** Scripted clicking is slower than a human, so a Classic run
   can hit its per-level timer mid-capture and end on TIME EXPIRED. Zen has no clock. The
   trade-off: Zen's HUD shows a streak where Classic shows points.

Suggested order for a store listing — lead with the board, not a menu:
`02-gameplay`, `03-results`, `07-boards`, `05-forge`, `04-stats`, `01-menu`.

---

## 6. Go-live sequence

**Before the first deploy**

- [ ] Replace `YOURDOMAIN.com`, `[OPERATOR NAME]` and the "Last updated" date in
      `public/privacy.html`
- [ ] Replace `[OPERATOR NAME]` in `LICENSE`
- [ ] Create the `privacy@` mailbox and send a test message to it
- [ ] Apply `supabase/schema.sql` to the production project
- [ ] Verify erasure on a scratch database with `supabase/verify_delete.sql`
- [ ] Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` on the host
- [ ] Decide on telemetry — leaving `VITE_TELEMETRY_URL` unset ships with none, and lets
      you answer "not collected" on both stores' diagnostics questions

**Deploy**

- [ ] `npx tsc --noEmit && npm test` — expect 77 passing (63 chromium + cross-browser subset)
- [ ] Deploy, then confirm `dist/assets/supabase-*.js` is ~213 kB and **not** 1 byte
      (a 1-byte chunk means the env vars were missing and leaderboards cannot work)
- [ ] Narrow `connect-src` in `vercel.json` to your Supabase origin, and redeploy

**Smoke-test the deployment**

- [ ] Post a score, then confirm it appears on the board from a second device
- [ ] Rename your callsign and confirm it changes on boards you already appear on
- [ ] Delete your leaderboard data and confirm the row disappears
- [ ] Load once, go offline, reload — the game should still boot
- [ ] Check `/privacy.html` renders and has no `YOURDOMAIN` left in it
- [ ] Install to a home screen and confirm it launches without browser chrome

**After launch**

- [ ] Watch the moderation queue (`select * from moderation_queue`) for the first few days
- [ ] Watch `select * from suspicious_scores;` — submit_score rejects the impossible, but
      only a human can judge the merely improbable
- [ ] Schedule `purge_rate_limits()` (hourly) if you enable pg_cron, or run it occasionally
      from the SQL editor so spent rate-limit buckets don't accumulate
- [ ] Keep an eye on whether the daily's protocol rotation lands on 2-Back too often for
      new players — it is the hardest protocol and the daily is many players' first run
