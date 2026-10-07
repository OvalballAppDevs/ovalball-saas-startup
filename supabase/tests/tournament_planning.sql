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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tpl-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tpl', p_label, 'tpl-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TPL ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tpl-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tpl-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12', p_squad text default null) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, squad_designation, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys' || coalesce(' ' || p_squad, ''),
          'tpl-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', p_squad, 'union', true)
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

-- The pathway is stated, never assumed from the team.
create or replace function pg_temp.player(p_team uuid, p_label text, p_dob date, p_user uuid default null) returns uuid language plpgsql as $$
declare v uuid;
begin
  -- The LABEL is the FIRST name here, because `myPlayers` reports a first name and the assertions
  -- below identify a child by it -- which is also how a guardian reads the screen.
  insert into public.players (first_name, surname, date_of_birth, user_id, playing_pathway)
  values (p_label, 'Test', p_dob, p_user, 'MALE') returning id into v;
  insert into public.player_team_memberships (player_id, team_id, status) values (v, p_team, 'active');
  return v;
end $$;

create or replace function pg_temp.guardian_of(p_player uuid, p_user uuid) returns void language plpgsql as $$
begin
  insert into public.guardians (guardian_user_id, player_id, status, state) values (p_user, p_player, 'active', 'ACTIVE');
end $$;

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

-- How many named responses this person can actually READ, under RLS, as the app would.
create or replace function pg_temp.rows_visible(p_user uuid, p_tournament uuid) returns int language plpgsql as $$
declare v int;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select count(*) into v from public.player_fixture_attendance where tournament_id = p_tournament;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;


-- Reads the GENERATED DRAFT as somebody, under the authenticated role, exactly as the app does.
create or replace function pg_temp.read_draft(p_user uuid, p_tournament uuid, p_age text, p_preview boolean)
returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  select public.get_tournament_plan_draft(p_tournament, p_age, p_preview) into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- Runs a read AS somebody and hands back what it returned, rather than only whether it was refused.
create or replace function pg_temp.try_json_as(p_subject uuid, p_sql text) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_subject, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  execute p_sql into v;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- Reads the participant centre AS somebody, under the authenticated role, exactly as the app does.
create or replace function pg_temp.centre_as(p_user uuid, p_tournament uuid) returns jsonb language plpgsql as $$
declare v jsonb;
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
  begin
    v := public.get_tournament_participant_centre(p_tournament);
  exception when others then
    v := null;
  end;
  perform set_config('role', 'none', true);
  perform set_config('request.jwt.claims', '', true);
  return v;
end $$;

-- A participant reads a tournament, and reads only what is theirs to read.
--
-- WHAT THIS GUARDS
--
-- `get_tournament_participant_centre` is the one read behind the participant Tournament Centre --
-- Overview, Teams, Agenda and Attendance are four views of it. It carries a PRIVACY BOUNDARY that a
-- client cannot be trusted with: every club except the viewer's own is reduced to a single ATTENDING
-- number before the payload is built, so another club's unsure, cannot-attend, awaiting and named
-- players are not merely undrawn -- they are never sent.
--
-- THE FAILURE THIS PREVENTS is the quiet one. A UI that simply does not render a field still received
-- it, and the next surface built on the same read will show it. So the assertions below read the
-- PAYLOAD, not a screen.
--
-- IT ALSO PINS THE COMPETITION BOUNDARY. A club with a U12 and a U16 side at one festival gets two
-- CONTEXTS over ONE tournament record -- not two tournaments, and not one list with both fields mixed
-- into it. A U12 context must never carry a U16 club.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

-- Round Robin generation: the pairings, and the line between a draft and a published plan.
--
-- WHAT IS BEING PROTECTED
--
-- A tournament plan is the first thing in Ovalball that CREATES fixtures rather than recording them,
-- so the way it can be wrong is different from everything around it. It can produce the wrong number
-- of games, the same pair twice, a side against itself, a side drawn twice at the same minute, or --
-- worst -- it can show a parent a schedule the organiser was still working on.
--
-- THE INVARIANT, stated once: a table of n sides produces exactly n * (n - 1) / 2 games. Three sides
-- three games, four sides six, five ten, six fifteen. Across tables the counts add. An odd table has a
-- BYE, which is the absence of a game and never a side called "Bye".
--
-- GENERATE IS NOT PUBLISH, and that is asserted from the participant's side rather than the
-- organiser's: the thing that matters is not that a flag is set but that a guardian reading the
-- Tournament Agenda sees nothing until the organiser says so.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_guest uuid;
  v_dir_host uuid; v_dir_guest uuid; v_dir_unclaimed uuid;
  v_h_u12 uuid; v_g_u12 uuid; v_g_u12b uuid; v_h_u16 uuid;
  v_ca uuid; v_guest_co uuid; v_mem uuid; v_parent uuid; v_child uuid;
  v_venue uuid; v_pitch uuid;
  v_t uuid; v_plan uuid; v_plan16 uuid;
  v_n int; v_games int; v_state text; v_sides uuid[]; v_tables jsonb;
  v_a uuid; v_b uuid;
