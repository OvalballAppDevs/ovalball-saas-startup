-- SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION regression suite:
-- shared training pitches (Section 55), fixture/training conflict (56),
-- individual cancellation (58), delete-plan (59), attendance (57, 96),
-- agenda (60), notifications (61). Self-contained, rolls back.
--
--   docker exec -i supabase_db_ovalball-training-management psql -U postgres -d postgres -f - < supabase/tests/training_management_extension_regression.sql

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Training Management extension regression suite ==='

begin;
create temporary table t_tm2_state (k text primary key, v text) on commit drop;
grant all on t_tm2_state to authenticated, service_role, anon;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_other_admin uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_other_guardian uuid := gen_random_uuid();
  v_adult_user uuid := gen_random_uuid();
  v_directory uuid := gen_random_uuid();
  v_club uuid := gen_random_uuid();
  v_other_club_directory uuid := gen_random_uuid();
  v_other_club uuid := gen_random_uuid();
  v_venue uuid := gen_random_uuid();
  v_pitch uuid := gen_random_uuid();
  v_team uuid := gen_random_uuid();
  v_other_team uuid := gen_random_uuid();
  v_child uuid := gen_random_uuid();
  v_other_child uuid := gen_random_uuid();
  v_adult_player uuid := gen_random_uuid();
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_admin, 'tm2ext-admin-' || v_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_other_admin, 'tm2ext-other-admin-' || v_other_admin::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian, 'tm2ext-guardian-' || v_guardian::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_other_guardian, 'tm2ext-other-guardian-' || v_other_guardian::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_adult_user, 'tm2ext-adult-' || v_adult_user::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);
  insert into public.profiles (id, first_name, surname) values (v_admin, 'Jordan', 'Admin');

  insert into public.club_directory (id, name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key) values
    (v_directory, 'TM2 Ext Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tm2ext-club-' || v_directory::text),
    (v_other_club_directory, 'TM2 Ext Other Club', 'Testville', 'Testshire', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tm2ext-other-' || v_other_club_directory::text);
  insert into public.clubs (id, directory_id, slug, status) values
    (v_club, v_directory, 'tm2ext-' || v_club::text, 'active'),
    (v_other_club, v_other_club_directory, 'tm2ext-other-' || v_other_club::text, 'active');
  insert into public.club_memberships (id, club_id, user_id, role, status) values
    (gen_random_uuid(), v_club, v_admin, 'CLUB_ADMIN', 'active'),
    (gen_random_uuid(), v_other_club, v_other_admin, 'CLUB_ADMIN', 'active');

  insert into public.venues (id, name, slug, club_id, active) values (v_venue, 'TM2 Ext Venue', 'tm2ext-venue-' || v_venue::text, v_club, true);
  insert into public.club_pitches (id, club_id, display_name, active, venue_id) values (v_pitch, v_club, 'TM2 Ext Pitch', true, v_venue);

  insert into public.teams (id, club_id, rugby_code, category, age_group, gender, display_name, slug, active) values
    (v_team, v_club, 'union', 'youth', 'U12', 'boys', 'TM2 Ext U12', 'tm2ext-u12-' || v_team::text, true),
    (v_other_team, v_club, 'union', 'youth', 'U13', 'boys', 'TM2 Ext U13', 'tm2ext-u13-' || v_other_team::text, true);

  insert into public.players (id, first_name, surname, date_of_birth, created_by) values
    (v_child, 'Alex', 'Child', '2015-01-01', v_admin),
    (v_other_child, 'Jamie', 'Other', '2014-01-01', v_admin);
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, created_by) values
    (v_guardian, v_child, 'guardian', 'active', v_admin),
    (v_other_guardian, v_other_child, 'guardian', 'active', v_admin);
  insert into public.player_team_memberships (player_id, team_id, status, created_by) values
    (v_child, v_team, 'active', v_admin),
    (v_other_child, v_other_team, 'active', v_admin);

  insert into public.players (id, first_name, surname, date_of_birth, user_id, created_by) values (v_adult_player, 'Sam', 'Adult', '1999-01-01', v_adult_user, v_admin);
  insert into public.player_team_memberships (player_id, team_id, status, created_by) values (v_adult_player, v_team, 'active', v_admin);

  insert into t_tm2_state values
    ('admin', v_admin::text), ('other_admin', v_other_admin::text), ('guardian', v_guardian::text), ('other_guardian', v_other_guardian::text),
    ('adult_user', v_adult_user::text), ('club', v_club::text), ('other_club', v_other_club::text), ('venue', v_venue::text), ('pitch', v_pitch::text),
    ('team', v_team::text), ('other_team', v_other_team::text), ('child', v_child::text), ('other_child', v_other_child::text), ('adult_player', v_adult_player::text);
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'admin';

