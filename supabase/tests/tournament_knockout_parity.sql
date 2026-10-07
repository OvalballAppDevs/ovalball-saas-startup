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
-- A KNOCKOUT IS THE SAME TOURNAMENT PRODUCT.
--
-- WHAT IS BEING PROTECTED
--
-- `tournament_knockout.sql` proves the BRACKET is right: that a draw seats everybody, that only a
-- settled result advances anybody, that a bye is not a game. This file protects something different and
-- easier to lose -- that choosing Knockout as the competition format does not quietly hand a club a
-- REDUCED TOURNAMENT.
--
-- The failure this guards against does not look like a bug. Every screen works; it is simply that the
-- cup has no Agenda, or its attendance turns out to be per game, or its games never reach the surfaces
-- a league's games reach, or a draft draw is visible to a parent because the Draw tab resolved
-- visibility for itself instead of asking the server. Each of those is a separate product by accident.
--
-- So the rule asserted here is:
--
--   SHARED TOURNAMENT BEHAVIOUR STAYS SHARED -- one tournament identity, one participant identity, one
--   attendance answer, one publication authority, one result lifecycle, one calendar projection.
--
--   FORMAT-SPECIFIC BEHAVIOUR BRANCHES ONLY WHERE THE SPORT GENUINELY DIFFERS -- a draw instead of a
--   table, a round's name instead of a round's number, a winner going through instead of points.
--
-- THE COMPETITION IS DELIBERATELY AWKWARD. Three days in the tournament's envelope, two of them played,
-- with the middle day skipped -- because "it works on a one-day festival" is where multi-day bugs hide.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_d1 date := current_date - 5;   -- played
  v_d2 date := current_date - 4;   -- INSIDE the tournament, deliberately NOT played
  v_d3 date := current_date - 3;   -- played
  v_host uuid; v_dir_host uuid; v_h_u12 uuid; v_ca uuid; v_venue uuid; v_pitch uuid;
  v_away uuid; v_dir_away uuid; v_a_u12 uuid; v_away_ca uuid;
  v_outsider uuid; v_out_club uuid; v_parent uuid; v_child uuid; v_away_child uuid;
  v_t uuid; v_plan uuid; v_n int; v_i int; v_g uuid; v_j jsonb; v_ctx jsonb;
  v_side_host uuid; v_side_away uuid; v_d uuid[]; v_order uuid[]; v_tmp uuid;
  v_qf_host uuid; v_qf_other uuid; v_sf uuid;
begin

-- ---- the world -------------------------------------------------------------------------------------

v_host := pg_temp.club('KPHost');
select directory_id into v_dir_host from public.clubs where id = v_host;
v_h_u12 := pg_temp.team(v_host, 'U12');
v_ca := pg_temp.person('KPCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');

v_away := pg_temp.club('KPAway');
select directory_id into v_dir_away from public.clubs where id = v_away;
v_a_u12 := pg_temp.team(v_away, 'U12');
v_away_ca := pg_temp.person('KPAwayCA', v_adult); perform pg_temp.member(v_away, v_away_ca, 'CLUB_ADMIN');

v_out_club := pg_temp.club('KPOut');
v_outsider := pg_temp.person('KPOutsider', v_adult); perform pg_temp.member(v_out_club, v_outsider, 'CLUB_ADMIN');

-- A FAMILY AT THE HOST CLUB, because most people reading a tournament are not running it.
v_parent := pg_temp.person('KPParent', v_adult);
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tres', 'KPChild', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_child;
insert into public.player_team_memberships (player_id, team_id, status) values (v_child, v_h_u12, 'active');
insert into public.guardians (guardian_user_id, player_id, status, state) values (v_parent, v_child, 'active', 'ACTIVE');

