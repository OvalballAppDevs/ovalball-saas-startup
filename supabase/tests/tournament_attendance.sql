-- A tournament asks "are you coming?" exactly the way everything else does.
--
-- WHAT IS BEING PROTECTED
--
-- Ovalball has ONE attendance record (`player_fixture_attendance`) and ONE authority for answering it
-- (`internal.resolve_attendance_response_source`). Migration 20270607 made a tournament the fourth
-- kind of activity that can be asked about, alongside a fixture, a training session and a club event.
-- The risk in a change like that is not that it fails to work -- it is that it works by quietly
-- growing a second rule: a tournament-only override, a staff answer "on behalf of" a family, a second
-- row per day, or a host organiser who can read another club's roster because they are running the
-- event. Each of those is asserted against here.
--
-- THE FOUR THINGS THIS SUITE PINS
--
--   1. ONE TOURNAMENT, ONE ANSWER -- including a tournament that runs for three days.
--   2. NO STAFF OVERRIDE -- a coach cannot answer for a child, as is already true everywhere else.
--      The age rules are the shared ones: under 16 never, 16-17 only with recorded guardian consent.
--   3. THE PLAYER MUST ACTUALLY BE GOING -- entry is by team, so a child whose age group is not
--      entered is refused rather than silently recorded.
--   4. A NAMED RESPONSE IS NOT SHARED WITH THE OTHER CLUBS. A tournament has many clubs in it. The
--      host needs NUMBERS and has no business reading another club's roster, so the row-level policy
--      is scoped to the side the player is entered with -- proved by a coach at a club that is in the
--      SAME tournament and still sees nothing.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'ta-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Ta', p_label, 'ta-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TA ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'ta-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'ta-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'ta-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true)
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
-- p_dispensed: a player deliberately placed outside the team's age grade gets the approved dispensation
-- that place needs, recorded before the place is made.
create or replace function pg_temp.player(p_team uuid, p_label text, p_dob date, p_user uuid default null, p_dispensed boolean default false) returns uuid language plpgsql as $$
declare v uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, user_id, playing_pathway)
  values ('Ta', p_label, p_dob, p_user, 'MALE') returning id into v;
  if p_dispensed then
    insert into public.player_team_dispensation (player_id, target_team_id, season_id, eligibility_rule_reference, status, governing_body_reference)
    values (v, p_team, internal.resolve_season_for_date('union', current_date), 'Suite fixture', 'approved', 'SUITE-FIXTURE');
  end if;
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

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_club_a uuid; v_club_b uuid;
  v_dir_a uuid; v_dir_b uuid;
  v_a_u12 uuid; v_a_u14 uuid; v_b_u12 uuid;
  v_a_coach uuid; v_mem_a_coach uuid;
  v_b_coach uuid; v_mem_b_coach uuid;
  v_parent uuid; v_child uuid;
  v_not_going_parent uuid; v_not_going_child uuid;
  v_adult_player_user uuid; v_adult_player uuid;
  v_teen_user uuid; v_teen uuid; v_teen_parent uuid;
  v_young_user uuid; v_young uuid;
  v_stranger uuid;
  v_a_admin uuid;
  v_t uuid; v_multi uuid; v_cancelled uuid;
  v_sa uuid; v_sb uuid;
  v_n int; v_state text; v_status text;
  v_names text; v_msg text; v_raised boolean;
begin

v_club_a := pg_temp.club('Alpha');
v_club_b := pg_temp.club('Bravo');
select directory_id into v_dir_a from public.clubs where id = v_club_a;
select directory_id into v_dir_b from public.clubs where id = v_club_b;

v_a_u12 := pg_temp.team(v_club_a, 'U12');
v_a_u14 := pg_temp.team(v_club_a, 'U14');
v_b_u12 := pg_temp.team(v_club_b, 'U12');

