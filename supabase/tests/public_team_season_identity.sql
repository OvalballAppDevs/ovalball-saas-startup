-- PUBLIC SEASON TEAM NAMES (Identity/Auth Slice 1 forward-fix).
--
-- The signed-out Club Digital Home labels each upcoming public fixture with
-- the team's identity in that fixture's season, through the public projection
-- public.get_public_team_season_names(jsonb). Every check runs as the role a
-- caller really has and reads the database back.
--
--   Q. Before a Season Handover: current-season and next-season fixtures.
--   R. After a Season Handover: an earlier-season fixture keeps its earlier
--      identity; a new-season fixture uses the new one.
--   S. The projection's boundary: shape, scope, malformed input.
--   T. The Slice 1 perimeter is unchanged around it.
--
-- Two transactions, both rolled back: the resolver chooses "the current
-- season" by date per rugby code, so the before and after worlds must not
-- share a transaction.

\set ON_ERROR_STOP off
\pset pager off

-- ===================================================================
-- Q + S + T: before handover
-- ===================================================================
begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_dir uuid; v_club uuid; v_team uuid; v_quiet_team uuid;
  v_s0 uuid; v_s1 uuid;
  v_f_current uuid; v_f_next uuid;
  v_live_name text; v_name text; v_count integer; v_err text; v_bool boolean;
  v_pairs jsonb;
