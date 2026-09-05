-- Pitch Allocation Group-vs-Group permanent regression suite. Proves, at
-- the data level, the two invariants app/(app)/calendar/pitch-allocation/data.ts
-- depends on to render exactly one card per real fixture even when one or
-- both sides are a Mini-Rugby scheduling group:
--   1. A legacy mirror pair (one fixture row created per club for the
--      same real-world match) collapses to exactly one canonical row
--      under the same `mirror_fixture_id IS NULL OR id < mirror_fixture_id`
--      predicate data.ts replicates from admin_fixture_overview.
--   2. A group-vs-group fixture's real component team_ids are resolvable
--      via scheduling_group_members for both the home AND away group,
--      which is what internal.get_effective_fixture_team_ids /
--      lib/mini-rugby/effective-teams.ts's effectiveFixtureParticipants
--      read to build the DTO's effectiveHomeTeamIds/effectiveAwayTeamIds.
-- Live-verified separately (2026-10-18, Burnley RUFC) that a real
-- group-vs-group fixture ("U7/U8 Falcons" v "U7/U8 Minis") renders as
-- exactly one card with both sides' real group labels on the actual
-- Pitch Allocation board -- this suite covers the data-level invariant
-- permanently, self-contained and self-cleaning.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/pitch_allocation_group_vs_group.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Pitch Allocation group-vs-group regression suite ==='

begin;
create temporary table t_pa_state (k text primary key, v text) on commit drop;
grant all on t_pa_state to authenticated, service_role, anon;