-- A CHILD AT THE OTHER CLUB, so "another club's attendance detail" is a real thing to leak.
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tres', 'KPAwayChild', internal.date_of_birth_in_age_grade('union', 'U12'), 'MALE') returning id into v_away_child;
insert into public.player_team_memberships (player_id, team_id, status) values (v_away_child, v_a_u12, 'active');

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'KP Ground', 'kp-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', v_d1, v_d3, 'confirmed', 'KP Cup',
  gen_random_uuid(), 'knockout', 'private', v_venue, '09:00', '17:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');

insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host, v_host, v_h_u12, 'U12', 'added') returning id into v_side_host;
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_away, v_away, v_a_u12, 'U12', 'added') returning id into v_side_away;
v_d := '{}'::uuid[];
for v_i in 1..6 loop
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
  values (v_t, pg_temp.directory_only('KP'||v_i), null, 'U12', 'A', 'added') returning id into v_g;
  v_d := v_d || v_g;
end loop;

insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, v_d1, '09:00', '17:00', v_ca),
       (v_t, v_pitch, v_d2, '09:00', '17:00', v_ca),
       (v_t, v_pitch, v_d3, '09:00', '17:00', v_ca);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
-- TWO DAYS OUT OF THREE. The middle day is inside the tournament and is not one of this competition's.
perform public.set_tournament_plan_days(v_plan, array[v_d1, v_d3]);
perform public.set_tournament_plan_settings(v_plan, 20);
perform public.set_tournament_knockout_settings(v_plan, p_tie_resolution => 'organiser_decision', p_third_place_playoff => true);
-- A DELIBERATE DRAW, so the two clubs that can both answer meet in the opening round: seeds 4 and 5
-- share a pairing at every bracket size.
v_order := array[v_d[1], v_d[2], v_d[3], v_side_host, v_side_away, v_d[4], v_d[5], v_d[6]];
perform public.set_tournament_bracket_draw(v_plan, v_order);
perform public.set_tournament_round_days(v_plan, jsonb_build_array(
  jsonb_build_object('round', 1, 'day', v_d1::text),
  jsonb_build_object('round', 2, 'day', v_d3::text),
  jsonb_build_object('round', 3, 'day', v_d3::text)));
v_n := public.generate_tournament_knockout_fixtures(v_plan);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

-- ============ A. ONE TOURNAMENT, ONE SET OF PARTICIPANTS, NO PHANTOMS ============

perform pg_temp.check((select count(*) from public.tournaments where id = v_t) = 1,
  '1 (A): a knockout is ONE tournament record, exactly as a round robin is');
perform pg_temp.check((select count(*) from public.tournament_participants where tournament_id = v_t) = 8,
  format('2 (A): with the eight sides that entered it and no others (%s)',
         (select count(*) from public.tournament_participants where tournament_id = v_t)));
perform pg_temp.check(
  (select count(*) from public.tournament_participants tp
   join public.club_directory cd on cd.id = tp.club_directory_id
   where tp.tournament_id = v_t and (cd.name ilike '%bye%' or cd.name ilike 'winner %' or cd.name ilike 'loser %')) = 0,
  '3 (A): and no participant called Bye -- a bye is an empty place, never a club');
perform pg_temp.check(
  (select count(*) from public.club_directory where name ilike 'winner q%' or name ilike 'winner s%' or name ilike 'loser s%') = 0,
  '4 (A): and no directory club called Winner QF1 -- the label is a sentence the draw prints');
perform pg_temp.check(
  (select count(*) from public.tournament_games g
   where g.plan_id = v_plan and (g.side_a_id is null or g.side_b_id is null)) = 0,
  '5 (A): every game that exists has two real sides');

-- ============ B. THE DRAFT IS THE ORGANISER'S WORKINGS ============

v_ctx := pg_temp.json_as(v_parent, format('select public.get_tournament_participant_centre(%L::uuid)', v_t));
perform pg_temp.check(
  jsonb_array_length(coalesce(v_ctx -> 'contexts' -> 0 -> 'games', '[]'::jsonb)) = 0,
  '6 (B): a parent sees no games while the plan is a draft');
