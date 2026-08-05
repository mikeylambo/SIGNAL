# Playtest protocol

For the first round with ~10 people who have never seen SIGNAL.

**URL:** https://signal-brain-training.vercel.app/

Ask them to open it on their **own phone**, not yours. A borrowed device with an
existing save is a different game: no splash, no callsign prompt, no Turnstile
challenge, and a leaderboard they are already on.

---

## The one question this round answers

**Does a stranger understand what to do without being told?**

Nothing else matters as much, because nothing else is recoverable by a patch to
copy. Balance, difficulty curve and feature requests are all cheap to change
later and expensive to gather now.

The reason this is genuinely uncertain: **the tutorial is opt-in and nothing
triggers it on first launch.** `startOnboardingRound()` is called from exactly
two places — the "How to Play" button in the menu sheet, and "Replay Intro" in
Stats. A new player who taps Engage goes straight into a real, permadeath run
having read only the one-line hint above the button.

That may be correct. Plenty of good games teach by doing, and the rules here fit
on one line. But it is an assumption that has never been tested on someone who
did not build it.

---

## Running one session

Fifteen minutes. Do not explain the game. Do not touch their phone.

1. Hand over the URL and say only: **"Have a go, and think out loud."**
2. Say nothing else until they stop of their own accord — including when they
   are stuck. The silence is the measurement. If they ask a direct question,
   write it down and answer it *after* the session.
3. When they stop, ask in this order:
   - What did you think you were supposed to do?
   - Was there a point where you weren't sure what was happening?
   - Would you open this again tomorrow? (Watch the pause before the answer,
     not the answer.)

### What to write down, verbatim

- **Did they find "How to Play"?** Unprompted, prompted, or never.
- **Where their eyes went** in the first ten seconds. The board, the buttons,
  or hunting for instructions.
- **The first mistake.** Whether they understood *why* the run ended.
- **The callsign prompt.** Did they hesitate? Did anyone type a real name? The
  policy warns against it, but the prompt itself does not.
- **Anything they said out loud that starts with "wait" or "oh".** Those are
  the moments; the rest is commentary.

Timings and scores are already in the database. Do not spend session time on
what you can query afterwards.

---

## Before you start

- [ ] Play one run yourself on production, same day, to confirm nothing has
      regressed since the last deploy.
- [ ] Decide the Turnstile question below.
- [ ] Have the rollback statement ready in a terminal, not in a browser tab you
      still have to find.

## During: the one thing that can fail silently

Every tester is a **new leaderboard identity**, so every one of them hits a
Turnstile challenge on their first submission. Attestation is enforced
(`require_attestation = true`).

If a challenge fails — an ad blocker, a corporate or campus network blocking
`challenges.cloudflare.com`, a bad moment of signal — the run plays perfectly
and the score silently does not post. The player has no way to tell those apart
from a broken leaderboard, and you will hear it as "it didn't save my score".

Check the edge function logs after the first two or three testers. A `403` or
`503` there means challenges are failing, not that the game is broken:

```sql
-- kill switch: takes effect immediately, no deploy
update app_settings set value = 'false' where key = 'require_attestation';
```

Ten testers from one room share one IP, which is well inside the
`claim_attested_ip` limit of 40/hour, so a shared connection is not a risk here.

---

## Afterwards

Write the notes up the same day, while you can still remember which face went
with which pause.

The bar for changing something: **two independent testers hit the same wall.**
One person struggling is one person. Two is the design.
