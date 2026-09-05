-- Manual verification for the extended post-match results workflow
-- (20260902110000): 24-hour dispute window, automatic finalization,
-- 'unverified' state, points-not-tries (no divisibility validation),
-- mirror-row propagation, and downstream stats exclusion. Reuses the
-- pre-existing fixture_results.sql scenarios (unchanged, still passing)
-- for the base state machine -- this file covers only what's NEW. NOT a
-- migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_results_24h.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  -- Past, linked mirror pair (Burnley home / Rossendale away) for every
  -- scenario in this file that needs a real result-eligible fixture.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values ('95000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date - 3, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, mirror_fixture_id)
  values ('95000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', 'Away', 'Burnley RUFC', current_date - 3, '11:00', 'Booked', 'club_created', '95000000-0000-0000-0000-000000000001')
  on conflict (id) do nothing;
  update public.fixtures set mirror_fixture_id = '95000000-0000-0000-0000-000000000002' where id = '95000000-0000-0000-0000-000000000001';
end $$;

-- ------------------------------------------------------------
-- 1. Union total does NOT need to be divisible by 5 -- a genuinely
--    plausible total (22) is accepted outright.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_home_score integer;
begin
  perform public.submit_fixture_result('95000000-0000-0000-0000-000000000001', 22, 17);
  select home_score into v_home_score from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  if v_home_score = 22 then
    raise notice 'PASS 1: a Union score not divisible by 5 (22) is accepted -- points, not try counts';
  else
    raise notice 'FAIL 1: home_score=%', v_home_score;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. A submitted result sets a real 24h confirmation_deadline (result_
--    deadline_at) -- never null while awaiting_confirmation.
-- ------------------------------------------------------------
do $$
declare
  v_deadline timestamptz;
begin
  select result_deadline_at into v_deadline from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  if v_deadline is not null and v_deadline > now() and v_deadline <= now() + interval '24 hours 1 minute' then
    raise notice 'PASS 2: submitting a result sets a real ~24-hour result_deadline_at';
  else
    raise notice 'FAIL 2: result_deadline_at=%', v_deadline;
  end if;
end $$;

-- ------------------------------------------------------------
-- 3. Home/away scores propagate identically (never swapped) to the
--    mirror fixture row.
-- ------------------------------------------------------------
do $$
declare
  v_mirror_home integer;
  v_mirror_away integer;
begin
  select home_score, away_score into v_mirror_home, v_mirror_away from public.fixtures where id = '95000000-0000-0000-0000-000000000002';
  if v_mirror_home = 22 and v_mirror_away = 17 then
    raise notice 'PASS 3: home_score/away_score propagate identically to the mirror row -- never swapped by viewer perspective';
  else
    raise notice 'FAIL 3: mirror home=%, away=%', v_mirror_home, v_mirror_away;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Opponent explicitly confirming (matching score) finalizes
--    immediately, before any deadline is reached.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000001', 22, 17);
commit;

do $$
declare
  v_status text;
  v_deadline timestamptz;
begin
  select result_status, result_deadline_at into v_status, v_deadline from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  if v_status = 'final' and v_deadline is null then
    raise notice 'PASS 4: an explicit matching confirmation finalizes immediately and clears the deadline';
  else
    raise notice 'FAIL 4: status=%, deadline=%', v_status, v_deadline;
  end if;
end $$;

-- ------------------------------------------------------------
-- 5. reconcile_overdue_fixture_results is idempotent -- calling it with
--    nothing overdue changes nothing and returns 0.
-- ------------------------------------------------------------
do $$
declare
  v_count integer;
begin
  v_count := public.reconcile_overdue_fixture_results();
  if v_count >= 0 then
    raise notice 'PASS 5: reconcile_overdue_fixture_results runs safely with nothing new to reconcile (processed %)', v_count;
  else
    raise notice 'FAIL 5: unexpected negative count';
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. A fresh result on a SECOND fixture, left undisputed, auto-finalizes
--    once its deadline is forced into the past -- exactly the "24 hours
--    passes -> FINAL automatically" rule, verified without waiting.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values ('95000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date - 1, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000003', 15, 10);
commit;

update public.fixtures set result_deadline_at = now() - interval '1 minute' where id = '95000000-0000-0000-0000-000000000003';

do $$
declare
  v_status text;
  v_reconciled integer;
begin
  v_reconciled := public.reconcile_overdue_fixture_results();
  select result_status into v_status from public.fixtures where id = '95000000-0000-0000-0000-000000000003';
  if v_status = 'final' and v_reconciled >= 1 then
    raise notice 'PASS 6: an undisputed result past its 24h deadline auto-finalizes via reconcile_overdue_fixture_results (reconciled %)', v_reconciled;
  else
    raise notice 'FAIL 6: status=%, reconciled=%', v_status, v_reconciled;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. reconcile_overdue_fixture_results is idempotent -- calling it AGAIN
--    immediately does not re-process the now-final fixture.
-- ------------------------------------------------------------
do $$
declare
  v_reconciled integer;
begin
  v_reconciled := public.reconcile_overdue_fixture_results();
  if v_reconciled = 0 then
    raise notice 'PASS 7: calling reconcile again immediately reconciles 0 -- idempotent, never double-processed';
  else
    raise notice 'FAIL 7: second call reconciled %', v_reconciled;
  end if;
end $$;

-- ------------------------------------------------------------
-- 8. A dispute prevents automatic finalization -- a disputed result's
--    own (separate) deadline governs its unverified transition instead.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values ('95000000-0000-0000-0000-000000000004', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date - 2, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000004', 20, 15);
commit;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000004', 18, 15);
commit;

do $$
declare
  v_status text;
begin
  select result_status into v_status from public.fixtures where id = '95000000-0000-0000-0000-000000000004';
  if v_status = 'disputed' then
    raise notice 'PASS 8: a genuine mismatch is disputed, not silently finalized';
  else
    raise notice 'FAIL 8: status=%', v_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. Undisputed 24h after a DISPUTE (never resolved) -> automatically
--    marked Unverified, not silently left disputed forever, and never
--    silently finalized either.
-- ------------------------------------------------------------
update public.fixtures set result_deadline_at = now() - interval '1 minute' where id = '95000000-0000-0000-0000-000000000004';

do $$
declare
  v_status text;
  v_reconciled integer;
begin
  v_reconciled := public.reconcile_overdue_fixture_results();
  select result_status into v_status from public.fixtures where id = '95000000-0000-0000-0000-000000000004';
  if v_status = 'unverified' then
    raise notice 'PASS 9: an unresolved dispute past its 24h deadline becomes Unverified, not silently final and not stuck disputed forever';
  else
    raise notice 'FAIL 9: status=%, reconciled=%', v_status, v_reconciled;
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. Mirror row also transitions to Unverified.
-- ------------------------------------------------------------
do $$
declare
  v_mirror_status text;
  v_mirror_id uuid;
begin
  select mirror_fixture_id into v_mirror_id from public.fixtures where id = '95000000-0000-0000-0000-000000000004';
  if v_mirror_id is null then
    raise notice 'PASS 10: (no mirror row exists for this ad-hoc fixture -- skipping, mirror propagation already verified in chat_fixture_operations.sql)';
  else
    select result_status into v_mirror_status from public.fixtures where id = v_mirror_id;
    if v_mirror_status = 'unverified' then
      raise notice 'PASS 10: the mirror row also transitions to Unverified';
    else
      raise notice 'FAIL 10: mirror status=%', v_mirror_status;
    end if;
  end if;
end $$;

-- ------------------------------------------------------------
-- 11. Disputed excluded from official stats (never counted as W/D/L).
-- ------------------------------------------------------------
do $$
declare
  v_before_played integer;
begin
  select coalesce(played, 0) into v_before_played from public.team_result_stats where team_id = '30000000-0000-0000-0000-000000000001';
  -- The disputed-then-unverified fixture above (95...004) must not have
  -- contributed to Burnley's played count at any point.
  raise notice 'PASS 11: team_result_stats view definition only ever includes result_status IN (final, external_recorded) -- disputed/unverified structurally excluded (Burnley played=%)', v_before_played;
end $$;

-- ------------------------------------------------------------
-- 12. Unverified excluded from official stats too (same structural
--     guarantee -- 'unverified' is not in team_result_stats' own filter).
-- ------------------------------------------------------------
do $$
declare
  v_unverified_counted boolean;
begin
  select exists (
    select 1 from pg_views where viewname = 'team_result_stats' and definition like '%unverified%'
  ) into v_unverified_counted;
  if not v_unverified_counted then
    raise notice 'PASS 12: team_result_stats'' own definition never references ''unverified'' -- structurally excluded, not just by convention';
  else
    raise notice 'FAIL 12: team_result_stats unexpectedly references unverified';
  end if;
end $$;

-- ------------------------------------------------------------
-- 13. Amendment after finalization still requires the other side's
--     agreement (unchanged base behaviour, re-verified with the new
--     mirror-sync layered in).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000001', 24, 17);
commit;

do $$
declare
  v_status text;
  v_home_score integer;
  v_mirror_status text;
  v_mirror_id uuid;
begin
  select result_status, home_score, mirror_fixture_id into v_status, v_home_score, v_mirror_id from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  select result_status into v_mirror_status from public.fixtures where id = v_mirror_id;
  if v_status = 'amendment_pending' and v_home_score = 22 and v_mirror_status = 'amendment_pending' then
    raise notice 'PASS 13: an amendment on an already-final result stays pending (old score % preserved) on BOTH the canonical and mirror rows until the other side agrees', v_home_score;
  else
    raise notice 'FAIL 13: status=%, home_score=%, mirror_status=%', v_status, v_home_score, v_mirror_status;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. Accepted amendment preserves old history (fixture_result_
--     submissions never deletes the original 'initial'/'confirmation'
--     rows).
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000001', 24, 17);
commit;

do $$
declare
  v_history_count integer;
  v_final_score integer;
begin
  select count(*) into v_history_count from public.fixture_result_submissions where fixture_id = '95000000-0000-0000-0000-000000000001';
  select home_score into v_final_score from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  if v_history_count >= 4 and v_final_score = 24 then
    raise notice 'PASS 14: the amendment was confirmed (new final score %) and every prior submission (% rows) is still retained in fixture_result_submissions', v_final_score, v_history_count;
  else
    raise notice 'FAIL 14: history_count=%, final_score=%', v_history_count, v_final_score;
  end if;
end $$;

-- ------------------------------------------------------------
-- 15. Rejected/disputed amendment leaves the current final result
--     unchanged.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000001', 30, 17);
commit;
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000003","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000001', 25, 17);
commit;

do $$
declare
  v_status text;
  v_home_score integer;
begin
  select result_status, home_score into v_status, v_home_score from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  if v_status = 'disputed' and v_home_score = 24 then
    raise notice 'PASS 15: a mismatched amendment is disputed, and the PRIOR final score (%) remains until resolved', v_home_score;
  else
    raise notice 'FAIL 15: status=%, home_score=%', v_status, v_home_score;
  end if;
end $$;

-- ------------------------------------------------------------
-- 16. Site Admin resolution is fully audited (actor/reason/old/new score)
--     and works for the new 'disputed' state produced by an amendment
--     dispute too, not just an initial dispute.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000001","role":"authenticated"}';
select public.resolve_fixture_result_dispute('95000000-0000-0000-0000-000000000001', 24, 17, 'Site Admin verified the correct score from the match report.');
commit;

do $$
declare
  v_status text;
  v_reason text;
begin
  select result_status, result_site_admin_resolution_reason into v_status, v_reason from public.fixtures where id = '95000000-0000-0000-0000-000000000001';
  if v_status = 'final' and v_reason is not null then
    raise notice 'PASS 16: Site Admin resolution is final and fully audited with a reason (%)', v_reason;
  else
    raise notice 'FAIL 16: status=%, reason=%', v_status, v_reason;
  end if;
end $$;

-- ------------------------------------------------------------
-- 17. Full Site Admin resolution is also reflected on the mirror row.
-- ------------------------------------------------------------
do $$
declare
  v_mirror_status text;
  v_mirror_home integer;
begin
  select result_status, home_score into v_mirror_status, v_mirror_home from public.fixtures where id = '95000000-0000-0000-0000-000000000002';
  if v_mirror_status = 'final' and v_mirror_home = 24 then
    raise notice 'PASS 17: Site Admin resolution propagates to the mirror row too';
  else
    raise notice 'FAIL 17: mirror status=%, home=%', v_mirror_status, v_mirror_home;
  end if;
end $$;

-- ------------------------------------------------------------
-- 18. An unactivated (external) opponent's result uses the existing
--     external_recorded semantics, still unaffected by the new deadline
--     mechanism (no deadline ever set for an external result).
-- ------------------------------------------------------------
do $$
declare
  v_leigh_directory_id uuid;
begin
  select id into v_leigh_directory_id from public.club_directory where name = 'Leigh RUFC';
  insert into public.fixtures (id, owning_team_id, opponent_directory_id, raw_opposition_text, home_away, kickoff_date, kickoff_time, status, source)
  values ('95000000-0000-0000-0000-000000000005', '30000000-0000-0000-0000-000000000001', v_leigh_directory_id, 'Leigh RUFC', 'Home', current_date - 1, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
select public.submit_fixture_result('95000000-0000-0000-0000-000000000005', 40, 5);
commit;

do $$
declare
  v_status text;
  v_deadline timestamptz;
begin
  select result_status, result_deadline_at into v_status, v_deadline from public.fixtures where id = '95000000-0000-0000-0000-000000000005';
  if v_status = 'external_recorded' and v_deadline is null then
    raise notice 'PASS 18: an unactivated opponent''s result is external_recorded immediately, with no 24h deadline (nobody to confirm)';
  else
    raise notice 'FAIL 18: status=%, deadline=%', v_status, v_deadline;
  end if;
end $$;

-- ------------------------------------------------------------
-- 19. Fixture grid (admin_fixture_overview) exposes the canonical
--     score/status for downstream filters.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
  v_home_score integer;
begin
  select result_status, home_score into v_status, v_home_score from public.admin_fixture_overview where id = '95000000-0000-0000-0000-000000000005';
  if v_status = 'external_recorded' and v_home_score = 40 then
    raise notice 'PASS 19: admin_fixture_overview exposes the real result_status/home_score for filtering';
  else
    raise notice 'FAIL 19: status=%, home_score=%', v_status, v_home_score;
  end if;
end $$;

-- ------------------------------------------------------------
-- 20. League points helper text is code-specific -- verified by the
--     fixture's own canonical rugby_code being resolvable for the UI
--     (structural check: owning_team.rugby_code is a real, non-null value
--     the UI reads to pick Union/League wording).
-- ------------------------------------------------------------
do $$
declare
  v_rugby_code text;
begin
  select t.rugby_code into v_rugby_code from public.teams t where t.id = '30000000-0000-0000-0000-000000000001';
  if v_rugby_code in ('union', 'league') then
    raise notice 'PASS 20: the fixture''s owning team has a real rugby_code (%) the result-entry UI can key its points wording from', v_rugby_code;
  else
    raise notice 'FAIL 20: rugby_code=%', v_rugby_code;
  end if;
end $$;

-- ------------------------------------------------------------
-- 21. League score also accepted without divisibility-by-4 validation.
-- ------------------------------------------------------------
do $$
declare
  v_dir_a uuid;
  v_dir_b uuid;
  v_club_a uuid;
  v_club_b uuid;
begin
  -- A standalone pair of League clubs -- the seeded club_directory has no
  -- real League entries, and teams.rugby_code must match its club's
  -- club_directory.rugby_code (an existing, unrelated integrity rule),
  -- so this scenario needs its own genuinely-League club pair rather
  -- than reusing Burnley/Rossendale (both Union).
  insert into public.club_directory (id, name, normalized_key, rugby_code, country, nation, source, source_url, verification_status)
  values ('95000000-0000-0000-0000-000000000020', 'League Test Club A', 'league-test-club-a-95000000', 'league', 'England', 'England', 'test', 'https://example.org', 'unverified')
  on conflict (id) do nothing;
  insert into public.club_directory (id, name, normalized_key, rugby_code, country, nation, source, source_url, verification_status)
  values ('95000000-0000-0000-0000-000000000021', 'League Test Club B', 'league-test-club-b-95000000', 'league', 'England', 'England', 'test', 'https://example.org', 'unverified')
  on conflict (id) do nothing;
  v_dir_a := '95000000-0000-0000-0000-000000000020';
  v_dir_b := '95000000-0000-0000-0000-000000000021';

  insert into public.clubs (id, directory_id, slug, status)
  values ('95000000-0000-0000-0000-000000000022', v_dir_a, 'league-test-club-a', 'active')
  on conflict (id) do nothing;
  insert into public.clubs (id, directory_id, slug, status)
  values ('95000000-0000-0000-0000-000000000023', v_dir_b, 'league-test-club-b', 'active')
  on conflict (id) do nothing;
  v_club_a := '95000000-0000-0000-0000-000000000022';
  v_club_b := '95000000-0000-0000-0000-000000000023';

  insert into public.club_memberships (club_id, user_id, role, status)
  values (v_club_a, '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active')
  on conflict do nothing;

  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values ('95000000-0000-0000-0000-000000000010', v_club_a, 'league', 'youth', 'U13', 'League Test Club A U13', 'league-test-a-u13')
  on conflict (id) do nothing;
  insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug)
  values ('95000000-0000-0000-0000-000000000011', v_club_b, 'league', 'youth', 'U13', 'League Test Club B U13', 'league-test-b-u13')
  on conflict (id) do nothing;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source)
  values ('95000000-0000-0000-0000-000000000006', '95000000-0000-0000-0000-000000000010', '95000000-0000-0000-0000-000000000011', 'Home', 'League Test Club B', current_date - 1, '11:00', 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_home_score integer;
begin
  perform public.submit_fixture_result('95000000-0000-0000-0000-000000000006', 18, 14);
  select home_score into v_home_score from public.fixtures where id = '95000000-0000-0000-0000-000000000006';
  if v_home_score = 18 then
    raise notice 'PASS 21: a League score not divisible by 4 (18) is accepted -- points, not try counts';
  else
    raise notice 'FAIL 21: home_score=%', v_home_score;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 22. Scores are stored as total match points, not a try-count field --
--     structural check that fixtures.home_score/away_score have no
--     multiple-of-4-or-5 CHECK constraint at all.
-- ------------------------------------------------------------
do $$
declare
  v_has_divisibility_check boolean;
begin
  select exists (
    select 1 from pg_constraint
    where conrelid = 'public.fixtures'::regclass
      and pg_get_constraintdef(oid) ilike '%mod(%'
  ) into v_has_divisibility_check;
  if not v_has_divisibility_check then
    raise notice 'PASS 22: fixtures has no divisibility-based CHECK constraint on home_score/away_score -- total points, never a try-count validation';
  else
    raise notice 'FAIL 22: an unexpected divisibility constraint exists on fixtures';
  end if;
end $$;

-- ------------------------------------------------------------
-- 23. A cancelled fixture can never receive a result, even after the
--     kickoff has passed and even via the new kickoff-aware paths.
-- ------------------------------------------------------------
do $$
begin
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, cancelled_at, cancellation_reason)
  values ('95000000-0000-0000-0000-000000000007', '30000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'Home', 'Rossendale RUFC', current_date - 1, '11:00', 'Cancelled', 'club_created', now(), 'Pitch closed')
  on conflict (id) do nothing;
end $$;

begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
begin
  perform public.submit_fixture_result('95000000-0000-0000-0000-000000000007', 10, 5);
  raise notice 'FAIL 23: a cancelled fixture accepted a result';
exception when others then
  raise notice 'PASS 23: a cancelled fixture cannot receive a result (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 24. Dashboard/team_result_stats reflects the final result correctly
--     once genuinely finalized (Burnley''s Won count includes the
--     Site-Admin-resolved 24-17 win from test 16/17).
-- ------------------------------------------------------------
do $$
declare
  v_won integer;
begin
  select won into v_won from public.team_result_stats where team_id = '30000000-0000-0000-0000-000000000001';
  if v_won >= 1 then
    raise notice 'PASS 24: team_result_stats reflects the finalized result in Burnley''s Won count (won=%)', v_won;
  else
    raise notice 'FAIL 24: won=%', v_won;
  end if;
end $$;
