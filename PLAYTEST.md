# Playtest protocol

For the first round with ~10 people who have never seen SIGNAL.

**URL:** https://signalcc.app/

Ask them to open it on their **own phone**, not yours. A borrowed device with an
existing save is a different game: no splash, no callsign prompt, no Turnstile
challenge, and a leaderboard they are already on.

---

## The one question this round answers

**Does a stranger understand what to do without being told?**

Nothing else matters as much, because nothing else is recoverable by a patch to
copy. Balance, difficulty curve and feature requests are all cheap to change
later and expensive to gather now.

First launch now opens the tutorial by itself, with "Skip tutorial" on screen
from the first frame. Until recently it was reachable only by tapping "How to
Play" in the menu sheet, so a new player who tapped Engage went straight into a
real permadeath run having read one line of hint text.

So the question is no longer *do they find the tutorial* — they are handed it.
It is whether the tutorial **works**: whether someone who sits through it can
then play unaided, and whether someone who skips it is left stranded.

Both halves matter, and the split is the finding. Roughly half your testers will
skip on reflex, and that is data, not a failed session — it tells you how much
the game has to teach without the tutorial's help.

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

- **Did they skip the tutorial, and how fast?** An instant skip means the card
  read as a barrier rather than help. Note it either way — the skip/sit split
  is the most useful number this round produces.
- **If they sat through it:** could they then play without asking anything? That
  is the tutorial's only job.
- **If they skipped:** how long until they understood the rules from play alone,
  if ever. This is what the tutorial is insurance against.
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

## During: submissions that don't land

Every tester is a **new leaderboard identity**, so every one of them hits a
Turnstile challenge on their first submission. Attestation is enforced
(`require_attestation = true`).

A challenge can fail for reasons that have nothing to do with the player — an ad
blocker, a campus or office network blocking `challenges.cloudflare.com`, a bad
moment of signal. This used to be **silent**: the run played perfectly, the score
never posted, and the results screen showed a leaderboard the player was simply
missing from. Indistinguishable from a broken leaderboard.

The results screen now says so, above the board:

> Score not posted — this device couldn't be verified. Your progress is saved.

So you do not have to watch for it, and a tester who sees it can tell you in
plain words instead of reporting "it didn't save my score". **Write down every
time it appears** — a handful across ten testers is a real signal about how much
of your audience Turnstile is turning away.

To see which half of the chain failed, check the edge function logs. A `403` or
`503` means challenges are failing, not that the game is broken:

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