begin

v_host  := pg_temp.club('Host');
v_guest := pg_temp.club('Guest');
select directory_id into v_dir_host  from public.clubs where id = v_host;
select directory_id into v_dir_guest from public.clubs where id = v_guest;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TPL Unclaimed RUFC','T','T','union','UK','England',true,'unverified','tournament_manual_entry','tpl-unc-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir_unclaimed;

v_h_u12 := pg_temp.team(v_host,'U12');
v_h_u16 := pg_temp.team(v_host,'U16');
v_g_u12 := pg_temp.team(v_guest,'U12');
v_g_u12b := pg_temp.team(v_guest,'U12','B');

v_ca := pg_temp.person('HostCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
v_guest_co := pg_temp.person('GuestCO', v_adult); v_mem := pg_temp.member(v_guest, v_guest_co, 'BASIC_USER');
perform pg_temp.team_role(v_mem, v_g_u12, 'COACH');
v_parent := pg_temp.person('Parent', v_adult);
v_child := pg_temp.player(v_g_u12, 'Child', internal.date_of_birth_in_age_grade('union', 'U12'));
perform pg_temp.guardian_of(v_child, v_parent);

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'TPL Ground', 'tpl-g-'||substr(gen_random_uuid()::text,1,8), '1 Lane', 'Town', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;
-- lane_count is a GENERATED column; layout and size take their own canonical defaults.
insert into public.club_pitches (club_id, venue_id, display_name, active, sort_order)
values (v_host, v_venue, 'Pitch 1', true, 1) returning id into v_pitch;

-- A TWO-DAY tournament running two competitions.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility, venue_id, kickoff_time, ends_at)
values (v_host, v_dir_host, 'union', current_date + 20, current_date + 21, 'confirmed', 'TPL Festival',
        gen_random_uuid(), 'round_robin', 'private', v_venue, '09:00', '16:00')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t,'U12'), (v_t,'U16');

-- FOUR U12 SIDES: the host, two from one guest club, and a club Ovalball does not have.
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host,  v_host,  v_h_u12,  'U12', 'added'),
       (v_t, v_dir_guest, v_guest, v_g_u12,  'U12', 'added'),
       (v_t, v_dir_guest, v_guest, v_g_u12b, 'U12', 'added');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, squad_label, status)
values (v_t, v_dir_unclaimed, null, null, 'U12', 'Spears', 'external_recorded');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_host, v_host, v_h_u16, 'U16', 'added');

-- ============ A. Starting a plan ============

v_state := pg_temp.try_as(v_guest_co, format('select public.start_tournament_plan(%L::uuid, ''U12'')', v_t));
perform pg_temp.check(v_state = '42501',
  format('1 (A): a participating club''s coach cannot start planning somebody else''s tournament (got %s)', v_state));

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_plan := public.start_tournament_plan(v_t, 'U12');
perform set_config('role', 'none', true);
perform pg_temp.check(v_plan is not null, '2 (A): the organiser starts a plan');

perform pg_temp.check((select publication_state from public.tournament_plans where id = v_plan) = 'DRAFT',
  '3 (A): and it begins as a DRAFT -- nothing is announced by starting');

select count(*) into v_n from public.tournament_plan_days where plan_id = v_plan;
perform pg_temp.check(v_n = 2, format('4 (A): every day the tournament runs is selected to begin with (%s)', v_n));

select count(*) into v_n from public.tournament_plan_table_sides where plan_id = v_plan;
perform pg_temp.check(v_n = 4,
  format('5 (A): all four U12 sides are placed, including the club that is not on Ovalball (%s)', v_n));