v_a_coach := pg_temp.person('AlphaCoach', v_adult); v_mem_a_coach := pg_temp.member(v_club_a, v_a_coach, 'BASIC_USER');
perform pg_temp.team_role(v_mem_a_coach, v_a_u12, 'COACH');
v_b_coach := pg_temp.person('BravoCoach', v_adult); v_mem_b_coach := pg_temp.member(v_club_b, v_b_coach, 'BASIC_USER');
perform pg_temp.team_role(v_mem_b_coach, v_b_u12, 'COACH');

v_parent := pg_temp.person('Parent', v_adult);
v_child := pg_temp.player(v_a_u12, 'Child', internal.date_of_birth_in_age_grade('union', 'U12'));
perform pg_temp.guardian_of(v_child, v_parent);

-- A child at the SAME CLUB whose age group is not entered.
v_not_going_parent := pg_temp.person('U14Parent', v_adult);
v_not_going_child := pg_temp.player(v_a_u14, 'U14Child', internal.date_of_birth_in_age_grade('union', 'U14'));
perform pg_temp.guardian_of(v_not_going_child, v_not_going_parent);

-- An adult player: answers for themselves, no guardian anywhere.
v_adult_player_user := pg_temp.person('AdultPlayer', v_adult);
v_adult_player := pg_temp.player(v_a_u12, 'AdultPlayer', v_adult, v_adult_player_user, true);

-- A 16 year old with a guardian: consent decides, and it has not been given yet.
v_teen_user := pg_temp.person('Teen', (current_date - interval '16 years')::date);
v_teen := pg_temp.player(v_a_u12, 'Teen', (current_date - interval '16 years')::date, v_teen_user, true);
v_teen_parent := pg_temp.person('TeenParent', v_adult);
perform pg_temp.guardian_of(v_teen, v_teen_parent);

-- A 12 year old who is their own user: never answers for themselves.
v_young_user := pg_temp.person('Young', (current_date - interval '12 years')::date);
v_young := pg_temp.player(v_a_u12, 'Young', internal.date_of_birth_in_age_grade('union', 'U12'), v_young_user);
perform pg_temp.guardian_of(v_young, v_parent);

v_stranger := pg_temp.person('Stranger', v_adult);

-- THE HOST'S OWN ORGANISER, deliberately not a coach of either team entered: club-wide
-- tournament.tournament.manage at Alpha, and nothing team-scoped at all.
v_a_admin := pg_temp.person('AlphaAdmin', v_adult);
perform pg_temp.member(v_club_a, v_a_admin, 'CLUB_ADMIN');

-- A private one-day festival hosted by Alpha, with Bravo in it too: both clubs are legitimately in
-- the same tournament, which is what makes the privacy assertions meaningful.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility)
values (v_club_a, v_dir_a, 'union', current_date + 14, current_date + 14, 'confirmed', 'TA Festival',
        gen_random_uuid(), 'round_robin', 'private')
returning id into v_t;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_t, 'U12');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_t, v_dir_a, v_club_a, v_a_u12, 'U12', 'added'),
       (v_t, v_dir_b, v_club_b, v_b_u12, 'U12', 'added');
select id into v_sa from public.tournament_participants where tournament_id = v_t and team_id = v_a_u12;
select id into v_sb from public.tournament_participants where tournament_id = v_t and team_id = v_b_u12;

-- ============ A. The record itself ============

select count(*) into v_n from information_schema.columns
where table_name = 'player_fixture_attendance' and column_name = 'tournament_id';
perform pg_temp.check(v_n = 1,
  '1 (A): a tournament is a column on the ONE attendance record, not a table of its own');

perform pg_temp.check(
  (select pg_get_constraintdef(oid) from pg_constraint
   where conrelid = 'public.player_fixture_attendance'::regclass
     and conname = 'player_fixture_attendance_activity_check')
  like '%num_nonnulls(fixture_id, training_session_id, tournament_id) = 1%',
  '2 (A): and exactly ONE kind of activity may be set -- a response answers one thing');

