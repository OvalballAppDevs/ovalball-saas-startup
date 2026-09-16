-- Single-fixture team authority versus club/site bulk planning authority
-- (20270303000000).
--
-- The product rule: a team's own staff may create or request ONE fixture for a
-- team they run. The Season Planner, fixture import (staging and publishing)
-- and competition-wide generation are club administration -- Club Admin,
-- Fixture Secretary, Site Admin -- and team staff never reach them, however
-- many teams they run.
--
-- SELF-SEEDING. Every person, the club, its teams and the season are created
-- inside this transaction, so the suite proves the rule on an empty database
-- straight after a clean migration boot, not only where UAT data happens to
-- exist. Rolled back.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_bulk_planning_authority.sql

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_external_dir uuid;
  v_site uuid := gen_random_uuid();
  v_admin uuid := gen_random_uuid();
  v_secretary uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_manager uuid := gen_random_uuid();
  v_team_admin uuid := gen_random_uuid();
  v_team_admin_secretary uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_outsider uuid := gen_random_uuid();
  v_dir uuid;
  v_club uuid;
  v_other_dir uuid;
  v_other_club uuid;
  v_season uuid;
  v_u7 uuid;
  v_u8 uuid;
  v_u12 uuid;
  v_u13 uuid;
  v_group uuid;
  v_batch uuid;
  v_row uuid;
  v_fixture uuid;
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person record;
  v_bool boolean;
  n integer;
  v_ids uuid[];