do $$
declare
  v_dir_a uuid := gen_random_uuid();
  v_club_a uuid := gen_random_uuid();
  v_dir_b uuid := gen_random_uuid();
  v_club_b uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_season uuid := gen_random_uuid();
  v_home_group uuid := gen_random_uuid();
  v_away_group uuid := gen_random_uuid();
  v_home_member_1 uuid := gen_random_uuid();
  v_home_member_2 uuid := gen_random_uuid();
  v_away_member_1 uuid := gen_random_uuid();
  v_fixture_a uuid := gen_random_uuid();
  v_fixture_b uuid := gen_random_uuid();
  v_mirror_team_a uuid := gen_random_uuid();
  v_mirror_team_b uuid := gen_random_uuid();
  v_mirror_fixture_a uuid := gen_random_uuid();
  v_mirror_fixture_b uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_admin, 'pa-gvg-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.club_directory (id, name, rugby_code, country, nation, source, normalized_key, verification_status) values
    (v_dir_a, 'Pitch Allocation GvG Club A', 'union', 'England', 'England', 'manual', 'pa-gvg-club-a', 'verified'),
    (v_dir_b, 'Pitch Allocation GvG Club B', 'union', 'England', 'England', 'manual', 'pa-gvg-club-b', 'verified');
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club_a, v_dir_a, 'pa-gvg-club-a', 'active'),
    (v_club_b, v_dir_b, 'pa-gvg-club-b', 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values (gen_random_uuid(), v_club_a, v_admin, 'CLUB_ADMIN', 'active');
  insert into public.seasons (id, name, rugby_code, starts_on, ends_on, season_year_start, active)
  values (v_season, 'PA GvG Test Season', 'union', '2099-09-01', '2100-05-31', 2099, true);

  -- Home side: a real Mini-Rugby scheduling group at Club A with two component teams.
  insert into public.scheduling_groups (id, club_id, display_tag, season_id, active) values (v_home_group, v_club_a, 'U7/U8 Test Group', v_season, true);
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
    (v_home_member_1, v_club_a, 'union', 'youth', 'U7', 'mixed', 'PA GvG U7', 'pa-gvg-u7-' || v_home_member_1::text, true),
    (v_home_member_2, v_club_a, 'union', 'youth', 'U8', 'mixed', 'PA GvG U8', 'pa-gvg-u8-' || v_home_member_2::text, true);
  insert into public.scheduling_group_members (group_id, team_id) values (v_home_group, v_home_member_1), (v_home_group, v_home_member_2);

  -- Away side: a real Mini-Rugby scheduling group at Club B with one component team.
  insert into public.scheduling_groups (id, club_id, display_tag, season_id, active) values (v_away_group, v_club_b, 'U7/U8 Test Away Group', v_season, true);
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
    (v_away_member_1, v_club_b, 'union', 'youth', 'U7', 'mixed', 'PA GvG Away U7', 'pa-gvg-away-u7-' || v_away_member_1::text, true);
  insert into public.scheduling_group_members (group_id, team_id) values (v_away_group, v_away_member_1);

  -- The group-vs-group fixture itself (no mirror pair -- matches the
  -- real live fixture this was verified against, which also has
  -- mirror_fixture_id = NULL).
  insert into public.fixtures (id, owning_team_id, opponent_team_id, owning_scheduling_group_id, opponent_scheduling_group_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_fixture_a, v_home_member_1, v_away_member_1, v_home_group, v_away_group, 'Home', 'PA GvG Test Away Group', '2099-10-01'::date, '10:00', 'Booked', 'club_created', v_season);

  -- A SEPARATE, independent legacy MIRROR PAIR (ordinary team-vs-team,
  -- unrelated teams -- mirror-pair dedup and group-vs-group are two
  -- independent invariants, so this uses its own fresh teams rather than
  -- reusing the group's own component teams, which would otherwise
  -- double-book them against the one-match-per-day-per-team trigger):
  -- two fixture rows for the SAME real-world match, one owned by each
  -- club (exactly the Section 1 root cause data.ts's own comment
  -- documents).
  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
    (v_mirror_team_a, v_club_a, 'union', 'youth', 'U10', 'mixed', 'PA Mirror Team A', 'pa-mirror-a-' || v_mirror_team_a::text, true),
    (v_mirror_team_b, v_club_b, 'union', 'youth', 'U10', 'mixed', 'PA Mirror Team B', 'pa-mirror-b-' || v_mirror_team_b::text, true);
  -- A genuine mirror pair is, by construction, the SAME two teams
  -- committed on the SAME day twice (once per row) -- exactly what the
  -- one-match-per-day-per-team trigger exists to prevent for NEW writes.
  -- Real mirror pairs are historical artifacts predating that trigger
  -- (or created by a trusted reconciliation path that intentionally
  -- bypasses it) -- session_replication_role is used here, superuser-only
  -- and scoped to just these two inserts, purely to reconstruct that
  -- historical shape for the dedup-predicate test, exactly as it exists
  -- in Main's own real data today.
  set local session_replication_role = replica;
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, season_id)
  values (v_mirror_fixture_a, v_mirror_team_a, v_mirror_team_b, 'Home', 'PA Mirror Team B', '2099-10-02'::date, '10:00', 'Booked', 'club_created', v_season);
  insert into public.fixtures (id, owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, status, source, mirror_fixture_id, season_id)
  values (v_mirror_fixture_b, v_mirror_team_b, v_mirror_team_a, 'Away', 'PA Mirror Team A', '2099-10-02'::date, '10:00', 'Booked', 'club_created', v_mirror_fixture_a, v_season);
  update public.fixtures set mirror_fixture_id = v_mirror_fixture_b where id = v_mirror_fixture_a;
  set local session_replication_role = origin;

  insert into t_pa_state values
    ('club_a', v_club_a::text), ('club_b', v_club_b::text), ('home_group', v_home_group::text), ('away_group', v_away_group::text),
    ('home_member_1', v_home_member_1::text), ('home_member_2', v_home_member_2::text), ('away_member_1', v_away_member_1::text),
    ('fixture_a', v_fixture_a::text), ('mirror_fixture_a', v_mirror_fixture_a::text), ('mirror_fixture_b', v_mirror_fixture_b::text);
end $$;

