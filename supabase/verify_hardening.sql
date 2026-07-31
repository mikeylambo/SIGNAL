-- Functional check for the leaderboard hardening: score plausibility, required
-- level_reached, and rate limiting. Run against a database that has already had
-- schema.sql applied:
--   psql -d sigtest -v ON_ERROR_STOP=1 -f supabase/verify_hardening.sql
-- Prints PASS/FAIL per assertion and raises on the first failure.
\set QUIET on
\pset pager off

do $$
declare
  p1      uuid := '4444aaaa-0000-0000-0000-000000000001';
  s1      uuid := '4444bbbb-0000-0000-0000-000000000001';
  p2      uuid := '4444aaaa-0000-0000-0000-000000000002';
  s2      uuid := '4444bbbb-0000-0000-0000-000000000002';
  v_n     int;
  v_bound bigint;
  v_ok    boolean;
begin
  delete from player_reports;
  delete from leaderboard_scores;
  delete from banned_players;
  delete from player_identities;
  delete from rate_limit_buckets;

  -- ── The bound must not reject real play ────────────────────────────────────
  -- Modelled from the actual scoring rules:
  --   per hit  = 10 × comboMult(≤4) × protocolMult(≤1.5) × modifier(≤1.8) = 108
  --   hits/lvl ≤ 10 + level   (n-Back's stream is the longest case)
  --   bonus/lvl ≤ 200         (Sprint: +100 per clear, 2 clears per level)
  --   Zen advances a level every 3 completions → ×3
  -- A player hitting ALL of those maxima at once is already unrealistic; the
  -- bound must still comfortably accept them.
  for v_n in 1..60 loop
    declare
      v_theoretical bigint := 0;
      l int;
    begin
      for l in 1..v_n loop
        v_theoretical := v_theoretical + (3 * ((10 + l) * 108 + 200));
      end loop;
      if v_theoretical > max_plausible_score(v_n) then
        raise exception 'FAIL: bound rejects a theoretical max run at level % (% > %)',
          v_n, v_theoretical, max_plausible_score(v_n);
      end if;
    end;
  end loop;
  raise notice 'PASS bound accepts the theoretical maximum run at every level 1–60';

  -- Spot-check the headroom so the bound is not absurdly loose either.
  select max_plausible_score(20) into v_bound;
  if v_bound < 100000 or v_bound > 1000000 then
    raise exception 'FAIL: level-20 bound % is outside a sane range', v_bound;
  end if;
  raise notice 'PASS level-20 bound is % (theoretical max run ~145k)', v_bound;

  -- ── A realistic strong run is accepted ─────────────────────────────────────
  perform submit_score('spatial_classic', p1, s1, 'HONEST', 28400, 14, 'spatial', 'classic');
  select count(*) into v_n from leaderboard_scores where player_id = p1;
  if v_n <> 1 then raise exception 'FAIL: a legitimate score was rejected'; end if;
  raise notice 'PASS a realistic strong run (28,400 @ level 14) is accepted';

  -- ── The defacement case is rejected ────────────────────────────────────────
  begin
    perform submit_score('spatial_classic', p2, s2, 'CHEAT', 9999999, 1, 'spatial', 'classic');
    raise exception 'FAIL: accepted a 9,999,999 score at level 1';
  exception
    when others then
      if position('FAIL:' in SQLERRM) > 0 then raise; end if;
      raise notice 'PASS 9,999,999 at level 1 rejected — %', left(SQLERRM, 60);
  end;

  -- Even claiming a high level does not unlock an arbitrary score.
  begin
    perform submit_score('spatial_classic', p2, s2, 'CHEAT', 9999999, 100, 'spatial', 'classic');
    raise exception 'FAIL: accepted 9,999,999 at level 100';
  exception
    when others then
      if position('FAIL:' in SQLERRM) > 0 then raise; end if;
      raise notice 'PASS 9,999,999 at level 100 rejected too';
  end;

  -- ── level_reached is now required and sane ─────────────────────────────────
  begin
    perform submit_score('spatial_classic', p2, s2, 'CHEAT', 500, null, 'spatial', 'classic');
    raise exception 'FAIL: accepted a null level_reached';
  exception
    when others then
      if position('FAIL:' in SQLERRM) > 0 then raise; end if;
      raise notice 'PASS null level_reached rejected';
  end;

  begin
    perform submit_score('spatial_classic', p2, s2, 'CHEAT', 500, 99999, 'spatial', 'classic');
    raise exception 'FAIL: accepted an absurd level_reached';
  exception
    when others then
      if position('FAIL:' in SQLERRM) > 0 then raise; end if;
      raise notice 'PASS absurd level_reached rejected';
  end;

  -- ── Rate limiting ──────────────────────────────────────────────────────────
  delete from rate_limit_buckets;

  -- Under the limit: fine. The per-player submit cap is 300/hour.
  for v_n in 1..100 loop
    perform bump_rate_limit('test:under', 120, interval '1 hour');
  end loop;
  raise notice 'PASS 100 hits under a 120 limit all pass';

  -- Over the limit: raises.
  v_ok := false;
  begin
    for v_n in 1..40 loop
      perform bump_rate_limit('test:under', 120, interval '1 hour');
    end loop;
  exception
    when others then v_ok := true;
  end;
  if not v_ok then raise exception 'FAIL: rate limit never fired'; end if;
  raise notice 'PASS rate limit fires once the window is exhausted';

  -- An expired window resets rather than staying latched shut forever.
  update rate_limit_buckets set window_start = now() - interval '2 hours'
   where bucket_key = 'test:under';
  perform bump_rate_limit('test:under', 120, interval '1 hour');
  select hits into v_n from rate_limit_buckets where bucket_key = 'test:under';
  if v_n <> 1 then raise exception 'FAIL: expired window did not reset (hits=%)', v_n; end if;
  raise notice 'PASS an expired window resets to 1';

  -- Buckets are independent — one player being limited must not limit another.
  perform bump_rate_limit('test:other', 5, interval '1 hour');
  select hits into v_n from rate_limit_buckets where bucket_key = 'test:other';
  if v_n <> 1 then raise exception 'FAIL: buckets are not independent'; end if;
  raise notice 'PASS buckets are independent per key';

  -- ── client_ip() must degrade, not explode, outside PostgREST ───────────────
  -- In psql `request.headers` does not exist. If this threw, every RPC would
  -- fail outside PostgREST — including these tests.
  if client_ip() is not null then
    raise exception 'FAIL: client_ip() should be null in psql, got %', client_ip();
  end if;
  raise notice 'PASS client_ip() returns null in psql rather than throwing';

  -- ── Real submissions are actually rate limited end to end ──────────────────
  delete from rate_limit_buckets;
  delete from leaderboard_scores;
  v_ok := false;
  begin
    -- Past the 300/hour per-player cap. Ascending scores so the upsert's
    -- "only if higher" guard never short-circuits a call into a no-op.
    for v_n in 1..310 loop
      perform submit_score('rate_test', p1, s1, 'HONEST', 100 + v_n, 14, 'spatial', 'classic');
    end loop;
  exception
    when others then
      if position('rate limit' in SQLERRM) > 0 then v_ok := true; else raise; end if;
  end;
  if not v_ok then raise exception 'FAIL: 310 submissions were not rate limited'; end if;
  raise notice 'PASS submit_score is rate limited end to end';

  -- ── The limiter stays latched after it fires ───────────────────────────────
  -- Worth asserting explicitly. When bump_rate_limit() raises, PL/pgSQL rolls
  -- back to the implicit savepoint, undoing that call's own increment — so the
  -- counter never climbs past the maximum. The limit therefore has to hold by
  -- *staying at* the cap rather than by exceeding it. If the reset branch were
  -- wrong, this is where it would show up as a limiter that opens back up.
  delete from rate_limit_buckets;
  for v_n in 1..5 loop
    perform bump_rate_limit('test:latch', 5, interval '1 hour');
  end loop;
  for v_n in 1..3 loop
    v_ok := false;
    begin
      perform bump_rate_limit('test:latch', 5, interval '1 hour');
    exception
      when others then v_ok := true;
    end;
    if not v_ok then raise exception 'FAIL: limiter reopened on attempt %', v_n; end if;
  end loop;
  select hits into v_n from rate_limit_buckets where bucket_key = 'test:latch';
  if v_n <> 5 then raise exception 'FAIL: latched counter drifted to %', v_n; end if;
  raise notice 'PASS limiter stays latched at the cap across repeated attempts';

  -- ── Housekeeping ───────────────────────────────────────────────────────────
  -- Fresh buckets: the caught exceptions above roll back their own writes, so
  -- anything created inside one of those blocks is already gone by now.
  insert into rate_limit_buckets (bucket_key, hits, window_start)
  values ('test:stale1', 3, now() - interval '48 hours'),
         ('test:stale2', 7, now() - interval '30 hours'),
         ('test:fresh',  1, now())
  on conflict (bucket_key) do update set window_start = excluded.window_start;

  select purge_rate_limits() into v_n;
  if v_n <> 2 then raise exception 'FAIL: purge removed % buckets, expected 2', v_n; end if;
  -- The recent bucket must survive, or housekeeping would reset live limits.
  if not exists (select 1 from rate_limit_buckets where bucket_key = 'test:fresh') then
    raise exception 'FAIL: purge removed a live bucket';
  end if;
  raise notice 'PASS purge_rate_limits() removed 2 stale buckets and kept the live one';

  -- ── Attestation gate ───────────────────────────────────────────────────────
  delete from rate_limit_buckets;
  delete from leaderboard_scores;
  delete from player_identities;

  -- Default OFF: nothing changes until it is deliberately switched on.
  if attestation_required() then
    raise exception 'FAIL: attestation defaults to ON — that would lock out new players on deploy';
  end if;
  raise notice 'PASS attestation defaults to off';

  -- An existing player is claimed while the gate is still open.
  perform submit_score('spatial_classic', p1, s1, 'EXISTING', 5000, 12, 'spatial', 'classic');

  update app_settings set value = 'true' where key = 'require_attestation';
  if not attestation_required() then
    raise exception 'FAIL: flag did not take effect';
  end if;

  -- A brand-new identity can no longer self-claim through the anon path. This is
  -- the whole point: free identities are what make per-player limits decorative.
  begin
    perform submit_score('spatial_classic', p2, s2, 'NEWCOMER', 1000, 5, 'spatial', 'classic');
    raise exception 'FAIL: a new identity was claimed with attestation required';
  exception
    when others then
      if position('FAIL:' in SQLERRM) > 0 then raise; end if;
      raise notice 'PASS unattested new identity rejected — %', left(SQLERRM, 45);
  end;

  -- The player who was already claimed must be unaffected. Turning the flag on
  -- must never lock out someone who has already posted a score.
  perform submit_score('rhythm_zen', p1, s1, 'EXISTING', 6000, 13, 'rhythm', 'zen');
  select count(*) into v_n from leaderboard_scores where player_id = p1;
  if v_n <> 2 then raise exception 'FAIL: existing player blocked by the gate (% rows)', v_n; end if;
  raise notice 'PASS an already-claimed player is unaffected by the gate';

  -- The Edge Function path — service_role only — does let a new identity through.
  perform claim_identity_attested(p2, s2);
  perform submit_score('spatial_classic', p2, s2, 'NEWCOMER', 1000, 5, 'spatial', 'classic');
  select count(*) into v_n from leaderboard_scores where player_id = p2;
  if v_n <> 1 then raise exception 'FAIL: attested claim did not admit the player'; end if;
  if not exists (select 1 from player_identities where player_id = p2 and attested) then
    raise exception 'FAIL: identity was not marked attested';
  end if;
  raise notice 'PASS an attested claim admits a new player and is recorded as attested';

  -- anon must not be able to call the claim function directly, or the gate is
  -- one RPC away from being skipped entirely.
  if has_function_privilege('anon', 'claim_identity_attested(uuid,uuid)', 'execute') then
    raise exception 'FAIL: anon can execute claim_identity_attested — the gate is bypassable';
  end if;
  raise notice 'PASS anon cannot execute claim_identity_attested';

  -- Restore the default so re-running the file is deterministic.
  update app_settings set value = 'false' where key = 'require_attestation';

  -- ── The moderator view resolves ────────────────────────────────────────────
  perform count(*) from suspicious_scores;
  raise notice 'PASS suspicious_scores view resolves';

  delete from player_reports;
  delete from leaderboard_scores;
  delete from banned_players;
  delete from player_identities;
  delete from rate_limit_buckets;

  raise notice 'ALL HARDENING CHECKS PASSED';
end $$;