perform pg_temp.check(
  jsonb_array_length(coalesce(v_ctx -> 'contexts' -> 0 -> 'pairings', '[]'::jsonb)) = 0,
  '7 (B): and no scheduled places either -- a draft draw is not a quieter publication');
perform pg_temp.check(
  jsonb_array_length(coalesce(v_ctx -> 'contexts' -> 0 -> 'competitionDays', '[]'::jsonb)) = 0,
  '8 (B): and no competition days, so nothing reaches their Calendar');
v_j := pg_temp.json_as(v_away_ca, format('select public.get_tournament_bracket(%L::uuid, %L)', v_t, 'U12'));
perform pg_temp.check(jsonb_array_length(coalesce(v_j -> 'rounds', '[]'::jsonb)) = 0,
  '9 (B): another participating club cannot read the draft draw');
v_j := pg_temp.json_as(v_ca, format('select public.get_tournament_bracket(%L::uuid, %L)', v_t, 'U12'));
perform pg_temp.check(jsonb_array_length(coalesce(v_j -> 'rounds', '[]'::jsonb)) > 0,
  '10 (B): the organiser can -- it is theirs');
perform pg_temp.check((v_j ->> 'published')::boolean is false,
  '11 (B): and it says out loud that it is a draft');

-- ---- PUBLISHED. The same column, the same authority a round robin publishes through. ----------------
update public.tournament_plans set publication_state = 'PUBLISHED', published_by = v_ca, published_at = now()
where id = v_plan;

v_j := pg_temp.json_as(v_away_ca, format('select public.get_tournament_bracket(%L::uuid, %L)', v_t, 'U12'));
perform pg_temp.check(jsonb_array_length(coalesce(v_j -> 'rounds', '[]'::jsonb)) > 0,
  '12 (B): once published, a participating club reads the draw');
perform pg_temp.check((v_j ->> 'canManage')::boolean is false,
  '13 (B): and is told plainly that it is not theirs to manage');
perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.randomise_tournament_bracket(%L::uuid)', v_plan)) = '42501',
  '14 (B): and cannot redraw it');
perform pg_temp.check(
  pg_temp.try_as(v_parent, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan, v_order)) = '42501',
  '15 (B): nor can a parent -- the Draw is a projection, never a control surface');

-- ============ C. THE DAYS ARE THE COMPETITION'S, NOT THE TOURNAMENT'S ============

v_ctx := (pg_temp.json_as(v_parent, format('select public.get_tournament_participant_centre(%L::uuid)', v_t))) -> 'contexts' -> 0;
perform pg_temp.check(
  (select count(*) from jsonb_array_elements_text(v_ctx -> 'competitionDays')) = 2,
  format('16 (C): the competition plays two of the tournament''s three days (%s)',
         v_ctx -> 'competitionDays'));
perform pg_temp.check(
  not (v_ctx -> 'competitionDays' @> to_jsonb(v_d2::text)),
  '17 (C): and the day it skips is NOT one of them, so no Calendar row appears for it');
perform pg_temp.check(
  (select count(*) from public.tournament_games where plan_id = v_plan and game_date = v_d2) = 0,
  '18 (C): no game lands on the skipped day either');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_pairings where plan_id = v_plan and game_date = v_d2) = 0,
  '19 (C): and no scheduled place does');

-- ============ D. ONE ATTENDANCE ANSWER FOR THE WHOLE TOURNAMENT ============

perform pg_temp.check(
  pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, %L)', v_t, v_child, 'ATTENDING')) = 'OK',
  '20 (D): a guardian answers for the TOURNAMENT, exactly as at a round robin');
perform pg_temp.check(
  (select count(*) from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child) = 1,
  format('21 (D): and that is ONE answer, not one per knockout game (%s rows)',
         (select count(*) from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child)));
perform pg_temp.check(
  (select count(*) from public.player_fixture_attendance a
   join public.tournament_games g on g.tournament_id = v_t
   where a.fixture_id = g.id) = 0,
  '22 (D): no attendance row is attached to a knockout game -- there is no per-game attendance model');