begin
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Season Names RFC ' || v_tag, 'union', 'England', 'England', 'manual', 'verified', 'season-names-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'season-names-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
  values (v_club, 'union', 'youth', 'U13', 'boys', 'U13', 'sn-u13-' || v_tag, true) returning id into v_team;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
  values (v_club, 'union', 'youth', 'U15', 'boys', 'U15', 'sn-u15-' || v_tag, true) returning id into v_quiet_team;
  select display_name into v_live_name from public.teams where id = v_team;

  -- The current Union season began yesterday; the next begins a year later.
  insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('Season Names Current ' || v_tag, current_date - 1, current_date + 300, 'union', 2190, true) returning id into v_s0;
  insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('Season Names Next ' || v_tag, current_date + 364, current_date + 660, 'union', 2191, true) returning id into v_s1;

  insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, status)
  values (v_team, v_s0, current_date + 10, 'Home', 'Current Season Opponent', 'Booked') returning id into v_f_current;
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, status)
  values (v_team, v_s1, current_date + 370, 'Away', 'Next Season Opponent', 'Booked') returning id into v_f_next;
  -- Not public: a cancelled fixture.
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, status)
  values (v_quiet_team, v_s0, current_date + 12, 'Home', 'Cancelled Opponent', 'Cancelled');

  v_pairs := jsonb_build_array(
    jsonb_build_object('team_id', v_team, 'season_id', v_s0),
    jsonb_build_object('team_id', v_team, 'season_id', v_s1));

  -- Q1 / Q2 ----------------------------------------------------------
  v_err := null;
  begin
    perform pg_temp.act('anon');
    select display_name into v_name from public.get_public_team_season_names(v_pairs) where team_id = v_team and season_id = v_s0;
    select count(*) into v_count from public.get_public_team_season_names(v_pairs);
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_err is null and v_name = v_live_name and v_live_name = 'Under 13 Boys' and v_count = 2 then
    raise notice 'PASS Q1: a signed-out visitor gets the current-season fixture''s team name (%), with no 401', v_name;
  else
    raise notice 'FAIL Q1: current season name % (live %, rows %, sqlstate %)', v_name, v_live_name, v_count, v_err;
  end if;

  perform pg_temp.act('anon');
  select display_name into v_name from public.get_public_team_season_names(v_pairs) where team_id = v_team and season_id = v_s1;
  perform pg_temp.act_postgres();
  if v_name = 'Under 14 Boys' and v_name <> v_live_name then
    raise notice 'PASS Q2: a next-season fixture shows the team as it will be that season (%), not today''s % ', v_name, v_live_name;
  else
    raise notice 'FAIL Q2: next season name % (live %)', v_name, v_live_name;
  end if;

  -- Q3: the signed-in resolver and the public projection agree.
  perform pg_temp.act('authenticated', gen_random_uuid());
  select string_agg(team_id || ':' || season_id || ':' || display_name, ',' order by season_id) into v_name from public.get_team_identities_for_season_batch(v_pairs);
  perform pg_temp.act_postgres();
  perform pg_temp.act('anon');
  if v_name = (select string_agg(team_id || ':' || season_id || ':' || display_name, ',' order by season_id) from public.get_public_team_season_names(v_pairs)) then
    perform pg_temp.act_postgres();
    raise notice 'PASS Q3: the existing signed-in resolver still works and gives the same names as the public projection';
  else
    perform pg_temp.act_postgres();
    raise notice 'FAIL Q3: signed-in and public names differ (%)', v_name;
  end if;

  -- S1: shape ----------------------------------------------------------
  if (select array_agg(n::text order by o) from pg_proc p, unnest(p.proargnames, p.proargmodes) with ordinality as a(n, m, o)
      where p.oid = 'public.get_public_team_season_names(jsonb)'::regprocedure and a.m = 't') = array['team_id', 'season_id', 'display_name'] then
    raise notice 'PASS S1: the projection returns exactly team_id, season_id and display_name';
  else
    raise notice 'FAIL S1: unexpected output columns';
  end if;

  -- S2: scope ----------------------------------------------------------
  perform pg_temp.act('anon');
  select count(*) into v_count from public.get_public_team_season_names(jsonb_build_array(
    jsonb_build_object('team_id', v_quiet_team, 'season_id', v_s0),         -- only a cancelled fixture
    jsonb_build_object('team_id', v_team, 'season_id', gen_random_uuid()),   -- no such season
    jsonb_build_object('team_id', gen_random_uuid(), 'season_id', v_s0),     -- no such team
    jsonb_build_object('team_id', v_quiet_team, 'season_id', v_s1)));        -- a real team and season, no fixture
  perform pg_temp.act_postgres();
  if v_count = 0 then
    raise notice 'PASS S2: a team or season with no public fixture returns nothing, so the projection cannot enumerate private teams';
  else
    raise notice 'FAIL S2: % row(s) returned outside public fixtures', v_count;
  end if;

  -- S3: malformed input -----------------------------------------------
  v_bool := true;
  begin
    perform pg_temp.act('anon');
    if (select count(*) from public.get_public_team_season_names('{"team_id":"x"}'::jsonb)) <> 0 then v_bool := false; end if;
    if (select count(*) from public.get_public_team_season_names(null)) <> 0 then v_bool := false; end if;
    if (select count(*) from public.get_public_team_season_names('[1, "a", {"team_id":"not-a-uuid","season_id":"; drop table teams"}]'::jsonb)) <> 0 then v_bool := false; end if;
    perform pg_temp.act_postgres();
  exception when others then
    v_bool := false;
    perform pg_temp.act_postgres();
  end;
  v_err := null;
  begin
    perform pg_temp.act('anon');
    perform count(*) from public.get_public_team_season_names((select jsonb_agg(jsonb_build_object('team_id', gen_random_uuid(), 'season_id', gen_random_uuid())) from generate_series(1, 101)));
    perform pg_temp.act_postgres();
  exception when others then
    get stacked diagnostics v_err = returned_sqlstate;
    perform pg_temp.act_postgres();
  end;
  if v_bool and v_err = '22023' then
    raise notice 'PASS S3: malformed pairs return nothing without error, and more than 100 pairs are refused';
  else
    raise notice 'FAIL S3: malformed input handling (ok %, oversized sqlstate %)', v_bool, v_err;
  end if;

  -- S4: security properties -------------------------------------------
  select p.prosecdef and 'search_path=""' = any (p.proconfig)
     and has_function_privilege('anon', p.oid, 'EXECUTE')
     and not has_function_privilege('authenticated', p.oid, 'EXECUTE')
     and not has_function_privilege('service_role', p.oid, 'EXECUTE')
     and not exists (select 1 from aclexplode(p.proacl) a where a.grantee = 0)
     and p.prosrc !~* 'select\s+\*'
  into v_bool
  from pg_proc p where p.oid = 'public.get_public_team_season_names(jsonb)'::regprocedure;
  if v_bool then
    raise notice 'PASS S4: definer with an empty search_path, executable by anon only, no PUBLIC execute, no select *';
  else
    raise notice 'FAIL S4: projection security properties';
  end if;

  -- T1: teams is not widened ------------------------------------------
  v_bool := true;
  foreach v_name in array array['select * from public.teams limit 1', 'select fold_reason from public.teams limit 1', 'select created_by from public.teams limit 1',
                                'select legacy_team_ref from public.teams limit 1', 'select * from public.team_season_identity limit 1',
                                'update public.teams set display_name = display_name where false', 'select * from public.fixtures limit 1'] loop
    v_err := null;
    begin
      perform pg_temp.act('anon');
      execute v_name;
      perform pg_temp.act_postgres();
    exception when others then
      get stacked diagnostics v_err = returned_sqlstate;
      perform pg_temp.act_postgres();
    end;
    if v_err is distinct from '42501' then
      v_bool := false;
      raise notice 'anon was not refused: % (sqlstate %)', v_name, v_err;
    end if;
  end loop;
  if v_bool and not has_function_privilege('anon', 'public.get_team_identities_for_season_batch(jsonb)', 'EXECUTE')
     and not has_function_privilege('anon', 'public.get_team_identity_for_season(uuid, uuid)', 'EXECUTE')
     and not has_column_privilege('anon', 'public.teams', 'fold_reason', 'SELECT')
     and not has_column_privilege('anon', 'public.teams', 'created_by', 'SELECT') then
    raise notice 'PASS T1: anon still cannot read teams broadly, read private team columns or team_season_identity, update teams, read fixtures, or run the broad resolvers';
  else
    raise notice 'FAIL T1: the teams perimeter was widened';
  end if;

  -- T2: the other Slice 1 closures ------------------------------------
  if not has_table_privilege('anon', 'public.admin_club_overview', 'SELECT')
     and not has_column_privilege('anon', 'public.competition_matches', 'notes', 'SELECT')
     and not has_column_privilege('anon', 'public.competition_matches', 'sync_error', 'SELECT')
     and not has_column_privilege('anon', 'public.club_directory', 'notes', 'SELECT')
     and not has_column_privilege('anon', 'public.club_directory', 'official_email', 'SELECT')
     and (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relkind in ('r','p')
            and (has_table_privilege('anon', c.oid, 'TRUNCATE') or has_table_privilege('authenticated', c.oid, 'TRUNCATE'))) = 0
     and (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname in ('public','internal') and has_function_privilege('anon', p.oid, 'EXECUTE')
            and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')) = 18 then
    -- 17 became 18 in Identity/Auth Slice 5: public.preview_invitation is anon-executable by design
    -- (O.1 Previews), because the person holding an invitation link has no account yet. It answers
    -- with nothing at all for a token it does not recognise, so it is not an enumeration oracle.
    --
    -- 15 became 17 in Identity/Auth Slice 4H, deliberately. internal.club_ids_with and
    -- internal.has_site_capability are now evaluated by policies a signed-out visitor reaches
    -- TRANSITIVELY -- club_articles_public_read joins to clubs, which evaluates clubs_select. Both
    -- resolve through the canonical decision and answer no without a session, so anon can call them
    -- and learns nothing; club_admin_authority_matrix CH-P4 and CH-P4b assert that emptiness.
    raise notice 'PASS T2: admin_club_overview, competition and club directory private columns stay closed, no browser TRUNCATE, 18 anon functions';
  else
    raise notice 'FAIL T2: a Slice 1 closure regressed';
  end if;
end $$;

rollback;

-- ===================================================================
-- R: after handover
-- ===================================================================
begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_dir uuid; v_club uuid; v_team uuid;
  v_old uuid; v_new uuid;
  v_before_name text; v_after_name text; v_old_name text; v_new_name text;
  v_pairs jsonb;
begin
  insert into public.club_directory (name, rugby_code, country, nation, source, verification_status, normalized_key)
  values ('Handover Names RFC ' || v_tag, 'union', 'England', 'England', 'manual', 'verified', 'handover-names-' || v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'handover-names-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
  values (v_club, 'union', 'youth', 'U13', 'boys', 'U13', 'hn-u13-' || v_tag, true) returning id into v_team;

  -- The earlier season has finished; the new one began yesterday.
  insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('Handover Names Earlier ' || v_tag, current_date - 366, current_date - 2, 'union', 2192, true) returning id into v_old;
  insert into public.seasons (name, starts_on, ends_on, rugby_code, season_year_start, is_regression_fixture)
  values ('Handover Names New ' || v_tag, current_date - 1, current_date + 300, 'union', 2193, true) returning id into v_new;

  -- A fixture that belongs to the earlier season but is still to be played
  -- (rearranged past the season end), and one in the new season.
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, status)
  values (v_team, v_old, current_date + 5, 'Home', 'Rearranged Earlier Opponent', 'Booked');
  insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, raw_opposition_text, status)
  values (v_team, v_new, current_date + 20, 'Away', 'New Season Opponent', 'Booked');

  select display_name into v_before_name from public.teams where id = v_team;

  -- Season Handover, exactly as internal.apply_season_handover_core records
  -- it: snapshot the team's identity for the season it is leaving, then the
  -- team moves up an age grade.
  insert into public.team_season_identity (team_id, season_id, category, age_group, squad_designation, gender, display_name)
  select t.id, v_old, t.category, t.age_group, t.squad_designation, t.gender, t.display_name from public.teams t where t.id = v_team
  on conflict (team_id, season_id) do nothing;
  update public.teams set age_group = 'U14', display_name = 'U14' where id = v_team;
  select display_name into v_after_name from public.teams where id = v_team;

  v_pairs := jsonb_build_array(
    jsonb_build_object('team_id', v_team, 'season_id', v_old),
    jsonb_build_object('team_id', v_team, 'season_id', v_new));

  perform pg_temp.act('anon');
  select display_name into v_old_name from public.get_public_team_season_names(v_pairs) where season_id = v_old;
  select display_name into v_new_name from public.get_public_team_season_names(v_pairs) where season_id = v_new;
  perform pg_temp.act_postgres();

  if v_before_name = 'Under 13 Boys' and v_after_name = 'Under 14 Boys' and v_old_name = 'Under 13 Boys' and v_old_name <> v_after_name then
    raise notice 'PASS R1: after Season Handover an earlier-season fixture keeps its earlier public identity (%), not today''s %', v_old_name, v_after_name;
  else
    raise notice 'FAIL R1: earlier-season name % (before %, after %)', v_old_name, v_before_name, v_after_name;
  end if;

  if v_new_name = 'Under 14 Boys' then
    raise notice 'PASS R2: a new-season fixture uses the new season identity (%)', v_new_name;
  else
    raise notice 'FAIL R2: new-season name %', v_new_name;
  end if;

  -- R3: the historical name comes from the stored record, not today's row.
  update public.teams set age_group = 'U15', display_name = 'U15' where id = v_team;
  perform pg_temp.act('anon');
  select display_name into v_old_name from public.get_public_team_season_names(v_pairs) where season_id = v_old;
  perform pg_temp.act_postgres();
  if v_old_name = 'Under 13 Boys' then
    raise notice 'PASS R3: renaming the team again leaves the earlier season''s public name untouched';
  else
    raise notice 'FAIL R3: earlier-season name followed the live team (%)', v_old_name;
  end if;
end $$;

rollback;