perform pg_temp.check(
  (select count(*) from public.tournament_plan_table_sides s
   join public.tournament_participants p on p.id = s.participant_id
   where s.plan_id = v_plan and p.age_group = 'U16') = 0,
  '6 (A): and the U16 side is not among them -- a competition''s tables hold its own sides');

perform pg_temp.check(public.start_tournament_plan(v_t, 'U12') = v_plan,
  '7 (A): starting again returns the plan that exists rather than making a second one');

-- ============ B. The canonical defaults ============

perform pg_temp.check((select game_duration_minutes from public.tournament_plans where id = v_plan) = 40,
  format('8 (B): the game length defaults to the RFU Regulation 15 length for U12 -- two 20 minute halves (got %s)',
         (select game_duration_minutes from public.tournament_plans where id = v_plan)));
perform pg_temp.check((select changeover_minutes from public.tournament_plans where id = v_plan) = 15,
  '9 (B): the changeover defaults to the canonical turnaround, not a number invented here');

v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_settings(%L::uuid, 90)', v_plan));
perform pg_temp.check(v_state = '22023',
  format('10 (B): a game longer than the age grade permits is refused -- player welfare, not preference (got %s)', v_state));
perform pg_temp.check(pg_temp.try_as(v_ca, format('select public.set_tournament_plan_settings(%L::uuid, 10)', v_plan)) = 'OK',
  '11 (B): a SHORTER festival game is accepted, because a festival may play short');

-- ============ C. The round robin invariant ============

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_games := public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);

perform pg_temp.check(v_games = 6, format('12 (C): four sides in one table produce 4x3/2 = 6 games (got %s)', v_games));

select count(*) into v_n from (
  select least(side_a_id, side_b_id) a, greatest(side_a_id, side_b_id) b
  from public.tournament_games where plan_id = v_plan group by 1,2 having count(*) > 1) d;
perform pg_temp.check(v_n = 0, '13 (C): no pair appears twice -- A v B and B v A are one pairing');

select count(*) into v_n from public.tournament_games where plan_id = v_plan and side_a_id = side_b_id;
perform pg_temp.check(v_n = 0, '14 (C): no side plays itself');

select count(*) into v_n from (
  select round_number, s from (
    select round_number, side_a_id s from public.tournament_games where plan_id = v_plan
    union all select round_number, side_b_id from public.tournament_games where plan_id = v_plan) x
  group by round_number, s having count(*) > 1) y;
perform pg_temp.check(v_n = 0, '15 (C): and no side is drawn twice in one round');

perform pg_temp.check(
  (select count(*) from public.tournament_games g
   join public.tournament_participants a on a.id = g.side_a_id
   join public.tournament_participants b on b.id = g.side_b_id
   where g.plan_id = v_plan and a.club_id = b.club_id) = 1,
  '16 (C): the two sides from ONE club do meet -- same-club pairing is not prevented, because a club may bring an A and a B');

perform pg_temp.check(
  (select count(*) from public.tournament_games g
   join public.tournament_participants a on a.id = g.side_a_id
   where g.plan_id = v_plan and a.status = 'external_recorded') > 0
  or (select count(*) from public.tournament_games g
      join public.tournament_participants b on b.id = g.side_b_id
      where g.plan_id = v_plan and b.status = 'external_recorded') > 0,
  '17 (C): a club that is not on Ovalball is scheduled like any other side');

perform pg_temp.check((select count(*) from public.tournament_games where plan_id = v_plan and age_group <> 'U12') = 0,
  '18 (C): every generated game belongs to the competition that generated it');

-- VISITOR v VISITOR, and HOST v HOST where two host sides exist.
perform pg_temp.check(
  (select count(*) from public.tournament_games g
   join public.tournament_participants a on a.id = g.side_a_id
   join public.tournament_participants b on b.id = g.side_b_id
   where g.plan_id = v_plan
     and a.club_id is distinct from (select host_club_id from public.tournaments where id = v_t)
     and b.club_id is distinct from (select host_club_id from public.tournaments where id = v_t)) > 0,
  '19 (C): visitor-v-visitor games are generated -- the host is not one half of every game');

-- ============ D. Odd tables, uneven tables, and no phantom side ============

select array_agg(s.participant_id order by s.position) into v_sides
from public.tournament_plan_table_sides s where s.plan_id = v_plan;