-- THE ANSWER SURVIVES THE BRACKET MOVING. A side advancing is not a new event to answer for.
perform pg_temp.check(
  (select status from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child) = 'ATTENDING',
  '23 (D): and it is the answer that was given');

-- ============ E. ANOTHER CLUB'S ATTENDANCE DETAIL STAYS THEIRS ============

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, %L)', v_t, v_away_child, 'CANNOT_ATTEND')) <> 'OK',
  '24 (E): a club admin cannot answer for a child -- no staff override, as at a round robin');
v_ctx := (pg_temp.json_as(v_away_ca, format('select public.get_tournament_participant_centre(%L::uuid)', v_t))) -> 'contexts' -> 0;
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_ctx -> 'attendance') a
   where (a ->> 'isMine')::boolean is false
     and (a -> 'unsure' <> 'null'::jsonb or a -> 'cannotAttend' <> 'null'::jsonb or a -> 'awaiting' <> 'null'::jsonb)) = 0,
  '25 (E): and reads no unsure, cannot-attend or awaiting count for a side that is not theirs');
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_ctx -> 'attendance') a where (a ->> 'isMine')::boolean) >= 1,
  '26 (E): while still reading their own');

-- ============ F. EVERY GAME SURFACE READS THE ONE CANONICAL GAME ============

select g.id into v_qf_host from public.tournament_games g
where g.plan_id = v_plan and v_side_host in (g.side_a_id, g.side_b_id);
perform pg_temp.check(v_qf_host is not null, '27 (F): the host''s opening game exists as a canonical game');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_pairings where plan_id = v_plan and game_id = v_qf_host) = 1,
  '28 (F): the bracket place points AT that game rather than carrying a copy of it');
v_j := pg_temp.json_as(v_ca, format('select public.get_tournament_game_result(%L::uuid)', v_qf_host));
perform pg_temp.check((v_j ->> 'id')::uuid = v_qf_host,
  '29 (F): the result detail is the same game');
perform pg_temp.check(v_j ->> 'roundName' = 'Quarter Final',
  format('30 (F): and names it the way the sport does, not "Round 1" (%s)', v_j ->> 'roundName'));
v_ctx := (pg_temp.json_as(v_parent, format('select public.get_tournament_participant_centre(%L::uuid)', v_t))) -> 'contexts' -> 0;
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_ctx -> 'games') g where (g ->> 'id')::uuid = v_qf_host) = 1,
  '31 (F): the Agenda carries the same game id -- there is no second "bracket game"');
perform pg_temp.check(
  (select g ->> 'roundName' from jsonb_array_elements(v_ctx -> 'games') g where (g ->> 'id')::uuid = v_qf_host) = 'Quarter Final',
  '32 (F): with the same name on it');
v_j := pg_temp.json_as(v_ca, format('select public.get_tournament_results_overview(%L::uuid, %L, %L)', v_t, 'U12', 'all'));
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_j -> 'games') g where (g ->> 'id')::uuid = v_qf_host) = 1,
  '33 (F): and the Results list carries it too');

-- A TOURNAMENT GAME IS NOT A CLUB FIXTURE, for a knockout exactly as for a round robin. Proven rather
-- than assumed, because "it should appear in Fixtures" is a reasonable-sounding thing to build and
-- would create a second identity for one game.
perform pg_temp.check(
  (select count(*) from public.fixtures f where f.id in (select id from public.tournament_games where plan_id = v_plan)) = 0,
  '34 (F): a tournament game is not duplicated into the club Fixtures list -- the same rule a round robin follows');

-- ============ G. A SCHEDULED PLACE IS NOT A GAME ============

perform pg_temp.check(
  (select count(*) from public.tournament_bracket_pairings where plan_id = v_plan and game_id is null) > 0,
  '35 (G): later rounds are scheduled before anybody has qualified for them');