select count(*) into v_n from public.player_fixture_attendance;
begin
  insert into public.player_fixture_attendance (tournament_id, fixture_id, player_id, status, responded_by_user_id, response_source)
  values (v_t, gen_random_uuid(), v_child, 'ATTENDING', v_parent, 'guardian');
  perform pg_temp.check(false, '3 (A): a row naming BOTH a tournament and a fixture is refused');
exception when others then
  perform pg_temp.check(true, '3 (A): a row naming BOTH a tournament and a fixture is refused by the database');
end;

-- ============ B. Who may answer ============

v_state := pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_child));
perform pg_temp.check(v_state = 'OK', format('4 (B): an active guardian answers for their child (got %s)', v_state));

select status, response_source into v_status, v_state from public.player_fixture_attendance
where tournament_id = v_t and player_id = v_child;
perform pg_temp.check(v_status = 'ATTENDING' and v_state = 'guardian',
  '5 (B): and it is recorded as ATTENDING, sourced ''guardian''');

v_state := pg_temp.try_as(v_adult_player_user, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''CANNOT_ATTEND'')', v_t, v_adult_player));
perform pg_temp.check(v_state = 'OK', format('6 (B): an adult player answers for themselves (got %s)', v_state));

v_state := pg_temp.try_as(v_young_user, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_young));
perform pg_temp.check(v_state = '42501',
  format('7 (B): a 12 year old cannot answer for themselves, even though the account is theirs (got %s)', v_state));

v_state := pg_temp.try_as(v_teen_user, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_teen));
perform pg_temp.check(v_state = '42501',
  format('8 (B): a 16 year old cannot answer for themselves without recorded guardian consent (got %s)', v_state));

insert into public.guardian_player_permissions (player_id, guardian_user_id, permission_key, granted, actor)
values (v_teen, v_teen_parent, 'approve_own_attendance', true, v_teen_parent);
v_state := pg_temp.try_as(v_teen_user, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_teen));
perform pg_temp.check(v_state = 'OK',
  format('9 (B): once consent is recorded, the same 16 year old can (got %s)', v_state));

-- ============ C. NO STAFF OVERRIDE ============
--
-- The single most important assertion in this suite. A coach of the very team the child plays for,
-- who can legitimately READ the attendance list, still cannot answer on the child's behalf.

v_state := pg_temp.try_as(v_a_coach, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_child));
perform pg_temp.check(v_state = '42501',
  format('10 (C): the child''s OWN coach cannot answer for them -- there is no staff override (got %s)', v_state));

v_state := pg_temp.try_as(v_stranger, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_child));
perform pg_temp.check(v_state = '42501', format('11 (C): nor can a stranger (got %s)', v_state));

perform pg_temp.check(
  position('staff' in (select pg_get_functiondef(oid) from pg_proc where proname = 'respond_to_tournament_attendance')) = 0,
  '12 (C): and the function contains no ''staff'' response source at all -- the override does not exist to be reached');

-- ============ D. The player must actually be going ============

v_state := pg_temp.try_as(v_not_going_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_t, v_not_going_child));
perform pg_temp.check(v_state = '42501',
  format('13 (D): a guardian at the HOST CLUB cannot answer for a child whose age group is not entered (got %s)', v_state));

v_state := pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''MAYBE'')', v_t, v_child));
perform pg_temp.check(v_state = '22023', format('14 (D): an unknown response word is refused (got %s)', v_state));

insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility)
values (v_club_a, v_dir_a, 'union', current_date + 20, current_date + 20, 'cancelled', 'TA Cancelled',
        gen_random_uuid(), 'round_robin', 'private')
returning id into v_cancelled;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_cancelled, 'U12');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_cancelled, v_dir_a, v_club_a, v_a_u12, 'U12', 'added');
v_state := pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_cancelled, v_child));
perform pg_temp.check(v_state = '22023',
  format('15 (D): a cancelled tournament asks nobody anything (got %s)', v_state));

