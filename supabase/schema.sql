-- ── SIGNAL leaderboard schema ─────────────────────────────────────────────────
-- Paste this entire file into the Supabase SQL Editor and click Run.
-- All statements are idempotent — safe to re-run after changes.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Table ─────────────────────────────────────────────────────────────────────
create table if not exists leaderboard_scores (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  board_key     text        not null,   -- e.g. "mode:spatial:classic" or "daily:2026-06-22"
  protocol      text,                   -- denormalised for easy filtering
  pacing        text,
  player_id     uuid        not null,   -- stable per-device identity (never a real user id)
  display_name  text        not null,
  score         int         not null,
  level_reached int
);

-- One row per (player × board): upsert replaces rather than appending duplicates
alter table leaderboard_scores
  drop constraint if exists leaderboard_scores_board_player_unique;
alter table leaderboard_scores
  add  constraint leaderboard_scores_board_player_unique
  unique (board_key, player_id);

-- Fast top-N reads
create index if not exists leaderboard_scores_board_key_score_idx
  on leaderboard_scores (board_key, score desc);

-- ── Row-level security ────────────────────────────────────────────────────────
alter table leaderboard_scores enable row level security;

-- Anon can SELECT; all writes go through submit_score() (SECURITY DEFINER).
-- No direct INSERT / UPDATE / DELETE policy for anon is intentional.
drop policy if exists "public read" on leaderboard_scores;
create policy "public read"
  on leaderboard_scores
  for select
  to anon
  using (true);

-- ── Data API grants (required for Supabase projects created after May 2026) ──
-- PostgREST (the Supabase Data API) runs as the anon/authenticated roles.
-- Without these explicit grants the SELECT queries in fetchBoard() return 403.
grant select on leaderboard_scores to anon;
grant select on leaderboard_scores to authenticated;

-- ── Player identity ownership ────────────────────────────────────────────────
-- player_id alone is not authentication — it's just a client-generated UUID.
-- Before this table existed, anyone could call submit_score/update_display_name
-- with someone else's player_id. This table pins each player_id to a secret
-- the client also generates once and never displays, claimed on first write
-- ("first writer wins") and checked on every write after that.
create table if not exists player_identities (
  player_id    uuid primary key,
  owner_secret uuid not null,
  created_at   timestamptz not null default now()
);
-- Whether this identity passed a Turnstile challenge when it was claimed.
-- Added separately so existing clusters migrate without dropping the table;
-- identities claimed before attestation existed are legitimately `false`.
alter table player_identities
  add column if not exists attested boolean not null default false;
alter table player_identities enable row level security;
-- Intentionally no policies for anon — this table is only ever touched via the
-- SECURITY DEFINER functions below, never queried or written directly by clients.

-- ── Rate limiting ────────────────────────────────────────────────────────────
-- The anon key ships inside the client bundle, by design — it is a public key,
-- not a secret. So every RPC here is reachable by anyone with curl, not only by
-- someone running the game. Ownership checking stops one player editing
-- another's row, but on its own it stops nothing else: a script could mint fresh
-- player_ids in a loop and bury every board.
--
-- Two buckets are counted, because they fail in different ways:
--   * per player_id — bounds one identity, and catches a looping client.
--   * per client IP — the one an attacker cannot shed by generating a new UUID.
--     Supabase/PostgREST exposes request headers through a GUC; outside
--     PostgREST (psql, tests) that setting simply does not exist, so the helper
--     degrades to identity-only limiting rather than failing the call.
--
-- This is deliberately mitigation, not prevention. A distributed attacker with
-- many IPs still gets through; what this buys is that casual abuse, a runaway
-- client, and single-source flooding all stop being trivial, and the score
-- plausibility check below caps the damage any one accepted row can do.
create table if not exists rate_limit_buckets (
  bucket_key   text        primary key,
  hits         int         not null default 0,
  window_start timestamptz not null default now()
);
alter table rate_limit_buckets enable row level security;
-- No anon policies: written only by the SECURITY DEFINER helper below.

create index if not exists rate_limit_buckets_window_idx
  on rate_limit_buckets (window_start);

/**
 * Fixed-window counter. Raises when p_key exceeds p_max hits within p_window.
 *
 * Fixed window rather than sliding: a sliding window needs a row per event,
 * which is itself a write-amplification vector on the exact path being
 * protected. The trade-off is that a burst can straddle a window boundary and
 * briefly see up to 2× p_max. For abuse control that is fine; the limits below
 * are set well above real play, so the boundary case is still nowhere near
 * anything a person can produce by hand.
 */