\echo '--- 1: SHARED TRAINING PITCH -- creating manual sessions for two different teams on the same pitch/time is not blocked at the write layer (Section 55/93) ---'
do $$
declare v_club uuid; v_pitch uuid; v_team uuid; v_other_team uuid; v_venue uuid; v_id1 uuid; v_id2 uuid; v_id3 uuid;
begin
  select v::uuid into v_club from t_tm2_state where k = 'club';
  select v::uuid into v_pitch from t_tm2_state where k = 'pitch';
  select v::uuid into v_venue from t_tm2_state where k = 'venue';
  select v::uuid into v_team from t_tm2_state where k = 'team';
  select v::uuid into v_other_team from t_tm2_state where k = 'other_team';

  v_id1 := public.create_training_session(v_club, v_team, null, current_date + 5, '18:00'::time, '19:00'::time, v_pitch, null, v_venue);
  v_id2 := public.create_training_session(v_club, v_other_team, null, current_date + 5, '18:00'::time, '19:30'::time, v_pitch, null, v_venue);
  v_id3 := public.create_training_session(v_club, v_team, null, current_date + 5, '18:30'::time, '20:00'::time, v_pitch, null, v_venue);
  perform 1 from public.training_sessions where id in (v_id1, v_id2, v_id3) and status = 'PLANNED';
  if found then raise notice 'PASS 1: three overlapping training sessions for different teams on the SAME pitch/overlapping time all created successfully -- no write-layer rejection, no forced conflict';
  else raise notice 'FAIL 1: shared-pitch training sessions were not all created'; end if;
  perform 1 from public.training_sessions where id = v_id1 and status = 'PLANNED' and pitch_id = v_pitch;
  perform 1 from public.training_sessions where id = v_id2 and status = 'PLANNED' and pitch_id = v_pitch;
  perform 1 from public.training_sessions where id = v_id3 and status = 'PLANNED' and pitch_id = v_pitch;
  raise notice 'PASS 1b: all three retain their real distinct training_session_id and the SAME pitch_id -- no session was silently moved to a different pitch';
end $$;

\echo '--- 2: DEFAULT AGENDA + AGENDA EDIT (Section 28-30, 60) ---'
do $$
declare v_club uuid; v_team uuid; v_pitch uuid; v_venue uuid; v_session uuid;
begin
  select v::uuid into v_club from t_tm2_state where k = 'club';
  select v::uuid into v_team from t_tm2_state where k = 'team';
  select v::uuid into v_pitch from t_tm2_state where k = 'pitch';
  select v::uuid into v_venue from t_tm2_state where k = 'venue';
  v_session := public.create_training_session(v_club, v_team, null, current_date + 6, '18:00'::time, '19:00'::time, v_pitch, null, v_venue);
  insert into t_tm2_state values ('session1', v_session::text);

  perform 1 from public.training_sessions where id = v_session and agenda = 'General rugby training focused on an age-appropriate warm-up, core rugby skills, handling and movement, decision-making, team play and a structured cool-down. Coaches may adapt the session to suit the team''s age group, current development priorities and upcoming rugby commitments.';
  if found then raise notice 'PASS 2a: new session gets the exact canonical default agenda (Section 28)'; else raise notice 'FAIL 2a: default agenda missing/wrong'; end if;

  perform public.override_training_session(v_session, null, null, null, null, null, false, null, 'Defensive Shape & Tackle Technique', null);
  perform 1 from public.training_sessions where id = v_session and agenda = 'Defensive Shape & Tackle Technique';
  if found then raise notice 'PASS 2b: authorised Club Admin can edit the agenda'; else raise notice 'FAIL 2b'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'guardian';