perform pg_temp.check(
  jsonb_array_length(coalesce(v_ctx -> 'pairings', '[]'::jsonb)) > 0,
  '36 (G): and a family can read when and where they are');
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_ctx -> 'pairings') p
   where p ->> 'sideALabel' is null or p ->> 'sideBLabel' is null) = 0,
  '37 (G): each one saying what fills it -- "Winner QF1" -- rather than naming a club');
perform pg_temp.check(
  (select count(*) from public.tournament_games where plan_id = v_plan) = 4,
  format('38 (G): and NO game was manufactured to make the Agenda look complete (%s games for 4 opening ties)',
         (select count(*) from public.tournament_games where plan_id = v_plan)));

-- ============ H. ONLY A SETTLED RESULT MOVES THE BRACKET ============

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.submit_tournament_game_result(%L::uuid, 10, 20, null)', v_qf_host)) = 'OK',
  '39 (H): the host''s side submits a score');
perform pg_temp.check(
  (select result_status from public.tournament_games where id = v_qf_host) = 'awaiting_confirmation',
  '40 (H): which is waiting for the other club');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id is not null) = 0,
  '41 (H): and a SUBMITTED score advances nobody');

perform pg_temp.check(
  pg_temp.try_as(v_away_ca, format('select public.submit_tournament_game_result(%L::uuid, 15, 20, null)', v_qf_host)) = 'OK',
  '42 (H): the other club says it was a different score');
perform pg_temp.check(
  (select result_status from public.tournament_games where id = v_qf_host) = 'disputed',
  '43 (H): which contests it');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id is not null) = 0,
  '44 (H): and a CONTESTED score advances nobody either');

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 10, 20, %L)', v_qf_host, 'Both cards checked')) = 'OK',
  '45 (H): the organiser settles it');
perform pg_temp.check(
  (select winner_participant_id from public.tournament_games where id = v_qf_host) = v_side_away,
  '46 (H): which decides a winner');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id = v_side_away) = 1,
  '47 (H): and a HOST-RESOLVED result advances them');

-- THE OTHER THREE OPENING TIES are between sides that are not on Ovalball, so the organiser records
-- them -- the documented route when nobody can confirm.
for v_g in select id from public.tournament_games where plan_id = v_plan and id <> v_qf_host loop
  perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 25, 5, %L)', v_g, 'Recorded at the ground'));
end loop;
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id is not null) = 4,
  format('48 (H): with every opening tie settled, all four semi-final places are filled (%s)',
         (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 2 and participant_id is not null)));
perform pg_temp.check(
  (select count(*) from public.tournament_games where plan_id = v_plan and round_number = 2) = 2,
  '49 (H): and the two semi-finals have become real games');

-- ============ I. HISTORY IS NOT SILENTLY REWRITTEN ============

-- THE SEMI-FINAL THE ADVANCING SIDE IS ACTUALLY IN. Any other semi-final would prove nothing: the
-- refusal is about the history built ON THIS PLACE, and a result elsewhere in the bracket is correctly
-- none of its business.
select id into v_sf from public.tournament_games
where plan_id = v_plan and round_number = 2 and v_side_away in (side_a_id, side_b_id);
perform pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 30, 12, %L)', v_sf, 'Played'));
perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_bracket_draw(%L::uuid, %L::uuid[])', v_plan, v_order)) <> 'OK',
  '50 (I): once games have results, the draw cannot be redrawn under them');
perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.resolve_tournament_game_result(%L::uuid, 20, 10, %L)', v_qf_host, 'Changed my mind')) <> 'OK',
  '51 (I): and an opening result cannot be reversed once its winner has already played again');
perform pg_temp.check(
  (select winner_participant_id from public.tournament_games where id = v_qf_host) = v_side_away,
  '52 (I): the agreed result stands');

-- ============ J. RESULT VISIBILITY IS THE TOURNAMENT'S, NOT THE DRAW'S ============