create or replace function bump_rate_limit(
  p_key    text,
  p_max    int,
  p_window interval
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits int;
begin
  if p_key is null then return; end if;

  insert into rate_limit_buckets (bucket_key, hits, window_start)
  values (p_key, 1, now())
  on conflict (bucket_key) do update
    set hits = case
                 when rate_limit_buckets.window_start < now() - p_window then 1
                 else rate_limit_buckets.hits + 1
               end,
        window_start = case
                 when rate_limit_buckets.window_start < now() - p_window then now()
                 else rate_limit_buckets.window_start
               end
  returning hits into v_hits;

  if v_hits > p_max then
    raise exception 'rate limit exceeded — too many requests, try again later';
  end if;
end;
$$;

/**
 * The caller's IP, or NULL when it cannot be determined.
 *
 * `request.headers` is set by PostgREST. In psql it does not exist, and
 * current_setting(..., true) returns NULL there rather than erroring — which is
 * why the second argument matters. x-forwarded-for may be a comma-separated
 * chain; the left-most entry is the original client.
 */
create or replace function client_ip()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_headers text;
  v_xff     text;
begin
  v_headers := current_setting('request.headers', true);
  if v_headers is null or v_headers = '' then
    return null;
  end if;
  v_xff := (v_headers::json ->> 'x-forwarded-for');
  if v_xff is null or v_xff = '' then
    return null;
  end if;
  return split_part(v_xff, ',', 1);
exception
  when others then
    -- A malformed header must never take down a score submission.
    return null;
end;
$$;

/**
 * Upper bound on a believable score for a run that reached p_level.
 *
 * Derived from the real scoring rules rather than picked out of the air, then
 * given wide headroom so no honest player is ever rejected:
 *
 *   per hit   = 10 × comboMult × protocolMult × modifierMult
 *   worst case = 10 × 4 × 1.5 × 1.8 = 108
 *   hits/level ≤ 10 for grid protocols (activeCount caps at 10), and ≤ 10+level
 *               for n-Back, whose stream is 10+level long
 *   level bonus ≤ 200 (Sprint: +100 per clear, two clears per level)
 *   Zen advances a level every 3 completions, so multiply by 3
 *
 * That gives roughly 3 × Σ((10+l)×108 + 200). The constant below sits about 2.5×
 * above that across the whole plausible range, so the check only ever fires on
 * scores no run could produce — the 9,999,999-at-level-1 defacement, not a
 * genuinely excellent player.
 *
 * This is what stops one forged row making a board meaningless. It does not try
 * to detect a *slightly* inflated score; without a server-authoritative
 * simulation that is not detectable, and pretending otherwise would be worse
 * than being clear about the boundary.
 */
create or replace function max_plausible_score(p_level int)
returns bigint
language sql
immutable
as $$
  select (400::bigint * greatest(coalesce(p_level, 1), 1)
                      * (greatest(coalesce(p_level, 1), 1) + 30));
$$;

-- These are called from inside SECURITY DEFINER functions, never by the client,
-- so anon deliberately gets no execute grant. max_plausible_score is granted
-- because it is useful to a moderator reading the queue, and leaks nothing.
grant execute on function max_plausible_score to anon;
grant execute on function max_plausible_score to authenticated;

/**
 * Drops spent rate-limit rows. The table is keyed per identity and per IP, so
 * without this it grows forever — every bucket that ever existed, long after its
 * window closed.
 *
 * Not scheduled automatically: pg_cron is an extension the project owner has to
 * enable, and silently depending on it would mean the cleanup just never runs on
 * a project that hasn't. Run it from the SQL editor, or schedule it once
 * pg_cron is on:
 *   select cron.schedule('signal-rl-gc', '0 * * * *', 'select purge_rate_limits()');
 */
create or replace function purge_rate_limits()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  delete from rate_limit_buckets where window_start < now() - interval '24 hours';
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

-- ── Runtime settings ─────────────────────────────────────────────────────────
-- Server-side switches, so behaviour can be changed without a client deploy.
-- That matters most for attestation: if Cloudflare has an outage or the widget
-- misbehaves on some device, the fix has to be "flip a row" and not "ship a
-- build", or every new player is locked out of the leaderboard until you can
-- deploy.
create table if not exists app_settings (
  key   text primary key,
  value text not null
);
alter table app_settings enable row level security;
-- No anon policies: read only from inside SECURITY DEFINER functions.

-- Default OFF. Turn it on only once VITE_TURNSTILE_SITE_KEY is set on the client
-- AND the verify-attestation function is deployed with its secret — enabling it
-- before both are true would reject every new player.
insert into app_settings (key, value)
values ('require_attestation', 'false')
on conflict (key) do nothing;

create or replace function attestation_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select value = 'true' from app_settings where key = 'require_attestation'),
    false);
