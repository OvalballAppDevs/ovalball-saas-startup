begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_dob date default null) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tres-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tres', p_label, 'tres-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TRES ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tres-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tres-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

/** A directory club with NO Ovalball club behind it -- nobody can answer for it. */
create or replace function pg_temp.directory_only(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TRES ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'tournament_manual_entry', 'tres-' || v_tag)
  returning id into v_dir;
  return v_dir;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12', p_squad text default null) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, squad_designation, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys' || coalesce(' ' || p_squad, ''),
          'tres-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', p_squad, 'union', true)
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

/** Runs a statement AS somebody and hands back 'OK' or the SQLSTATE. */
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v_state text;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    execute p_sql;
    v_state := 'OK';
  exception when others then
    get stacked diagnostics v_state = returned_sqlstate;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v_state;
end $$;

/** Runs a read AS somebody and hands back what it returned. */
create or replace function pg_temp.json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin execute p_sql into v; exception when others then v := null; end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- =====================================================================================================
-- A TOURNAMENT RESULT, THROUGH ITS WHOLE LIFE.
--
-- WHAT IS BEING PROTECTED
--
-- A tournament game's score is the only thing in a festival that TWO CLUBS both have an opinion about
-- and only one of them can be right. Everything else in Ovalball is owned by somebody: a club's teams,
-- a parent's answer, an organiser's programme. A result is CONTESTED ground, and the ways it can go
-- wrong are particular to that:
--
--   * one club quietly overwriting what the other said;
--   * a club "confirming" its own score, so one opinion becomes an agreement;
--   * an unsettled number counting towards a table, or reaching somebody who should not see it;
--   * a disagreement that no longer holds both claims, so the organiser has nothing to settle it with;
--   * an amendment to an agreed result silently replacing it.
--
-- Every one of those is asserted below, and asserted against the PAYLOAD and the ROW rather than
-- against a screen -- a client that declines to draw a field has still been sent it.
--
-- THE EXTERNAL-OPPONENT PATH IS DELIBERATELY NOT HERE. A side with nobody on Ovalball to answer takes a
-- different route (`external_recorded`), and mixing the two would let a change to one silently satisfy
-- the other's assertions. It has its own suite: tournament_external_results.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_away uuid; v_other uuid;
  v_dir_host uuid; v_dir_away uuid; v_dir_other uuid;
  v_h_u12 uuid; v_a_u12 uuid; v_o_u12 uuid;
  v_ca uuid; v_away_ca uuid; v_away_coach uuid; v_other_ca uuid; v_parent uuid; v_child uuid; v_mem uuid;
  v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid; v_tbl uuid;
  v_sh uuid; v_sa uuid; v_so uuid;
  v_game uuid; v_future uuid;
  v_state text; v_json jsonb; v_n int;
begin

-- ---- a two-club competition that has already been played ---------------------------------------------

v_host  := pg_temp.club('Host');
v_away  := pg_temp.club('Away');
v_other := pg_temp.club('Other');
select directory_id into v_dir_host  from public.clubs where id = v_host;
select directory_id into v_dir_away  from public.clubs where id = v_away;
select directory_id into v_dir_other from public.clubs where id = v_other;

v_h_u12 := pg_temp.team(v_host, 'U12');
v_a_u12 := pg_temp.team(v_away, 'U12');
v_o_u12 := pg_temp.team(v_other, 'U12');

v_ca       := pg_temp.person('HostCA', v_adult);  perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
v_away_ca  := pg_temp.person('AwayCA', v_adult);  perform pg_temp.member(v_away, v_away_ca, 'CLUB_ADMIN');
v_other_ca := pg_temp.person('OtherCA', v_adult); perform pg_temp.member(v_other, v_other_ca, 'CLUB_ADMIN');
-- A COACH AT THE AWAY CLUB with no club-wide authority: the team-scope half of the same capability.
v_away_coach := pg_temp.person('AwayCoach', v_adult);
v_mem := pg_temp.member(v_away, v_away_coach, 'BASIC_USER');
perform pg_temp.team_role(v_mem, v_a_u12, 'COACH');
-- A PARENT at the away club: connected to the tournament, and able to record nothing.
v_parent := pg_temp.person('Parent', v_adult);
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tres', 'Child', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child;
insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_a_u12, 'active');
insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent, v_child, 'active', 'ACTIVE');

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'TRES Ground', 'tres-g-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