begin
  -- ---------------------------------------------------------------
  -- SEED
  -- ---------------------------------------------------------------
  for v_person in
    select * from (values
      (v_site, 'site'), (v_admin, 'admin'), (v_secretary, 'secretary'), (v_coach, 'coach'),
      (v_manager, 'manager'), (v_team_admin, 'teamadmin'), (v_team_admin_secretary, 'teamadminsec'),
      (v_member, 'member'), (v_guardian, 'guardian'), (v_outsider, 'outsider')
    ) as p(id, handle)
  loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person.id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      'fbpa-' || v_person.handle || '-' || v_tag || '@ovalball.test', '', now(), now(), now(),
      '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email)
    values (v_person.id, 'Fbpa', initcap(v_person.handle), 'fbpa-' || v_person.handle || '-' || v_tag || '@ovalball.test')
    on conflict (id) do nothing;
  end loop;

  insert into public.site_admins (user_id, status, admin_role) values (v_site, 'active', 'full');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FBPA Home RUFC ' || v_tag, 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fbpa-home-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'fbpa-home-' || v_tag, 'active') returning id into v_club;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FBPA Other RUFC ' || v_tag, 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fbpa-other-' || v_tag)
  returning id into v_other_dir;
  insert into public.clubs (directory_id, slug, status) values (v_other_dir, 'fbpa-other-' || v_tag, 'active') returning id into v_other_club;
  -- A club not on Ovalball: a staged row against it is recorded directly. (An
  -- Ovalball club named without one of its teams is refused -- asked, not booked.)
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FBPA External RFC ' || v_tag, 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'fbpa-external-' || v_tag)
  returning id into v_external_dir;

  select id into v_season from public.seasons
   where rugby_code = 'union' and not is_regression_fixture and current_date between coalesce(pre_season_starts_on, starts_on) and ends_on
   limit 1;
  if v_season is null then
    insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, season_ref)
    values ('FBPA Union ' || v_tag, current_date - 30, current_date + 300, 'union', (select greatest(2100, coalesce(max(s.season_year_start), 2099) + 1) from public.seasons s where s.season_year_start >= 2100), 'fbpa-' || v_tag)
    returning id into v_season;
  end if;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values
    (v_club, 'Under 7 Mixed', 'fbpa-u7-' || v_tag, 'youth', 'U7', 'mixed', 'union', true) returning id into v_u7;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values
    (v_club, 'Under 8 Mixed', 'fbpa-u8-' || v_tag, 'youth', 'U8', 'mixed', 'union', true) returning id into v_u8;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values
    (v_club, 'Under 12 Boys', 'fbpa-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_u12;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active) values
    (v_club, 'Under 13 Boys', 'fbpa-u13-' || v_tag, 'youth', 'U13', 'boys', 'union', true) returning id into v_u13;

  insert into public.scheduling_groups (club_id, display_tag, season_id, active) values (v_club, 'U7/U8', v_season, true) returning id into v_group;
  insert into public.scheduling_group_members (group_id, team_id) values (v_group, v_u7), (v_group, v_u8);

  insert into public.club_memberships (club_id, user_id, role, status) values
    (v_club, v_admin, 'CLUB_ADMIN', 'active'),
    (v_club, v_secretary, 'FIXTURE_SECRETARY', 'active'),
    (v_club, v_coach, 'BASIC_USER', 'active'),
    (v_club, v_manager, 'BASIC_USER', 'active'),
    (v_club, v_team_admin, 'BASIC_USER', 'active'),
    (v_club, v_team_admin_secretary, 'FIXTURE_SECRETARY', 'active'),
    (v_club, v_member, 'BASIC_USER', 'active'),
    (v_club, v_guardian, 'BASIC_USER', 'active'),
    (v_other_club, v_outsider, 'CLUB_ADMIN', 'active');

  insert into public.team_permissions (membership_id, team_id, permission)
  select cm.id, x.team_id, x.permission
  from (values
    (v_coach, v_u12, 'coach'),
    (v_manager, v_u7, 'manager'), (v_manager, v_u8, 'manager'), (v_manager, v_u12, 'manager'),
    (v_team_admin, v_u7, 'team_admin'), (v_team_admin, v_u8, 'team_admin'), (v_team_admin, v_u12, 'team_admin'), (v_team_admin, v_u13, 'team_admin'),
    (v_team_admin_secretary, v_u12, 'team_admin'),
    (v_guardian, v_u12, 'view_only')
  ) as x(user_id, team_id, permission)
  join public.club_memberships cm on cm.user_id = x.user_id and cm.club_id = v_club;

  -- =================================================================
  -- A. BULK PLANNING AUTHORITY, PERSON BY PERSON
  -- =================================================================
  for v_person in
    select * from (values
      (v_admin, 'Club Admin', true),
      (v_secretary, 'Fixture Secretary', true),
      (v_site, 'Site Admin', true),
      (v_team_admin_secretary, 'Team Admin who is ALSO the club''s Fixture Secretary', true),
      (v_coach, 'Coach', false),
      (v_manager, 'Team Manager of U7, U8 and U12', false),
      (v_team_admin, 'Team Admin of every team at the club', false),
      (v_member, 'club member', false),
      (v_guardian, 'guardian (view-only)', false),
      (v_outsider, 'Club Admin of a DIFFERENT club', false)
    ) as p(id, label, expected)
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_person.id::text, 'role', 'authenticated')::text, true);
    v_bool := public.can_bulk_plan_fixtures(v_club);
    reset role;
    if v_bool = v_person.expected then
      raise notice 'PASS A: % -- bulk planning authority is %', v_person.label, v_bool;
    else
      raise notice 'FAIL A: % -- bulk planning authority is %, expected %', v_person.label, v_bool, v_person.expected;
    end if;
  end loop;

  -- =================================================================
  -- B. SINGLE-FIXTURE TEAM AUTHORITY IS UNCHANGED FOR TEAM STAFF
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  select array_agg(team_id order by team_id) into v_ids from public.single_fixture_team_ids(v_club);
  reset role;
  if v_ids = (select array_agg(x order by x) from unnest(array[v_u7, v_u8, v_u12]) x) then
    raise notice 'PASS B1: a Team Manager keeps single-fixture authority for exactly the teams they run (U7, U8, U12)';
  else
    raise notice 'FAIL B1: Team Manager single-fixture teams were %', v_ids;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.single_fixture_team_ids(v_club);
  reset role;
  if n = 1 then
    raise notice 'PASS B2: a Coach keeps single-fixture authority for their one team';
  else
    raise notice 'FAIL B2: Coach single-fixture team count %', n;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.single_fixture_team_ids(v_club);
  reset role;
  if n = 4 then
    raise notice 'PASS B3: a Club Admin has single-fixture authority for every active team, both U7/U8 Tags members included';
  else
    raise notice 'FAIL B3: Club Admin single-fixture team count %', n;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text, 'role', 'authenticated')::text, true);
  select count(*) into n from public.single_fixture_team_ids(v_club);
  reset role;
  if n = 0 then
    raise notice 'PASS B4: a view-only guardian has no fixture authority at all';
  else
    raise notice 'FAIL B4: guardian single-fixture team count %', n;
  end if;

  -- The single fixture itself, through the real fixtures boundary.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_manager::text, 'role', 'authenticated')::text, true);
  -- Slice 4C: creation no longer travels through a direct INSERT -- `authenticated` holds no
  -- INSERT privilege on public.fixtures at all. The behaviour this row protects is unchanged
  -- (a Team Manager may still create one fixture for their own team); only the route is now the
  -- canonical public.create_fixture contract, which is also what enforces "an Ovalball opponent
  -- is asked, never booked".
  -- The opponent here is another ACTIVE Ovalball club, so under the Slice 4C contract this
  -- correctly becomes a REQUEST for that club to answer rather than a fixture booked on their
  -- behalf. The previous direct INSERT booked it outright, which was the bypass 4C closed.
  declare v_res jsonb; begin
    v_res := public.create_fixture(
      v_u12, 'Home', 'FBPA Other RUFC', (current_date + 14)::date, 'Planned',
      null, v_other_dir, '10:30'::time);
    if (v_res->>'pendingRequest')::boolean then
      raise notice 'PASS B5: a Team Manager may still initiate a fixture for their own team, and an Ovalball opponent is asked rather than booked';
    else
      raise notice 'FAIL B5: an Ovalball opponent was booked without being asked (%)', v_res;
    end if;
  exception when others then
    raise notice 'FAIL B5: a Team Manager could not initiate a fixture for their own team: %', sqlerrm;
  end;
  -- Asked through the canonical contract, so this proves the team-scope refusal itself and not
  -- merely the absence of an INSERT privilege.
  begin
    perform public.create_fixture(
      v_u13, 'Home', 'FBPA Other RUFC', (current_date + 21)::date, 'Planned',
      null, v_other_dir, '10:30'::time);
    raise notice 'FAIL B6: a Team Manager created a fixture for a team they do not run';
  exception when others then
    if sqlerrm like '%not authorised%' or sqlstate = '42501' then
      raise notice 'PASS B6: a Team Manager cannot create a fixture for a team they do not run';
    else
      raise notice 'FAIL B6: refused for the wrong reason: %', sqlerrm;
    end if;
  end;
  reset role;

  -- =================================================================
  -- C. STAGING AND PUBLISHING ARE CLOSED TO TEAM STAFF
  -- =================================================================
  for v_person in
    select * from (values (v_manager, 'Team Manager'), (v_team_admin, 'Team Admin'), (v_coach, 'Coach'), (v_member, 'club member')) as p(id, label)
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_person.id::text, 'role', 'authenticated')::text, true);
    begin
      insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
      values (v_person.id, 'fbpa team staff batch', 1, 'processing', v_club);
      raise notice 'FAIL C1: % staged a bulk planning batch', v_person.label;
    exception when insufficient_privilege then
      raise notice 'PASS C1: % cannot stage a bulk planning batch, even in their own name', v_person.label;
    end;
    reset role;
  end loop;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values (v_secretary, 'fbpa secretary batch', 1, 'processing', v_club) returning id into v_batch;
  insert into public.fixture_import_rows (batch_id, row_number, raw, status, errors, resolved_home_team_id, resolved_away_directory_id, raw_opposition_text, fixture_date, kickoff_time, home_away)
  values (v_batch, 1, '{}'::jsonb, 'ready', '[]'::jsonb, v_u12, v_external_dir, 'FBPA External RFC', current_date + 28, '11:00', 'Home')
  returning id into v_row;
  reset role;
  raise notice 'PASS C2: a Fixture Secretary stages a bulk planning batch';

  for v_person in select * from (values (v_manager, 'Team Manager of the row''s own team'), (v_team_admin, 'Team Admin of the row''s own team')) as p(id, label)
  loop
    set local role authenticated;
    perform set_config('request.jwt.claims', json_build_object('sub', v_person.id::text, 'role', 'authenticated')::text, true);
    begin
      perform public.publish_import_row(v_row);
      raise notice 'FAIL C3: % published a staged planner row', v_person.label;
    exception when insufficient_privilege then
      raise notice 'PASS C3: % cannot publish a staged row, even for a team they run', v_person.label;
    end;
    select count(*) into n from public.fixture_import_batches where id = v_batch;
    reset role;
    if n = 0 then
      raise notice 'PASS C4: % cannot read the club''s staged batch', v_person.label;
    else
      raise notice 'FAIL C4: % can read the club''s staged batch', v_person.label;
    end if;
  end loop;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  begin
    v_fixture := public.publish_import_row(v_row);
    if v_fixture is not null then
      raise notice 'PASS C5: the Fixture Secretary publishes the staged row';
    else
      raise notice 'FAIL C5: publishing returned no fixture';
    end if;
  exception when others then
    raise notice 'FAIL C5: the Fixture Secretary could not publish: %', sqlerrm;
  end;
  reset role;

  -- =================================================================
  -- D. A CLUB'S DENY OVERRIDE WITHDRAWS BULK AUTHORITY
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_site::text, 'role', 'authenticated')::text, true);
  -- Slice 3: bulk planning is its own capability (fixture.planner.use), never fixture.create.
  perform public.set_capability_override(v_secretary, 'fixture.planner.use', 'club', v_club, null, 'deny', 'fixture_bulk_planning_authority suite');
  perform set_config('request.jwt.claims', json_build_object('sub', v_secretary::text, 'role', 'authenticated')::text, true);
  v_bool := public.can_bulk_plan_fixtures(v_club);
  begin
    insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
    values (v_secretary, 'fbpa denied', 1, 'processing', v_club);
    v_bool := true;
  exception when insufficient_privilege then
    null;
  end;
  reset role;
  if not v_bool then
    raise notice 'PASS D: a deny on fixture.planner.use removes bulk authority from the screen check and the staging boundary alike';
  else
    raise notice 'FAIL D: a denied Fixture Secretary still has bulk authority';
  end if;

  -- =================================================================
  -- E. PRIVILEGE LAYER
  -- =================================================================
  if not has_function_privilege('anon', 'public.can_bulk_plan_fixtures(uuid)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.single_fixture_team_ids(uuid)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.can_bulk_plan_fixtures(uuid)', 'EXECUTE')
     and has_function_privilege('authenticated', 'public.single_fixture_team_ids(uuid)', 'EXECUTE') then
    raise notice 'PASS E: anon cannot execute either authority function; authenticated can';
  else
    raise notice 'FAIL E: authority function grants are wrong';
  end if;
end $$;

rollback;