$$;

/**
 * Claims a NEW identity. Callable only by service_role — i.e. only from the
 * verify-attestation Edge Function, after it has checked the Turnstile token
 * with Cloudflare. anon deliberately gets no grant: if it did, the attestation
 * gate would be one direct RPC call away from being skipped entirely.
 */
create or replace function claim_identity_attested(
  p_player_id     uuid,
  p_owner_secret  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_player_id is null or p_owner_secret is null then
    raise exception 'player_id and owner_secret are required';
  end if;

  -- Still IP-limited. Attestation raises the cost of minting an identity; it
  -- does not make it free to do so in bulk with a farm of solved challenges.
  perform bump_rate_limit('claim_attested_ip:' || coalesce(client_ip(), 'unknown'), 40, interval '1 hour');

  insert into player_identities (player_id, owner_secret, attested)
  values (p_player_id, p_owner_secret, true)
  on conflict (player_id) do nothing;
end;
$$;

-- REVOKE FROM PUBLIC, not just from anon. Postgres grants EXECUTE on a new
-- function to PUBLIC by default, and anon inherits that — so revoking from anon
-- alone leaves the function callable by anon anyway, and the whole attestation
-- gate is one direct RPC call away from being skipped. Caught by
-- verify_hardening.sql's has_function_privilege check, not by reading the code.
revoke execute on function claim_identity_attested from public;
revoke execute on function claim_identity_attested from anon;
revoke execute on function claim_identity_attested from authenticated;
grant  execute on function claim_identity_attested to service_role;

create or replace function verify_or_claim_owner(
  p_player_id     uuid,
  p_owner_secret  uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  existing_secret uuid;
begin
  if p_owner_secret is null then
    raise exception 'owner_secret is required';
  end if;

  select owner_secret into existing_secret
  from player_identities
  where player_id = p_player_id;

  if existing_secret is null then
    -- With attestation on, anon cannot self-claim at all: a new identity has to
    -- come through claim_identity_attested(), which only the Edge Function can
    -- call and only after Cloudflare has verified a Turnstile token. This is the
    -- chokepoint — free identities are what make every per-player limit
    -- decorative, since a fresh UUID resets them.
    --
    -- Existing players are unaffected either way: they already have a row, so
    -- they never reach this branch. Turning the flag on cannot lock out anyone
    -- who has already posted a score.
    if attestation_required() then
      raise exception 'attestation required to create a new leaderboard identity'
        using errcode = 'insufficient_privilege';
    end if;

    -- Claiming a NEW identity is the step an attacker repeats to escape a
    -- per-player limit, so it is rate limited by IP specifically here — on the
    -- claim path only. Returning players never reach this branch, so a shared
    -- IP (a household, a school, an office NAT) is unaffected by it; the limit
    -- is high enough to cover a genuinely busy shared connection anyway.
    perform bump_rate_limit('claim_ip:' || coalesce(client_ip(), 'unknown'), 40, interval '1 hour');

    -- First time this player_id has ever written: claim it for this secret.
    -- ON CONFLICT DO NOTHING covers the race where two calls for a brand-new
    -- player_id land at nearly the same time — whichever inserts first wins,
    -- and the second falls through to the re-select + check below.
    insert into player_identities (player_id, owner_secret)
    values (p_player_id, p_owner_secret)
    on conflict (player_id) do nothing;

    select owner_secret into existing_secret
    from player_identities
    where player_id = p_player_id;
  end if;

  if existing_secret is distinct from p_owner_secret then
    raise exception 'owner_secret does not match this player_id';
  end if;
end;
$$;

-- ── submit_score ──────────────────────────────────────────────────────────────
-- IMPORTANT: submit_score and update_display_name are being given a new
-- required parameter (p_owner_secret). `create or replace function` only
-- replaces a function with an IDENTICAL parameter signature — adding a
-- parameter creates a second, separate overload instead, silently leaving the
-- old vulnerable version callable. These explicit drops close that gap.
drop function if exists submit_score(text, uuid, text, int, int, text, text);
drop function if exists update_display_name(uuid, text);

-- submit_score's return type is also changing (void → boolean, so callers can
-- tell whether a run was a new personal best). create-or-replace can't change
-- a function's return type either, even with an otherwise-identical parameter
-- list, so this signature needs an explicit drop too.
drop function if exists submit_score(text, uuid, uuid, text, int, int, text, text);

-- SECURITY DEFINER: runs as the function owner (bypasses RLS) so it can
-- insert/update without an anon INSERT policy on the table.
--
-- Upsert logic: only updates the stored row when the incoming score is strictly
-- higher than the existing one.  If the new score is lower, the call is a no-op.
create or replace function submit_score(
  p_board_key     text,
  p_player_id     uuid,
  p_owner_secret  uuid,
  p_display_name  text,
  p_score         int,
  p_level_reached int    default null,
  p_protocol      text   default null,
  p_pacing        text   default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row_count int;
begin
  perform verify_or_claim_owner(p_player_id, p_owner_secret);

  -- board_key: required, ≤64 chars, lowercase alphanumeric + _ : -
  if p_board_key is null or length(p_board_key) < 1 or length(p_board_key) > 64 then
    raise exception 'invalid board_key length (must be 1–64 characters)';
  end if;
  if p_board_key !~ '^[a-z0-9_:\-]+$' then
    raise exception 'board_key contains invalid characters (allowed: a-z 0-9 _ : -)';
  end if;

  -- display_name: required, non-blank after trimming, ≤32 chars
  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'display_name is required';
  end if;
  if length(p_display_name) > 32 then
    raise exception 'display_name exceeds 32 characters';
  end if;

  -- Moderation (see the Moderation section at the end of this file). These two
  -- checks are the authoritative ones — the client's blocked-word list ships in
  -- the bundle and can simply be edited out.
  if exists (select 1 from banned_players where player_id = p_player_id) then
    raise exception 'player is banned';
  end if;
  if is_name_blocked(p_display_name) then
    raise exception 'display_name contains disallowed content';
  end if;

  -- score: non-negative, below anti-cheat ceiling
  if p_score < 0 then
    raise exception 'score must be >= 0';
  end if;
  if p_score > 9999999 then
    raise exception 'score exceeds maximum (9,999,999)';
  end if;

  -- level_reached: required, and sane. It is what the plausibility bound below
  -- is measured against, so a null or absurd level would make that check
  -- meaningless — previously it was optional and unvalidated.
  if p_level_reached is null or p_level_reached < 1 then
    raise exception 'level_reached is required and must be >= 1';
  end if;
  if p_level_reached > 500 then
    raise exception 'level_reached exceeds maximum (500)';
  end if;

  -- Plausibility: a flat 9,999,999 ceiling let anyone post a perfect-looking
  -- score at level 1 and permanently ruin a board — including a daily board,
  -- which is a dated historical record and cannot simply be rebuilt. Tying the
  -- ceiling to the level actually reached makes the forged row have to claim a
  -- run long enough to be beatable by real play.
  if p_score > max_plausible_score(p_level_reached) then
    raise exception 'score % is not achievable at level % (max %)',
      p_score, p_level_reached, max_plausible_score(p_level_reached);
  end if;

  -- Submission rate. The binding case for the limit is NOT a long run — it is a
  -- player who keeps failing immediately and hitting "Run Again". That cycle is
  -- roughly 15–20s (countdown, a flash, a mistake, the results screen), so real
  -- frustrated play can reach 180–240 submissions an hour. The cap has to sit
  -- above that or it punishes exactly the player having a bad session, so 300 —
  -- five a minute sustained for an hour, which no one does by hand, while a
  -- looping client still gets bounded. Both buckets are counted because they
  -- fail differently; see the rate-limiting section above.
  perform bump_rate_limit('submit:' || p_player_id::text, 300, interval '1 hour');
  perform bump_rate_limit('submit_ip:' || coalesce(client_ip(), 'unknown'), 1500, interval '1 hour');

  insert into leaderboard_scores
    (board_key, player_id, display_name, score, level_reached, protocol, pacing)
  values
    (p_board_key, p_player_id, trim(p_display_name),
     p_score, p_level_reached, p_protocol, p_pacing)
  on conflict (board_key, player_id)
  do update set
    score         = excluded.score,
    level_reached = excluded.level_reached,
    display_name  = excluded.display_name,
    protocol      = excluded.protocol,
    pacing        = excluded.pacing,
    created_at    = now()
  where excluded.score > leaderboard_scores.score;

  -- ROW_COUNT reflects rows actually inserted/updated: a fresh insert (first
  -- score ever on this board) or an update that passed the WHERE clause above.
  -- A row skipped by the WHERE clause (existing score was already as high or
  -- higher) does not count, giving us "was this a new personal best?" for free.
  get diagnostics v_row_count = row_count;
  return v_row_count > 0;
end;
$$;

-- Allow anon callers to invoke submit_score via supabase.rpc()
grant execute on function submit_score to anon;
grant execute on function submit_score to authenticated;

-- ── update_display_name ──────────────────────────────────────────────────────
-- Lets a returning player rename themselves across every board they've already
-- appeared on, independent of submit_score()'s "only if score improved" guard.
-- SECURITY DEFINER: bypasses RLS the same way submit_score() does.
create or replace function update_display_name(
  p_player_id     uuid,
  p_owner_secret  uuid,
  p_display_name  text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  perform verify_or_claim_owner(p_player_id, p_owner_secret);

  if p_display_name is null or length(trim(p_display_name)) = 0 then
    raise exception 'display_name is required';
  end if;
  if length(p_display_name) > 32 then
    raise exception 'display_name exceeds 32 characters';
  end if;
  if exists (select 1 from banned_players where player_id = p_player_id) then
    raise exception 'player is banned';
  end if;
  if is_name_blocked(p_display_name) then
    raise exception 'display_name contains disallowed content';
  end if;

  -- Rate limited harder than submitting: one call rewrites every row the player
  -- owns across every board, so it is the most write-amplifying RPC here, and
  -- nobody legitimately renames themselves dozens of times an hour.
  perform bump_rate_limit('rename:' || p_player_id::text, 20, interval '1 hour');

  update leaderboard_scores
  set display_name = trim(p_display_name)
  where player_id = p_player_id;
end;
$$;

grant execute on function update_display_name to anon;
grant execute on function update_display_name to authenticated;

-- ── delete_player_data ───────────────────────────────────────────────────────
-- Right to erasure. Every other write path here only ever *adds* a player to the
-- backend; without this, a player who typed a callsign onto a public board had
-- no way to take it back, which is a data-protection obligation (GDPR Art. 17 /
-- CCPA) and not merely a nice-to-have.
--
-- Deletes the player's scores on every board and forgets the identity itself, so
-- nothing player-supplied survives the call.
--
-- Two deliberate choices:
--  * owner_secret is verified first, so one player cannot erase another. This is
--    the same gate submit_score() uses — the only proof of ownership that exists
--    in an account-less design.
--  * A `banned_players` row is deliberately NOT removed. Otherwise erasure
--    doubles as a ban-evasion button: delete, and the ban is gone. A ban row
--    holds only a random player_id and a moderator note, never player-supplied
--    content, so keeping it erases everything personal while preserving the
--    moderation decision.
--
-- Idempotent: erasing an identity that holds no rows succeeds and reports 0.
create or replace function delete_player_data(
  p_player_id     uuid,
  p_owner_secret  uuid
)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deleted int;
begin
  perform verify_or_claim_owner(p_player_id, p_owner_secret);

  delete from leaderboard_scores where player_id = p_player_id;
  get diagnostics v_deleted = row_count;

  -- Reports have to go as well, and specifically because of `reported_name`:
  -- it stores a *copy* of the display name at report time, so deleting only
  -- leaderboard_scores would leave the erased callsign sitting in this table.
  -- Reports the player filed against others go too, since those carry their id.
  -- That does cost a little moderation signal — a report count can drop when a
  -- reporter erases themselves — but a report is a soft signal that rebuilds,
  -- whereas retaining identifiers of a player who asked to be forgotten is the
  -- thing erasure exists to prevent. Bans, which carry no player-supplied text,
  -- are kept (see above).
  delete from player_reports
   where reported_player_id = p_player_id
      or reporter_player_id = p_player_id;

  -- Erasing the identity last: verify_or_claim_owner() reads it, and dropping it
  -- earlier in the same transaction would let a concurrent call re-claim the id
  -- with a different secret.
  delete from player_identities where player_id = p_player_id;

  return v_deleted;
end;
$$;

grant execute on function delete_player_data to anon;
grant execute on function delete_player_data to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════
-- Moderation
-- ═══════════════════════════════════════════════════════════════════════════
-- The client carries a blocked-word list, but it is a UX fast-path only: it
-- lives in the shipped bundle, so anyone can edit it out and post whatever they
-- like. Display names are user-generated content shown to every other player,
-- which app-store review treats as a compliance requirement, so the
-- authoritative check has to run here, inside the SECURITY DEFINER functions
-- that are the only write path to the table.

-- ── Blocklist ────────────────────────────────────────────────────────────────
-- A table rather than a hardcoded array so terms can be added in response to a
-- report without shipping a new client build or redefining a function.
create table if not exists moderation_blocklist (
  pattern    text primary key,
  match_mode text not null default 'substring'
             check (match_mode in ('substring', 'word')),
  added_at   timestamptz not null default now(),
  note       text
);
-- Idempotent for clusters created before match_mode existed.
alter table moderation_blocklist
  add column if not exists match_mode text not null default 'substring';
alter table moderation_blocklist enable row level security;
-- No anon policies: readable and writable only by the service role / SQL editor.

-- 'substring': unambiguous — no ordinary word contains these.
insert into moderation_blocklist (pattern, match_mode) values
  ('fuck', 'substring'), ('shit', 'substring'), ('nigger', 'substring'),
  ('nigga', 'substring'), ('faggot', 'substring'), ('retard', 'substring'),
  ('pussy', 'substring'), ('bitch', 'substring'), ('tranny', 'substring'),
  ('hitler', 'substring'), ('kike', 'substring')
on conflict (pattern) do nothing;

-- 'word': these appear inside perfectly ordinary words (Scunthorpe, Assassin,
-- Dickinson, Cockburn, Grapes, Nazism-free placenames, Gookin), so they only
-- match standing alone.
insert into moderation_blocklist (pattern, match_mode) values
  ('cunt', 'word'), ('ass', 'word'), ('dick', 'word'), ('cock', 'word'),
  ('fag', 'word'), ('spic', 'word'), ('gook', 'word'), ('chink', 'word'),
  ('rape', 'word'), ('nazi', 'word')
on conflict (pattern) do nothing;

-- ── Normalisation ────────────────────────────────────────────────────────────
-- Folds common evasions before matching. Without this, 'n1gg3r', 'f.u.c.k' and
-- 'Ｆｕｃｋ' all sail past a naive substring check.
--
-- Two forms are produced, because they answer different questions:
--   * stripped  — every non-letter removed, so 'f.u.c.k' collapses to 'fuck'.
--     Used for slurs, which should match however they are padded.
--   * tokenised — separators collapsed to single spaces, so word boundaries
--     survive. Used for terms that legitimately occur inside other words;
--     matching 'cunt' as a substring blocks Scunthorpe, and matching 'ass'
--     blocks Assassin. That class of false positive locks real players out of
--     their own name, so those terms match as whole words only.
--
-- `p_i_as` disambiguates the digit 1, which stands in for both 'i' (n1gg3r) and
-- 'l' (h1tler). Callers test both foldings rather than guessing.
create or replace function fold_leet(p_name text, p_i_as text default 'i')
returns text
language sql
immutable
set search_path = public
as $$
  select translate(
    lower(coalesce(p_name, '')),
    '013457８@$!|' ||
      'ａｂｃｄｅｆｇｈｉｊｋｌｍｎｏｐｑｒｓｔｕｖｗｘｙｚ',
    'o' || p_i_as || 'east' || 'b' || 'a' || 's' || 'i' || p_i_as ||
      'abcdefghijklmnopqrstuvwxyz'
  );
$$;

create or replace function normalize_display_name(p_name text, p_i_as text default 'i')
returns text
language sql
immutable
set search_path = public
as $$
  select regexp_replace(fold_leet(p_name, p_i_as), '[^a-z]', '', 'g');
$$;

create or replace function tokenize_display_name(p_name text, p_i_as text default 'i')
returns text
language sql
immutable
set search_path = public
as $$
  -- Leading/trailing spaces are kept so a ' word ' pattern match works at the
  -- string edges as well as the middle.
  select ' ' || btrim(regexp_replace(fold_leet(p_name, p_i_as), '[^a-z]+', ' ', 'g')) || ' ';
$$;

create or replace function is_name_blocked(p_name text)
returns boolean
language sql
stable
set search_path = public
as $$
  select exists (
    select 1
    from moderation_blocklist b,
         -- Both readings of the digit 1; a hit under either is a hit.
         (values ('i'), ('l')) as v(i_as)
    where (b.match_mode = 'substring'
             and normalize_display_name(p_name, v.i_as) like '%' || b.pattern || '%')
       or (b.match_mode = 'word'
             and tokenize_display_name(p_name, v.i_as) like '% ' || b.pattern || ' %')
  );
$$;

-- ── Bans ─────────────────────────────────────────────────────────────────────
-- Set by a moderator after reviewing the report queue. A banned player's writes
-- are rejected; their existing rows are removed by the ban trigger below so the
-- offending name stops being served immediately rather than at their next write.
create table if not exists banned_players (
  player_id  uuid primary key,
  reason     text,
  banned_at  timestamptz not null default now()
);
alter table banned_players enable row level security;

create or replace function purge_banned_player_scores()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from leaderboard_scores where player_id = new.player_id;
  return new;
end;
$$;

drop trigger if exists banned_players_purge on banned_players;
create trigger banned_players_purge
  after insert on banned_players
  for each row execute function purge_banned_player_scores();

-- ── Player reports ───────────────────────────────────────────────────────────
-- Lets players flag a name. Reporting is rate-limited by a unique constraint:
-- one report per reporter per reported player, so a brigade cannot inflate the
-- count and an individual cannot spam the queue.
create table if not exists player_reports (
  id                  bigint generated always as identity primary key,
  reported_player_id  uuid not null,
  reporter_player_id  uuid not null,
  reported_name       text not null,
  created_at          timestamptz not null default now(),
  resolved            boolean not null default false,
  unique (reported_player_id, reporter_player_id)
);
alter table player_reports enable row level security;

create index if not exists player_reports_open_idx
  on player_reports (reported_player_id) where not resolved;

create or replace function report_player(
  p_reported_player_id uuid,
  p_reporter_player_id uuid,
  p_owner_secret       uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text;
begin
  -- Reporters must prove who they are, or one actor could manufacture
  -- unlimited distinct "reporters" and bury a player in the queue.
  perform verify_or_claim_owner(p_reporter_player_id, p_owner_secret);

  if p_reported_player_id = p_reporter_player_id then
    raise exception 'cannot report yourself';
  end if;

  select display_name into v_name
  from leaderboard_scores
  where player_id = p_reported_player_id
  limit 1;

  if v_name is null then
    raise exception 'no such player on any board';
  end if;

  insert into player_reports (reported_player_id, reporter_player_id, reported_name)
  values (p_reported_player_id, p_reporter_player_id, v_name)
  on conflict (reported_player_id, reporter_player_id) do nothing;
end;
$$;

grant execute on function report_player to anon;
grant execute on function report_player to authenticated;

-- ── Moderation queue ─────────────────────────────────────────────────────────
-- What a moderator actually looks at: open reports grouped by player, most
-- reported first. Not exposed to anon.
create or replace view moderation_queue as
  select
    r.reported_player_id,
    max(r.reported_name)                       as reported_name,
    count(*)                                   as report_count,
    min(r.created_at)                          as first_reported_at,
    bool_or(is_name_blocked(r.reported_name))  as matches_blocklist
  from player_reports r
  where not r.resolved
  group by r.reported_player_id
  order by count(*) desc;

-- ── Suspicious scores ────────────────────────────────────────────────────────
-- submit_score() rejects the impossible; this surfaces the merely improbable,
-- which is the part no rule can decide automatically. `headroom` is the score as
-- a fraction of what the reached level could plausibly produce — a legitimate
-- run sits well below 1.0, so rows creeping toward it are the ones worth a look.
-- Not exposed to anon: it is a moderation tool, and publishing a "how close to
-- the limit am I" readout would just be a calibration aid for cheating.
create or replace view suspicious_scores as
  select
    s.player_id,
    s.display_name,
    s.board_key,
    s.score,
    s.level_reached,
    round(s.score::numeric / nullif(max_plausible_score(s.level_reached), 0), 3) as headroom,
    s.created_at
  from leaderboard_scores s
  where s.level_reached is not null
    and s.score::numeric / nullif(max_plausible_score(s.level_reached), 0) > 0.35
  order by (s.score::numeric / nullif(max_plausible_score(s.level_reached), 0)) desc;
