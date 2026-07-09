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
alter table player_identities enable row level security;
-- Intentionally no policies for anon — this table is only ever touched via the
-- SECURITY DEFINER functions below, never queried or written directly by clients.

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
returns void
language plpgsql
security definer
set search_path = public
as $$
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

  -- score: non-negative, below anti-cheat ceiling
  if p_score < 0 then
    raise exception 'score must be >= 0';
  end if;
  if p_score > 9999999 then
    raise exception 'score exceeds maximum (9,999,999)';
  end if;

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

  update leaderboard_scores
  set display_name = trim(p_display_name)
  where player_id = p_player_id;
end;
$$;

grant execute on function update_display_name to anon;
grant execute on function update_display_name to authenticated;