-- THE FESTIVAL HAS ALREADY HAPPENED, because a result belongs to a game that has kicked off.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', current_date - 2, current_date - 2, 'confirmed', 'TRES Festival',
        gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '16:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');

insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added') returning id into v_sh;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_away, v_away, v_a_u12, 'U12', 'added') returning id into v_sa;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_other, v_other, v_o_u12, 'U12', 'added') returning id into v_so;

insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, current_date - 2, '09:00', '16:00', v_ca);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform public.set_tournament_plan_days(v_plan, array[(current_date - 2)::date]);
perform public.set_tournament_plan_tables(v_plan, jsonb_build_array(
  jsonb_build_object('name', 'Table A', 'sides', jsonb_build_array(v_sh, v_sa, v_so))));
perform public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

update public.tournament_plans set publication_state = 'PUBLISHED', published_by = v_ca, published_at = now()
where id = v_plan;
select id into v_tbl from public.tournament_plan_tables where plan_id = v_plan;

-- The host's game against the away club: both ends can answer.
select id into v_game from public.tournament_games
where plan_id = v_plan and ((side_a_id = v_sh and side_b_id = v_sa) or (side_a_id = v_sa and side_b_id = v_sh));

-- ============ A. WHO MAY SUBMIT AT ALL ============

perform pg_temp.check(
  pg_temp.try_as(v_parent, format('select public.submit_tournament_game_result(%L::uuid, 10, 5)', v_game)) = '42501',
  '1 (A): a PARENT of a player in the game cannot record its result');

perform pg_temp.check(
  pg_temp.try_as(v_other_ca, format('select public.submit_tournament_game_result(%L::uuid, 10, 5)', v_game)) = '42501',
  '2 (A): a club admin of a THIRD club in the same competition cannot record somebody else''s game');

-- ============ B. ONE SIDE SUBMITS ============

perform pg_temp.check(
  pg_temp.try_as(v_away_coach, format('select public.submit_tournament_game_result(%L::uuid, 24, 17, ''Our record'')', v_game)) = 'OK',
  '3 (B): a COACH of an entered team may record its result -- the capability at team scope, not a role name');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'awaiting_confirmation',
  format('4 (B): one side''s score is AWAITING CONFIRMATION, never a result (%s)', v_state));

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions where game_id = v_game and kind = 'initial') = 1,
  '5 (B): and it is recorded as a claim, attributed and timestamped');

-- ============ C. A SIDE CANNOT AGREE WITH ITSELF ============

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, 24, 17)', v_game)) = 'OK',
  '6 (C): the SAME side submitting the same score again is accepted');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'awaiting_confirmation',
  format('7 (C): but it does NOT become a result -- one club agreeing with itself is not two clubs agreeing (%s)', v_state));

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions where game_id = v_game and kind = 'confirmation') = 0,
  '8 (C): and nothing was recorded as a confirmation');

-- ============ D. AN UNSETTLED SCORE COUNTS FOR NOTHING ============

perform pg_temp.check((select coalesce(sum(played), 0) from internal.tournament_table_standings(v_tbl)) = 0,
  '9 (D): an awaiting score moves NO side''s played count');
perform pg_temp.check((select coalesce(sum(competition_points), 0) from internal.tournament_table_standings(v_tbl)) = 0,
  '10 (D): and no side''s points');

-- ============ E. THE OTHER SIDE AGREES ============

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 24, 17)', v_game)) = 'OK',
  '11 (E): the OTHER side submitting the same score is accepted');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'final', format('12 (E): and the result is now FINAL (%s)', v_state));

perform pg_temp.check((select status from public.tournament_games where id = v_game) = 'PLAYED',
  '13 (E): the game is PLAYED');

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions where game_id = v_game) = 3,
  '14 (E): and nothing was overwritten -- three claims are on the record, not one');

