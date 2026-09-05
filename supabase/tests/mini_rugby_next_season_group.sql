-- Manual verification for 20260925050000_mini_rugby_next_season_group.sql:
-- public.create_next_season_scheduling_group() -- Sections 7-10 of
-- RESUME SEASON HANDOVER.
--
-- Transaction-scoped and rolled back like the other season-aware
-- tests, since this reads the real shared `seasons` table to walk a
-- genuine current -> next season boundary.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/mini_rugby_next_season_group.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
  ('9d000000-0000-0000-0000-0000000d0021', 'Mini Rugby Wizard Test Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'mini-rugby-wizard-test-club-9d000000');
insert into public.clubs (id, directory_id, slug, status) values
  ('9d000000-0000-0000-0000-0000000c0021', '9d000000-0000-0000-0000-0000000d0021', 'mini-rugby-wizard-test-club-9d000000', 'active');
insert into public.club_memberships (id, club_id, user_id, role, status) values
  ('9d000000-0000-0000-0000-000000600021', '9d000000-0000-0000-0000-0000000c0021', '00000000-0000-0000-0000-000000000002', 'CLUB_ADMIN', 'active');

-- U6/U7/U8 today; U6->U7, U7->U8, U8->U9 next season (U8 team must be
-- excludable, never silently waved through as a valid successor).
-- c21/c22 form the group actually progressed in PASS 1-3. c24/c25 are
-- separate, unused-elsewhere teams so the invalid-successor checks
-- (PASS 4-5) fail for the reason under test, not for "already in
-- another group this season" from the earlier successful creation.
insert into public.teams (id, club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, active) values
  ('9d000000-0000-0000-0000-000000000c21', '9d000000-0000-0000-0000-0000000c0021', 'union', 'youth', 'U6', null, null, 'U6', 'mrw-u6', true),
  ('9d000000-0000-0000-0000-000000000c22', '9d000000-0000-0000-0000-0000000c0021', 'union', 'youth', 'U7', null, null, 'U7', 'mrw-u7', true),
  ('9d000000-0000-0000-0000-000000000c23', '9d000000-0000-0000-0000-0000000c0021', 'union', 'youth', 'U8', null, null, 'U8', 'mrw-u8', true),
  ('9d000000-0000-0000-0000-000000000c24', '9d000000-0000-0000-0000-0000000c0021', 'union', 'youth', 'U7', null, 'B', 'U7 B', 'mrw-u7b', true),
  ('9d000000-0000-0000-0000-000000000c25', '9d000000-0000-0000-0000-0000000c0021', 'union', 'youth', 'U6', null, 'B', 'U6 B', 'mrw-u6b', true);

-- A genuinely separate, later season of the SAME real rugby_code, wide
-- of any other test file's date bands.
insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code, season_year_start, is_regression_fixture) values
  ('9d000000-0000-0000-0000-00000000c210', 'MRW Current Season', current_date - 300, current_date - 10, current_date - 310, 'union', 2197, true),
  ('9d000000-0000-0000-0000-00000000c211', 'MRW Next Season', current_date + 55, current_date + 155, current_date - 3, 'union', 2198, true);

insert into public.scheduling_groups (id, club_id, display_tag, season_id, alias, created_by) values
  ('9d000000-0000-0000-0000-00000000c212', '9d000000-0000-0000-0000-0000000c0021', 'U6/U7', '9d000000-0000-0000-0000-00000000c210', 'The Minis', '00000000-0000-0000-0000-000000000002');
insert into public.scheduling_group_members (group_id, team_id) values
  ('9d000000-0000-0000-0000-00000000c212', '9d000000-0000-0000-0000-000000000c21'),
  ('9d000000-0000-0000-0000-00000000c212', '9d000000-0000-0000-0000-000000000c22');

set local role authenticated;
set local request.jwt.claims = '{"sub":"00000000-0000-0000-0000-000000000002","role":"authenticated"}';

do $$
declare
  v_new_group_id uuid;
  v_new_tag text;
  v_new_alias text;
  v_new_season_id uuid;
  v_old_active boolean;
  v_old_season_id uuid;
begin
  -- CREATE NEXT-SEASON GROUP: same composition (U6->U7, U7->U8).
  v_new_group_id := public.create_next_season_scheduling_group(
    '9d000000-0000-0000-0000-00000000c212', '9d000000-0000-0000-0000-00000000c211',
    array['9d000000-0000-0000-0000-000000000c21'::uuid, '9d000000-0000-0000-0000-000000000c22'::uuid],
    null
  );
  select display_tag, alias, season_id into v_new_tag, v_new_alias, v_new_season_id from public.scheduling_groups where id = v_new_group_id;

  if v_new_group_id is distinct from '9d000000-0000-0000-0000-00000000c212' and v_new_season_id = '9d000000-0000-0000-0000-00000000c211' and v_new_tag = 'U7/U8' then
    raise notice 'PASS 1: a NEW group_id is created for the next season, correctly tagged U7/U8 (the PROJECTED next-season ages, not the live U6/U7)';
  else
    raise notice 'FAIL 1: new_group_id=% season_id=% tag=%', v_new_group_id, v_new_season_id, v_new_tag;
  end if;

  if v_new_alias = 'The Minis' then
    raise notice 'PASS 2: the historical group''s alias carries forward as a suggestion when none is explicitly supplied';
  else
    raise notice 'FAIL 2: new alias=%', v_new_alias;
  end if;

  select active, season_id into v_old_active, v_old_season_id from public.scheduling_groups where id = '9d000000-0000-0000-0000-00000000c212';
  if v_old_active and v_old_season_id = '9d000000-0000-0000-0000-00000000c210' then
    raise notice 'PASS 3: the historical group is completely untouched -- same id, same season_id, still active (never mutated in place)';
  else
    raise notice 'FAIL 3: historical group active=% season_id=%', v_old_active, v_old_season_id;
  end if;

  -- Invalid successor: including the U8 team (-> U9 next season) must
  -- be rejected outright, never silently dropped or waved through.
  begin
    perform public.create_next_season_scheduling_group(
      '9d000000-0000-0000-0000-00000000c212', '9d000000-0000-0000-0000-00000000c211',
      array['9d000000-0000-0000-0000-000000000c24'::uuid, '9d000000-0000-0000-0000-000000000c23'::uuid],
      null
    );
    raise notice 'FAIL 4: a U8->U9 invalid successor combination was accepted';
  exception when others then
    if sqlerrm like '%no longer be a valid Mini-Rugby age%' then
      raise notice 'PASS 4: a team that would become U9 next season is rejected as an invalid successor, exactly like an ordinary U8/U9 combination';
    else
      raise notice 'FAIL 4: rejected for an unexpected reason: %', sqlerrm;
    end if;
  end;

  -- EDIT COMPOSITION THEN CREATE: an explicit alias override, and only
  -- the U7 team (which alone cannot satisfy the "at least two ages"
  -- rule) -- must be rejected for that reason instead.
  begin
    perform public.create_next_season_scheduling_group(
      '9d000000-0000-0000-0000-00000000c212', '9d000000-0000-0000-0000-00000000c211',
      array['9d000000-0000-0000-0000-000000000c25'::uuid],
      'Renamed Minis'
    );
    raise notice 'FAIL 5: a single-age successor group was accepted';
  exception when others then
    if sqlerrm like '%at least two different ages%' then
      raise notice 'PASS 5: a single remaining age cannot form a Mini-Rugby Group on its own, exactly like the ordinary creation path';
    else
      raise notice 'FAIL 5: rejected for an unexpected reason: %', sqlerrm;
    end if;
  end;
end $$;

reset role;
rollback;
