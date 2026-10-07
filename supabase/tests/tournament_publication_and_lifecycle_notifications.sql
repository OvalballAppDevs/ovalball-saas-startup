-- NOTIFICATIONS PLATFORM PROGRAMME, PHASE F+G(partial): the governed publish_tournament_plan path,
-- and the application/decision/cancellation notification producers that did not exist before this
-- programme. Proves: publish is organiser-only, refuses an empty plan, is idempotent against a
-- second publish, and notifies every participating side; applying notifies the organiser; deciding
-- notifies the applicant; cancelling is mandatory and reaches everyone.
--
--   docker exec -i supabase_db_ovalball-saas-startup psql -U postgres -d postgres -f - < supabase/tests/tournament_publication_and_lifecycle_notifications.sql
--
-- Self-contained and rolled back.

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'pub-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email) values (v, 'Pub', p_label, 'pub-' || v::text || '@ovalball.test');
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Pub ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'pub-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'pub-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'pub-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true)
  returning id into v;
  return v;
end $$;

create or replace function pg_temp.member(p_club uuid, p_user uuid, p_role text default 'BASIC_USER') returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.club_memberships (club_id, user_id, role, status) values (p_club, p_user, p_role, 'active') returning id into v;
  return v;
end $$;

create or replace function pg_temp.team_role(p_membership uuid, p_team uuid, p_role_key text default 'COACH') returns void language plpgsql as $$
begin
  insert into testing.team_roles (membership_id, team_id, role_key) values (p_membership, p_team, p_role_key);
end $$;