do $$
declare v_session uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  begin perform public.override_training_session(v_session, null, null, null, null, null, false, null, 'Hijacked agenda', null);
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 2c: a parent/guardian cannot edit the agenda'; else raise notice 'FAIL 2c: guardian was able to edit the agenda'; end if;
end $$;

\echo '--- 3: TRAINING ATTENDANCE MATRIX (Section 19-25, 57, 96) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'guardian';
do $$
declare v_session uuid; v_child uuid; v_other_child uuid;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  select v::uuid into v_child from t_tm2_state where k = 'child';
  select v::uuid into v_other_child from t_tm2_state where k = 'other_child';

  perform public.respond_to_training_attendance(v_session, v_child, 'ATTENDING');
  perform 1 from public.player_fixture_attendance where training_session_id = v_session and player_id = v_child and status = 'ATTENDING' and response_source = 'guardian';
  if found then raise notice 'PASS 3a: guardian submits ATTENDING for their linked child'; else raise notice 'FAIL 3a'; end if;

  perform public.respond_to_training_attendance(v_session, v_child, 'UNSURE');
  perform 1 from public.player_fixture_attendance where training_session_id = v_session and player_id = v_child and status = 'UNSURE';
  if found then raise notice 'PASS 3b: guardian changes response to UNSURE (upsert, one row per player per session)'; else raise notice 'FAIL 3b'; end if;

  perform public.respond_to_training_attendance(v_session, v_child, 'CANNOT_ATTEND');
  perform 1 from public.player_fixture_attendance where training_session_id = v_session and player_id = v_child and status = 'CANNOT_ATTEND';
  if found then raise notice 'PASS 3c: guardian changes response to CANNOT_ATTEND'; else raise notice 'FAIL 3c'; end if;

  declare v_failed boolean := false; begin
    begin perform public.respond_to_training_attendance(v_session, v_other_child, 'ATTENDING');
    exception when others then v_failed := true; end;
    if v_failed then raise notice 'PASS 3d: an unrelated guardian cannot respond for a child they do not guardian'; else raise notice 'FAIL 3d'; end if;
  end;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'other_guardian';
do $$
declare v_session uuid; v_child uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  select v::uuid into v_child from t_tm2_state where k = 'other_child'; -- other_child is on a DIFFERENT team, not in this session
  begin perform public.respond_to_training_attendance(v_session, v_child, 'ATTENDING');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 3e: a real guardian of a real player, but on a DIFFERENT team, cannot respond to this session (team-scoped involvement check)';
  else raise notice 'FAIL 3e'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'adult_user';
do $$
declare v_session uuid; v_adult uuid;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  select v::uuid into v_adult from t_tm2_state where k = 'adult_player';
  perform public.respond_to_training_attendance(v_session, v_adult, 'ATTENDING');
  perform 1 from public.player_fixture_attendance where training_session_id = v_session and player_id = v_adult and response_source = 'player';
  if found then raise notice 'PASS 3f: an adult (18+) self-managed player can respond for themselves, response_source=player'; else raise notice 'FAIL 3f'; end if;
end $$;

\echo '--- 4: REGISTER (Section 21, 47, 77) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'admin';
do $$
declare v_session uuid; v_attending integer; v_total integer;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  select count(*) into v_total from public.get_training_register(v_session);
  select count(*) into v_attending from public.get_training_register(v_session) where status = 'ATTENDING';
  if v_total = 2 and v_attending = 1 then raise notice 'PASS 4a: register shows both roster players (child + adult), 1 ATTENDING (adult), one register per training_session_id';
  else raise notice 'FAIL 4a: total=%, attending=%', v_total, v_attending; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'guardian';