update public.tournaments set visibility = 'public', results_visibility = 'participants' where id = v_t;
v_j := pg_temp.json_as(v_outsider, format('select public.get_tournament_bracket(%L::uuid, %L)', v_t, 'U12'));
perform pg_temp.check((v_j ->> 'showsScores')::boolean is false,
  '53 (J): an outsider reading a public tournament whose results are participants-only sees no scores in the draw');
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_j -> 'rounds') r,
        jsonb_array_elements(r -> 'games') g
   where (g -> 'sideA' -> 'score') <> 'null'::jsonb) = 0,
  '54 (J): not on a single side of a single game');
update public.tournaments set results_visibility = 'public' where id = v_t;
v_j := pg_temp.json_as(v_outsider, format('select public.get_tournament_bracket(%L::uuid, %L)', v_t, 'U12'));
perform pg_temp.check((v_j ->> 'showsScores')::boolean,
  '55 (J): and sees them when the organiser makes results public -- the same one authority a table uses');
update public.tournaments set visibility = 'private' where id = v_t;

-- ============ K. A NOTIFICATION LANDS ON THE GAME, NOT ON A DASHBOARD ============
--
-- The result lifecycle's notifications are the round robin's. What is proven here is that a knockout
-- result produces one and that it carries the GAME, because the destination a client resolves is built
-- from exactly that: a notification that named only the tournament would put somebody on a Centre and
-- leave them to find the game that needed them.

perform pg_temp.check(
  (select count(*) from public.notifications n
   where n.data ->> 'tournament_game_id' = v_qf_host::text) > 0,
  '56 (K): a knockout result notifies the other side');
perform pg_temp.check(
  (select count(*) from public.notifications n
   where n.data ->> 'tournament_game_id' = v_qf_host::text
     and n.data ->> 'tournament_id' = v_t::text) > 0,
  '57 (K): naming the game AND its tournament, which is what a deep link is built from');
perform pg_temp.check(
  (select count(*) from public.notifications n
   where n.data ->> 'tournament_game_id' = v_qf_host::text and n.user_id = v_parent) = 0,
  '58 (K): and it does not go to a parent -- it is addressed to people who can act on it');

-- ============ L. THE THIRD-PLACE PLAY-OFF IS FED BY LOSING ============

perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots
   where plan_id = v_plan and is_third_place and source_kind = 'loser') = 2,
  '59 (L): both of its places come from LOSING a semi-final -- the only places in a knockout that do');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots
   where plan_id = v_plan and is_third_place and source_round = 2) = 2,
  '60 (L): and from the semi-finals specifically');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots
   where plan_id = v_plan and not is_third_place and source_kind = 'loser') = 0,
  '61 (L): nothing else in the bracket is fed by losing');
-- NOTHING FEEDS OUT OF IT. Winning the third-place play-off is not a route to the final, and a bracket
-- that let it be one would advance a side out of a game they had already lost.
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots
   where plan_id = v_plan and not is_third_place and source_round = (select max(round_number) from public.tournament_bracket_slots where plan_id = v_plan and is_third_place)) = 0,
  '62 (L): and nothing is fed BY it');

end $$;

-- =====================================================================================================
-- M. SEVEN SIDES: THE SHAPE A REAL FESTIVAL TURNS UP WITH.
--
-- A bye is the one place a knockout can quietly invent something. The proofs are that it invents
-- nothing: no opponent, no game, no result to wait for, no attendance to answer and no row in any list
-- of what was played -- while the side it belongs to is genuinely through.
-- =====================================================================================================

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_day date := current_date - 3;
  v_host uuid; v_dir uuid; v_ca uuid; v_venue uuid; v_pitch uuid; v_t uuid; v_plan uuid;
  v_i int; v_n int; v_bye_side uuid; v_bye_pos int; v_j jsonb;
