-- Match Centre real-integration capability wrappers (Phase 1 of the Side
-- Project 3 -> Main integration plan).
--
-- get_my_attendance_authority and get_match_centre_capabilities add ZERO
-- new authorization logic of their own -- they wrap internal.resolve_
-- attendance_response_source, internal.can_access_fixture_conversation,
-- and internal.can_manage_fixture_side verbatim. These assertions exist to
-- prove the WRAPPING is correct (non-throwing shape, correct field
-- mapping), not to re-prove the underlying rules those functions already
-- have their own test coverage for.
--
-- Assertion F below is the one live-UAT-caught regression this file
-- exists to pin permanently: can_view_participants must be STAFF-LEVEL
-- ONLY. A guardian relationship must never satisfy it, because player_
-- fixture_attendance's and player_team_memberships' own row-level RLS
-- already scopes a guardian's read to their own linked player alone -- a
-- broader flag here would tell a page to render a "full roster" section
-- that silently comes back partial for that viewer (caught live: a
-- guardian's aggregate attendance counts showed only her own two children
-- rather than the whole fixture, before this was fixed).
--
-- Self-contained/transactional: fresh gen_random_uuid() identities,
-- begin/rollback, no persistent fixture.

\set ON_ERROR_STOP off
\pset pager off

\echo '=== Match Centre: capability wrappers ==='

begin;

do $$
declare
  v_directory uuid;
  v_directory_away uuid;
  v_club uuid;
  v_club_away uuid;
  v_team_home uuid;
  v_team_away uuid;
  v_fixture uuid;

  v_coach uuid := gen_random_uuid();
  v_guardian uuid := gen_random_uuid();
  v_adult_player uuid := gen_random_uuid();
  v_1617_player uuid := gen_random_uuid();
  v_unrelated uuid := gen_random_uuid();

  v_player_adult uuid;
  v_player_1617 uuid;
  v_player_u16 uuid;

  v_can_respond boolean;
  v_source text;
  v_reason text;
  v_view boolean;
  v_message boolean;
  v_manage boolean;
  v_rowcount int;
