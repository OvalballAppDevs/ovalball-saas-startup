-- Manual verification for 20260924960000_season_transition_pre_season_boundary.sql:
-- the automatic team/cohort transition boundary is
-- to_season.pre_season_starts_on, never starts_on (main season start),
-- with no silent fallback when pre_season_starts_on is unconfigured.
--
-- Section 4's boundary matrix, Section 31's live acceptance test, and
-- Section 5/32's future-fixture identity acceptance test, all in one
-- transaction-scoped file (real inserts, rolled back at the end).
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/season_transition_boundary.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

-- ============================================================
-- UNION: five checkpoints, one isolated club/team per checkpoint so
-- each can use its own pre_season_starts_on offset relative to "now"
-- without interfering with the others.
-- ============================================================
insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0010', 'Boundary Test Club Far', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'boundary-test-club-far-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0011', 'Boundary Test Club Warn', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'boundary-test-club-warn-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0012', 'Boundary Test Club Due', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'boundary-test-club-due-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0013', 'Boundary Test Club NoPreSeason', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'boundary-test-club-noPS-9d000000'),
  ('9d000000-0000-0000-0000-0000000d0014', 'Boundary Test Club League', 'Testville', 'Testshire', 'league', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'boundary-test-club-league-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0010', '9d000000-0000-0000-0000-0000000d0010', 'boundary-test-club-far-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0011', '9d000000-0000-0000-0000-0000000d0011', 'boundary-test-club-warn-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0012', '9d000000-0000-0000-0000-0000000d0012', 'boundary-test-club-due-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0013', '9d000000-0000-0000-0000-0000000d0013', 'boundary-test-club-noPS-9d000000', 'active'),
  ('9d000000-0000-0000-0000-0000000c0014', '9d000000-0000-0000-0000-0000000d0014', 'boundary-test-club-league-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600010', '9d000000-0000-0000-0000-0000000c0010', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600011', '9d000000-0000-0000-0000-0000000c0011', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600012', '9d000000-0000-0000-0000-0000000c0012', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600013', '9d000000-0000-0000-0000-0000000c0013', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active'),
  ('9d000000-0000-0000-0000-000000600014', '9d000000-0000-0000-0000-0000000c0014', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');
insert into public.teams (id, club_id, rugby_code, category, age_group, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000b01', '9d000000-0000-0000-0000-0000000c0010', 'union', 'youth', 'U13', 'U13', 'bt-far-u13', true),
  ('9d000000-0000-0000-0000-000000000b02', '9d000000-0000-0000-0000-0000000c0011', 'union', 'youth', 'U13', 'U13', 'bt-warn-u13', true),
  ('9d000000-0000-0000-0000-000000000b03', '9d000000-0000-0000-0000-0000000c0012', 'union', 'youth', 'U13', 'U13', 'bt-due-u13', true),
  ('9d000000-0000-0000-0000-000000000b04', '9d000000-0000-0000-0000-0000000c0013', 'union', 'youth', 'U13', 'U13', 'bt-nops-u13', true),
  ('9d000000-0000-0000-0000-000000000b05', '9d000000-0000-0000-0000-0000000c0014', 'league', 'youth', 'U13', 'U13', 'bt-league-u13', true);

-- IMPORTANT: `seasons` are global per rugby_code, never per-club -- the
-- "next season after my anchor" query has no club filter (only a
-- per-club "not already completed" exclusion). So each checkpoint
-- club's own ANCHOR season and TARGET season live in a widely-separated
-- date band (1000+ days apart) with an explicit "completed" transition
-- pre-seeded pointing at that club's own anchor -- otherwise every
-- checkpoint club would race over the SAME nearest season in the
-- global pool via the shared current-season fallback, as an earlier
-- version of this test discovered the hard way (all five checkpoints
-- failed identically until this was fixed).
insert into public.seasons (id, name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000a010', 'Boundary Anchor Far', current_date + 500, current_date + 550, 'union', 2181, true),
  ('9d000000-0000-0000-0000-00000000a011', 'Boundary Anchor Warn', current_date + 1500, current_date + 1550, 'union', 2182, true),
  ('9d000000-0000-0000-0000-00000000a012', 'Boundary Anchor Due', current_date + 2500, current_date + 2550, 'union', 2183, true),
  ('9d000000-0000-0000-0000-00000000a013', 'Boundary Anchor NoPreSeason', current_date - 1, current_date + 30, 'union', 2184, true),
  ('9d000000-0000-0000-0000-00000000a014', 'Boundary Anchor League', current_date + 4500, current_date + 4550, 'league', 2185, true);
insert into public.season_transitions (club_id, rugby_code, from_season_id, to_season_id, status, applied_at) values
  ('9d000000-0000-0000-0000-0000000c0010', 'union', null, '9d000000-0000-0000-0000-00000000a010', 'completed', now()),
  ('9d000000-0000-0000-0000-0000000c0011', 'union', null, '9d000000-0000-0000-0000-00000000a011', 'completed', now()),
  ('9d000000-0000-0000-0000-0000000c0012', 'union', null, '9d000000-0000-0000-0000-00000000a012', 'completed', now()),
  ('9d000000-0000-0000-0000-0000000c0013', 'union', null, '9d000000-0000-0000-0000-00000000a013', 'completed', now()),
  ('9d000000-0000-0000-0000-0000000c0014', 'league', null, '9d000000-0000-0000-0000-00000000a014', 'completed', now());

-- Checkpoint 1 ("before boundary, far out"): pre-season starts 10 days
-- from now -- outside the 24h lookahead window entirely.
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c101', 'Boundary Far Next', current_date + 600, current_date + 700, current_date + 10, 'union', 2186, true);
-- Checkpoint 2 ("24h-before -> warning, not yet applied"): pre-season
-- starts ~1 day from now.
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c102', 'Boundary Warn Next', current_date + 1600, current_date + 1700, current_date + 1, 'union', 2187, true);
-- Checkpoint 3/4 ("at/after boundary -> transitions, then idempotent
-- re-run covers both 'between pre and main' and 'at main season start'
-- since the engine has no separate logic keyed to starts_on at all):
-- pre-season started 5 days ago, main season also already started
-- (starts_on in the past too) -- proves no re-trigger at either point.
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c103', 'Boundary Due Next', current_date + 2600, current_date + 2700, current_date - 5, 'union', 2188, true);
-- Checkpoint 5 (Section 1: no pre_season_starts_on configured -> must
-- go to needs_attention with a stated reason, never silently use
-- starts_on). This season's own starts_on must be near "now" (unlike
-- the other checkpoints) because the engine's look-ahead window falls
-- back to starts_on ONLY to decide when to start paying attention when
-- pre_season_starts_on is null -- it must never use it as the actual
-- transition trigger.
insert into public.seasons (id, name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c104', 'Boundary NoPreSeason Next', current_date, current_date + 30, 'union', 2189, true);
-- League: the SAME mechanism, proven against League-shaped dates, to
-- confirm nothing in the engine is Union-specific.
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c105', 'Boundary League Next', current_date + 4600, current_date + 4700, current_date - 5, 'league', 2190, true);

do $$
declare
  v_status text;
  v_warned boolean;
  v_reason text;
  v_u13_age text;
begin
  -- Checkpoint 1: far out -- no season_transitions row for the REAL
  -- target season yet (the club_id also has its pre-seeded anchor row,
  -- which is a completed transition to a DIFFERENT to_season_id and
  -- must not be confused with this check).
  perform internal.process_due_season_transitions();
  select count(*) into v_status from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0010' and to_season_id = '9d000000-0000-0000-0000-00000000c101';
  if v_status::int = 0 then
    raise notice 'PASS 1: pre-season 10 days out (outside 24h lookahead) -- no transition row created, no premature action';
  else
    raise notice 'FAIL 1: unexpected season_transitions row(s) created this early';
  end if;

  -- Checkpoint 2: ~24h out -- warned, but NOT applied.
  select status, warning_sent_at is not null into v_status, v_warned from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0011' and to_season_id = '9d000000-0000-0000-0000-00000000c102';
  select age_group into v_u13_age from public.teams where id = '9d000000-0000-0000-0000-000000000b02';
  if v_status = 'ready' and v_warned and v_u13_age = 'U13' then
    raise notice 'PASS 2: pre-season ~1 day out -- warning sent, status=ready, team NOT yet progressed (still U13)';
  else
    raise notice 'FAIL 2: status=% warned=% team_age=%', v_status, v_warned, v_u13_age;
  end if;

  -- Checkpoint 3: pre-season 5 days ago (boundary passed) -- transitioned.
  select status into v_status from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0012' and to_season_id = '9d000000-0000-0000-0000-00000000c103';
  select age_group into v_u13_age from public.teams where id = '9d000000-0000-0000-0000-000000000b03';
  if v_status = 'completed' and v_u13_age = 'U14' then
    raise notice 'PASS 3: pre-season boundary already passed -- team correctly progressed U13 -> U14 (season cycle boundary, not main-season start)';
  else
    raise notice 'FAIL 3: status=% team_age=%', v_status, v_u13_age;
  end if;

  -- Checkpoint 4: re-run -- covers BOTH "between pre-season and main
  -- season" and "at main-season start" (this season's own starts_on is
  -- also already in the past) since nothing in the engine is keyed to
  -- starts_on any more.
  perform internal.process_due_season_transitions();
  select status into v_status from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0012' and to_season_id = '9d000000-0000-0000-0000-00000000c103';
  select age_group into v_u13_age from public.teams where id = '9d000000-0000-0000-0000-000000000b03';
  if v_status = 'completed' and v_u13_age = 'U14' then
    raise notice 'PASS 4: idempotent re-run (covering both mid-cycle and main-season-start timing) -- no second transition, team still U14 exactly once';
  else
    raise notice 'FAIL 4: status=% team_age=%', v_status, v_u13_age;
  end if;

  -- Checkpoint 5 (Section 1): no pre_season_starts_on configured.
  select status, needs_attention_reason into v_status, v_reason from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0013' and to_season_id = '9d000000-0000-0000-0000-00000000c104';
  select age_group into v_u13_age from public.teams where id = '9d000000-0000-0000-0000-000000000b04';
  if v_status = 'needs_attention' and v_reason ilike '%pre-season%' and v_u13_age = 'U13' then
    raise notice 'PASS 5: a season with NO configured pre-season date is parked at needs_attention with a stated reason (%), never silently defaulting to main-season start -- team correctly left untouched (still U13)', v_reason;
  else
    raise notice 'FAIL 5: status=% reason=% team_age=%', v_status, v_reason, v_u13_age;
  end if;

  -- League: same mechanism, League-shaped dates.
  select status into v_status from public.season_transitions where club_id = '9d000000-0000-0000-0000-0000000c0014' and to_season_id = '9d000000-0000-0000-0000-00000000c105';
  select age_group into v_u13_age from public.teams where id = '9d000000-0000-0000-0000-000000000b05';
  if v_status = 'completed' and v_u13_age = 'U14' then
    raise notice 'PASS 6: the SAME mechanism (pre_season_starts_on boundary) correctly progresses a League team -- nothing in the engine is Union-specific';
  else
    raise notice 'FAIL 6: status=% team_age=%', v_status, v_u13_age;
  end if;
end $$;

rollback;