perform pg_temp.check((select sum(played) from internal.tournament_table_standings(v_tbl)) = 2,
  '15 (E): NOW it counts, for both sides');

-- ============ F. A CORRECTION AFTER AGREEMENT IS A PROPOSAL ============

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, 24, 20, ''We had 20'')', v_game)) = 'OK',
  '16 (F): a side may propose a change to an agreed result');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'amendment_pending',
  format('17 (F): which is a PROPOSAL, not a new result (%s)', v_state));

perform pg_temp.check((select side_b_score from public.tournament_games where id = v_game) = 17,
  '18 (F): the AGREED score is still the one on the game -- a proposal does not replace it');

perform pg_temp.check((select sum(points_for) from internal.tournament_table_standings(v_tbl)) = 41,
  '19 (F): and the table still reads the agreed score, not the proposed one');

-- ============ F2. AN AGREED RESULT CANNOT BE PUT BACK INTO DISPUTE ============
--
-- A contest is what happens to a score NOBODY has agreed yet. Once two clubs agree one, a later
-- disagreement is a PROPOSAL against a standing result -- never a return to `disputed`, which counts
-- for nothing and would let one club remove an agreed result from the table by objecting to it.

perform pg_temp.check((select result_status from public.tournament_games where id = v_game) <> 'disputed',
  '19a (F2): a side''s objection to an agreed score never returns the game to disputed');
perform pg_temp.check(internal.tournament_result_counts(
  (select result_status from public.tournament_games where id = v_game)),
  '19b (F2): so the agreed result still counts while the proposal is outstanding');

