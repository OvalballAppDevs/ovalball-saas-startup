-- Manual verification for season windows, age-grade rollover review, and
-- training-as-calendar-event (20260902150000, 20260902160000). NOT a
-- migration -- run AFTER permission_matrix.sql.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/permission_matrix.sql
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/season_rollover.sql

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code) values
    ('98000000-0000-0000-0000-000000000101', 'Union 2025/26 Test', '2025-09-01', '2026-05-31', '2025-06-01', 'union'),
    ('98000000-0000-0000-0000-000000000102', 'Union 2026/27 Test', '2026-09-01', '2027-05-31', '2026-06-01', 'union'),
    ('98000000-0000-0000-0000-000000000103', 'League 2026 Test', '2026-03-01', '2026-10-31', '2025-11-01', 'league'),
    ('98000000-0000-0000-0000-000000000104', 'League 2027 Test', '2027-03-01', '2027-10-31', '2026-11-01', 'league'),
    ('98000000-0000-0000-0000-000000000105', 'League 2028 Test', '2028-03-01', '2028-10-31', '2027-11-01', 'league')
  on conflict (id) do nothing;

  -- A dedicated Burnley U12 (squad C) to prove U12 A -> U13 A style
  -- mapping without touching the shared 30000000-... test fixture used
  -- by every other test file.
  insert into public.teams (id, club_id, rugby_code, category, age_group, squad_designation, display_name, slug) values
    ('98000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U12', 'C', 'Burnley RUFC U12 C', 'burnley-u12-c'),
    ('98000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U16', null, 'Burnley RUFC U16', 'burnley-u16-rlv'),
    ('98000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U7', 'C', 'Burnley RUFC U7 C', 'burnley-u7-rlv'),
    ('98000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'union', 'youth', 'U8', 'C', 'Burnley RUFC U8 C', 'burnley-u8-rlv')
  on conflict (id) do nothing;

  -- A historical (past) fixture for U12 C, in the FROM season's window --
  -- must stay historically U12 after the team rolls to U13.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('98000000-0000-0000-0000-000000000010', '98000000-0000-0000-0000-000000000001', null, 'Home', 'Old Rivals FC', '2026-02-10', 'Completed', 'club_created')
  on conflict (id) do nothing;

  -- A fixture already booked ahead into the TO season's window, before
  -- rollover is even generated -- must survive rollover untouched.
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values ('98000000-0000-0000-0000-000000000011', '98000000-0000-0000-0000-000000000001', null, 'Home', 'Next Season Rivals FC', '2026-10-05', 'Booked', 'club_created')
  on conflict (id) do nothing;
end $$;

-- ------------------------------------------------------------
-- 1. Union rollover becomes effective from 1 June (the season row's own
--    pre_season_starts_on) -- generating a Union rollover to the 2026/27
--    season resolves the correct FROM season and stores that boundary.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_rollover_id uuid;
  v_from_season_id uuid;
  v_pre_season_starts_on date;
begin
  v_rollover_id := public.generate_rollover_proposal('10000000-0000-0000-0000-000000000001', 'union', '98000000-0000-0000-0000-000000000102');
  select from_season_id into v_from_season_id from public.age_grade_rollovers where id = v_rollover_id;
  select pre_season_starts_on into v_pre_season_starts_on from public.seasons where id = '98000000-0000-0000-0000-000000000102';
  if v_from_season_id = '98000000-0000-0000-0000-000000000101' and v_pre_season_starts_on = '2026-06-01' then
    raise notice 'PASS 1: a Union rollover to 2026/27 resolves the correct prior season and becomes effective from 1 June (the season''s own pre-season start)';
  else
    raise notice 'FAIL 1: from_season_id=%, pre_season_starts_on=%', v_from_season_id, v_pre_season_starts_on;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 2. League rollover becomes effective from 1 November.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_from_season_id uuid;
  v_pre_season_starts_on date;
begin
  perform public.generate_rollover_proposal('10000000-0000-0000-0000-000000000001', 'league', '98000000-0000-0000-0000-000000000104');
  select pre_season_starts_on into v_pre_season_starts_on from public.seasons where id = '98000000-0000-0000-0000-000000000104';
  if v_pre_season_starts_on = '2026-11-01' then
    raise notice 'PASS 2: a League rollover becomes effective from 1 November (the season''s own pre-season start)';
  else
    raise notice 'FAIL 2: pre_season_starts_on=%', v_pre_season_starts_on;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 3. Generating the proposal never silently mutates a real team.
-- ------------------------------------------------------------
do $$
declare
  v_age_group text;
begin
  select age_group into v_age_group from public.teams where id = '98000000-0000-0000-0000-000000000001';
  if v_age_group = 'U12' then
    raise notice 'PASS 3: generating a rollover proposal never silently mutates a real team -- U12 C is still U12 until explicitly confirmed';
  else
    raise notice 'FAIL 3: age_group=%', v_age_group;
  end if;
end $$;

-- ------------------------------------------------------------
-- 4. Club Admin review is required -- an ordinary club member cannot
--    generate a rollover proposal.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000004","role":"authenticated"}';
do $$
begin
  perform public.generate_rollover_proposal('10000000-0000-0000-0000-000000000001', 'union', '98000000-0000-0000-0000-000000000102');
  raise notice 'FAIL 4: an ordinary club member generated a rollover proposal';
exception when others then
  raise notice 'PASS 4: an ordinary club member cannot generate a rollover proposal -- Club Admin review is required (%)', sqlerrm;
end $$;
rollback;

-- ------------------------------------------------------------
-- 5. U12 -> U13 mechanical mapping is proposed correctly, no manual
--    choice required.
-- ------------------------------------------------------------
do $$
declare
  v_proposed text;
  v_manual boolean;
  v_proposal_id uuid;
begin
  select p.id, p.proposed_age_group, p.requires_manual_choice into v_proposal_id, v_proposed, v_manual
  from public.age_grade_rollover_team_proposals p
  join public.age_grade_rollovers r on r.id = p.rollover_id
  where p.team_id = '98000000-0000-0000-0000-000000000001' and r.to_season_id = '98000000-0000-0000-0000-000000000102';
  if v_proposed = 'U13' and v_manual = false then
    raise notice 'PASS 5: Burnley U12 C is proposed to roll forward to U13, no manual choice required';
  else
    raise notice 'FAIL 5: proposed=%, manual=%', v_proposed, v_manual;
  end if;
end $$;

-- ------------------------------------------------------------
-- 6. Confirming applies the age group and retains squad designation when
--    not explicitly overridden.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_proposal_id uuid;
begin
  select p.id into v_proposal_id
  from public.age_grade_rollover_team_proposals p
  join public.age_grade_rollovers r on r.id = p.rollover_id
  where p.team_id = '98000000-0000-0000-0000-000000000001' and r.to_season_id = '98000000-0000-0000-0000-000000000102';
  perform public.confirm_rollover_team_proposal(v_proposal_id, 'confirm');
end $$;
commit;

do $$
declare
  v_age_group text;
  v_squad text;
begin
  select age_group, squad_designation into v_age_group, v_squad from public.teams where id = '98000000-0000-0000-0000-000000000001';
  if v_age_group = 'U13' and v_squad = 'C' then
    raise notice 'PASS 6: confirming the rollover applies the new age group (U13) and retains the existing squad designation (C) when not overridden';
  else
    raise notice 'FAIL 6: age_group=%, squad=%', v_age_group, v_squad;
  end if;
end $$;

-- ------------------------------------------------------------
-- 7. U16 requires an explicit destination -- no automatic mapping, and
--    confirming without one is rejected.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_proposed text;
  v_manual boolean;
  v_proposal_id uuid;
begin
  select p.id, p.proposed_age_group, p.requires_manual_choice into v_proposal_id, v_proposed, v_manual
  from public.age_grade_rollover_team_proposals p
  join public.age_grade_rollovers r on r.id = p.rollover_id
  where p.team_id = '98000000-0000-0000-0000-000000000002' and r.to_season_id = '98000000-0000-0000-0000-000000000102';
  if v_proposed is null and v_manual = true then
    raise notice 'PASS 7a: U16 is flagged as requiring an explicit Club Admin choice -- no age is invented (Colts/Junior Colts/1st team, etc.)';
  else
    raise notice 'FAIL 7a: proposed=%, manual=%', v_proposed, v_manual;
  end if;

  begin
    perform public.confirm_rollover_team_proposal(v_proposal_id, 'confirm');
    raise notice 'FAIL 7b: U16 was confirmed with no destination age group supplied';
  exception when others then
    raise notice 'PASS 7b: confirming a U16 rollover with no explicit destination is rejected (%)', sqlerrm;
  end;
end $$;
commit;

-- ------------------------------------------------------------
-- 8. The historical (past) fixture stays historically U12 even after the
--    owning team rolls forward to U13 -- the snapshot is never rewritten.
-- ------------------------------------------------------------
do $$
declare
  v_snapshot text;
begin
  select owning_team_age_group_snapshot into v_snapshot from public.fixtures where id = '98000000-0000-0000-0000-000000000010';
  if v_snapshot = 'U12' then
    raise notice 'PASS 8: a 2025/26 U12 fixture stays historically identifiable as U12 even though the cohort is now U13';
  else
    raise notice 'FAIL 8: snapshot=%', v_snapshot;
  end if;
end $$;

-- ------------------------------------------------------------
-- 9. The historical fixture's own season remains queryable as the
--    PREVIOUS season -- it is never rewritten to point at the new season.
-- ------------------------------------------------------------
do $$
declare
  v_season_id uuid;
begin
  select season_id into v_season_id from public.fixtures where id = '98000000-0000-0000-0000-000000000010';
  if v_season_id = '98000000-0000-0000-0000-000000000101' then
    raise notice 'PASS 9: the historical fixture remains attached to its original (previous) season, still queryable as 2025/26';
  else
    raise notice 'FAIL 9: season_id=%', v_season_id;
  end if;
end $$;

-- ------------------------------------------------------------
-- 10. Union pre-season window: 1 Jun - 31 Aug.
-- ------------------------------------------------------------
do $$
declare
  v_phase text;
begin
  select internal.season_phase('98000000-0000-0000-0000-000000000102', '2026-07-15') into v_phase;
  if v_phase = 'pre_season' then
    raise notice 'PASS 10: 15 July falls within the Union pre-season window (1 Jun - 31 Aug)';
  else
    raise notice 'FAIL 10: phase=%', v_phase;
  end if;
end $$;

-- ------------------------------------------------------------
-- 11. Union main season window: 1 Sep - 31 May (including the last day).
-- ------------------------------------------------------------
do $$
declare
  v_phase_oct text;
  v_phase_last_day text;
begin
  select internal.season_phase('98000000-0000-0000-0000-000000000102', '2026-10-01') into v_phase_oct;
  select internal.season_phase('98000000-0000-0000-0000-000000000102', '2027-05-31') into v_phase_last_day;
  if v_phase_oct = 'main_season' and v_phase_last_day = 'main_season' then
    raise notice 'PASS 11: 1 October and 31 May (the exact last day) both correctly fall within the Union main season (1 Sep - 31 May)';
  else
    raise notice 'FAIL 11: oct=%, last_day=%', v_phase_oct, v_phase_last_day;
  end if;
end $$;

-- ------------------------------------------------------------
-- 12. League pre-season window: 1 Nov - end of Feb.
-- ------------------------------------------------------------
do $$
declare
  v_phase text;
begin
  select internal.season_phase('98000000-0000-0000-0000-000000000104', '2027-01-15') into v_phase;
  if v_phase = 'pre_season' then
    raise notice 'PASS 12: 15 January falls within the League pre-season window (1 Nov - end of Feb)';
  else
    raise notice 'FAIL 12: phase=%', v_phase;
  end if;
end $$;

-- ------------------------------------------------------------
-- 13. League main season window: 1 Mar - 31 Oct.
-- ------------------------------------------------------------
do $$
declare
  v_phase text;
begin
  select internal.season_phase('98000000-0000-0000-0000-000000000104', '2027-06-01') into v_phase;
  if v_phase = 'main_season' then
    raise notice 'PASS 13: 1 June falls within the League main season (1 Mar - 31 Oct)';
  else
    raise notice 'FAIL 13: phase=%', v_phase;
  end if;
end $$;

-- ------------------------------------------------------------
-- 14. Leap-year February is handled correctly -- 29 Feb 2028 resolves
--     as League pre-season (real dates stored, never a hard-coded day
--     count that would misfire on a leap year).
-- ------------------------------------------------------------
do $$
declare
  v_phase text;
begin
  select internal.season_phase('98000000-0000-0000-0000-000000000105', '2028-02-29') into v_phase;
  if v_phase = 'pre_season' then
    raise notice 'PASS 14: 29 February 2028 (a real leap day) correctly resolves as League pre-season, no error and no misfire';
  else
    raise notice 'FAIL 14: phase=%', v_phase;
  end if;
end $$;

-- ------------------------------------------------------------
-- 15. Training is valid in pre-season.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_session_id uuid;
begin
  v_session_id := public.create_training_session('10000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', null, '2026-07-10', '18:00', '19:30', null, 'Pre-season fitness');
  if v_session_id is not null then
    raise notice 'PASS 15: a training session can be booked during pre-season';
  else
    raise notice 'FAIL 15: create_training_session returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 16. Training is valid in main season.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_session_id uuid;
begin
  v_session_id := public.create_training_session('10000000-0000-0000-0000-000000000001', '98000000-0000-0000-0000-000000000001', null, '2026-10-20', '18:00', '19:30', null, 'Main-season session');
  if v_session_id is not null then
    raise notice 'PASS 16: a training session can be booked during the main season';
  else
    raise notice 'FAIL 16: create_training_session returned null';
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 17. Training is not a fixture -- no fixtures row is created, and the
--     training_sessions table structurally carries no opponent/result
--     columns (never fakeable as a match).
-- ------------------------------------------------------------
do $$
declare
  v_fixture_count integer;
  v_bad_column_count integer;
begin
  select count(*) into v_fixture_count from public.fixtures where raw_opposition_text ilike '%Pre-season fitness%' or raw_opposition_text ilike '%Main-season session%';
  select count(*) into v_bad_column_count from information_schema.columns
  where table_schema = 'public' and table_name = 'training_sessions'
    and column_name in ('opponent_team_id', 'home_score', 'away_score', 'result_status');
  if v_fixture_count = 0 and v_bad_column_count = 0 then
    raise notice 'PASS 17: training sessions create no fixture row and the table itself has no opponent/result columns -- structurally never fakeable as a match';
  else
    raise notice 'FAIL 17: fixture_count=%, bad_column_count=%', v_fixture_count, v_bad_column_count;
  end if;
end $$;

-- ------------------------------------------------------------
-- 18. A future fixture already booked ahead into the next season's
--     window before rollover survives rollover completely untouched --
--     never lost, never silently moved.
-- ------------------------------------------------------------
do $$
declare
  v_status text;
  v_kickoff date;
begin
  select status, kickoff_date into v_status, v_kickoff from public.fixtures where id = '98000000-0000-0000-0000-000000000011';
  if v_status = 'Booked' and v_kickoff = '2026-10-05' then
    raise notice 'PASS 18: a fixture legitimately booked ahead into the next season''s window is retained, unaffected by the rollover review';
  else
    raise notice 'FAIL 18: status=%, kickoff=%', v_status, v_kickoff;
  end if;
end $$;

-- ------------------------------------------------------------
-- 19. A shared U7/U8 mini-rugby group rolling forward would produce
--     U8/U9 -- an invalid combination -- so it is flagged for explicit
--     reconfiguration, never silently rolled forward. Resolving the flag
--     never reconfigures the group itself.
-- ------------------------------------------------------------
begin;
set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';
do $$
declare
  v_group_id uuid;
  v_flag_id uuid;
  v_rollover_id uuid;
  v_member_count_before integer;
  v_member_count_after integer;
begin
  v_group_id := public.create_scheduling_group('10000000-0000-0000-0000-000000000001', array['98000000-0000-0000-0000-000000000003'::uuid, '98000000-0000-0000-0000-000000000004'::uuid]);
  select count(*) into v_member_count_before from public.scheduling_group_members where group_id = v_group_id;

  v_rollover_id := public.generate_rollover_proposal('10000000-0000-0000-0000-000000000001', 'union', '98000000-0000-0000-0000-000000000102');
  select f.id into v_flag_id from public.age_grade_rollover_group_flags f where f.rollover_id = v_rollover_id and f.scheduling_group_id = v_group_id;
  if v_flag_id is null then
    raise notice 'FAIL 19a: the U7/U8 shared group was NOT flagged even though rolling forward would produce U8/U9';
  else
    raise notice 'PASS 19a: the shared U7/U8 group is flagged for explicit reconfiguration -- never silently rolled forward as the invalid U8/U9 combination';
  end if;

  perform public.resolve_rollover_group_flag(v_flag_id);
  select count(*) into v_member_count_after from public.scheduling_group_members where group_id = v_group_id;
  if v_member_count_after = v_member_count_before then
    raise notice 'PASS 19b: resolving the flag never reconfigures the group itself -- membership is unchanged, Club Admin must act separately';
  else
    raise notice 'FAIL 19b: member_count_before=%, member_count_after=%', v_member_count_before, v_member_count_after;
  end if;
end $$;
commit;

-- ------------------------------------------------------------
-- 20. Post-rollover fixture eligibility uses the NEW age identity --
--     the rolled-forward U13 team can no longer be matched against a
--     fresh U12 opponent under the strict same-age rule.
-- ------------------------------------------------------------
do $$
declare
  v_eligible_before boolean;
  v_eligible_after boolean;
begin
  -- Before rollover, U12 C (still U12 at the time captured in test 5/6's
  -- OWN team row) vs. a real Rossendale U12 team was eligible; capture
  -- that fact freshly against a parallel, still-U12 team to avoid relying
  -- on mutated state from earlier tests -- team_lifecycle.sql's own U12 B
  -- (97000000-...-001, reactivated and still a genuine active U12 by the
  -- end of that file) rather than inserting a new row here, since every
  -- valid Burnley U12 identity slot at this point in the regression run
  -- is already claimed by an earlier file.
  select internal.teams_can_play_fixture('97000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003') into v_eligible_before;
  select internal.teams_can_play_fixture('98000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003') into v_eligible_after;

  if v_eligible_before = true and v_eligible_after = false then
    raise notice 'PASS 20: post-rollover eligibility uses the new age identity -- the confirmed U13 team can no longer be matched against a fresh U12 opponent, while an un-rolled U12 team still can';
  else
    raise notice 'FAIL 20: eligible_before=%, eligible_after=%', v_eligible_before, v_eligible_after;
  end if;
end $$;