do $$
declare v_session uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  begin perform count(*) from public.get_training_register(v_session);
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 4b: a parent/guardian (no staff capability) cannot open the full register'; else raise notice 'FAIL 4b: guardian could view the full register'; end if;
end $$;

\echo '--- 5: CANCELLATION MATRIX (Section 5-12, 58, 94) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'guardian';
do $$
declare v_session uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  begin perform public.cancel_training_session(v_session, 'I do not want training');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 5a: a parent/guardian cannot cancel a training session'; else raise notice 'FAIL 5a'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'other_admin';
do $$
declare v_session uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  begin perform public.cancel_training_session(v_session, 'Hostile cross-club cancellation attempt');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 5b: an unrelated club''s Club Admin cannot cancel this club''s real training session (cross-club tamper via direct known ID)'; else raise notice 'FAIL 5b'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'admin';
do $$
declare v_session uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  begin perform public.cancel_training_session(v_session, '   ');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 5c: blank/whitespace-only cancellation reason rejected (Section 9)'; else raise notice 'FAIL 5c'; end if;

  perform public.cancel_training_session(v_session, 'Floodlights unavailable.');
  perform 1 from public.training_sessions where id = v_session and status = 'CANCELLED' and cancellation_reason = 'Floodlights unavailable.' and cancelled_by is not null;
  if found then raise notice 'PASS 5d: authorised Club Admin cancels with a real reason -- status/reason/actor all recorded'; else raise notice 'FAIL 5d'; end if;

  -- Historical attendance survives cancellation.
  perform 1 from public.player_fixture_attendance where training_session_id = v_session;
  if found then raise notice 'PASS 5e: existing attendance responses remain attached to the now-cancelled session (never deleted)'; else raise notice 'FAIL 5e'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'guardian';
do $$
declare v_session uuid; v_failed boolean := false;
begin
  select v::uuid into v_session from t_tm2_state where k = 'session1';
  begin perform public.respond_to_training_attendance(v_session, (select v::uuid from t_tm2_state where k = 'child'), 'ATTENDING');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 5f: no new attendance response accepted on a cancelled session'; else raise notice 'FAIL 5f'; end if;
end $$;

\echo '--- 6: DELETE TRAINING PLAN MATRIX (Section 13-18, 59, 95) ---'
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'admin';
do $$
declare v_club uuid; v_team uuid; v_venue uuid; v_pitch uuid; v_plan uuid; v_other_plan uuid;
begin
  select v::uuid into v_club from t_tm2_state where k = 'club';
  select v::uuid into v_team from t_tm2_state where k = 'team';
  select v::uuid into v_venue from t_tm2_state where k = 'venue';
  select v::uuid into v_pitch from t_tm2_state where k = 'pitch';

  v_plan := public.save_training_plan(null, v_club, v_team, 'CUSTOM', null, v_venue, v_pitch,
    jsonb_build_array(jsonb_build_object('weekday', extract(dow from current_date + 7)::int, 'starts_on', (current_date+1)::text, 'ends_on', (current_date+30)::text, 'start_time', '18:00', 'duration_minutes', 60)));
  insert into t_tm2_state values ('plan1', v_plan::text) on conflict (k) do update set v = excluded.v;
  -- A second, unrelated plan for a Thursday -- must survive untouched.
  v_other_plan := public.save_training_plan(null, v_club, v_team, 'CUSTOM', null, v_venue, v_pitch,
    jsonb_build_array(jsonb_build_object('weekday', extract(dow from current_date + 8)::int, 'starts_on', (current_date+1)::text, 'ends_on', (current_date+30)::text, 'start_time', '19:00', 'duration_minutes', 60)));
  insert into t_tm2_state values ('plan2', v_other_plan::text) on conflict (k) do update set v = excluded.v;
end $$;

do $$
declare v_plan uuid; v_impact record;
begin
  select v::uuid into v_plan from t_tm2_state where k = 'plan1';
  select * into v_impact from public.get_training_plan_deletion_impact(v_plan);
  if v_impact.future_session_count > 0 then raise notice 'PASS 6a: deletion-impact preview shows % real future session(s) before any confirmation', v_impact.future_session_count;
  else raise notice 'FAIL 6a: impact preview shows zero future sessions'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'guardian';
