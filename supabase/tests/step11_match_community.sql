-- CONVERGENCE STEP 11 — MATCH CENTRE COMMUNITY + REWARDS.
--
--   A. THE ELECTORATE FOLLOWS THE SIDE'S AGE. One canonical category: Parents'
--      Player on a youth side, Players' Player on an adult one -- and U18
--      keeps the parents' electorate, deliberately.
--   B. VOTE INTEGRITY. One human, one vote, enforced by the database rather
--      than by the browser: a repeat, a change and a withdrawal are all one row.
--   C. LIFECYCLE. Recognition belongs to a match that was played. A tie is
--      reported as a tie rather than resolved into an invented winner.
--   D. ELIGIBILITY AND IDOR. The wrong parent, the wrong club, a revoked coach
--      and a forged id all fail server-side.
--   E. OPPOSITION. Only where the opposition is on Ovalball, because otherwise
--      there is no authenticated actor to be entitled.
--   F. TOTALS ARE STAFF-ONLY, AND ONLY ONCE CLOSED.
--   G. KUDOS. A fixed positive vocabulary, nothing to give yourself, and staff
--      removal that stops display without erasing that it happened.
--   H. THE DISPLAY OVERRIDE IS PRESENTATION ONLY.
--   I. THE RUGBY IS UNTOUCHED.
--   J. HISTORY SURVIVES A PLAYER LEAVING THE TEAM.
--   K. ADMINISTRATION IS NOT PARTICIPATION.
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
  v_coach uuid := gen_random_uuid();
  v_coach2 uuid := gen_random_uuid();   -- a disposable coach, because a revoked role is never restored
  v_manager uuid := gen_random_uuid();
  v_parent1 uuid := gen_random_uuid();
  v_parent2 uuid := gen_random_uuid();
  v_parent3 uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_u18_parent uuid := gen_random_uuid();
  v_opp_coach uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_dir uuid; v_dir_b uuid; v_dir_c uuid; v_club uuid; v_club_b uuid; v_club_c uuid;
  v_u12 uuid; v_adult_team uuid; v_u18 uuid; v_opp_team uuid;
  v_ms_coach uuid; v_ms_coach2 uuid; v_ms_manager uuid; v_ms_p1 uuid; v_ms_p2 uuid; v_ms_p3 uuid;
  v_ms_adult uuid; v_ms_u18p uuid; v_ms_opp uuid;
  v_child1 uuid; v_child2 uuid; v_child3 uuid; v_adult_player uuid; v_u18_player uuid;
  v_f_played uuid; v_f_upcoming uuid; v_f_external uuid; v_f_adult uuid; v_f_u18 uuid;
  v_award uuid; v_award2 uuid; v_award_opp uuid; v_award_u18 uuid; v_award_tie uuid; v_award_empty uuid;
  v_text text; v_n int; v_bool boolean; v_uuid uuid; v_state text;