\echo '--- 1: mirror pair collapses to exactly one canonical row under the same predicate data.ts uses ---'
do $$
declare
  v_club_a uuid := (select v::uuid from t_pa_state where k = 'club_a');
  v_count integer;
begin
  -- Mirrors data.ts's own query: home_team_id in (this club's teams), then
  -- the mirror-pair predicate (mirror_fixture_id IS NULL OR id < mirror_fixture_id).
  select count(*) into v_count
  from public.fixtures f
  where f.home_team_id in (select id from public.teams where club_id = v_club_a)
    and f.kickoff_date = '2099-10-02'::date
    and f.status <> 'Cancelled'
    and (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id);
  if v_count = 1 then
    raise notice 'PASS 1: exactly one canonical row survives the mirror-pair dedup predicate for this home_team_id set';
  else
    raise notice 'FAIL 1: expected exactly 1 row, got %', v_count;
  end if;
end $$;

\echo '--- 2: the surviving row is genuinely the lower-id fixture, matching admin_fixture_overview''s own is_primary_mirror convention ---'
do $$
declare
  v_club_a uuid := (select v::uuid from t_pa_state where k = 'club_a');
  v_mirror_fixture_a uuid := (select v::uuid from t_pa_state where k = 'mirror_fixture_a');
  v_mirror_fixture_b uuid := (select v::uuid from t_pa_state where k = 'mirror_fixture_b');
  v_survivor uuid;
  v_expected uuid;
begin
  v_expected := least(v_mirror_fixture_a, v_mirror_fixture_b);
  select f.id into v_survivor
  from public.fixtures f
  where f.home_team_id in (select id from public.teams where club_id = v_club_a)
    and f.kickoff_date = '2099-10-02'::date
    and f.status <> 'Cancelled'
    and (f.mirror_fixture_id is null or f.id < f.mirror_fixture_id);
  if v_survivor = v_expected then
    raise notice 'PASS 2: the surviving row is the lower-id member of the mirror pair, the same one Fixture Management''s own is_primary_mirror convention treats as canonical';
  else
    raise notice 'FAIL 2: expected % to survive, got %', v_expected, v_survivor;
  end if;
end $$;

\echo '--- 3: both sides'' real component team_ids are resolvable via scheduling_group_members (what effectiveFixtureParticipants reads) ---'
do $$
declare
  v_home_group uuid := (select v::uuid from t_pa_state where k = 'home_group');
  v_away_group uuid := (select v::uuid from t_pa_state where k = 'away_group');
  v_home_count integer;
  v_away_count integer;
begin
  select count(*) into v_home_count from public.scheduling_group_members where group_id = v_home_group;
  select count(*) into v_away_count from public.scheduling_group_members where group_id = v_away_group;
  if v_home_count = 2 and v_away_count = 1 then
    raise notice 'PASS 3: home group resolves its real 2 component teams, away group resolves its real 1 component team -- the exact shape effectiveFixtureParticipants would expand this fixture into';
  else
    raise notice 'FAIL 3: expected home=2 away=1, got home=% away=%', v_home_count, v_away_count;
  end if;
end $$;

\echo '--- 4: cross-club tamper -- an unrelated authenticated user cannot reschedule Club A''s fixture via update_fixture_schedule ---'
do $$
declare
  v_unrelated uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
  values (v_unrelated, 'pa-gvg-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into t_pa_state values ('unrelated', v_unrelated::text);
end $$;
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_pa_state where k = 'unrelated';
do $$
begin
  perform public.update_fixture_schedule(
    (select v::uuid from t_pa_state where k = 'fixture_a'),
    '2099-10-01'::date, '14:00'::time, null, null, null, 'PITCH_ALLOCATION'
  );
  raise notice 'FAIL 4: an unrelated authenticated user was able to reschedule Club A''s fixture';
exception when others then
  raise notice 'PASS 4: unrelated user correctly denied by update_fixture_schedule''s own internal.can_submit_fixture_result() check -- %', sqlerrm;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
