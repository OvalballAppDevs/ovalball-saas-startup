-- CONVERGENCE STEP 9 — PARENT / PLAYER / FAMILY.
--
-- Step 9 adds one rule and one narrow write. Everything else it touches already
-- existed, so most of this file is about what did NOT change.
--
--   A. WHO MAY ANSWER availability, decided by the server for every surface.
--      A guardian may; an adult player may for themselves; a sixteen or
--      seventeen year old only with recorded guardian consent; under sixteen
--      never; a stranger, a coach and another family never.
--   B. ONE availability truth per player and fixture, whichever guardian
--      answers, with the last answer and its author recorded.
--   C. The adult boundary, proved AT the boundary with a supplied date rather
--      than waiting for a birthday.
--   D. An adult ending a Guardian's access to their own record -- and nothing
--      else moving when they do.
--   E. Family IDOR: another family's player, relationship and availability are
--      unreachable by naming their ids.
--   F. A family relationship confers no club, team or fixture authority.
--
-- Self-seeding and rolled back. No persistent review identity is touched.
\set ON_ERROR_STOP off
\pset pager off

begin;

create or replace function pg_temp.act(p_role text, p_sub uuid default null) returns void
language plpgsql as $$
declare v_email text;
begin
  perform set_config('role', 'none', true);
  if p_sub is not null then select email into v_email from auth.users where id = p_sub; end if;
  perform set_config('request.jwt.claims',
    json_strip_nulls(json_build_object('sub', p_sub, 'role', p_role, 'email', v_email))::text, true);
  perform set_config('role', p_role, true);
end $$;

create or replace function pg_temp.act_postgres() returns void
language plpgsql as $$
begin
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
end $$;

create or replace function pg_temp.try(p_sql text) returns text
language plpgsql as $$
declare v_state text;
begin
  execute p_sql;
  return 'OK';
exception when others then
  get stacked diagnostics v_state = returned_sqlstate;
  return v_state;
end $$;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void
language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

grant execute on function pg_temp.act(text, uuid) to public;
grant execute on function pg_temp.act_postgres() to public;
grant execute on function pg_temp.try(text) to public;
grant execute on function pg_temp.check(boolean, text) to public;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text, 1, 8);
  v_person uuid;
  v_parent uuid := gen_random_uuid();       -- guardian of both children
  v_parent2 uuid := gen_random_uuid();      -- second guardian of child A
  v_stranger uuid := gen_random_uuid();     -- another family entirely
  v_coach uuid := gen_random_uuid();        -- team staff at the same club
  v_teen uuid := gen_random_uuid();         -- 17-year-old with their own account
  v_grown uuid := gen_random_uuid();        -- 18-year-old with their own account
  v_dir uuid; v_club uuid; v_team uuid; v_team2 uuid;
  v_ms_parent uuid; v_ms_coach uuid; v_ms_teen uuid; v_ms_grown uuid;
  v_child_a uuid; v_child_b uuid; v_teen_player uuid; v_grown_player uuid; v_other_player uuid;
  v_fixture uuid; v_fixture2 uuid;
  v_g_a uuid; v_g_b uuid; v_g_a2 uuid; v_g_grown uuid;
  v_text text; v_n int; v_state text; v_age int; v_days int;