create or replace function pg_temp.as_user(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end $$;

do $$
declare
  v_organiser uuid := pg_temp.person('Organiser');
  v_coach uuid := pg_temp.person('Coach');
  v_applicant_admin uuid := pg_temp.person('ApplicantAdmin');
  v_stranger uuid := pg_temp.person('Stranger');
  v_host uuid := pg_temp.club('Host');
  v_guest uuid := pg_temp.club('Guest');
  v_h_u12 uuid; v_g_u12 uuid;
  v_venue uuid; v_pitch uuid;
  v_dir_host uuid; v_dir_guest uuid;
  v_t uuid;
  v_plan uuid;
  v_app uuid;
  v_game uuid;
  v_coach_membership uuid;
  v_n int;
  v_n_before int;
  v_state text;
begin
  select directory_id into v_dir_host from public.clubs where id = v_host;
  select directory_id into v_dir_guest from public.clubs where id = v_guest;
  v_h_u12 := pg_temp.team(v_host, 'U12');
  v_g_u12 := pg_temp.team(v_guest, 'U12');

  perform pg_temp.member(v_host, v_organiser, 'CLUB_ADMIN');
  v_coach_membership := pg_temp.member(v_guest, v_coach, 'BASIC_USER');
  perform pg_temp.team_role(v_coach_membership, v_g_u12, 'COACH');
  perform pg_temp.member(v_guest, v_applicant_admin, 'CLUB_ADMIN');

  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility)
  values (v_host, v_dir_host, 'union', current_date + 20, current_date + 20, 'confirmed', 'Publication Test Festival',
          gen_random_uuid(), 'round_robin', 'public')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added');

  -- ============ A. APPLYING NOTIFIES THE ORGANISER ============

  perform pg_temp.as_user(v_applicant_admin);
  perform public.apply_to_tournament(v_t, v_guest, 'U12', array[v_g_u12]);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select id into v_app from public.tournament_applications where tournament_id = v_t and club_id = v_guest;

  select count(*) into v_n from public.notifications
  where user_id = v_organiser and type = 'tournament_application_received' and (data->>'tournament_application_id')::uuid = v_app;
  perform pg_temp.check(v_n = 1, '1 (A): applying notifies the host club''s organiser');

  select count(*) into v_n from public.notifications where user_id = v_applicant_admin and type = 'tournament_application_received';
  perform pg_temp.check(v_n = 0, '2 (A): the applicant themselves is not notified of their own application');

  -- ============ B. DECIDING NOTIFIES THE APPLICANT, NOT THE ORGANISER WHO ACTED ============

  perform pg_temp.as_user(v_organiser);
  perform public.decide_tournament_application(v_app, true);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.notifications
  where user_id = v_applicant_admin and type = 'tournament_application_decided' and (data->>'tournament_application_id')::uuid = v_app;
  perform pg_temp.check(v_n = 1, '3 (B): the applicant club''s admin is told the decision');

  select count(*) into v_n from public.notifications where user_id = v_organiser and type = 'tournament_application_decided';
  perform pg_temp.check(v_n = 0, '4 (B): the organiser who decided is not notified of their own decision');

  perform pg_temp.check(
    exists (select 1 from public.tournament_participants where tournament_id = v_t and club_id = v_guest and team_id = v_g_u12 and status = 'added'),
    '5 (B): accepting the application actually seats the side (unchanged behaviour)');

  -- ============ C. PUBLISHING ============

  -- Planning is HOST-ONLY: can_manage_tournament's "participating club" branch reads from
  -- tournament_team_entries, which is itself filtered to club_id = host_club_id (confirmed by
  -- reading its view definition) -- it is not a general participant view, so a guest club, CLUB_ADMIN
  -- included, is correctly denied, matching tournament_planning.sql's own "a participating club's
  -- coach cannot start planning" pin.
  perform pg_temp.as_user(v_applicant_admin);
  v_state := null;
  begin
    perform public.start_tournament_plan(v_t, 'U12');
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state = '42501', format('6a (C): a guest club''s own CLUB_ADMIN cannot start planning the host''s tournament (got %s)', v_state));

  perform pg_temp.as_user(v_organiser);
  begin
    select public.start_tournament_plan(v_t, 'U12') into v_plan;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state = 'OK', format('6b (C): the host''s own organiser may start planning (got %s)', v_state));

  perform pg_temp.as_user(v_organiser);

  v_state := null;
  begin
    perform public.publish_tournament_plan(v_plan);
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state <> 'OK', format('7 (C): an empty plan (no games yet) cannot be published (got %s)', v_state));

  -- Give it one game so it is publishable. The guest's tournament_participants row already exists --
  -- decide_tournament_application (section B) seated it when the application was accepted.
  -- It is THE game this plan's arrangement makes -- Table A, host v guest -- so it carries that table:
  -- a plan's games are checked against its arrangement before publication (20270720), and a game the
  -- arrangement does not make would be reported as out of date.
  -- ...ON A PITCH THE TOURNAMENT HAS RESERVED: a kick-off with no pitch is not a schedule anybody can
  -- find, so publication waits for one (20270736).
  insert into public.venues (club_id, name, slug) values (v_host, 'Tplc Ground', 'tplc-' || substr(gen_random_uuid()::text, 1, 8))
  returning id into v_venue;
  insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
  values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;
  insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
  values (v_t, v_pitch, current_date + 20, '09:00', '16:00', v_organiser);
  insert into public.tournament_games (tournament_id, plan_id, table_id, age_group, side_a_id, side_b_id, game_date, start_time, pitch_id, status)
  select v_t, v_plan, (select t.id from public.tournament_plan_tables t where t.plan_id = v_plan order by t.sort_order limit 1),
         'U12', a.id, b.id, current_date + 20, '10:00', v_pitch, 'SCHEDULED'
  from public.tournament_participants a, public.tournament_participants b
  where a.tournament_id = v_t and a.age_group = 'U12' and a.club_id = v_host
    and b.tournament_id = v_t and b.age_group = 'U12' and b.club_id = v_guest
  returning id into v_game;

  perform pg_temp.as_user(v_organiser);
  perform public.publish_tournament_plan(v_plan);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(
    (select publication_state from public.tournament_plans where id = v_plan) = 'PUBLISHED',
    '8 (C): the plan is now published');
  perform pg_temp.check(
    (select published_by from public.tournament_plans where id = v_plan) = v_organiser
    and (select published_at from public.tournament_plans where id = v_plan) is not null,
    '9 (C): who published it and when is recorded');

  select count(*) into v_n from public.notifications
  where user_id = v_coach and type = 'tournament_schedule_published' and (data->>'tournament_plan_id')::uuid = v_plan;
  perform pg_temp.check(v_n = 1, '10 (C): the participating side''s own staff is told the schedule is published');

  select count(*) into v_n from public.notifications where user_id = v_organiser and type = 'tournament_schedule_published';
  perform pg_temp.check(v_n = 0, '11 (C): the organiser who published is not notified of their own action');

  select count(*) into v_n_before from public.notifications where type = 'tournament_schedule_published';

  perform pg_temp.as_user(v_organiser);
  v_state := null;
  begin
    perform public.publish_tournament_plan(v_plan);
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state <> 'OK', format('12 (C): publishing an already-published plan is refused, not silently repeated (got %s)', v_state));

  select count(*) into v_n from public.notifications where type = 'tournament_schedule_published';
  perform pg_temp.check(v_n = v_n_before, '13 (C): and no second round of notifications was sent on the refused re-publish');

  perform pg_temp.as_user(v_stranger);
  v_state := null;
  begin
    perform public.publish_tournament_plan(v_plan);
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  perform pg_temp.check(v_state = '42501', format('14 (C): somebody with no relationship to this tournament cannot publish it (got %s)', v_state));

  -- ============ D. CANCELLATION IS MANDATORY AND REACHES EVERYONE ============

  perform pg_temp.as_user(v_coach);
  perform public.set_notification_preference('tournaments', false, false, false);
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  perform pg_temp.as_user(v_organiser);
  perform public.cancel_tournament(v_t, 'Waterlogged pitches');
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);

  select count(*) into v_n from public.notifications where user_id = v_coach and type = 'tournament_cancelled';
  perform pg_temp.check(v_n = 1, '15 (D): cancellation reaches a side even though they turned the whole topic off -- it is mandatory');

  select count(*) into v_n from public.notifications where user_id = v_organiser and type = 'tournament_cancelled';
  perform pg_temp.check(v_n = 0, '16 (D): the organiser who cancelled is not notified of their own action');

  perform pg_temp.check(
    (select status from public.tournaments where id = v_t) = 'cancelled',
    '17 (D): the tournament itself is actually cancelled (unchanged behaviour)');
end $$;

rollback;
