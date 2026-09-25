-- =====================================================================================================
-- SHARED SCHEDULING CALENDAR (CA-M11.4) -- team_scheduling_availability
--
-- Self-seeding, self-contained. Pins: authority is tied to the VIEWER's own fixture-request authority
-- (never target-club membership, never a blanket "any signed-in person"), the function's output is
-- structurally limited to (date, status) with no detail columns, every status derives correctly from
-- real commitments, and the date-range bound is enforced.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','tsa-'||v::text||'@ovalball.test','',
    now(),now(),now(),'{}'::jsonb,'{}'::jsonb,'','','','','','','','');
  insert into public.profiles (id, first_name, surname, email) values (v,'TSA',p_label,'tsa-'||v::text||'@ovalball.test');
  return v;
end $$;

create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
  begin execute p_sql; v := 'OK'; exception when others then get stacked diagnostics v = returned_sqlstate; end;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_dir_a uuid; v_club_a uuid; v_team_a uuid;
  v_dir_b uuid; v_club_b uuid; v_team_b uuid;
  v_ca uuid; v_stranger uuid;
  v_result text;
  v_status text;
  v_col_count int;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TSA A '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tsa-a-'||v_tag)
  returning id into v_dir_a;
  insert into public.clubs (directory_id, slug, status) values (v_dir_a,'tsa-a-'||v_tag,'active') returning id into v_club_a;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_a,'TSA A U12','tsa-a-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team_a;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TSA B '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tsa-b-'||v_tag)
  returning id into v_dir_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b,'tsa-b-'||v_tag,'active') returning id into v_club_b;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b,'TSA B U12','tsa-b-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team_b;

  v_ca := pg_temp.person('ClubAdminA');
  v_stranger := pg_temp.person('Stranger');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_a,v_ca,'CLUB_ADMIN','active');

  -- Real commitments on team B: a fixture on day 3, training on day 5, a club event on day 7.
  insert into public.fixtures (owning_team_id, kickoff_date, kickoff_time, home_away, status, raw_opposition_text, created_by, updated_by)
  values (v_team_b, current_date + 3, '14:00', 'Home', 'Booked', 'Some Other Club', v_ca, v_ca);
  insert into public.training_sessions (club_id, team_id, session_date, occurrence_date, start_time, status, source)
  values (v_club_b, v_team_b, current_date + 5, current_date + 5, '18:00', 'PLANNED', 'MANUAL');
  insert into public.club_events (club_id, name, starts_on, ends_on, is_club_wide, external_location_name)
  values (v_club_b, 'TSA Festival', current_date + 7, current_date + 7, true, 'TSA B Ground');

  -- A genuinely OUTSTANDING (sent) request naming team B as the target, on day 10.
  declare v_group uuid; v_req uuid;
  begin
    insert into public.fixture_request_groups (requesting_club_id, raw_opponent_text, opponent_club_id, proposed_date, created_by)
    values (v_club_a, 'TSA B RUFC', v_club_b, current_date + 10, v_ca) returning id into v_group;
    insert into public.fixture_requests (group_id, requesting_team_id, target_team_id, venue_preference, status, created_by)
    values (v_group, v_team_a, v_team_b, 'home', 'sent', v_ca) returning id into v_req;
  end;

  -- ---------------------------------------------------------------------------------------------
  -- A. AUTHORITY -- tied to the VIEWER's own fixture-request authority, never target-club membership.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_stranger, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+30)', v_team_a, v_team_b));
  perform pg_temp.check(v_result = '42501', 'A1: a stranger with no fixture-request authority anywhere is refused');

  v_result := pg_temp.try_as(v_ca, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date)', v_team_a, v_team_a));
  perform pg_temp.check(v_result = 'OK', 'A2: Club A''s own admin can see their OWN team''s availability');

  v_result := pg_temp.try_as(v_ca, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+30)', v_team_a, v_team_b));
  perform pg_temp.check(v_result = 'OK', 'A3: Club A''s own admin CAN see Club B''s team availability -- this is the whole point, asking about a prospective opponent, gated on the VIEWER''s own authority, not the target''s');

  v_result := pg_temp.try_as(v_stranger, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+30)', v_team_b, v_team_a));
  perform pg_temp.check(v_result = '42501', 'A4: a stranger cannot use Club B''s own team as the viewer either -- they hold no authority anywhere');

  -- ---------------------------------------------------------------------------------------------
  -- B. RANGE BOUND.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+91)', v_team_a, v_team_b));
  perform pg_temp.check(v_result <> 'OK', 'B1: a range beyond 90 days is refused -- bounded queries, never an unbounded partner scan');

  -- ---------------------------------------------------------------------------------------------
  -- C. STATUS CORRECTNESS, as Club A's admin looking at Club B's team. Every value is gathered
  -- BEFORE switching role/claims back, because pg_temp.check() (owned by this session's postgres
  -- role) is not itself granted to `authenticated` -- checking mid-impersonation would fail on the
  -- checker, not the thing being checked.
  -- ---------------------------------------------------------------------------------------------
  declare
    v_fixture_day text; v_training_day text; v_event_day text; v_pending_day text; v_free_day text;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',v_ca,'role','authenticated')::text, true);

    select status into v_fixture_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 3, current_date + 3);
    select status into v_training_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 5, current_date + 5);
    select status into v_event_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 7, current_date + 7);
    select status into v_pending_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 10, current_date + 10);
    select status into v_free_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 1, current_date + 1);

    perform set_config('request.jwt.claims','', true);
    reset role;

    perform pg_temp.check(v_fixture_day = 'fixture', 'C1: the fixture day reads fixture');
    perform pg_temp.check(v_training_day = 'training', 'C2: the training day reads training');
    perform pg_temp.check(v_event_day = 'club_event', 'C3: the club event day reads club_event');
    perform pg_temp.check(v_pending_day = 'request_pending', 'C4: the day with an outstanding sent request reads request_pending');
    perform pg_temp.check(v_free_day = 'available', 'C5: a day with nothing on it reads available');
  end;

  -- ---------------------------------------------------------------------------------------------
  -- D. STRUCTURAL PRIVACY -- the function can only ever return (date, status), nothing else.
  -- ---------------------------------------------------------------------------------------------
  select count(*) into v_col_count
  from information_schema.parameters
  where specific_schema = 'public' and specific_name in (
    select specific_name from information_schema.routines where routine_name = 'team_scheduling_availability' and routine_schema = 'public'
  ) and parameter_mode = 'OUT';
  perform pg_temp.check(v_col_count = 2, 'D1: the function returns exactly two columns (date, status) -- structurally incapable of leaking event names, opponents or any other detail');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
