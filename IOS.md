# iOS wrapper — scope

Capacitor, targeting the App Store. Written before any of it is built, so the
decisions are visible and the unknowns are named rather than discovered.

## What is gated, and what is not

Gated on the LLC returning to good standing: **Developer Program enrollment,
TestFlight, the store listing.** An individual enrollment publishes the owner's
legal name as the seller, which is the one thing this project has consistently
avoided.

Not gated on anything: **the build itself.** A free Apple ID installs to your own
device for seven days — enough to answer every question below. Do this first. If
the answers are bad you want to know before paying for anything.

---

## The live bug this uncovered

**`navigator.vibrate` does not exist on iOS.** Safari has never implemented the
Vibration API, and WKWebView inherits that. So on every iPhone:

- `haptic()` in `audio.ts` returns at `!navigator.vibrate` and does nothing
- the **Haptics toggle in Settings toggles nothing**
- the page description and store copy say "with bloom lighting and haptics"

That is inaccurate today, on the web, for the majority platform — not a
Capacitor problem. It is only listed here because the wrapper is what fixes it:
`@capacitor/haptics` reaches the Taptic Engine properly, and it is a better
effect than the Vibration API gives on Android anyway.

Two options, and they are not exclusive:

1. Fix the copy now (drop "haptics", or qualify it), since it is a claim that is
   false for most players.
2. Fix the capability in the wrapper, and let the copy become true on iOS.

Doing 2 without 1 leaves the web build still claiming something it cannot do.

---

## Changes the wrapper needs

Four, all small, none architectural. The app is unusually well placed for this —
it already runs offline and stores everything locally.

**1. Disable the service worker under Capacitor.** `main.ts` registers `/sw.js`
whenever `import.meta.env.PROD`. In a native build the assets are already local,
so the worker adds nothing and introduces a cache layer that can serve a stale
shell after an app update. Guard the registration on not-native.

**2. Haptics through the native API.** Wrap `haptic()` so it calls Capacitor's
Haptics plugin when native and falls back to `navigator.vibrate` on the web. The
switch statement's five patterns map onto impact/notification styles.

**3. A meta CSP.** The policy currently lives in `vercel.json` headers, which do
not exist in a native build — so the WebView would run with no CSP at all. Add an
equivalent `<meta http-equiv="Content-Security-Policy">` so both builds are
covered by the same rules.

**4. Keep every asset local.** Capacitor copies `dist/` into the bundle and
serves it from `capacitor://localhost`. Nothing may point at `signalcc.app` at
runtime. This is the whole of Guideline 4.2 compliance: a WebView pointed at a
remote URL is the classic rejection, and a bundle that genuinely runs offline is
not that. The fonts are already self-hosted, which is most of the work.

---

## The unknown that actually matters

**Does Turnstile work inside a WKWebView whose origin is `capacitor://localhost`?**

Turnstile validates the hostname when the token is verified, not when the widget
renders. The widget dialog says `localhost` is added to every hostname list
automatically, which suggests it will — but "suggests" is not "verified", and the
failure mode is the one that already cost this project two debugging sessions:
nothing looks broken, the challenge appears to run, and every new player silently
posts no score.

Test it explicitly, on a device, before building a listing around it:

1. Install the dev build to a real iPhone
2. Play one run to the results screen and enter a callsign
3. Check the `verify-attestation` edge function logs

`POST | 200` means the hostname was accepted. A `403` means it was not, and the
log line carries Cloudflare's error code.

If it fails, the options in order of preference are: add whatever hostname
Cloudflare actually reports to the widget; change Capacitor's server hostname to
one the widget lists; or run attestation only on the web build and gate native
identity creation another way.

---

## Order of work

1. Build and install to a device (free Apple ID, seven-day build)
2. Answer the Turnstile question
3. Make the four changes above
4. Decide on the haptics copy
5. Reinstate the LLC — paperwork with a waiting period, so start it early
6. Enroll, TestFlight, listing

Steps 1–4 need a Mac with Xcode. Nothing in them needs a paid account, an
entity, or a decision about the store name.

## Commands (macOS)

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/ios @capacitor/haptics
npx cap init "SIGNAL" app.signalcc.game --web-dir dist
npm run build
npx cap add ios
npx cap sync
npx cap open ios
```

`app.signalcc.game` is the bundle identifier and **can never be changed** after
the first submission. It is not user-visible; the store name is a separate field
and stays open.
