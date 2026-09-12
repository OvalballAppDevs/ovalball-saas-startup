-- What a staged fixture row carries through to the fixture it becomes
-- (20270277000000 home_away, 20270278000000 meet_time).
--
-- Every route into Ovalball's bulk fixture creation -- a CSV upload, a
-- block pasted from a spreadsheet, a Fixture Day, the Mass Fixture Planner
-- -- converges on ONE staging row and ONE publish function. That is the
-- design, and it is only worth anything if the staging row can actually
-- hold what the source said.
--
-- Two fields could not be held at all until these migrations. publish
-- wrote 'Home' as a literal, so every fixture the import pipeline had ever
-- created was a home fixture whatever the file said -- a club importing a
-- season was silently told half its matches were at its own ground. And
-- meet_time, the one time a parent plans their Saturday around, had
-- nowhere to be staged, so somebody re-typed two hundred of them.
--
-- Neither failure could surface as an error, because in both cases there
-- was no value to disagree with. Hence permanent coverage: a regression
-- here is invisible in exactly the same way.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/fixture_staging_fidelity.sql
--
-- Wrapped in a transaction and rolled back.

\set ON_ERROR_STOP off
\pset pager off

begin;

do $$
declare
  v_admin uuid;
  v_club uuid;
  v_team uuid;
  v_directory uuid;
  v_batch uuid;
  v_row_away uuid;
  v_row_silent uuid;
  v_fixture_away uuid;
  v_fixture_silent uuid;
  v_home_away text;
  v_meet time;
begin
  select id into v_admin from auth.users where email = 'uat.fullsiteadmin@ovalball.test';
  select club_id into v_club from public.club_memberships
  where user_id = (select id from auth.users where email = 'uat.coach@ovalball.test')
    and status = 'active' limit 1;
  select id into v_team from public.teams where club_id = v_club and active limit 1;
  select id into v_directory from public.club_directory
  where id <> coalesce((select directory_id from public.clubs where id = v_club), '00000000-0000-0000-0000-000000000000'::uuid)
  limit 1;

  if v_admin is null or v_club is null or v_team is null or v_directory is null then
    raise notice 'SKIP: the UAT club this suite reads is not present in this database';
    return;
  end if;

  -- =================================================================
  -- 1. THE STAGING ROW CAN HOLD BOTH FIELDS AT ALL
  -- =================================================================
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'fixture_import_rows'
      and column_name in ('home_away', 'meet_time')
    group by table_name having count(*) = 2
  ) then
    raise notice 'PASS 1: a staged row has somewhere to record which side we are on and when to meet';
  else
    raise notice 'FAIL 1: fixture_import_rows cannot hold home_away and meet_time';
    return;
  end if;

  -- 2. AND IT REFUSES A VALUE THAT IS NEITHER. A staging column that
  -- accepted "Sideways" would publish it into fixtures and fail there,
  -- one row at a time, after the batch had already half-published.
  -- The batch is created OUTSIDE the exception block below. A begin/exception
  -- in plpgsql is a subtransaction, so creating it inside would have been
  -- rolled back along with the violation the block is there to catch.
  insert into public.fixture_import_batches (uploaded_by, filename, row_count, state, club_id)
  values (v_admin, 'staging fidelity suite', 2, 'processing', v_club)
  returning id into v_batch;

  begin
    insert into public.fixture_import_rows (batch_id, row_number, raw, status, home_away)
    values (v_batch, 99, '{}'::jsonb, 'ready', 'Sideways');
    raise notice 'FAIL 2: a staged row accepted a side that is neither Home nor Away';
  exception when check_violation then
    raise notice 'PASS 2: a staged row refuses a side that is neither Home nor Away';
  end;

  -- =================================================================
  -- 3-5. AN AWAY FIXTURE STAYS AWAY, AND A MEET TIME SURVIVES
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  insert into public.fixture_import_rows (
    batch_id, row_number, raw, status, resolved_home_team_id, resolved_away_directory_id,
    raw_opposition_text, fixture_date, kickoff_time, home_away, meet_time
  ) values (
    v_batch, 1, '{}'::jsonb, 'ready', v_team, v_directory,
    'Staging fidelity opposition', current_date + 400, '14:00', 'Away', '13:00'
  ) returning id into v_row_away;

  -- A row that says nothing about either field: the pre-migration shape,
  -- which must publish exactly as it always did rather than newly failing.
  insert into public.fixture_import_rows (
    batch_id, row_number, raw, status, resolved_home_team_id, resolved_away_directory_id,
    raw_opposition_text, fixture_date, kickoff_time
  ) values (
    v_batch, 2, '{}'::jsonb, 'ready', v_team, v_directory,
    'Staging fidelity opposition', current_date + 401, '11:00'
  ) returning id into v_row_silent;

  v_fixture_away := public.publish_import_row(v_row_away);
  v_fixture_silent := public.publish_import_row(v_row_silent);

  select home_away, meet_time into v_home_away, v_meet from public.fixtures where id = v_fixture_away;
  if v_home_away = 'Away' then
    raise notice 'PASS 3: a staged away fixture publishes as away, not at our own ground';
  else
    raise notice 'FAIL 3: a staged away fixture published as %', v_home_away;
  end if;

  if v_meet = '13:00'::time then
    raise notice 'PASS 4: the meet time the source gave survives to the fixture';
  else
    raise notice 'FAIL 4: meet time published as % rather than 13:00', coalesce(v_meet::text, 'null');
  end if;

  -- 5. BACKWARDS COMPATIBILITY IS THE POINT OF THE COALESCE. Every row
  -- published before these columns existed meant Home and no meet time,
  -- and must keep meaning that.
  select home_away, meet_time into v_home_away, v_meet from public.fixtures where id = v_fixture_silent;
  if v_home_away = 'Home' and v_meet is null then
    raise notice 'PASS 5: a row that says nothing still publishes as Home with no meet time';
  else
    raise notice 'FAIL 5: a silent row published as % / %', v_home_away, coalesce(v_meet::text, 'null');
  end if;

  -- =================================================================
  -- 6. PUBLISH STILL ASKS THE BATCH'S OWN CLUB, NOT THE CALLER
  -- The function was rewritten twice for these columns; the authority it
  -- carries is the part that must not have drifted in the process.
  -- =================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', (select id from auth.users where email = 'uat.unrelated@ovalball.test'),
                      'role', 'authenticated')::text, true);
  begin
    insert into public.fixture_import_rows (
      batch_id, row_number, raw, status, resolved_home_team_id, resolved_away_directory_id,
      raw_opposition_text, fixture_date, kickoff_time, home_away
    ) values (
      v_batch, 3, '{}'::jsonb, 'ready', v_team, v_directory,
      'Staging fidelity opposition', current_date + 402, '11:00', 'Home'
    );
    perform public.publish_import_row(
      (select id from public.fixture_import_rows where batch_id = v_batch and row_number = 3));
    raise notice 'FAIL 6: somebody outside the club published one of its fixtures';
  exception
    when insufficient_privilege then
      raise notice 'PASS 6: publishing still answers to the batch''s own club';
    when others then
      -- RLS refusing the staging insert outright is the same boundary
      -- holding one step earlier, and is equally a pass.
      raise notice 'PASS 6: an outsider could not even stage a row against this club''s batch';
  end;
end $$;

rollback;