-- THREE SIDES IN ONE TABLE AND ONE IN ANOTHER is refused: a side with nobody to play is not a plan.
v_tables := jsonb_build_array(
  jsonb_build_object('name','Table A','sides', to_jsonb(v_sides[1:3])),
  jsonb_build_object('name','Table B','sides', to_jsonb(v_sides[4:4])));
v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', v_plan, v_tables));
perform pg_temp.check(v_state = 'OK',
  '20 (D): the database accepts a one-side table (the client warns; the server does not invent a rule)');

-- GENERATING IT IS REFUSED (Tournament Planning parity programme, 20270720). This used to produce
-- 3 + 0 = 3 games and leave the lone side with none -- which is test 23's own case, "entered and
-- unscheduled is nobody's intention", reached by another route, and the planner already refused to offer
-- Generate for it ("Table B needs at least 2 teams"). Server and client now give the same answer.
v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L::uuid)', v_plan));
perform pg_temp.check(v_state = '22023',
  format('21 (D): a table of one cannot be generated -- a side with nobody to play is refused, as the planner says (got %s)', v_state));

select count(*) into v_n from public.tournament_participants where tournament_id = v_t;
perform pg_temp.check(v_n = 5,
  format('22 (D): and generating created NO new participants -- there is no side called "Bye" (%s)', v_n));

-- A side left out of every table is refused outright.
v_tables := jsonb_build_array(jsonb_build_object('name','Table A','sides', to_jsonb(v_sides[1:2])));
v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', v_plan, v_tables));
perform pg_temp.check(v_state = '22023',
  format('23 (D): a side left out of every table is refused -- entered and unscheduled is nobody''s intention (got %s)', v_state));

-- A side at two tables is refused.
v_tables := jsonb_build_array(
  jsonb_build_object('name','Table A','sides', to_jsonb(v_sides[1:2])),
  jsonb_build_object('name','Table B','sides', to_jsonb(array[v_sides[1], v_sides[3], v_sides[4]])));
v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', v_plan, v_tables));
perform pg_temp.check(v_state = '22023', format('24 (D): a side at two tables is refused (got %s)', v_state));

-- ============ E. Days belong to the tournament ============

v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_days(%L::uuid, array[%L::date])', v_plan, current_date + 90));
perform pg_temp.check(v_state = '22023',
  format('25 (E): a competition cannot play on a day the tournament does not run (got %s)', v_state));

perform pg_temp.check(
  pg_temp.try_as(v_ca, format('select public.set_tournament_plan_days(%L::uuid, array[%L::date])', v_plan, current_date + 21)) = 'OK',
  '26 (E): but it may use only some of them');
perform pg_temp.check((select count(*) from public.tournament_plan_days where plan_id = v_plan) = 1,
  '27 (E): and the selection replaces, rather than adding to, the days');
perform pg_temp.check((select ends_on from public.tournaments where id = v_t) = current_date + 21,
  '28 (E): choosing fewer days NEVER changes what the tournament itself is');

-- ============ F. A side belongs to its own competition ============

v_tables := jsonb_build_array(jsonb_build_object('name','Table A','sides',
  to_jsonb(array[(select id from public.tournament_participants where tournament_id = v_t and age_group = 'U16' limit 1)])));
v_state := pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', v_plan, v_tables));
perform pg_temp.check(v_state = '22023',
  format('29 (F): a U16 side cannot be placed in the U12 competition''s tables (got %s)', v_state));

-- ============ G. A DRAFT REACHES NOBODY ============

-- Put the four sides back in one table and generate a full draft.
v_tables := jsonb_build_array(jsonb_build_object('name','Table A','sides', to_jsonb(v_sides)));
perform pg_temp.try_as(v_ca, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', v_plan, v_tables));
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_games := public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);
perform pg_temp.check(v_games = 6, '30 (G): the draft holds six games');

select jsonb_array_length((select c->'games' from jsonb_array_elements(
  (pg_temp.centre_as(v_parent, v_t))->'contexts') c where c->>'ageGroup' = 'U12')) into v_n;
perform pg_temp.check(v_n = 0,
  format('31 (G): and a GUARDIAN reading the Tournament Agenda sees NONE of them (%s)', v_n));

update public.tournament_plans set publication_state = 'PUBLISHED', published_by = v_ca, published_at = now()
where id = v_plan;