-- ============ E. ONE TOURNAMENT, ONE ANSWER ============

v_state := pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''CANNOT_ATTEND'')', v_t, v_child));
select count(*) into v_n from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child;
select status into v_status from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child;
perform pg_temp.check(v_n = 1 and v_status = 'CANNOT_ATTEND',
  format('16 (E): changing the answer REPLACES it -- one row, now %s', v_status));

-- A THREE-DAY tournament still asks once. A club takes one squad away for the weekend; per-day
-- availability is a different question, deliberately not invented here.
insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                conversation_id, format, visibility)
values (v_club_a, v_dir_a, 'union', current_date + 30, current_date + 32, 'confirmed', 'TA Three Day',
        gen_random_uuid(), 'round_robin', 'private')
returning id into v_multi;
insert into public.tournament_age_groups (tournament_id, age_group) values (v_multi, 'U12');
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
values (v_multi, v_dir_a, v_club_a, v_a_u12, 'U12', 'added');

v_state := pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid, %L::uuid, ''ATTENDING'')', v_multi, v_child));
select count(*) into v_n from public.player_fixture_attendance where tournament_id = v_multi and player_id = v_child;
perform pg_temp.check(v_state = 'OK' and v_n = 1,
  '17 (E): a tournament running three days takes ONE answer, not three');

select count(*) into v_n from public.player_fixture_attendance where player_id = v_child and tournament_id in (v_t, v_multi);
perform pg_temp.check(v_n = 2,
  '18 (E): and the two different tournaments keep their own answers');

-- ============ F. A named response is not shared with the other clubs ============
--
-- Alpha and Bravo are in the SAME tournament. Bravo's coach can see the tournament -- that is correct
-- and was the point of 20270606 -- and must still not be able to read Alpha's roster.

-- Three, not four. The U12 side has four players, but the 12 year old's attempt to answer for
-- themselves was refused at assertion 7, so no row was ever written for them -- a refusal leaves
-- silence rather than an UNSURE. The coach reads every response that exists and no more.
select count(*) into v_n from public.player_fixture_attendance where tournament_id = v_t;
perform pg_temp.check(v_n = 3 and pg_temp.rows_visible(v_a_coach, v_t) = 3,
  format('19 (F): the entered side''s OWN coach reads every response recorded for it (%s of %s)',
         pg_temp.rows_visible(v_a_coach, v_t), v_n));

perform pg_temp.check(pg_temp.rows_visible(v_b_coach, v_t) = 0,
  format('20 (F): a coach at ANOTHER CLUB IN THE SAME TOURNAMENT reads none of them (read %s)',
         pg_temp.rows_visible(v_b_coach, v_t)));

perform pg_temp.check(pg_temp.rows_visible(v_parent, v_t) = 1,
  format('21 (F): a parent reads their own child''s response and nobody else''s (read %s)',
         pg_temp.rows_visible(v_parent, v_t)));

perform pg_temp.check(pg_temp.rows_visible(v_stranger, v_t) = 0,
  '22 (F): a signed-in stranger reads none');

perform pg_temp.check(pg_temp.rows_visible(v_not_going_parent, v_t) = 0,
  '23 (F): and a parent at the host club whose child is not going reads none');

-- ============ G. Nobody writes a response by hand ============
--
-- The RPC is the only way in: the table carries no INSERT or UPDATE policy for a tournament response,
-- so a parent cannot write a row for somebody else's child by going around it.

v_state := pg_temp.try_as(v_parent, format(
  'insert into public.player_fixture_attendance (tournament_id, player_id, status, responded_by_user_id, response_source) values (%L::uuid, %L::uuid, ''ATTENDING'', %L::uuid, ''guardian'')',
  v_t, v_adult_player, v_parent));
perform pg_temp.check(v_state <> 'OK',
  format('24 (G): a direct INSERT for another person''s response is refused (got %s)', v_state));