begin
v_host := pg_temp.club('KP7Host');
select directory_id into v_dir from public.clubs where id = v_host;
v_ca := pg_temp.person('KP7CA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'KP7 Ground', 'kp7-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
  conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir, 'union', v_day, v_day, 'confirmed', 'KP7 Cup',
  gen_random_uuid(), 'knockout', 'private', v_venue, '08:00', '20:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
for v_i in 1..7 loop
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, age_group, squad_label, status)
  values (v_t, pg_temp.directory_only('KP7S'||v_i), null, 'U12', 'A', 'added');
end loop;
insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, v_day, '08:00', '20:00', v_ca);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform public.set_tournament_plan_days(v_plan, array[v_day]);
perform public.set_tournament_knockout_settings(v_plan, p_third_place_playoff => true);
v_n := public.randomise_tournament_bracket(v_plan);
perform public.generate_tournament_knockout_fixtures(v_plan);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);

perform pg_temp.check(v_n = 8, format('M1: seven sides are seated in an eight-place bracket (%s)', v_n));
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots where plan_id = v_plan and round_number = 1 and is_bye) = 1,
  'M2: with exactly one empty place');
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots
   where plan_id = v_plan and round_number = 1 and is_bye and participant_id is not null) = 0,
  'M3: and nobody standing in it -- a bye is an absence, not a club');
perform pg_temp.check(
  (select count(*) from public.tournament_games where plan_id = v_plan) = 3,
  format('M4: three opening games, not four -- the bye is not played (%s)',
         (select count(*) from public.tournament_games where plan_id = v_plan)));
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_pairings bp
   join public.tournament_bracket_slots s on s.plan_id = bp.plan_id and s.round_number = 1
        and s.position = bp.game_position * 2 and not s.is_third_place
   where bp.plan_id = v_plan and bp.round_number = 1 and s.is_bye) = 0,
  'M5: and takes no pitch and no kick-off slot');

select s.position, (select participant_id from public.tournament_bracket_slots p
                    where p.plan_id = v_plan and p.round_number = 1 and not p.is_third_place
                      and p.position = case when s.position % 2 = 1 then s.position + 1 else s.position - 1 end)
into v_bye_pos, v_bye_side
from public.tournament_bracket_slots s
where s.plan_id = v_plan and s.round_number = 1 and not s.is_third_place and s.is_bye;

perform pg_temp.check(
  (select count(*) from public.tournament_bracket_slots
   where plan_id = v_plan and round_number = 2 and participant_id = v_bye_side) = 1,
  'M6: the side with no opponent is already through to the next round');
perform pg_temp.check(
  (select count(*) from public.tournament_games g
   where g.plan_id = v_plan and v_bye_side in (g.side_a_id, g.side_b_id)) = 0,
  'M7: with no game to play and so no result to wait for');

v_j := pg_temp.json_as(v_ca, format('select public.get_tournament_bracket(%L::uuid, %L)', v_t, 'U12'));
perform pg_temp.check(jsonb_array_length(v_j -> 'byes') = 1,
  'M8: the draw names the side that is through');
perform pg_temp.check(
  (v_j -> 'byes' -> 0 ->> 'advancesToName') = 'Semi Final',
  format('M9: and says which ONE game it is through to, in the singular (%s)',
         v_j -> 'byes' -> 0 ->> 'advancesToName'));
perform pg_temp.check(
  (select count(*) from jsonb_array_elements(v_j -> 'rounds') r, jsonb_array_elements(r -> 'games') g
   where (g -> 'sideA' ->> 'label') ilike '%bye%' or (g -> 'sideB' ->> 'label') ilike '%bye%') = 0,
  'M10: and draws no game whose opponent is the word Bye');

-- n - 1 games decide a knockout, plus the third-place play-off and nothing else.
perform pg_temp.check(
  (select count(*) from public.tournament_bracket_pairings where plan_id = v_plan) = 7,
  format('M11: seven sides produce six games plus a third-place play-off, and no more (%s)',
         (select count(*) from public.tournament_bracket_pairings where plan_id = v_plan)));

end $$;

rollback;