begin
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data) values
    (v_coach, 'mc-coach-' || v_coach::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_guardian, 'mc-guardian-' || v_guardian::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_adult_player, 'mc-adult-' || v_adult_player::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_1617_player, 'mc-1617-' || v_1617_player::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb),
    (v_unrelated, 'mc-unrelated-' || v_unrelated::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb);

  select cd.id into v_directory from club_directory cd where not exists (select 1 from clubs c where c.directory_id = cd.id) order by cd.id limit 1;
  select cd.id into v_directory_away from club_directory cd where not exists (select 1 from clubs c where c.directory_id = cd.id) and cd.id <> v_directory order by cd.id limit 1;
  insert into clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_directory, 'mc-test-club-' || gen_random_uuid()::text, 'active') returning id into v_club;
  insert into clubs (id, directory_id, slug, status) values (gen_random_uuid(), v_directory_away, 'mc-test-club-away-' || gen_random_uuid()::text, 'active') returning id into v_club_away;
  insert into club_memberships (user_id, club_id, role, status) values (v_coach, v_club, 'CLUB_ADMIN', 'active');

  insert into teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    (gen_random_uuid(), v_club, 'union', 'youth', 'U12', 'MC Test Home U12', 'mc-test-home-' || gen_random_uuid()::text) returning id into v_team_home;
  insert into teams (id, club_id, rugby_code, category, age_group, display_name, slug) values
    (gen_random_uuid(), v_club_away, 'union', 'youth', 'U12', 'MC Test Away U12', 'mc-test-away-' || gen_random_uuid()::text) returning id into v_team_away;

  insert into fixtures (id, owning_team_id, opponent_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values (gen_random_uuid(), v_team_home, v_team_away, current_date + 7, 'Home', 'Booked', 'MC Test Away U12')
  returning id into v_fixture;

  insert into players (id, first_name, surname, date_of_birth, user_id) values (gen_random_uuid(), 'Adult', 'Player', current_date - interval '20 years', v_adult_player) returning id into v_player_adult;
  insert into players (id, first_name, surname, date_of_birth, user_id) values (gen_random_uuid(), 'Sixteen', 'Seventeen', current_date - interval '17 years', v_1617_player) returning id into v_player_1617;
  insert into players (id, first_name, surname, date_of_birth, user_id) values (gen_random_uuid(), 'Under', 'Sixteen', current_date - interval '11 years', null) returning id into v_player_u16;

  insert into player_team_memberships (player_id, team_id, status) values
    (v_player_adult, v_team_home, 'active'),
    (v_player_1617, v_team_home, 'active'),
    (v_player_u16, v_team_home, 'active');

  insert into guardians (guardian_user_id, player_id, relationship_type, status) values
    (v_guardian, v_player_u16, 'guardian', 'active'),
    (v_guardian, v_player_1617, 'guardian', 'active');

  insert into guardian_player_permissions (player_id, permission_key, guardian_user_id, granted, actor)
  values (v_player_1617, 'approve_own_attendance', v_guardian, true, v_guardian);

  -- A. Adult self-response
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_adult_player::text, 'role', 'authenticated')::text, true);
  select can_respond, response_source into v_can_respond, v_source from get_my_attendance_authority(v_player_adult);
  if v_can_respond and v_source = 'player' then raise notice 'PASS A: adult self-response authorized as player'; else raise notice 'FAIL A: got can_respond=%, source=%', v_can_respond, v_source; end if;

  -- B. 16-17 self-response, consent granted
  perform set_config('request.jwt.claims', json_build_object('sub', v_1617_player::text, 'role', 'authenticated')::text, true);
  select can_respond, response_source into v_can_respond, v_source from get_my_attendance_authority(v_player_1617);
  if v_can_respond and v_source = 'player' then raise notice 'PASS B: 16-17 self-response authorized with consent'; else raise notice 'FAIL B: got can_respond=%, source=%', v_can_respond, v_source; end if;

  -- C. Guardian responding for under-16
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text, 'role', 'authenticated')::text, true);
  select can_respond, response_source into v_can_respond, v_source from get_my_attendance_authority(v_player_u16);
  if v_can_respond and v_source = 'guardian' then raise notice 'PASS C: guardian authorized for own under-16 player'; else raise notice 'FAIL C: got can_respond=%, source=%', v_can_respond, v_source; end if;

  -- D. Unrelated user denied, exact Main denial text preserved
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_unrelated::text, 'role', 'authenticated')::text, true);
  select can_respond, denial_reason into v_can_respond, v_reason from get_my_attendance_authority(v_player_u16);
  if not v_can_respond and v_reason = 'You are not authorized to respond to attendance for this player.' then
    raise notice 'PASS D: unrelated user denied with Main''s real denial text';
  else
    raise notice 'FAIL D: got can_respond=%, reason=%', v_can_respond, v_reason;
  end if;

  -- E. Staff (club admin) capabilities: full access
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text, 'role', 'authenticated')::text, true);
  select can_view_participants, can_message, can_manage_fixture into v_view, v_message, v_manage from get_match_centre_capabilities(v_fixture);
  if v_view and v_message and v_manage then raise notice 'PASS E: staff (club admin) has full Match Centre capabilities'; else raise notice 'FAIL E: got view=%, message=%, manage=%', v_view, v_message, v_manage; end if;

  -- F. Guardian capabilities: can_view_participants is STAFF-ONLY, never
  -- widened by a guardian relationship (the live-UAT-caught regression).
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_guardian::text, 'role', 'authenticated')::text, true);
  select can_view_participants, can_message, can_manage_fixture into v_view, v_message, v_manage from get_match_centre_capabilities(v_fixture);
  if not v_view and not v_message and not v_manage then
    raise notice 'PASS F: guardian relationship alone does NOT grant full-roster/message/manage capabilities (matches player_fixture_attendance''s own row-level RLS)';
  else
    raise notice 'FAIL F: guardian unexpectedly granted view=%, message=%, manage=%', v_view, v_message, v_manage;
  end if;

  -- G. A fixture id that does not exist resolves no capability row at all -- never a fabricated all-false row for a real fixture.
  reset role;
  set local role authenticated;
  perform set_config('request.jwt.claims', json_build_object('sub', v_coach::text, 'role', 'authenticated')::text, true);
  select count(*) into v_rowcount from get_match_centre_capabilities(gen_random_uuid());
  if v_rowcount = 0 then raise notice 'PASS G: an unknown fixture id resolves zero capability rows'; else raise notice 'FAIL G: got % rows for a nonexistent fixture', v_rowcount; end if;

  reset role;
end $$;

rollback;