v_state := pg_temp.try_as(v_a_coach, format(
  'update public.player_fixture_attendance set status = ''ATTENDING'' where tournament_id = %L::uuid and player_id = %L::uuid', v_t, v_child));
select status into v_status from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child;
perform pg_temp.check(v_status = 'CANNOT_ATTEND',
  '25 (G): and a coach''s direct UPDATE changes nothing -- reading the list is not answering it');

-- ============ H. MY TEAM, BY NAME -- the roster read's own authority boundary ============
--
-- A genuinely different read from everything above: not whether somebody may ANSWER for a player, but
-- whether they may see a PARTICIPATING SIDE'S ROSTER BY NAME. Staff-level only, scoped to that one
-- side, and never widened by organising the tournament or being family to one player on it.

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a_coach, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
select string_agg(first_name || ' ' || surname, ', ' order by surname) into v_names
from public.get_tournament_participant_roster(v_t, v_sa);
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);
perform pg_temp.check(v_names like '%Child%' and v_names like '%AdultPlayer%',
  format('26 (H): Alpha''s own coach sees Alpha''s roster by name (%s)', v_names));

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a_coach, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_raised := false; v_msg := null;
begin
  perform public.get_tournament_participant_roster(v_t, v_sb);
exception when others then
  v_raised := true; v_msg := sqlerrm;
end;
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);
perform pg_temp.check(v_raised and v_msg like '%not authorized%', format('27 (H): Alpha''s coach cannot see Bravo''s roster by name (%s)', v_msg));

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_b_coach, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_raised := false; v_msg := null;
begin
  perform public.get_tournament_participant_roster(v_t, v_sa);
exception when others then
  v_raised := true; v_msg := sqlerrm;
end;
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);
perform pg_temp.check(v_raised and v_msg like '%not authorized%', format('28 (H): Bravo''s coach cannot see Alpha''s roster by name (%s)', v_msg));

-- THE HOST'S OWN ORGANISER does not automatically gain the away side's roster merely by running the
-- tournament -- club-wide tournament.tournament.manage at Alpha is not tournament.tournament.view at
-- Bravo, the same way a Site Admin issuing a competition does not confirm on a club's behalf.
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_a_admin, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_raised := false; v_msg := null;
begin
  perform public.get_tournament_participant_roster(v_t, v_sb);
exception when others then
  v_raised := true; v_msg := sqlerrm;
end;
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);
perform pg_temp.check(v_raised and v_msg like '%not authorized%', format('29 (H): the host organiser alone does not gain every side''s roster (%s)', v_msg));

-- A GUARDIAN WITH NO TEAM-STAFF ROLE sees only the player(s) they are canonically allowed to answer
-- for (proved throughout sections C-F above) -- never the whole roster merely for being family to one
-- player on it.
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_parent, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_raised := false; v_msg := null;
begin
  perform public.get_tournament_participant_roster(v_t, v_sa);
exception when others then
  v_raised := true; v_msg := sqlerrm;
end;
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);
perform pg_temp.check(v_raised and v_msg like '%not authorized%', format('30 (H): a guardian is not widened into the whole roster by family alone (%s)', v_msg));

-- AN UNRELATED, SIGNED-IN STRANGER gets nothing.
perform set_config('request.jwt.claims', jsonb_build_object('sub', v_stranger, 'role', 'authenticated')::text, true);
perform set_config('role', 'authenticated', true);
v_raised := false; v_msg := null;
begin
  perform public.get_tournament_participant_roster(v_t, v_sa);
exception when others then
  v_raised := true; v_msg := sqlerrm;
end;
perform set_config('role', 'none', true);
perform set_config('request.jwt.claims', '', true);
perform pg_temp.check(v_raised and v_msg like '%not authorized%', format('31 (H): a stranger reads no roster at all (%s)', v_msg));

end $$;

rollback;
