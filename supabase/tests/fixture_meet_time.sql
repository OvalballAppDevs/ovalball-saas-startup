-- Meet / arrival time is canonical fixture data, not a Match Centre label.
--
-- The rules are enforced in the database precisely so that no form, import
-- or future surface can produce a fixture telling a parent to arrive after
-- kick-off. These assertions are written as the wrong data they prevent.
--
-- Self-contained/transactional.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Fixture meet time ==='

begin;

do $$
declare
  v_staff uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_club uuid; v_team uuid; v_opp uuid; v_fixture uuid; v_season uuid;
  v_r record; v_n int; v_meet time; v_kick time;
begin
  select c.id into v_club from public.clubs c
  join public.club_directory d on d.id = c.directory_id where d.normalized_key = 'ovalball-uat-rufc';
  if v_club is null then
    raise exception 'FAIL setup: local UAT club missing';
  end if;
  select id into v_team from public.teams where club_id = v_club and age_group = 'U12' and squad_designation is null limit 1;
  -- An UNCLAIMED directory opposition, so the fixture is valid without
  -- needing two age-eligible claimed teams (and exercises the same
  -- canonical unclaimed representation the Match Centre renders).
  select id into v_opp from public.club_directory where normalized_key <> 'ovalball-uat-rufc' limit 1;
  select id into v_season from public.seasons where starts_on <= current_date and ends_on >= current_date limit 1;

  for v_r in select unnest(array[v_staff, v_stranger]) as id loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_r.id,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fmt-'||v_r.id::text||'@ovalball.test','',now(),now(),now(),
      '{}'::jsonb,'{}'::jsonb,'','','','','','','','');
    insert into public.profiles (id, first_name, surname, email) values (v_r.id,'FMT','Tester','fmt-'||v_r.id::text||'@ovalball.test');
  end loop;
  insert into public.club_memberships (user_id, club_id, role, status) values (v_staff, v_club, 'CLUB_ADMIN', 'active');

  insert into public.fixtures (owning_team_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id, created_by)
  values (v_team, v_opp, 'Directory Opposition RFC', current_date + 7, '10:30', 'Home', 'Booked', v_season, v_staff)
  returning id into v_fixture;

  -- =================================================================
  -- A. Optional, and existing fixtures are untouched
  -- =================================================================
  select meet_time into v_meet from public.fixtures where id = v_fixture;
  if v_meet is null then
    raise notice 'PASS 1 (A): meet time is optional -- a new fixture has none';
  else
    raise exception 'FAIL 1 (A): a fixture was created with a meet time of %', v_meet;
  end if;

  select count(*) into v_n from public.fixtures where meet_time is not null;
  if v_n = 0 then
    raise notice 'PASS 2 (A): no pre-existing fixture gained a meet time from the migration';
  else
    raise notice 'NOTE 2 (A): % fixture(s) already carry a meet time', v_n;
  end if;

  -- =================================================================
  -- B. The rules
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);

  perform public.update_fixture_meet_time(v_fixture, '09:45');
  reset role;
  select meet_time into v_meet from public.fixtures where id = v_fixture;
  if v_meet = '09:45' then
    raise notice 'PASS 3 (B): a meet time BEFORE kick-off is accepted';
  else
    raise exception 'FAIL 3 (B): meet time is %', v_meet;
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  perform public.update_fixture_meet_time(v_fixture, '10:30');
  reset role;
  select meet_time into v_meet from public.fixtures where id = v_fixture;
  if v_meet = '10:30' then
    raise notice 'PASS 4 (B): a meet time EQUAL to kick-off is accepted (meet <= kickoff)';
  else
    raise exception 'FAIL 4 (B): equal meet time was rejected';
  end if;

  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  begin
    perform public.update_fixture_meet_time(v_fixture, '11:00');
    raise exception 'FAIL 5 (B): a meet time AFTER kick-off was accepted';
  exception when others then
    if sqlerrm like 'FAIL 5%' then raise; end if;
    raise notice 'PASS 5 (B): a meet time after kick-off is refused -- %', left(sqlerrm, 48);
  end;
  reset role;

  -- The RPC is not the only door: the constraint itself must hold.
  begin
    update public.fixtures set meet_time = '11:00' where id = v_fixture;
    raise exception 'FAIL 6 (B): a direct UPDATE set a meet time after kick-off';
  exception
    when check_violation then
      raise notice 'PASS 6 (B): the CHECK constraint refuses meet > kickoff even on a direct write';
    when others then
      if sqlerrm like 'FAIL 6%' then raise; end if;
      raise notice 'PASS 6 (B): a direct write of meet > kickoff is refused (%)', left(sqlerrm, 40);
  end;

  -- Clearing is always allowed.
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  perform public.update_fixture_meet_time(v_fixture, null);
  reset role;
  select meet_time into v_meet from public.fixtures where id = v_fixture;
  if v_meet is null then
    raise notice 'PASS 7 (B): a meet time can be cleared';
  else
    raise exception 'FAIL 7 (B): meet time survived clearing';
  end if;

  -- =================================================================
  -- C. A meet time requires a kick-off
  -- =================================================================
  update public.fixtures set kickoff_time = null where id = v_fixture;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  begin
    perform public.update_fixture_meet_time(v_fixture, '09:45');
    raise exception 'FAIL 8 (C): a meet time was set on a fixture with no kick-off';
  exception when others then
    if sqlerrm like 'FAIL 8%' then raise; end if;
    raise notice 'PASS 8 (C): a meet time without a kick-off is refused -- %', left(sqlerrm, 48);
  end;
  reset role;

  -- ...and removing the kick-off must not strand one behind it.
  update public.fixtures set kickoff_time = '10:30' where id = v_fixture;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  perform public.update_fixture_meet_time(v_fixture, '09:45');
  reset role;
  update public.fixtures set kickoff_time = null where id = v_fixture;
  select meet_time into v_meet from public.fixtures where id = v_fixture;
  if v_meet is null then
    raise notice 'PASS 9 (C): clearing the kick-off clears the meet time -- no orphaned arrival time';
  else
    raise exception 'FAIL 9 (C): meet time % survived the kick-off being removed', v_meet;
  end if;

  -- A kickoff moved EARLIER than the meet time must not block the reschedule.
  update public.fixtures set kickoff_time = '10:30' where id = v_fixture;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  perform public.update_fixture_meet_time(v_fixture, '10:15');
  reset role;
  update public.fixtures set kickoff_time = '09:00' where id = v_fixture;
  select meet_time, kickoff_time into v_meet, v_kick from public.fixtures where id = v_fixture;
  if v_meet is null and v_kick = '09:00' then
    raise notice 'PASS 10 (C): moving kick-off earlier still succeeds; the stale meet time is dropped';
  else
    raise exception 'FAIL 10 (C): meet=% kickoff=% after an earlier reschedule', v_meet, v_kick;
  end if;

  -- =================================================================
  -- D. Authority
  -- =================================================================
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_stranger::text,'role','authenticated')::text, true);
  begin
    perform public.update_fixture_meet_time(v_fixture, '08:30');
    raise exception 'FAIL 11 (D): an unrelated account set a fixture meet time';
  exception when insufficient_privilege then
    raise notice 'PASS 11 (D): setting a meet time needs the same authority as the rest of the schedule';
  end;
  reset role;

  -- =================================================================
  -- E. Future-season fixtures behave identically
  -- =================================================================
  insert into public.fixtures (owning_team_id, opponent_directory_id, raw_opposition_text, kickoff_date, kickoff_time, home_away, status, season_id, created_by)
  values (v_team, v_opp, 'Directory Opposition RFC', current_date + 400, '14:00', 'Home', 'Booked', v_season, v_staff)
  returning id into v_fixture;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_staff::text,'role','authenticated')::text, true);
  perform public.update_fixture_meet_time(v_fixture, '13:15');
  reset role;
  select meet_time into v_meet from public.fixtures where id = v_fixture;
  if v_meet = '13:15' then
    raise notice 'PASS 12 (E): a future-season fixture supports a meet time on the same canonical column';
  else
    raise exception 'FAIL 12 (E): future fixture meet time is %', v_meet;
  end if;

  -- =================================================================
  -- F. One canonical column
  -- =================================================================
  -- BASE TABLES only. The invariant is that meet time is STORED in exactly one
  -- place; a VIEW that projects fixtures.meet_time is the opposite of a second
  -- copy -- it is a read of the one column, and Fixture Management needs one to
  -- show the value it edits. A second base table carrying a meet or arrival
  -- time still fails here, which is the case this assertion exists for.
  select count(*) into v_n
  from information_schema.columns c
  join information_schema.tables t
    on t.table_schema = c.table_schema and t.table_name = c.table_name
  where c.table_schema = 'public'
    and c.column_name in ('meet_time','arrival_time','meet_at')
    and t.table_type = 'BASE TABLE'
    and c.table_name <> 'fixtures';
  if v_n = 0 then
    raise notice 'PASS 13 (F): meet time is STORED only on fixtures -- no second copy, however many views read it';
  else
    raise exception 'FAIL 13 (F): % other base table(s) carry a meet/arrival time', v_n;
  end if;

  raise notice 'Fixture meet time complete.';
end $$;

rollback;