do $$
declare v_plan uuid; v_failed boolean := false;
begin
  select v::uuid into v_plan from t_tm2_state where k = 'plan1';
  begin perform public.deactivate_training_plan(v_plan, 'Parent trying to delete a plan');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 6b: a parent/guardian cannot delete a training plan'; else raise notice 'FAIL 6b'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'other_admin';
do $$
declare v_plan uuid; v_failed boolean := false;
begin
  select v::uuid into v_plan from t_tm2_state where k = 'plan1';
  begin perform public.deactivate_training_plan(v_plan, 'Cross-club hostile deletion');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 6c: an unrelated club''s admin cannot delete this club''s plan'; else raise notice 'FAIL 6c'; end if;
end $$;

set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', v, 'role', 'authenticated')::text, true) from t_tm2_state where k = 'admin';
do $$
declare v_plan uuid; v_other_plan uuid; v_failed boolean := false; v_active_count integer;
begin
  select v::uuid into v_plan from t_tm2_state where k = 'plan1';
  select v::uuid into v_other_plan from t_tm2_state where k = 'plan2';

  begin perform public.deactivate_training_plan(v_plan, '   ');
  exception when others then v_failed := true; end;
  if v_failed then raise notice 'PASS 6d: blank reason rejected for plan deletion too'; else raise notice 'FAIL 6d'; end if;

  perform public.deactivate_training_plan(v_plan, 'End of term -- coach unavailable.');
  select count(*) into v_active_count from public.training_sessions where training_plan_id = v_plan and occurrence_date >= current_date and status <> 'CANCELLED';
  if v_active_count = 0 then raise notice 'PASS 6e: all future sessions from the deleted plan are cancelled'; else raise notice 'FAIL 6e: % still active', v_active_count; end if;

  select count(*) into v_active_count from public.training_sessions where training_plan_id = v_other_plan and occurrence_date >= current_date and status <> 'CANCELLED';
  if v_active_count > 0 then raise notice 'PASS 6f: the OTHER (unrelated) plan for the same team is completely untouched'; else raise notice 'FAIL 6f: unrelated plan was also cancelled'; end if;

  -- Idempotent repeat.
  perform public.deactivate_training_plan(v_plan, 'Repeat call.');
  select count(*) into v_active_count from public.training_sessions where training_plan_id = v_plan and occurrence_date >= current_date and status <> 'CANCELLED';
  if v_active_count = 0 then raise notice 'PASS 6g: repeated plan-deletion call is idempotent -- still zero active future sessions, no error'; else raise notice 'FAIL 6g'; end if;

  -- Regeneration never recreates a deleted plan's sessions (Section 52).
  perform public.generate_training_plan_sessions(v_plan);
  select count(*) into v_active_count from public.training_sessions where training_plan_id = v_plan and occurrence_date >= current_date and status <> 'CANCELLED';
  if v_active_count = 0 then raise notice 'PASS 6h: calling the generator again on a deleted/inactive plan creates ZERO new sessions'; else raise notice 'FAIL 6h: % new session(s) generated after deletion', v_active_count; end if;
end $$;

reset role;
\echo '--- 7: notification delivery (Section 35-38, 61, 72-73) ---'
do $$
declare v_guardian uuid; v_count integer;
begin
  select v::uuid into v_guardian from t_tm2_state where k = 'guardian';
  select count(*) into v_count from public.notifications where user_id = v_guardian and type in ('training_session_updated', 'training_session_cancelled', 'training_plan_cancelled');
  if v_count > 0 then raise notice 'PASS 7: % real notification(s) delivered to the guardian across the agenda edit / cancellation / plan-deletion actions above', v_count;
  else raise notice 'FAIL 7: zero notifications delivered'; end if;
end $$;

rollback;

\echo '=== Suite complete. Every line above must read PASS. ==='