select jsonb_array_length((select c->'games' from jsonb_array_elements(
  (pg_temp.centre_as(v_parent, v_t))->'contexts') c where c->>'ageGroup' = 'U12')) into v_n;
perform pg_temp.check(v_n = 6,
  format('32 (G): once PUBLISHED, the same Agenda surface shows all six (%s)', v_n));

-- ============ H. Authority ============

perform pg_temp.check(pg_temp.try_as(v_guest_co, format('select public.generate_tournament_plan_fixtures(%L::uuid)', v_plan)) = '42501',
  '33 (H): a participating club''s coach cannot generate fixtures for the host''s tournament');
perform pg_temp.check(pg_temp.try_as(v_parent, format('select public.set_tournament_plan_tables(%L::uuid, %L::jsonb)', v_plan, v_tables)) = '42501',
  '34 (H): nor can a parent arrange the tables');
perform pg_temp.check(pg_temp.try_as(v_guest_co, format('select public.get_tournament_plan(%L::uuid, ''U12'')', v_t)) = '42501',
  '35 (H): and planning state is not even readable by a participant');

-- A participant cannot write planning rows directly either: there is no write policy at all.
perform pg_temp.check(
  (select count(*) from pg_policies where tablename like 'tournament_plan%' and cmd <> 'SELECT'
     and policyname not like '%session_ok%') = 0,
  '36 (H): no planning table has an INSERT, UPDATE or DELETE policy -- the governed functions are the only way in');

-- ============ I. One attendance answer, whatever the plan does ============

perform pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_child));
select count(*) into v_n from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child;
perform pg_temp.check(v_n = 1,
  '37 (I): a published six-game plan still means ONE attendance answer for the tournament, not one per game');

-- ============ J. A GENERATED DRAFT IS SOMETHING YOU CAN READ ============
--
-- The plan is PUBLISHED by this point (section G), so these assertions exercise the draft read model
-- and the scheduler over a real competition rather than a second fixture built for the purpose.

-- ---- the scheduler places games inside the playing day, never past midnight ----

-- Reserve one pitch for the first day, for half an hour -- room for ONE kick-off time, and a round
-- robin of four sides needs three.
insert into public.tournament_pitches (tournament_id, pitch_id, reserved_on, start_time, end_time, created_by)
values (v_t, v_pitch, (select min(day_date) from public.tournament_plan_days where plan_id = v_plan),
        '09:30', '10:00', v_ca);

-- Six games will not fit a single pitch in two and a half hours, and that refusal is the correct
-- answer: the scheduler used to manufacture capacity by wrapping past midnight.
v_state := pg_temp.try_as(v_ca, format('select public.generate_tournament_plan_fixtures(%L::uuid)', v_plan));
perform pg_temp.check(v_state = '22023',
  format('38 (J): three rounds need three kick-off times and half an hour gives one, so generation refuses rather than inventing room (%s)', v_state));

-- Widen the reservation to the whole day and it fits.
update public.tournament_pitches set end_time = '17:00' where tournament_id = v_t;
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_games := public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);
perform pg_temp.check(v_games = 6, format('39 (J): with the pitch reserved all day, six games generate (%s)', v_games));

select count(*) into v_n from public.tournament_games
where plan_id = v_plan and (start_time < time '09:30' or start_time + make_interval(mins => duration_minutes) > time '17:00');
perform pg_temp.check(v_n = 0,
  format('40 (J): EVERY game starts inside the reserved window -- no kick-off wrapped past midnight (%s outside)', v_n));

select count(*) into v_n from public.tournament_games where plan_id = v_plan and start_time is null;
perform pg_temp.check(v_n = 0, format('41 (J): and every game has a time (%s without one)', v_n));

-- A PITCH TAKES WHAT IT TAKES (20270736). Several games share a kick-off on DIFFERENT pitches, and a
-- pitch the club splits into halves or quarters takes one game per area; but a pitch laid out as one
-- whole pitch takes one game at a time. This suite's pitch is a whole pitch, so a hand-made game already
-- on it must not block generation -- the games are placed around it -- and nothing may be placed on top
-- of it. (Until 20270736 this pinned the opposite: games stacked on one whole pitch at one time.)
-- A SECOND U16 SIDE, so the blocking game is a real game between two different teams.
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_guest, v_guest, null, 'U16', 'added');