-- ============ G. THE ORGANISER SETTLES IT ============

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.resolve_tournament_game_result(%L::uuid, 24, 20, ''We insist'')', v_game)) = '42501',
  '20 (G): a participating club cannot settle its own disagreement');

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 24, 20, ''Referee''''s card'')', v_game)) = 'OK',
  '21 (G): the ORGANISER can');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'final', format('22 (G): and it is final again (%s)', v_state));

perform pg_temp.check((select result_resolution_reason from public.tournament_games where id = v_game) = 'Referee''s card',
  '23 (G): their reason is recorded ON the game, so a club can see how it was settled');

perform pg_temp.check((select result_resolved_by from public.tournament_games where id = v_game) = v_ca,
  '24 (G): attributed to the person who settled it');

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions where game_id = v_game) = 5,
  '25 (G): and EVERY claim survives -- the resolution is appended, never a replacement');

-- ============ H. A CONTEST HOLDS BOTH CLAIMS ============

-- A second game, contested from the start.
select id into v_game from public.tournament_games
where plan_id = v_plan and ((side_a_id = v_sa and side_b_id = v_so) or (side_a_id = v_so and side_b_id = v_sa));

perform pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, 12, 10)', v_game));
perform pg_temp.check(
  pg_temp.try_as(v_other_ca, format('select public.submit_tournament_game_result(%L::uuid, 12, 17, ''A late try'')', v_game)) = 'OK',
  '26 (H): the other side may give a DIFFERENT score');

select result_status into v_state from public.tournament_games where id = v_game;
perform pg_temp.check(v_state = 'disputed', format('27 (H): which contests it (%s)', v_state));

perform pg_temp.check((select side_b_score from public.tournament_games where id = v_game) = 10,
  '28 (H): and the FIRST submission is untouched -- a contest adds a claim, it does not overwrite one');

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions where game_id = v_game) = 2,
  '29 (H): both claims are on the record');

perform pg_temp.check((select note from public.tournament_game_result_submissions where game_id = v_game and kind = 'dispute') = 'A late try',
  '30 (H): with the explanation the contesting side gave');

perform pg_temp.check((select count(*) from internal.tournament_table_standings(v_tbl) s where s.played > 1) = 0,
  '31 (H): a CONTESTED result counts for nothing until it is settled');

-- ============ I. WHO MAY READ WHAT ============

v_json := pg_temp.json_as(v_ca, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''all'')', v_t));
perform pg_temp.check(jsonb_array_length(v_json->'games') = 3,
  format('32 (I): the ORGANISER reads every game in the competition (%s)', jsonb_array_length(v_json->'games')));
perform pg_temp.check((v_json->>'sideFilterApplied')::boolean is false,
  '33 (I): and is told the list was not narrowed');

v_json := pg_temp.json_as(v_away_ca, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''all'')', v_t));
perform pg_temp.check(jsonb_array_length(v_json->'games') = 2,
  format('34 (I): a participating club reads only its OWN games (%s)', jsonb_array_length(v_json->'games')));
perform pg_temp.check((v_json->>'sideFilterApplied')::boolean,
  '35 (I): and is TOLD the server narrowed it, rather than left to wonder why the list is short');

perform pg_temp.check(pg_temp.json_as(v_parent, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''all'')', v_t)) is null,
  '36 (I): a parent reads NOTHING -- not an empty list of games they could have seen');

perform pg_temp.check(pg_temp.json_as(v_parent, format('select public.get_tournament_game_result(%L::uuid)', v_game)) is null,
  '37 (I): and cannot reach a single game''s result either, where the contested scores and the notes live');

v_json := pg_temp.json_as(v_other_ca, format('select public.get_tournament_game_result(%L::uuid)', v_game));
perform pg_temp.check(jsonb_array_length(v_json->'submissions') = 2,
  '38 (I): a side IN the contest reads both claims, because answering it requires them');

-- ============ J. NEEDS ATTENTION IS COMPUTED PER VIEWER ============

v_json := pg_temp.json_as(v_ca, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''needs_attention'')', v_t));
perform pg_temp.check((v_json->'counts'->>'contested')::int = 1,
  '39 (J): the organiser''s Needs Attention holds the contested game');

-- A game nobody has recorded, awaiting the away club's own answer.
select id into v_future from public.tournament_games
where plan_id = v_plan and result_status = 'none' limit 1;
perform pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 3, 3)', v_future));

v_json := pg_temp.json_as(v_ca, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''all'')', v_t));
select count(*) into v_n from jsonb_array_elements(v_json->'games') g
where g->>'id' = v_future::text and (g->>'needsAttention')::boolean;
perform pg_temp.check(v_n = 0,
  '40 (J): a side''s OWN submission sitting with the opposition is NOT their outstanding work');

v_json := pg_temp.json_as(v_other_ca, format('select public.get_tournament_results_overview(%L::uuid, ''U12'', ''all'')', v_t));
select count(*) into v_n from jsonb_array_elements(v_json->'games') g
where g->>'id' = v_future::text and (g->>'needsAttention')::boolean;
perform pg_temp.check(v_n = 1,
  '41 (J): but it IS the other side''s, because they are the ones who must answer');

-- ============ K. THE ORGANISER MAY TURN SUBMISSION OFF ============

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.set_tournament_results_settings(%L::uuid, false, ''participants'')', v_t)) = '42501',
  '42 (K): a participating club cannot change how results are run');

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, false, ''participants'')', v_t)) = 'OK',
  '43 (K): the organiser can');

select id into v_future from public.tournament_games where plan_id = v_plan and result_status = 'none' limit 1;
if v_future is not null then
  perform pg_temp.check(
    pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, 1, 1)', v_future)) = '42501',
    '44 (K): and a side can then no longer submit -- the organiser records every score themselves');
else
  perform pg_temp.check(true, '44 (K): skipped -- no unrecorded game left');
end if;

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, true, ''sort-of'')', v_t)) = '22023',
  '45 (K): results are visible either to everybody or to participants, and nothing else');

-- ============ L. THE WRITE PATH IS THE ONLY WAY IN ============

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('update public.tournament_games set side_a_score = 99 where id = %L', v_game)) <> 'OK',
  '46 (L): a club cannot write a score straight onto the game, bypassing the lifecycle');

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('insert into public.tournament_game_result_submissions (game_id, kind, side_a_score, side_b_score, submitted_by) values (%L, ''confirmation'', 99, 0, %L)', v_game, v_away_ca)) <> 'OK',
  '47 (L): nor forge a confirmation into the audit trail');

-- ============ M. RE-PLANNING NEVER DESTROYS A RESULT ============
--
-- `generate_tournament_plan_fixtures` begins by deleting the plan's games, and the submissions cascade
-- with them. That was right while a draft was machine-made pairings nobody had played; it stops being
-- right the moment a club records a score, because the delete would take both sides' claims, the
-- organiser's ruling and the whole record of the match with it -- silently, and with the standings
-- quietly re-resolving as though it had never happened.

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L::uuid)', v_plan)) = '22023',
  '48 (M): regenerating a plan that carries a result is REFUSED');

perform pg_temp.check((select games_with_results from internal.tournament_plan_result_history(v_plan)) > 0,
  '49 (M): and the guard''s own count says why');

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.clear_tournament_plan_results(%L::uuid, ''We want to start again'')', v_plan)) = '42501',
  '50 (M): only the organiser may clear a competition''s results');

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.clear_tournament_plan_results(%L::uuid, %L)', v_plan, '')) = '22023',
  '51 (M): and must say why -- it is recorded against the tournament');

select count(*) into v_n from public.tournament_game_result_submissions s
join public.tournament_games g on g.id = s.game_id where g.plan_id = v_plan;

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.clear_tournament_plan_results(%L::uuid, ''Re-drawing the competition'')', v_plan)) = 'OK',
  '52 (M): with a reason, they can');

perform pg_temp.check((select count(*) from public.tournament_games where plan_id = v_plan and result_status <> 'none') = 0,
  '53 (M): every result is cleared');

perform pg_temp.check((select count(*) from public.tournament_game_result_submissions s
                       join public.tournament_games g on g.id = s.game_id where g.plan_id = v_plan) > v_n,
  '54 (M): and the audit trail GREW rather than shrank -- clearing means the games no longer have results, not that nobody ever said anything');

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L::uuid)', v_plan)) = 'OK',
  '55 (M): and only then may the competition be drawn again');

-- ============ N. THE PEOPLE WHO CAN ANSWER ARE THE PEOPLE TOLD ============
--
-- A club admin holds `fixture.result.record` at CLUB scope and may hold no team role at all. Reaching a
-- side through its TEAM staff alone misses them -- which is the commonest case, and was found by
-- driving the real review festival: the one person who had to act was the one person not notified.

perform pg_temp.try_as(v_ca, format('select public.set_tournament_results_settings(%L::uuid, true, ''participants'')', v_t));
select id into v_game from public.tournament_games where plan_id = v_plan
  and ((side_a_id = v_sh and side_b_id = v_sa) or (side_a_id = v_sa and side_b_id = v_sh));
delete from public.notifications where data->>'tournament_game_id' = v_game::text;
perform pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 5, 3)', v_game));

perform pg_temp.check(
  exists (select 1 from public.notifications where user_id = v_away_ca and data->>'tournament_game_id' = v_game::text),
  '56 (N): the other side''s CLUB ADMIN is told -- the authority they hold is at club scope, and they hold no team role');

perform pg_temp.check(
  exists (select 1 from public.notifications where user_id = v_away_coach and data->>'tournament_game_id' = v_game::text),
  '57 (N): and so is the team''s own coach');

perform pg_temp.check(
  not exists (select 1 from public.notifications where user_id = v_parent and data->>'tournament_game_id' = v_game::text),
  '58 (N): a parent is NOT -- there is nothing they can do about it');

perform pg_temp.check(
  not exists (select 1 from public.notifications where user_id = v_other_ca and data->>'tournament_game_id' = v_game::text),
  '59 (N): and nor is a club that is not in this game');

perform pg_temp.check(
  (select count(*) from public.notifications where data->>'tournament_game_id' = v_game::text
     and data->>'tournament_id' = v_t::text) > 0,
  '60 (N): every notification carries the GAME it is about, so it can route to the one score that needs answering');

end $$;


rollback;
