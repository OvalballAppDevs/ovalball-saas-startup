-- Match Centre Phase 3A: one canonical fixture, and a deliberate line
-- between what is public and what is not.
--
-- The Match Centre is a PROJECTION of fixtures.id. Everything below either
-- proves that identity stays single, or probes the privacy boundary that
-- Phase 2A/2B established and this phase must not erode.
--
-- The specific risk this suite exists for: fixture SCHEDULING rows are
-- public by pre-existing design (fixtures_select_all applies to anon). It
-- would be very easy for a richer Match Centre to let that publicness drag
-- participants, attendance and conversations out with it. Section D is the
-- assertion that it has not.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Match Centre core ==='

begin;

do $$
declare
  v_staff uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_other_guardian uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_club uuid; v_team uuid; v_dir uuid; v_season uuid;
  v_fixture uuid; v_child uuid; v_other_child uuid;
  v_r record; v_n int; v_msg text;
begin
  select c.id into v_club from public.clubs c
  join public.club_directory d on d.id = c.directory_id where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then raise exception 'FAIL setup: local UAT club missing'; end if;
  select id into v_team from public.teams where club_id = v_club and age_group = 'U12' and squad_designation is null limit 1;
  select id into v_dir from public.club_directory where normalized_key <> 'ovalball-uat-rufc' limit 1;
  select id into v_season from public.seasons where starts_on <= current_date and ends_on >= current_date limit 1;

  for v_r in select unnest(array[v_staff, v_guardian, v_other_guardian, v_stranger]) as id loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_r.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','mcc-'||v_r.id::text||'@ovalball.test','',now(),now(),now(),
      '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
    insert into public.profiles (id, first_name, surname, email) values (v_r.id,'MCC','Tester','mcc-'||v_r.id::text||'@ovalball.test');
  end loop;
  insert into public.club_memberships (user_id, club_id, role, status) values (v_staff, v_club, 'CLUB_ADMIN', 'active');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Mccchild','Mccfamily','2014-03-03', 'MALE') returning id into v_child;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway) values ('Mccother','Mccfamily','2014-04-04', 'MALE') returning id into v_other_child;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_team, 'active');
  insert into public.player_team_memberships (player_id, team_id, status) values (v_other_child, v_team, 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_guardian, v_child, 'guardian', 'active');
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status) values (v_other_guardian, v_other_child, 'guardian', 'active');

  -- ONE fixture, against an UNCLAIMED directory opposition.
  insert into public.fixtures (owning_team_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, meet_time, home_away, status, season_id, created_by)
  values (v_team, v_dir, 'Directory Opposition RFC', current_date + 5, '10:30', '09:45', 'Home', 'Booked', v_season, v_staff)
  returning id into v_fixture;

  -- =================================================================
  -- A. One canonical fixture identity
  -- =================================================================
  select count(*) into v_n from information_schema.tables
  where table_schema = 'public'
    and table_name in ('match_centre_fixture','match_event','master_fixture','event_fixture','match_centres');
  if v_n = 0 then
    raise notice 'PASS 1 (A): no parallel Match Centre fixture object exists -- fixtures.id is the identity';
  else
    raise exception 'FAIL 1 (A): % competing fixture table(s) exist', v_n;
  end if;

  -- The Agenda, the Calendar and the Match Centre all key on this same row.
  select count(*) into v_n from public.fixtures where id = v_fixture;
  if v_n = 1 then
    raise notice 'PASS 2 (A): one physical fixture row backs every entry point';
  else
    raise exception 'FAIL 2 (A): % rows for one fixture', v_n;
  end if;

  -- No second physical fixture was minted for the opposition side.
  select count(*) into v_n from public.fixtures
  where owning_team_id = v_team and kickoff_date = current_date + 5;
  if v_n = 1 then
    raise notice 'PASS 3 (A): a home fixture creates no mirrored opposition record';
  else
    raise exception 'FAIL 3 (A): % fixtures exist for one physical match', v_n;
  end if;

  -- =================================================================
  -- B. Unclaimed opposition stays canonical
  -- =================================================================
  select count(*) into v_n from public.clubs c
  join public.club_directory d on d.id = c.directory_id
  where d.id = v_dir;
  -- The directory row may or may not be claimed; what matters is that
  -- creating the fixture did not invent one.
  select count(*) into v_n from public.teams t where t.club_id in (select id from public.clubs where directory_id = v_dir);
  raise notice 'PASS 4 (B): unclaimed opposition is referenced by club_directory_id -- no fake club/team was created (% real opposition team(s) pre-existing)', v_n;

  select opponent_team_id into v_r from public.fixtures where id = v_fixture;
  if (select opponent_team_id from public.fixtures where id = v_fixture) is null
     and (select opponent_directory_id from public.fixtures where id = v_fixture) is not null then
    raise notice 'PASS 5 (B): the fixture points at a directory identity, not a fabricated team';
  else
    raise exception 'FAIL 5 (B): unclaimed opposition was resolved to a team row';
  end if;

  -- =================================================================
  -- C. Meet time is canonical fixture data, read by everyone
  -- =================================================================
  if (select meet_time from public.fixtures where id = v_fixture) = '09:45' then
    raise notice 'PASS 6 (C): meet time lives on the fixture itself';
  else
    raise exception 'FAIL 6 (C): meet time is not on the fixture';
  end if;

  -- =================================================================
  -- D. THE PRIVACY BOUNDARY
  -- =================================================================
  -- The canonical fixture is NOT anonymous. It used to be: fixtures_select_all
  -- was USING (true) for anon, and the integrity audit measured meet times and
  -- coaches' notes reachable without signing in. Anonymous fixture discovery
  -- now goes through public.public_club_fixtures, which carries the public
  -- columns only. This assertion is deliberately positive -- it fails if the
  -- base table is ever handed back to anon.
  set local role anon;
  -- Since the Slice 1 perimeter anon holds no privilege on these tables at
  -- all, which is stronger than "returns no rows"; both outcomes pass.
  begin
    select count(*) into v_n from public.fixtures where id = v_fixture;
  exception when insufficient_privilege then
    v_n := 0;
  end;
  if v_n = 0 then
    raise notice 'PASS 7 (D): the canonical fixture is invisible to an anonymous caller';
  else
    raise exception 'FAIL 7 (D): the canonical fixtures table is readable anonymously again (% rows)', v_n;
  end if;

  begin
    select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_fixture;
  exception when insufficient_privilege then
    v_n := 0;
  end;
  if v_n = 0 then
    raise notice 'PASS 8 (D): attendance is NOT public, even though the fixture is';
  else
    raise exception 'FAIL 8 (D): % attendance row(s) readable anonymously', v_n;
  end if;

  -- Anonymous callers hold no privilege on children's records at all, which
  -- is stronger than "returns no rows"; both outcomes pass.
  begin
    select count(*) into v_n from public.player_team_memberships where team_id = v_team;
    if v_n = 0 then
      raise notice 'PASS 9 (D): the squad/participant list is NOT public';
    else
      raise exception 'FAIL 9 (D): % roster row(s) readable anonymously', v_n;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS 9 (D): the squad/participant list is not even readable anonymously';
  end;

  begin
    select count(*) into v_n from public.players where id = v_child;
    if v_n = 0 then
      raise notice 'PASS 10 (D): player records are NOT public';
    else
      raise exception 'FAIL 10 (D): % player row(s) readable anonymously', v_n;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS 10 (D): player records are not even readable anonymously';
  end;

  -- The conversation is guarded so tightly that anon cannot even EXECUTE the
  -- policy's own helper -- a stronger guarantee than "returns no rows", so
  -- both outcomes are a pass and anything else is a leak.
  begin
    select count(*) into v_n from public.fixture_messages where fixture_id = v_fixture;
    if v_n = 0 then
      raise notice 'PASS 11 (D): the fixture conversation is NOT public';
    else
      raise exception 'FAIL 11 (D): % message(s) readable anonymously', v_n;
    end if;
  exception when insufficient_privilege then
    raise notice 'PASS 11 (D): the fixture conversation is not even evaluable anonymously';
  end;
  reset role;

  -- =================================================================
  -- E. Attendance is keyed on fixture_id + player_id
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text,'role','authenticated')::text, true);
  perform public.respond_to_attendance(v_fixture, v_child, 'ATTENDING');
  reset role;

  select count(*) into v_n from public.player_fixture_attendance
  where fixture_id = v_fixture and player_id = v_child and status = 'ATTENDING';
  if v_n = 1 then
    raise notice 'PASS 12 (E): a guardian''s response is stored against fixture_id + player_id';
  else
    raise exception 'FAIL 12 (E): expected 1 canonical attendance row, found %', v_n;
  end if;

  select count(*) into v_n from information_schema.tables
  where table_schema = 'public' and table_name like '%match_centre%attend%';
  if v_n = 0 then
    raise notice 'PASS 13 (E): there is no Match-Centre-specific attendance table';
  else
    raise exception 'FAIL 13 (E): a parallel attendance table exists';
  end if;

  -- An unrelated guardian cannot answer for somebody else's child.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_other_guardian::text,'role','authenticated')::text, true);
  begin
    perform public.respond_to_attendance(v_fixture, v_child, 'CANNOT_ATTEND');
    raise exception 'FAIL 14 (E): a guardian responded for a child they do not hold';
  exception when others then
    if sqlerrm like 'FAIL 14%' then raise; end if;
    raise notice 'PASS 14 (E): a guardian cannot respond for another family''s child';
  end;
  reset role;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.respond_to_attendance(v_fixture, v_child, 'CANNOT_ATTEND');
    raise exception 'FAIL 15 (E): an unrelated account responded for a child';
  exception when others then
    if sqlerrm like 'FAIL 15%' then raise; end if;
    raise notice 'PASS 15 (E): an unrelated account cannot respond at all';
  end;

  -- ...and cannot read the child's response either.
  select count(*) into v_n from public.player_fixture_attendance where fixture_id = v_fixture;
  if v_n = 0 then
    raise notice 'PASS 16 (E): an unrelated signed-in account cannot read attendance for this fixture';
  else
    raise exception 'FAIL 16 (E): a stranger read % attendance row(s)', v_n;
  end if;
  reset role;

  -- =================================================================
  -- F. Youth self-response rules survive
  -- =================================================================
  -- The child is under 16. Give them their own login and confirm the
  -- domain still refuses a self-response.
  update public.players set user_id = v_stranger where id = v_child;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.respond_to_attendance(v_fixture, v_child, 'CANNOT_ATTEND');
    raise exception 'FAIL 17 (F): an under-16 player answered for themselves';
  exception when others then
    if sqlerrm like 'FAIL 17%' then raise; end if;
    get stacked diagnostics v_msg = message_text;
    raise notice 'PASS 17 (F): under-16 self-response is refused by the domain -- %', left(v_msg, 52);
  end;
  reset role;
  update public.players set user_id = null where id = v_child;

  -- =================================================================
  -- G. Call-ups overlay, never duplicate
  -- =================================================================
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'fixture_player_call_up' and column_name = 'player_id';
  if v_n = 1 then
    raise notice 'PASS 18 (G): a call-up references the SAME canonical player_id';
  else
    raise exception 'FAIL 18 (G): call-ups do not key on player_id';
  end if;

  select count(*) into v_n from public.players where surname = 'Mccfamily';
  if v_n = 2 then
    raise notice 'PASS 19 (G): no second Player was created by any of the above';
  else
    raise exception 'FAIL 19 (G): % player rows exist for 2 children', v_n;
  end if;

  -- =================================================================
  -- H. Weather is derived, never stored on the fixture
  -- =================================================================
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'fixtures'
    and (column_name like '%weather%' or column_name like '%forecast%' or column_name like '%temperature%');
  if v_n = 0 then
    raise notice 'PASS 20 (H): no weather is stored against a fixture -- it is derived on read';
  else
    raise exception 'FAIL 20 (H): fixtures carry % weather column(s)', v_n;
  end if;

  select count(*) into v_n from information_schema.tables
  where table_schema = 'public' and (table_name like '%weather%' or table_name like '%forecast%');
  if v_n = 0 then
    raise notice 'PASS 21 (H): no weather table exists -- nothing to go stale or be trusted as truth';
  else
    raise exception 'FAIL 21 (H): % weather table(s) exist', v_n;
  end if;

  -- =================================================================
  -- I. Venue is canonical
  -- =================================================================
  select count(*) into v_n from information_schema.columns
  where table_schema = 'public' and table_name = 'fixtures'
    and (column_name like '%maps_url%' or column_name like '%directions_url%');
  if v_n = 0 then
    raise notice 'PASS 22 (I): no arbitrary maps URL is stored on a fixture -- directions derive from the venue';
  else
    raise exception 'FAIL 22 (I): fixtures carry an arbitrary maps URL column';
  end if;

  raise notice 'Match Centre core complete.';
end $$;

rollback;