insert into public.tournament_games (tournament_id, age_group, side_a_id, side_b_id, game_date,
                                     start_time, duration_minutes, pitch_id, status, sort_order)
select v_t, 'U16', (array_agg(tp.id order by tp.id))[1], (array_agg(tp.id order by tp.id))[2],
       (select min(day_date) from public.tournament_plan_days where plan_id = v_plan),
       '09:30', 240, v_pitch, 'SCHEDULED', 999
from public.tournament_participants tp
where tp.tournament_id = v_t and tp.age_group = 'U16';

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_games := public.generate_tournament_plan_fixtures(v_plan);
perform set_config('role', 'none', true);
select count(*) into v_n from public.tournament_games where plan_id = v_plan and start_time is not null;
perform pg_temp.check(v_games = 6 and v_n = 0,
  format('42 (J): a whole pitch taken for the whole playing day does NOT stop generation -- the six pairings exist -- and none is put on top of the game already there (%s generated, %s timed)', v_games, v_n));
perform pg_temp.check(exists (select 1 from jsonb_array_elements(internal.tournament_plan_readiness(v_plan) -> 'blockers') b
                              where b ->> 'code' = 'UNSCHEDULED'),
  '42a (J): and readiness says they still need kick-off times, so nothing is published without them');

-- Free the pitch from 10:30 and schedule again: the games are placed around the game already there.
update public.tournament_games set duration_minutes = 60 where sort_order = 999 and tournament_id = v_t;
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform set_config('role', 'authenticated', true);
perform public.schedule_tournament_plan(v_plan);
perform set_config('role', 'none', true);
select count(*) into v_n from public.tournament_games where plan_id = v_plan and start_time is not null;
perform pg_temp.check(v_n = 6,
  format('42b (J): with the pitch free from 10:30, scheduling places all six around the game already on it (%s timed)', v_n));

select count(*) into v_n
from public.tournament_games a join public.tournament_games b
  on b.tournament_id = a.tournament_id and b.id <> a.id and b.game_date = a.game_date
 and b.pitch_id = a.pitch_id
 and a.start_time < b.start_time + make_interval(mins => b.duration_minutes)
 and b.start_time < a.start_time + make_interval(mins => a.duration_minutes)
where a.plan_id = v_plan;
perform pg_temp.check(v_n = 0 and (select lane_count from public.club_pitches where id = v_pitch) = 1,
  format('42c (J): and none is placed on top of another on that whole pitch (%s overlapping pairs)', v_n));
perform pg_temp.check(not exists (select 1 from internal.tournament_schedule_conflicts(v_t)),
  '42d (J): and the one clash engine finds nothing to report in what the scheduler made');

delete from public.tournament_games where sort_order = 999 and tournament_id = v_t;

select count(*) into v_n
from public.tournament_games a join public.tournament_games b
  on b.tournament_id = a.tournament_id and b.id <> a.id and b.game_date = a.game_date
 and (b.side_a_id in (a.side_a_id, a.side_b_id) or b.side_b_id in (a.side_a_id, a.side_b_id))
 and a.start_time < b.start_time + make_interval(mins => b.duration_minutes)
 and b.start_time < a.start_time + make_interval(mins => a.duration_minutes)
where a.plan_id = v_plan;
perform pg_temp.check(v_n = 0, format('43 (J): and no side is in two places at once (%s overlapping pairs)', v_n));

-- ---- the draft read model returns the real games, grouped ----

select jsonb_array_length((pg_temp.read_draft(v_ca, v_t, 'U12', false))->'tables') into v_n;
perform pg_temp.check(v_n = 1, format('44 (J): the draft is grouped into its one table (%s)', v_n));

select ((pg_temp.read_draft(v_ca, v_t, 'U12', false))->'plan'->>'gameCount')::int into v_n;
perform pg_temp.check(v_n = 6, format('45 (J): and reports the six games that exist (%s)', v_n));

select jsonb_array_length((pg_temp.read_draft(v_ca, v_t, 'U12', false))->'tables'->0->'sides') into v_n;
perform pg_temp.check(v_n = 4,
  format('46 (J): the table''s own membership comes with it, so a round''s pairings can be read (%s)', v_n));

-- Three rounds, and the games in them add back up to six: nothing is dropped by the grouping.
select jsonb_array_length((pg_temp.read_draft(v_ca, v_t, 'U12', false))->'tables'->0->'rounds') into v_n;
perform pg_temp.check(v_n = 3, format('47 (J): four sides play three rounds (%s)', v_n));

