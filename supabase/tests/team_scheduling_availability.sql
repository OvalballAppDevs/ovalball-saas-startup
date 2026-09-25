-- =====================================================================================================
-- SHARED SCHEDULING CALENDAR (CA-M11.4, corrected by Clubhouse Programme Section 7 --
-- 20270558000000) -- team_scheduling_availability
--
-- Self-seeding, self-contained. Pins: authority for a team's OWN calendar is tied to the VIEWER's own
-- fixture-request authority (never target-club membership, never a blanket "any signed-in person"); a
-- CROSS-team read additionally requires the two teams to be canonically compatible AND their clubs to
-- hold an active partnership -- a real gap this suite itself used to assert as correct ("gated on the
-- VIEWER's own authority, not the target's") until Section 7's own forensic audit found it: any team
-- manager anywhere could previously read ANY other team's full fixture/training/club-event/pending-
-- request detail with no relationship to that team at all. The function's output is structurally
-- limited to (date, status) with no detail columns; every status derives correctly from real
-- commitments; the cross-team side is coarsened to a single 'busy' value, never the specific category;
-- a genuinely clear cross-team day reads 'no_known_clash', never the previously-shipped 'available'; and
-- the date-range bound is enforced.
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
  v_dir_c uuid; v_club_c uuid; v_team_c uuid; v_team_c_u16 uuid;
  v_type_u16 uuid;
  v_ca uuid; v_cb uuid; v_stranger uuid;
  v_result text;
  v_status text;
  v_col_count int;
  v_partnership uuid;
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

  -- Club C: compatible with A, deliberately NEVER partnered -- proves the "partners only" boundary.
  -- Also carries an incompatible U16 side, so a partnered-but-wrong-age-band team can be proven refused
  -- too (X2 below), independent of the partnership question X1 proves.
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TSA C '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tsa-c-'||v_tag)
  returning id into v_dir_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c,'tsa-c-'||v_tag,'active') returning id into v_club_c;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_c,'TSA C U12','tsa-c-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team_c;
  select id into v_type_u16 from public.canonical_team_types_by_code where rugby_code='union' and key='u16' and is_offered limit 1;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active, canonical_team_type_id)
  values (v_club_c,'TSA C U16','tsa-c-u16-'||v_tag,'youth','U16','boys','union',true, v_type_u16) returning id into v_team_c_u16;

  v_ca := pg_temp.person('ClubAdminA');
  v_cb := pg_temp.person('ClubAdminB');
  v_stranger := pg_temp.person('Stranger');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_a,v_ca,'CLUB_ADMIN','active');
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club_b,v_cb,'CLUB_ADMIN','active');

  -- Club A and Club B are an ACTIVE partnership -- Section 7's own new precondition for any cross-team
  -- read. Without this, A3 below would now be correctly refused (see X1/X2 further down for exactly
  -- that refused case, proven against a genuinely non-partnered/incompatible third club).
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_ca,'role','authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  insert into public.club_partnerships (requesting_club_id, partner_club_id, requested_by) values (v_club_a, v_club_b, v_ca) returning id into v_partnership;
  perform set_config('request.jwt.claims', jsonb_build_object('sub',v_cb,'role','authenticated')::text, true);
  perform public.respond_to_club_partnership(v_partnership, true);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims','', true);

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
  perform pg_temp.check(v_result = 'OK', 'A3: Club A''s own admin CAN see Club B''s team availability -- a real, active, compatible partner, exactly the case this exists for');

  v_result := pg_temp.try_as(v_stranger, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+30)', v_team_b, v_team_a));
  perform pg_temp.check(v_result = '42501', 'A4: a stranger cannot use Club B''s own team as the viewer either -- they hold no authority anywhere');

  -- ---------------------------------------------------------------------------------------------
  -- X. SECTION 7'S OWN NEW BOUNDARY: a cross-team read additionally needs compatibility AND an
  -- active partnership -- real fixture-request authority over the viewer's own team is necessary but
  -- no longer sufficient on its own.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+30)', v_team_a, v_team_c));
  perform pg_temp.check(v_result = '42501', 'X1: Club C is compatible but NEVER partnered with Club A -- refused, the partners-only boundary is not broadened');

  v_result := pg_temp.try_as(v_ca, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+30)', v_team_a, v_team_c_u16));
  perform pg_temp.check(v_result = '42501', 'X2: Club C''s U16 side is a different age band entirely -- refused on incompatibility, independent of partnership');

  -- ---------------------------------------------------------------------------------------------
  -- B. RANGE BOUND.
  -- ---------------------------------------------------------------------------------------------
  v_result := pg_temp.try_as(v_ca, format('select * from public.team_scheduling_availability(%L,%L,current_date,current_date+91)', v_team_a, v_team_b));
  perform pg_temp.check(v_result <> 'OK', 'B1: a range beyond 90 days is refused -- bounded queries, never an unbounded partner scan');

  -- ---------------------------------------------------------------------------------------------
  -- C. STATUS CORRECTNESS, as Club A's admin looking at Club B's (a real, active partner) team.
  -- Section 7's own coarsening: every specific category collapses to 'busy', and a genuinely clear
  -- day reads 'no_known_clash' -- NEVER 'available', which only a team's own calendar may say about
  -- itself (proven separately in section OWN below). Every value is gathered BEFORE switching
  -- role/claims back, because pg_temp.check() (owned by this session's postgres role) is not itself
  -- granted to `authenticated` -- checking mid-impersonation would fail on the checker, not the thing
  -- being checked.
  -- ---------------------------------------------------------------------------------------------
  declare
    v_fixture_day text; v_training_day text; v_event_day text; v_pending_day text; v_free_day text;
    v_own_fixture_day text; v_own_free_day text;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', jsonb_build_object('sub',v_ca,'role','authenticated')::text, true);

    select status into v_fixture_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 3, current_date + 3);
    select status into v_training_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 5, current_date + 5);
    select status into v_event_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 7, current_date + 7);
    select status into v_pending_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 10, current_date + 10);
    select status into v_free_day from public.team_scheduling_availability(v_team_a, v_team_b, current_date + 1, current_date + 1);

    -- OWN: the SAME dates, but B looking at its OWN team -- specific categories, exactly as before.
    perform set_config('request.jwt.claims', jsonb_build_object('sub',v_cb,'role','authenticated')::text, true);
    select status into v_own_fixture_day from public.team_scheduling_availability(v_team_b, v_team_b, current_date + 3, current_date + 3);
    select status into v_own_free_day from public.team_scheduling_availability(v_team_b, v_team_b, current_date + 1, current_date + 1);

    perform set_config('request.jwt.claims','', true);
    reset role;

    perform pg_temp.check(v_fixture_day = 'busy', 'C1: the fixture day coarsens to busy for the cross-team viewer, never the specific category "fixture"');
    perform pg_temp.check(v_training_day = 'busy', 'C2: the training day coarsens to busy for the cross-team viewer');
    perform pg_temp.check(v_event_day = 'busy', 'C3: the club event day coarsens to busy for the cross-team viewer');
    perform pg_temp.check(v_pending_day = 'request_pending', 'C4: the day with an outstanding sent request still reads request_pending -- distinct from busy, never coarsened away');
    perform pg_temp.check(v_free_day = 'no_known_clash', 'C5: a genuinely clear cross-team day reads no_known_clash -- the exact fix, never the previously-shipped "available"');
    perform pg_temp.check(v_own_fixture_day = 'fixture', 'OWN1: Club B looking at its OWN team still gets the specific category "fixture", completely unchanged');
    perform pg_temp.check(v_own_free_day = 'available', 'OWN2: Club B''s own genuinely clear day truthfully reads available -- a team may say this about itself');
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