begin
  -- ---------------------------------------------------------------- people
  foreach v_person in array array[v_coach, v_coach2, v_manager, v_parent1, v_parent2, v_parent3, v_adult, v_u18_parent, v_opp_coach, v_stranger] loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
      email_change_token_current, phone_change, phone_change_token, reauthentication_token)
    values (v_person, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      's11-' || v_person::text || '@ovalball.test', '', now(), now(), now(), '{}'::jsonb, '{}'::jsonb,
      '', '', '', '', '', '', '', '');
    insert into public.profiles (id, first_name, surname, email, date_of_birth)
    values (v_person, 'Step', 'Eleven', 's11-' || v_person::text || '@ovalball.test', (current_date - interval '38 years')::date)
    on conflict (id) do nothing;
  end loop;

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S11 RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's11-' || v_tag)
  returning id into v_dir;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S11 Opp RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's11-opp-' || v_tag)
  returning id into v_dir_b;
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('S11 Far RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 's11-far-' || v_tag)
  returning id into v_dir_c;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 's11-' || v_tag, 'active') returning id into v_club;
  insert into public.clubs (directory_id, slug, status) values (v_dir_b, 's11-opp-' || v_tag, 'active') returning id into v_club_b;
  insert into public.clubs (directory_id, slug, status) values (v_dir_c, 's11-far-' || v_tag, 'active') returning id into v_club_c;

  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 12 Boys', 's11-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_u12;
  -- AN ADULT SIDE. `category = 'senior'` is the canonical open-age marker, and the only thing that
  -- turns the family electorate into the players' own.
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Mens 1st', 's11-adult-' || v_tag, 'senior', null, 'mens', 'union', true) returning id into v_adult_team;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club, 'Under 18 Boys', 's11-u18-' || v_tag, 'youth', 'U18', 'boys', 'union', true) returning id into v_u18;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club_b, 'Under 12 Boys', 's11-opp-u12-' || v_tag, 'youth', 'U12', 'boys', 'union', true) returning id into v_opp_team;

  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active') returning id into v_ms_coach;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach2, 'BASIC_USER', 'active') returning id into v_ms_coach2;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_manager, 'BASIC_USER', 'active') returning id into v_ms_manager;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent1, 'BASIC_USER', 'active') returning id into v_ms_p1;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_parent2, 'BASIC_USER', 'active') returning id into v_ms_p2;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_parent3, 'BASIC_USER', 'active') returning id into v_ms_p3;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_adult, 'BASIC_USER', 'active') returning id into v_ms_adult;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_u18_parent, 'BASIC_USER', 'active') returning id into v_ms_u18p;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_b, v_opp_coach, 'BASIC_USER', 'active') returning id into v_ms_opp;
  insert into public.club_memberships (club_id, user_id, role, status) values (v_club_c, v_stranger, 'CLUB_ADMIN', 'active');

  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Ada', 'One ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_child1;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Bo', 'Two ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_child2;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Cy', 'Three ' || v_tag, (current_date - interval '11 years')::date, 'MALE') returning id into v_child3;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('Dee', 'Adult ' || v_tag, (current_date - interval '26 years')::date, 'MALE', v_adult) returning id into v_adult_player;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Eli', 'Eighteen ' || v_tag, (current_date - interval '17 years')::date, 'MALE') returning id into v_u18_player;

  insert into public.player_team_memberships (player_id, team_id, state) values
    (v_child1, v_u12, 'ACTIVE'), (v_child2, v_u12, 'ACTIVE'),
    (v_child3, v_opp_team, 'ACTIVE'),
    (v_adult_player, v_adult_team, 'ACTIVE'),
    (v_u18_player, v_u18, 'ACTIVE');

  insert into public.guardians (guardian_user_id, player_id, relationship_type, status, state, source, created_by) values
    (v_parent1, v_child1, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent1),
    (v_parent2, v_child2, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent2),
    (v_parent3, v_child3, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_parent3),
    (v_u18_parent, v_u18_player, 'parent', 'active', 'ACTIVE', 'SELF_ADDED_CHILD', v_u18_parent);

  insert into public.role_assignments (user_id, membership_id, club_id, team_id, role_key, state, source) values
    (v_coach, v_ms_coach, v_club, v_u12, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_coach, v_ms_coach, v_club, v_adult_team, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_coach, v_ms_coach, v_club, v_u18, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_coach2, v_ms_coach2, v_club, v_u12, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_manager, v_ms_manager, v_club, v_u12, 'TEAM_MANAGER', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT'),
    (v_opp_coach, v_ms_opp, v_club_b, v_opp_team, 'COACH', 'ACTIVE', 'CLUB_ADMIN_ASSIGNMENT');

  -- ------------------------------------------------------------- fixtures
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
  values (v_u12, v_opp_team, 'Home', 'S11 Opp RUFC', current_date - 7, 'Completed', 'club_created', 24, 12, 'final')
  returning id into v_f_played;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source)
  values (v_u12, v_opp_team, 'Home', 'S11 Opp RUFC', current_date + 14, 'Booked', 'club_created')
  returning id into v_f_upcoming;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
  values (v_u12, null, 'Away', 'Not On Ovalball RFC', current_date - 14, 'Completed', 'club_created', 5, 30, 'external_recorded')
  returning id into v_f_external;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
  values (v_adult_team, null, 'Home', 'Adult Opposition RFC', current_date - 7, 'Completed', 'club_created', 18, 18, 'external_recorded')
  returning id into v_f_adult;
  insert into public.fixtures (owning_team_id, opponent_team_id, home_away, raw_opposition_text, kickoff_date, status, source, home_score, away_score, result_status)
  values (v_u18, null, 'Home', 'Colts Opposition RFC', current_date - 7, 'Completed', 'club_created', 10, 7, 'external_recorded')
  returning id into v_f_u18;

  -- Every award this suite uses is switched on by the team first, because nothing may be opened on a
  -- category the team does not run.
  insert into public.team_award_category_settings (team_id, category_key, enabled) values
    (v_u12, 'FAMILY_OR_SELF_PLAYER', true), (v_u12, 'COACHES_PLAYER', true), (v_u12, 'OPPOSITION_PLAYER', true),
    (v_adult_team, 'FAMILY_OR_SELF_PLAYER', true), (v_adult_team, 'COACHES_PLAYER', true),
    (v_u18, 'FAMILY_OR_SELF_PLAYER', true);

  -- =====================================================================
  -- A. THE ELECTORATE FOLLOWS THE SIDE'S AGE
  -- =====================================================================
  perform pg_temp.act_postgres();
  select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', v_u12) into v_text;
  perform pg_temp.check(v_text = 'Parents'' Player', format('A1 a youth side calls it Parents'' Player (got %s)', v_text));

  select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', v_adult_team) into v_text;
  perform pg_temp.check(v_text = 'Players'' Player', format('A2 an adult side calls the same category Players'' Player (got %s)', v_text));

  -- THE LOCKED DECISION. U18 is exactly where somebody would switch to player voting; the product
  -- decision was not to, so the top of the youth range keeps the parents' electorate.
  select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', v_u18) into v_text;
  perform pg_temp.check(v_text = 'Parents'' Player', format('A3 U18 keeps Parents'' Player (got %s)', v_text));

  perform pg_temp.act('authenticated', v_coach);
  select public.open_match_award(v_f_played, v_u12, 'FAMILY_OR_SELF_PLAYER') into v_award;
  select public.open_match_award(v_f_played, v_u12, 'COACHES_PLAYER') into v_award2;
  select public.open_match_award(v_f_played, v_u12, 'OPPOSITION_PLAYER') into v_award_opp;
  select public.open_match_award(v_f_u18, v_u18, 'FAMILY_OR_SELF_PLAYER') into v_award_u18;
  select public.open_match_award(v_f_adult, v_adult_team, 'FAMILY_OR_SELF_PLAYER') into v_award_tie;

  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.match_award_can_vote(v_award, v_parent1),
    'A4 a guardian of a player in the side is entitled to the family award');
  perform pg_temp.check(internal.match_award_can_vote(v_award_tie, v_adult),
    'A5 on an adult side the player themselves is entitled');
  perform pg_temp.check(not internal.match_award_can_vote(v_award_tie, v_parent1),
    'A6 a youth parent is not entitled on an unrelated adult side');
  perform pg_temp.check(internal.match_award_can_vote(v_award_u18, v_u18_parent),
    'A7 and the U18 parent is entitled, which is the whole point of A3');

  -- =====================================================================
  -- B. VOTE INTEGRITY -- one human, one vote, in the database
  -- =====================================================================
  perform pg_temp.act('authenticated', v_parent1);
  perform public.cast_match_award_vote(v_award, v_child1);
  perform public.cast_match_award_vote(v_award, v_child1);
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.match_award_votes where award_id = v_award and voter_user_id = v_parent1;
  perform pg_temp.check(v_n = 1, format('B1 a repeated identical vote is still one vote (got %s)', v_n));

  perform pg_temp.act('authenticated', v_parent1);
  perform public.cast_match_award_vote(v_award, v_child2);
  perform pg_temp.act_postgres();
  select count(*), max(player_id::text) into v_n, v_text from public.match_award_votes where award_id = v_award and voter_user_id = v_parent1;
  perform pg_temp.check(v_n = 1 and v_text = v_child2::text, format('B2 changing your mind changes the row rather than adding one (got %s rows)', v_n));

  perform pg_temp.act('authenticated', v_parent1);
  perform public.withdraw_match_award_vote(v_award);
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.match_award_votes where award_id = v_award and voter_user_id = v_parent1;
  perform pg_temp.check(v_n = 0, 'B3 a vote can be taken back while voting is open');

  -- The constraint itself, not the function's good manners.
  perform pg_temp.act_postgres();
  select pg_temp.try(format('insert into public.match_award_votes (award_id, voter_user_id, player_id) values (%L, %L, %L), (%L, %L, %L)',
    v_award, v_parent1, v_child1, v_award, v_parent1, v_child2)) into v_state;
  perform pg_temp.check(v_state = '23505', format('B4 the database refuses two votes from one person outright (got %s)', v_state));

  -- =====================================================================
  -- C. LIFECYCLE
  -- =====================================================================
  perform pg_temp.act('authenticated', v_coach);
  select pg_temp.try(format('select public.open_match_award(%L, %L, %L)', v_f_upcoming, v_u12, 'FAMILY_OR_SELF_PLAYER')) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('C1 an award cannot be opened on a match that has not been played (got %s)', v_state));

  -- Two votes for one player, one for another: a clear winner.
  perform pg_temp.act('authenticated', v_parent1); perform public.cast_match_award_vote(v_award, v_child1);
  perform pg_temp.act('authenticated', v_parent2); perform public.cast_match_award_vote(v_award, v_child1);
  perform pg_temp.act('authenticated', v_coach);
  select public.close_match_award(v_award) into v_text;
  perform pg_temp.act_postgres();
  select winner_player_id into v_uuid from public.match_awards where id = v_award;
  perform pg_temp.check(v_text = 'WINNER' and v_uuid = v_child1, format('C2 a clear winner is recorded (outcome %s)', v_text));

  perform pg_temp.act('authenticated', v_parent1);
  select pg_temp.try(format('select public.cast_match_award_vote(%L, %L)', v_award, v_child2)) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('C3 voting is refused once it has closed (got %s)', v_state));

  -- A TIE IS AN ANSWER. The adult award gets one vote each way.
  perform pg_temp.act('authenticated', v_coach);
  select public.open_match_award(v_f_adult, v_adult_team, 'COACHES_PLAYER') into v_award_empty;
  perform pg_temp.act_postgres();
  insert into public.players (first_name, surname, date_of_birth, playing_pathway)
  values ('Fin', 'Second ' || v_tag, (current_date - interval '25 years')::date, 'MALE') returning id into v_uuid;
  insert into public.player_team_memberships (player_id, team_id, state) values (v_uuid, v_adult_team, 'ACTIVE');
  insert into public.match_award_votes (award_id, voter_user_id, player_id) values
    (v_award_tie, v_adult, v_adult_player), (v_award_tie, v_coach, v_uuid);
  perform pg_temp.act('authenticated', v_coach);
  select public.close_match_award(v_award_tie) into v_text;
  perform pg_temp.act_postgres();
  select winner_player_id into v_uuid from public.match_awards where id = v_award_tie;
  perform pg_temp.check(v_text = 'TIE' and v_uuid is null, format('C4 a tie is reported as a tie and no winner is invented (outcome %s)', v_text));

  perform pg_temp.act('authenticated', v_coach);
  select public.close_match_award(v_award_empty) into v_text;
  perform pg_temp.check(v_text = 'NO_VOTES', format('C5 an award nobody voted in says so (got %s)', v_text));

  -- A match that stops being a played match stops taking votes.
  perform pg_temp.act_postgres();
  update public.fixtures set status = 'Cancelled', cancelled_at = now(), cancellation_reason = 'Waterlogged' where id = v_f_u18;
  perform pg_temp.act('authenticated', v_u18_parent);
  select pg_temp.try(format('select public.cast_match_award_vote(%L, %L)', v_award_u18, v_u18_player)) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('C6 a cancelled match fails closed rather than quietly collecting votes (got %s)', v_state));

  -- =====================================================================
  -- D. ELIGIBILITY AND IDOR
  -- =====================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check(not internal.match_award_can_vote(v_award2, v_stranger),
    'D1 an unrelated club admin from another club is entitled to nothing here');
  perform pg_temp.check(not internal.match_award_can_vote(v_award, v_parent3),
    'D2 the wrong parent -- a guardian in the opposition club -- cannot choose our award');
  perform pg_temp.check(internal.match_award_can_vote(v_award2, v_coach),
    'D3 the coaches'' award belongs to the coaches');
  -- §12: a Team Manager is not automatically a coach.
  perform pg_temp.check(not internal.match_award_can_vote(v_award2, v_manager),
    'D4 a Team Manager is not silently promoted into the coaches'' electorate');

  perform pg_temp.act('authenticated', v_parent2);
  select pg_temp.try(format('select public.cast_match_award_vote(%L, %L)', gen_random_uuid(), v_child1)) into v_state;
  perform pg_temp.check(v_state = 'P0002', format('D5 a forged award id is not found rather than leaked (got %s)', v_state));

  perform pg_temp.act('authenticated', v_coach);
  select pg_temp.try(format('select public.cast_match_award_vote(%L, %L)', v_award2, v_child3)) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('D6 you cannot vote for a player who did not play for that side (got %s)', v_state));

  -- A revoked role is not a coach; a suspended membership is not anybody. The revocation is done on
  -- a SECOND coach, because the role state machine is right that a revoked assignment is never
  -- restored -- "assign it again" -- and the first coach is needed intact below.
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.match_award_can_vote(v_award2, v_coach2),
    'D7 a second active coach is entitled too, before anything is taken away');
  update public.role_assignments set state = 'REVOKED', revoked_at = now() where user_id = v_coach2 and team_id = v_u12 and role_key = 'COACH';
  perform pg_temp.check(not internal.match_award_can_vote(v_award2, v_coach2),
    'D8 and a revoked coach assignment stops being an entitlement immediately');
  update public.club_memberships set state = 'SUSPENDED' where id = v_ms_coach;
  perform pg_temp.check(not internal.match_award_can_vote(v_award2, v_coach),
    'D9 a suspended membership cannot keep an entitlement alive');
  update public.club_memberships set state = 'ACTIVE' where id = v_ms_coach;
  perform pg_temp.check(internal.match_award_can_vote(v_award2, v_coach),
    'D10 and reactivation brings it back, because the role was never deleted');

  -- =====================================================================
  -- E. OPPOSITION -- only where there is somebody to be entitled
  -- =====================================================================
  perform pg_temp.act_postgres();
  perform pg_temp.check(internal.match_award_can_vote(v_award_opp, v_opp_coach),
    'E1 the opposition''s coach chooses the opposition award');
  perform pg_temp.check(not internal.match_award_can_vote(v_award_opp, v_coach),
    'E2 our own coach does not get to choose the award that is theirs to give');

  perform pg_temp.act_postgres();
  insert into public.team_award_category_settings (team_id, category_key, enabled)
  values (v_u12, 'OPPOSITION_PLAYER', true) on conflict (team_id, category_key) do update set enabled = true;
  perform pg_temp.act('authenticated', v_coach);
  select pg_temp.try(format('select public.open_match_award(%L, %L, %L)', v_f_external, v_u12, 'OPPOSITION_PLAYER')) into v_state;
  perform pg_temp.check(v_state = 'P0001',
    format('E3 against an opponent who is not on Ovalball the award cannot open, rather than opening with no electorate (got %s)', v_state));

  -- =====================================================================
  -- F. TOTALS ARE STAFF-ONLY, AND ONLY ONCE CLOSED
  -- =====================================================================
  perform pg_temp.act('authenticated', v_coach);
  select total_votes into v_n from public.get_match_community(v_f_played) where award_id = v_award;
  perform pg_temp.check(v_n = 2, format('F1 staff see the count once it is closed (got %s)', coalesce(v_n::text, 'null')));

  perform pg_temp.act('authenticated', v_parent2);
  select total_votes, winner_player_id into v_n, v_uuid from public.get_match_community(v_f_played) where award_id = v_award;
  perform pg_temp.check(v_n is null and v_uuid = v_child1,
    format('F2 the team is told who won and never by how much (total %s)', coalesce(v_n::text, 'null')));

  perform pg_temp.act('authenticated', v_coach);
  select total_votes into v_n from public.get_match_community(v_f_played) where award_id = v_award2;
  perform pg_temp.check(v_n is null, format('F3 an open award shows no running total, not even to staff (got %s)', coalesce(v_n::text, 'null')));

  -- =====================================================================
  -- G. KUDOS
  -- =====================================================================
  perform pg_temp.act('authenticated', v_parent1);
  select pg_temp.try(format('select public.give_match_kudos(%L, %L, %L, %L)', v_f_played, v_u12, v_child2, 'NOT_A_KIND')) into v_state;
  perform pg_temp.check(v_state = 'P0002', format('G1 the vocabulary is fixed and closed (got %s)', v_state));

  perform public.give_match_kudos(v_f_played, v_u12, v_child2, 'BRAVE');
  perform public.give_match_kudos(v_f_played, v_u12, v_child2, 'WORK_RATE');
  perform pg_temp.act_postgres();
  select count(*), max(kudos_key) into v_n, v_text from public.match_kudos
   where fixture_id = v_f_played and given_by_user_id = v_parent1 and recipient_player_id = v_child2 and removed_at is null;
  perform pg_temp.check(v_n = 1 and v_text = 'WORK_RATE',
    format('G2 one person recognises one player once per match, and may change what for (got %s rows, %s)', v_n, v_text));

  perform pg_temp.act('authenticated', v_adult);
  select pg_temp.try(format('select public.give_match_kudos(%L, %L, %L, %L)', v_f_adult, v_adult_team, v_adult_player, 'SKILL')) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('G3 nobody gives themselves kudos (got %s)', v_state));

  perform pg_temp.act('authenticated', v_stranger);
  select pg_temp.try(format('select public.give_match_kudos(%L, %L, %L, %L)', v_f_played, v_u12, v_child1, 'SKILL')) into v_state;
  perform pg_temp.check(v_state = '42501', format('G4 somebody with no standing in the team cannot give recognition in it (got %s)', v_state));

  perform pg_temp.act('authenticated', v_parent1);
  select pg_temp.try(format('select public.give_match_kudos(%L, %L, %L, %L)', v_f_upcoming, v_u12, v_child2, 'SKILL')) into v_state;
  perform pg_temp.check(v_state = 'P0001', format('G5 recognition waits until the match has been played (got %s)', v_state));

  -- A giver may take their own back, and only their own.
  perform pg_temp.act('authenticated', v_parent2);
  perform public.give_match_kudos(v_f_played, v_u12, v_child1, 'SKILL');
  select public.withdraw_match_kudos(v_f_played, v_child1) into v_n;
  perform pg_temp.check(v_n = 1, format('G6 a giver may take their own recognition back (withdrew %s)', v_n));
  select public.withdraw_match_kudos(v_f_played, v_child2) into v_n;
  perform pg_temp.check(v_n = 0, 'G7 and withdrawing reaches nobody else''s, even for the same player');

  -- Staff removal: it leaves the surface, and it leaves a record of who removed it.
  perform pg_temp.act('authenticated', v_coach);
  select public.remove_match_kudos(v_f_played, v_u12, v_child2, 'WORK_RATE') into v_n;
  perform pg_temp.check(v_n = 1, format('G8 staff may take recognition down (removed %s)', v_n));
  select count(*) into v_n from public.get_match_kudos(v_f_played) where player_id = v_child2;
  perform pg_temp.check(v_n = 0, 'G9 removed recognition stops being displayed');
  perform pg_temp.act_postgres();
  select count(*) into v_n from public.match_kudos where fixture_id = v_f_played and recipient_player_id = v_child2 and removed_by = v_coach;
  perform pg_temp.check(v_n = 1, 'G10 and the record of the removal survives, with who did it');

  -- =====================================================================
  -- H. THE DISPLAY OVERRIDE IS PRESENTATION ONLY
  -- =====================================================================
  perform pg_temp.act('authenticated', v_coach);
  perform public.set_team_award_category(v_u12, 'FAMILY_OR_SELF_PLAYER', true, 'Clubhouse Player');
  perform pg_temp.act_postgres();
  select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', v_u12) into v_text;
  perform pg_temp.check(v_text = 'Clubhouse Player', format('H1 a team may call the award what its club calls it (got %s)', v_text));
  select name_youth into v_text from public.match_award_categories where category_key = 'FAMILY_OR_SELF_PLAYER';
  perform pg_temp.check(v_text = 'Parents'' Player', format('H2 and the canonical category is untouched by it (got %s)', v_text));
  perform pg_temp.check(internal.match_award_can_vote(v_award, v_parent2) = true
                        and internal.match_award_can_vote(v_award, v_stranger) = false
                        and internal.match_award_can_vote(v_award2, v_manager) = false,
    'H3 renaming an award moves nobody into or out of its electorate');
  select internal.match_award_display_name('FAMILY_OR_SELF_PLAYER', v_u18) into v_text;
  perform pg_temp.check(v_text = 'Parents'' Player', format('H4 and one team''s name for it is not another team''s (got %s)', v_text));

  -- =====================================================================
  -- I. THE RUGBY IS UNTOUCHED
  -- =====================================================================
  perform pg_temp.act_postgres();
  select format('%s-%s/%s', home_score, away_score, status) into v_text from public.fixtures where id = v_f_played;
  perform pg_temp.check(v_text = '24-12/Completed',
    format('I1 after every vote, kudos and closure the result and status are exactly as recorded (got %s)', v_text));

  select count(*) into v_n
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'internal')
     and p.proname ~ '^(open_match_award|close_match_award|cast_match_award_vote|withdraw_match_award_vote|give_match_kudos|withdraw_match_kudos|remove_match_kudos|set_team_award_category)$'
     and p.prosrc ~* '(insert into|update)\s+public\.fixtures';
  perform pg_temp.check(v_n = 0, format('I2 and no community function can write to a fixture at all (%s could)', v_n));

  -- =====================================================================
  -- J. HISTORY SURVIVES THE PLAYER LEAVING
  -- =====================================================================
  perform pg_temp.act_postgres();
  update public.player_team_memberships set state = 'ENDED', ended_at = now() where player_id = v_child1 and team_id = v_u12;
  select count(*) into v_n from public.match_awards
   where id = v_award and winner_player_id = v_child1 and team_id = v_u12 and fixture_id = v_f_played;
  perform pg_temp.check(v_n = 1, 'J1 a won award stays attached to the match and the team it was won with, after the player leaves');
  perform pg_temp.check(not internal.match_award_can_vote(v_award2, v_parent1),
    'J2 while current entitlement follows the current roster, so a departed family stops being an electorate');
  -- Deliberately not switched back on: a finished team place is final, and the suite does not ask
  -- the schema to pretend otherwise.

  -- =====================================================================
  -- K. ADMINISTRATION IS NOT PARTICIPATION
  -- =====================================================================
  perform pg_temp.act('authenticated', v_parent1);
  select count(*) into v_n from public.get_match_community_admin(v_f_played);
  perform pg_temp.check(v_n = 0, format('K1 a parent is offered no configuration at all (got %s rows)', v_n));

  perform pg_temp.act('authenticated', v_coach);
  select count(*) into v_n from public.get_match_community_admin(v_f_played);
  perform pg_temp.check(v_n > 0, format('K2 staff for the side are (got %s rows)', v_n));

  perform pg_temp.act('authenticated', v_parent1);
  select pg_temp.try(format('select public.open_match_award(%L, %L, %L)', v_f_external, v_u12, 'COACHES_PLAYER')) into v_state;
  perform pg_temp.check(v_state = '42501', format('K3 a parent cannot open an award (got %s)', v_state));
  select pg_temp.try(format('select public.close_match_award(%L)', v_award2)) into v_state;
  perform pg_temp.check(v_state = '42501', format('K4 nor close one (got %s)', v_state));
  select pg_temp.try(format('select public.set_team_award_category(%L, %L, true, null)', v_u12, 'COACHES_PLAYER')) into v_state;
  perform pg_temp.check(v_state = '42501', format('K5 nor decide which awards the team runs (got %s)', v_state));

  perform pg_temp.act('authenticated', v_stranger);
  select pg_temp.try(format('select public.get_match_community_admin(%L)', v_f_played)) into v_state;
  select count(*) into v_n from public.get_match_community(v_f_played);
  perform pg_temp.check(v_n = 0, format('K6 another club''s admin sees no community on a match that is not theirs (got %s rows)', v_n));

  -- =====================================================================
  -- L. THE WRITE-UP HAS A MATCH, AND IS STILL AN ARTICLE
  -- =====================================================================
  perform pg_temp.act_postgres();
  insert into public.club_articles (club_id, team_id, fixture_id, slug, title, body, category, status, visibility, published_at, created_by)
  values (v_club, v_u12, v_f_played, 's11-report-' || v_tag, 'A hard-won win', 'They dug in.', 'MATCH_REPORT', 'PUBLISHED', 'MEMBERS', now(), v_coach);
  select count(*) into v_n from public.club_articles
   where fixture_id = v_f_played and category = 'MATCH_REPORT' and status = 'PUBLISHED';
  perform pg_temp.check(v_n = 1, 'L1 a match report belongs to the match it is about, in the article model that already existed');

  -- The article is not owned by the fixture: losing the match must not lose the write-up.
  delete from public.match_kudos where fixture_id = v_f_played;
  delete from public.match_award_votes where award_id in (select id from public.match_awards where fixture_id = v_f_played);
  delete from public.match_awards where fixture_id = v_f_played;
  delete from public.fixtures where id = v_f_played;
  select count(*) into v_n from public.club_articles where slug = 's11-report-' || v_tag and fixture_id is null;
  perform pg_temp.check(v_n = 1, 'L2 and if the fixture goes, the article survives with no match rather than being deleted with it');

  perform pg_temp.act_postgres();
end $$;

rollback;