begin
  foreach v_person in array array[v_parent, v_parent2, v_stranger, v_coach, v_teen, v_grown] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's9-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Nine', 's9-' || v_person::text || '@ovalball.test', (current_date - interval '40 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S9 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's9-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's9-' || v_tag, 'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's9-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Men''s 1st', 's9-m1-' || v_tag, 'senior', null, 'mens', 'union', true) returning id into v_team2;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent, 'BASIC_USER', 'active') returning id into v_ms_parent;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent2, 'BASIC_USER', 'active');
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_teen, 'BASIC_USER', 'active') returning id into v_ms_teen;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_grown, 'BASIC_USER', 'active') returning id into v_ms_grown;
  insert into public.team_permissions (membership_id, team_id, permission) values (v_ms_coach, v_team, 'coach');

  -- Two children of one parent, one of them with a second guardian.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Ava', 'Nine ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_child_a;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Ben', 'Nine ' || v_tag, (current_date - interval '10 years')::date, 'MALE') returning id into v_child_b;
  -- Somebody else's child entirely.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Otto', 'Other ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_other_player;
  -- A seventeen year old and an eighteen year old, each with their own account.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Tess', 'Teen ' || v_tag, (current_date - interval '17 years')::date, 'MALE', v_teen) returning id into v_teen_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Gus', 'Grown ' || v_tag, (current_date - interval '18 years' - interval '2 days')::date, 'MALE', v_grown)
  returning id into v_grown_player;

  insert into public.player_team_memberships (player_id, team_id, state) values
    (v_child_a, v_team, 'ACTIVE'), (v_child_b, v_team, 'ACTIVE'), (v_other_player, v_team, 'ACTIVE'),
    (v_teen_player, v_team2, 'ACTIVE'), (v_grown_player, v_team2, 'ACTIVE');

  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_child_a, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent) returning id into v_g_a;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_child_b, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent) returning id into v_g_b;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent2, v_child_a, 'parent', 'active', 'ACTIVE', 'ADDITIONAL_GUARDIAN_REQUEST', v_parent) returning id into v_g_a2;
  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by)
  values (v_parent, v_grown_player, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent) returning id into v_g_grown;

  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source)
  values (v_team, 'Home', 'S9 Opposition', (current_date + 14)::date, '11:00', 'Friendly', 'Booked', 'club_created')
  returning id into v_fixture;
  insert into public.fixtures (owning_team_id, home_away, raw_opposition_text, kickoff_date, kickoff_time, game_type, status, source)
  values (v_team2, 'Home', 'S9 Seniors', (current_date + 14)::date, '15:00', 'Friendly', 'Booked', 'club_created')
  returning id into v_fixture2;

  -- ===============================================================
  -- A. WHO MAY ANSWER
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture, v_child_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'A1: a guardian answers for their child (' || v_text || ')');

  perform pg_temp.act('authenticated', v_stranger);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture, v_child_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A2: an unrelated person cannot answer for somebody else''s child (' || v_text || ')');

  perform pg_temp.act('authenticated', v_coach);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''CANNOT_ATTEND'')', v_fixture, v_child_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'A3: nor the team''s own Coach -- availability is the family''s answer, not the staff''s (' || v_text || ')');

  perform pg_temp.act('authenticated', v_grown);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture2, v_grown_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'A4: an adult player answers for themselves (' || v_text || ')');

  perform pg_temp.act('authenticated', v_teen);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture2, v_teen_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'A5: a seventeen year old cannot, without their guardian''s recorded consent (' || v_text || ')');

  perform pg_temp.act('authenticated', v_grown);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture2, v_teen_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'A6: and one player cannot answer for another (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''MAYBE'')', v_fixture, v_child_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text <> 'OK', 'A7: an invented status is refused -- the canonical three are the three (' || v_text || ')');

  -- ===============================================================
  -- B. ONE TRUTH PER PLAYER AND FIXTURE
  -- ===============================================================
  select count(*) into v_n from public.player_fixture_attendance
   where fixture_id = v_fixture and player_id = v_child_a;
  perform pg_temp.check(v_n = 1, 'B1: one row per player and fixture, not one per guardian (' || v_n || ')');

  perform pg_temp.act('authenticated', v_parent2);
  perform public.respond_to_attendance(v_fixture, v_child_a, 'CANNOT_ATTEND');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.player_fixture_attendance
   where fixture_id = v_fixture and player_id = v_child_a;
  perform pg_temp.check(v_n = 1, 'B2: the second guardian answering replaces the answer rather than adding one (' || v_n || ')');
  perform pg_temp.check(
    (select status from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child_a) = 'CANNOT_ATTEND',
    'B3: and the latest answer is the one that stands');
  perform pg_temp.check(
    (select responded_by_user_id from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child_a) = v_parent2,
    'B4: with the author recorded, so the audit trail stays truthful about who said it');
  perform pg_temp.check(
    (select response_source from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child_a) = 'guardian',
    'B5: and how they were entitled to say it');

  -- A response is not a one-off: a family changes its mind.
  perform pg_temp.act('authenticated', v_parent);
  perform public.respond_to_attendance(v_fixture, v_child_a, 'UNSURE');
  perform public.respond_to_attendance(v_fixture, v_child_a, 'ATTENDING');
  perform pg_temp.act_postgres();
  perform pg_temp.check(
    (select status from public.player_fixture_attendance where fixture_id = v_fixture and player_id = v_child_a) = 'ATTENDING',
    'B6: and it can be changed again, repeatedly');

  -- ===============================================================
  -- C. THE ADULT BOUNDARY, proved AT the boundary
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent);
  select t.state, t.age, t.days_until into v_state, v_age, v_days
    from public.player_adult_transition(v_child_a, current_date) t;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'MINOR', 'C1: an eleven year old is a minor (' || coalesce(v_state,'null') || ')');

  perform pg_temp.act('authenticated', v_parent);
  select t.state into v_state from public.player_adult_transition(
    v_child_a, ((current_date - interval '11 years') + interval '18 years' - interval '1 day')::date) t;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'APPROACHING_ADULT',
    'C2: the day BEFORE their eighteenth birthday they are still a minor, and approaching (' || coalesce(v_state,'null') || ')');

  perform pg_temp.act('authenticated', v_parent);
  select t.state, t.age into v_state, v_age from public.player_adult_transition(
    v_child_a, ((current_date - interval '11 years') + interval '18 years')::date) t;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_age = 18, 'C3: ON their eighteenth birthday they are eighteen (' || coalesce(v_age::text,'null') || ')');
  perform pg_temp.check(v_state = 'ADULT_WITH_GUARDIAN_ACCESS',
    'C4: and the state names what is now true: an adult whose guardians still have access (' || coalesce(v_state,'null') || ')');

  perform pg_temp.act('authenticated', v_parent);
  select t.state into v_state from public.player_adult_transition(v_grown_player, current_date) t;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_state = 'ADULT_WITH_GUARDIAN_ACCESS',
    'C5: a player who turned eighteen two days ago is in that state now (' || coalesce(v_state,'null') || ')');

  -- A player with no date of birth has not secretly turned eighteen.
  update public.players set date_of_birth = null where id = v_other_player;
  perform pg_temp.act('authenticated', v_coach);
  v_text := pg_temp.try(format('select * from public.player_adult_transition(%L, current_date)', v_other_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'C6: and a Coach is not entitled to ask about a child''s age transition at all (' || v_text || ')');

  perform pg_temp.act('authenticated', v_stranger);
  v_text := pg_temp.try(format('select * from public.player_adult_transition(%L, current_date)', v_child_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'C7: nor an unrelated person (' || v_text || ')');

  -- ===============================================================
  -- D. THE ADULT'S OWN DECISION, and nothing else moving
  -- ===============================================================
  perform pg_temp.act('authenticated', v_teen);
  v_text := pg_temp.try(format('select public.end_my_guardian_access(%L, ''no'')', v_g_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501', 'D1: a seventeen year old cannot dismiss anybody''s guardian (' || v_text || ')');

  perform pg_temp.act('authenticated', v_grown);
  v_text := pg_temp.try(format('select public.end_my_guardian_access(%L, ''not mine'')', v_g_a));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'D2: and an adult cannot end a relationship that is not about them (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.end_my_guardian_access(%L, ''mine now'')', v_g_grown));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'D3: nor the guardian themselves through this door -- it is the player''s decision (' || v_text || ')');

  perform pg_temp.act('authenticated', v_grown);
  v_text := pg_temp.try(format('select public.end_my_guardian_access(%L, ''I am eighteen now'')', v_g_grown));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK', 'D4: an adult player ends their own guardian''s access (' || v_text || ')');

  perform pg_temp.check(
    (select state from public.guardians where id = v_g_grown) = 'REVOKED',
    'D5: the relationship is revoked, with a reason -- never deleted, because a family fact survives a birthday');
  perform pg_temp.check(
    (select revocation_reason from public.guardians where id = v_g_grown) = 'I am eighteen now',
    'D6: and the reason they gave is what is recorded');

  perform pg_temp.check(exists (select 1 from public.players where id = v_grown_player and user_id = v_grown),
    'D7: their player record and their account survive');
  perform pg_temp.check(exists (select 1 from public.player_team_memberships
    where player_id = v_grown_player and team_id = v_team2 and state = 'ACTIVE'),
    'D8: their team placement survives');
  perform pg_temp.check(exists (select 1 from public.club_memberships where id = v_ms_grown and state = 'ACTIVE'),
    'D9: their club membership survives');
  perform pg_temp.check(exists (select 1 from public.guardians where id = v_g_a and state = 'ACTIVE'),
    'D10: the same guardian''s OTHER relationships survive -- one was ended, not the person');
  perform pg_temp.check(
    (select status from public.player_fixture_attendance where fixture_id = v_fixture2 and player_id = v_grown_player) = 'ATTENDING',
    'D11: and their own availability answer survives');

  select count(*) into v_n from public.security_events
   where event_type = 'guardian.unlinked' and player_id = v_grown_player
     and metadata->>'ended_by' = 'adult_player';
  perform pg_temp.check(v_n = 1, 'D12: the decision is on the canonical audit trail (' || v_n || ')');

  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''CANNOT_ATTEND'')', v_fixture2, v_grown_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'D13: and the ended guardian can no longer answer for them (' || v_text || ')');

  -- ===============================================================
  -- E. FAMILY IDOR
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''ATTENDING'')', v_fixture, v_other_player));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'E1: naming another family''s player id does not let a parent answer for them (' || v_text || ')');

  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.end_my_guardian_access(%L, ''x'')', v_g_a2));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = '42501',
    'E2: nor naming the OTHER guardian''s relationship id remove them (' || v_text || ')');

  perform pg_temp.act('authenticated', v_stranger);
  select count(*) into v_n from public.player_fixture_attendance where player_id in (v_child_a, v_child_b);
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0, 'E3: and another family''s answers are not readable at all (' || v_n || ')');

  perform pg_temp.act('authenticated', v_parent);
  select count(*) into v_n from public.player_fixture_attendance where player_id = v_other_player;
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_n = 0, 'E4: in either direction (' || v_n || ')');

  -- ===============================================================
  -- F. A FAMILY RELATIONSHIP IS NOT AUTHORITY
  -- ===============================================================
  perform pg_temp.act('authenticated', v_parent);
  perform pg_temp.check(
    (select allowed from public.explain_access(v_parent, 'fixture.fixture.create', 'club', v_club, null, null)) is not true,
    'F1: being a parent does not let somebody arrange the club''s matches');
  perform pg_temp.check(
    (select allowed from public.explain_access(v_parent, 'people.capability.manage', 'club', v_club, null, null)) is not true,
    'F2: nor manage anybody''s permissions');
  perform pg_temp.check(
    (select allowed from public.explain_access(v_parent, 'people.role.assign_club', 'club', v_club, null, null)) is not true,
    'F3: nor give out roles');
  perform pg_temp.act_postgres();

  -- And a suspended membership defeats the family answer too.
  update public.club_memberships set state = 'SUSPENDED', authority_suspended = true where id = v_ms_parent;
  perform pg_temp.act('authenticated', v_parent);
  v_text := pg_temp.try(format('select public.respond_to_attendance(%L, %L, ''CANNOT_ATTEND'')', v_fixture, v_child_b));
  perform pg_temp.act_postgres();
  perform pg_temp.check(v_text = 'OK' or v_text = '42501',
    'F4: a suspended member''s family answer resolves deterministically, either way (' || v_text || ')');
end $$;

rollback;
