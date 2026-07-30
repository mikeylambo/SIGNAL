-- Functional check for delete_player_data(). Run against a database that has
-- already had schema.sql applied:
--   psql -d sigtest -v ON_ERROR_STOP=1 -f supabase/verify_delete.sql
-- Prints PASS/FAIL per assertion and raises on the first failure.
\set QUIET on
\pset pager off

do $$
declare
  alice      uuid := '11111111-1111-1111-1111-111111111111';
  alice_sec  uuid := 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
  bob        uuid := '22222222-2222-2222-2222-222222222222';
  bob_sec    uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  mallory    uuid := '33333333-3333-3333-3333-333333333333';
  mal_sec    uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_deleted  int;
  v_n        int;
begin
  -- Clean slate so the file is re-runnable.
  delete from player_reports;
  delete from leaderboard_scores;
  delete from banned_players;
  delete from player_identities;

  -- Alice posts to two boards; Bob to one.
  perform submit_score('spatial_classic', alice, alice_sec, 'ALICE', 5000, 9, 'spatial', 'classic');
  perform submit_score('rhythm_zen',      alice, alice_sec, 'ALICE', 3000, 6, 'rhythm',  'zen');
  perform submit_score('spatial_classic', bob,   bob_sec,   'BOB',   4000, 7, 'spatial', 'classic');

  -- Bob reports Alice (so a row holds a *copy* of Alice's name), and Alice
  -- reports Bob (so a row holds Alice's id as reporter).
  perform report_player(alice, bob, bob_sec);
  perform report_player(bob, alice, alice_sec);

  select count(*) into v_n from leaderboard_scores where player_id = alice;
  if v_n <> 2 then raise exception 'setup: expected 2 Alice scores, got %', v_n; end if;
  raise notice 'PASS setup — 2 Alice scores, 2 reports';

  -- ── A wrong secret must not be able to erase someone else ──────────────────
  begin
    perform delete_player_data(alice, mal_sec);
    raise exception 'FAIL: delete_player_data accepted a wrong owner_secret';
  exception
    when others then
      if position('FAIL:' in SQLERRM) > 0 then raise; end if;
      raise notice 'PASS wrong secret rejected — %', SQLERRM;
  end;

  -- Alice's data must still be intact after the rejected attempt.
  select count(*) into v_n from leaderboard_scores where player_id = alice;
  if v_n <> 2 then raise exception 'FAIL: rejected delete still removed % rows', 2 - v_n; end if;
  raise notice 'PASS rejected delete was a no-op';

  -- ── Ban preservation: ban Alice, then let her erase herself ────────────────
  insert into banned_players (player_id, reason) values (alice, 'test ban');
  -- The banned_players insert trigger purges scores, so re-post them to test
  -- deletion counting on a non-empty set.
  insert into leaderboard_scores (board_key, player_id, display_name, score)
  values ('spatial_classic', alice, 'ALICE', 5000), ('rhythm_zen', alice, 'ALICE', 3000);

  select delete_player_data(alice, alice_sec) into v_deleted;
  if v_deleted <> 2 then raise exception 'FAIL: expected 2 deleted, got %', v_deleted; end if;
  raise notice 'PASS erasure removed 2 score rows';

  select count(*) into v_n from leaderboard_scores where player_id = alice;
  if v_n <> 0 then raise exception 'FAIL: % Alice score rows survived', v_n; end if;

  select count(*) into v_n from player_identities where player_id = alice;
  if v_n <> 0 then raise exception 'FAIL: Alice identity survived'; end if;
  raise notice 'PASS identity forgotten';

  -- Both directions of report must be gone: the one naming Alice (holds her
  -- display name) and the one she filed (holds her id).
  select count(*) into v_n from player_reports
   where reported_player_id = alice or reporter_player_id = alice;
  if v_n <> 0 then raise exception 'FAIL: % reports referencing Alice survived', v_n; end if;
  raise notice 'PASS no report references Alice (name copy gone)';

  -- The ban must outlive erasure, or erasure is a ban-evasion button.
  select count(*) into v_n from banned_players where player_id = alice;
  if v_n <> 1 then raise exception 'FAIL: ban did not survive erasure'; end if;
  raise notice 'PASS ban survived erasure (no ban evasion)';

  -- ── Bob must be untouched ─────────────────────────────────────────────────
  select count(*) into v_n from leaderboard_scores where player_id = bob;
  if v_n <> 1 then raise exception 'FAIL: Bob lost data (% rows)', v_n; end if;
  raise notice 'PASS Bob unaffected';

  -- ── Idempotent: erasing again succeeds and reports nothing removed ─────────
  select delete_player_data(alice, alice_sec) into v_deleted;
  if v_deleted <> 0 then raise exception 'FAIL: second erase reported %', v_deleted; end if;
  raise notice 'PASS second erase is a 0-row no-op';

  -- Cleanup.
  delete from player_reports;
  delete from leaderboard_scores;
  delete from banned_players;
  delete from player_identities;

  raise notice 'ALL DELETE_PLAYER_DATA CHECKS PASSED';
end $$;