select sum(jsonb_array_length(r->'games'))::int into v_n
from jsonb_array_elements((pg_temp.read_draft(v_ca, v_t, 'U12', false))->'tables'->0->'rounds') r;
perform pg_temp.check(v_n = 6, format('48 (J): and the rounds hold every game between them (%s)', v_n));

-- A game carries both sides by identity, never a bare club name -- a club with two sides at one
-- tournament is otherwise two identical rows.
perform pg_temp.check(
  (select bool_and((g->'sideA'->>'participantId') is not null and (g->'sideB'->>'participantId') is not null
                   and (g->'sideA'->>'label') is not null and (g->'sideB'->>'label') is not null)
   from jsonb_array_elements((pg_temp.read_draft(v_ca, v_t, 'U12', false))->'tables'->0->'rounds') r,
        jsonb_array_elements(r->'games') g),
  '49 (J): every game names both sides by participant and by side label, not just by club');

-- ---- preview creates nothing ----

select count(*) into v_games from public.tournament_games where plan_id = v_plan;
perform pg_temp.check((pg_temp.read_draft(v_ca, v_t, 'U12', true))->>'preview' = 'true',
  '50 (J): a preview says it is one');
select count(*) into v_n from public.tournament_games where plan_id = v_plan;
perform pg_temp.check(v_n = v_games,
  format('51 (J): and previewing creates nothing -- %s games before, %s after', v_games, v_n));

-- ---- regeneration cost, and who may ask ----

perform pg_temp.check(
  ((pg_temp.try_json_as(v_ca, format('select public.tournament_plan_regeneration_cost(%L::uuid)', v_plan)))->>'gameCount')::int = 6,
  '52 (J): the regeneration cost names the games it would replace');

perform pg_temp.check(
  pg_temp.try_as(v_guest_co, format('select public.get_tournament_plan_draft(%L::uuid, ''U12'')', v_t)) = '42501',
  '53 (J): a participating club''s coach cannot read the host''s draft plan');
perform pg_temp.check(
  pg_temp.try_as(v_parent, format('select public.tournament_plan_regeneration_cost(%L::uuid)', v_plan)) = '42501',
  '54 (J): nor can a parent ask what regenerating would cost');

-- ============ K. THE PARTICIPANT READS THE SAME SHAPE, READ-ONLY ============
--
-- The plan is PUBLISHED by section G, so these assert what a guardian actually gets back.

perform pg_temp.check(
  (select bool_and((g->>'tableName') is not null and (g->>'round') is not null)
   from jsonb_array_elements((pg_temp.centre_as(v_parent, v_t))->'contexts') c,
        jsonb_array_elements(c->'games') g
   where c->>'ageGroup' = 'U12'),
  '55 (K): every published game tells a participant its TABLE and its ROUND, not just a kick-off');

select jsonb_array_length((select c->'competitionDays' from jsonb_array_elements(
  (pg_temp.centre_as(v_parent, v_t))->'contexts') c where c->>'ageGroup' = 'U12')) into v_n;
perform pg_temp.check(v_n = 1,
  format('56 (K): and the days THIS COMPETITION plays -- one of the tournament''s two, because section E deselected the other (%s)', v_n));

-- A day the competition does not play is not one of its days, however long the tournament runs.
perform pg_temp.check(
  not exists (
    select 1 from jsonb_array_elements((pg_temp.centre_as(v_parent, v_t))->'contexts') c,
         jsonb_array_elements_text(c->'competitionDays') d
    where c->>'ageGroup' = 'U12'
      and d::date not in (select day_date from public.tournament_plan_days where plan_id = v_plan)),
  '57 (K): every day it reports is one the plan actually selected');

-- AND THE AGENDA IS A PROJECTION. There is no participant-facing write for a game: the only governed
-- tournament write a participant has is their own attendance answer.
perform pg_temp.check(
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname ~ 'tournament'
      and p.proname !~ '^get_|^preview_|_cost$'
      and has_function_privilege('authenticated', p.oid, 'EXECUTE')
      and p.proname in ('respond_to_tournament_attendance')) = 1,
  '58 (K): a participant''s only governed tournament write is their own attendance answer');

end $$;

rollback;
