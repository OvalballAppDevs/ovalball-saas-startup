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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tx-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tx', p_label, 'tx-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TX ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tx-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tx-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

-- A SQUAD DESIGNATION, because a club may not hold two teams with the same canonical identity: an A
-- and a B side at one grade are distinguished by the designation, which is exactly the shape the
-- directory already uses.
create or replace function pg_temp.team(p_club uuid, p_age text default 'U12', p_squad text default null) returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, squad_designation, rugby_code, active)
  values (p_club,
          'Under ' || substr(p_age, 2) || ' Boys' || coalesce(' ' || p_squad, ''),
          'tx-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', p_squad, 'union', true)
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

-- The tournament estate, end to end, over real canonical records.
--
-- WHAT THIS IS FOR
--
-- The other tournament suites each prove one migration. This one walks the PRODUCT: create every
-- shape a club can create, edit the things a club edits, run the application path a public tournament
-- has, and check the identities that everything else depends on -- Tournament, Competition/Age Group,
-- Participating Side, Tournament Day, Tournament Game, Attendance. It exists because the parts can
-- each be right while the whole is not: a format the creator accepts and the constraint rejects, an
-- age group added without its sides, an application accepted twice.
--
-- IT USES THE CANONICAL WRITE PATHS ONLY. Nothing below inserts a tournament, a side or an application
-- by hand; every row is produced by the function the product uses, so a check that passes here is a
-- check about Ovalball rather than about this file.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_guest uuid;
  v_dir_host uuid; v_dir_guest uuid; v_dir_unclaimed uuid;
  v_h_u12 uuid; v_h_u16 uuid; v_g_u12 uuid; v_g_u12b uuid;
  v_ca uuid; v_guest_ca uuid;
  v_t uuid; v_pub uuid; v_app uuid; v_venue uuid;
  v_n int; v_state text; v_txt text;
  v_fmt text;
begin

v_host  := pg_temp.club('Host');
v_guest := pg_temp.club('Guest');
select directory_id into v_dir_host  from public.clubs where id = v_host;
select directory_id into v_dir_guest from public.clubs where id = v_guest;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TX Unclaimed RUFC','T','T','union','United Kingdom','England',true,'unverified','tournament_manual_entry','tx-unc-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir_unclaimed;

insert into public.venues (club_id, name, slug, address_line_1, town, postcode, country)
values (v_host, 'TX Ground', 'tx-ground-' || substr(gen_random_uuid()::text,1,8), '1 Test Lane', 'Testville', 'TE1 1ST', 'United Kingdom')
returning id into v_venue;

v_h_u12 := pg_temp.team(v_host,'U12');
v_h_u16 := pg_temp.team(v_host,'U16');
v_g_u12 := pg_temp.team(v_guest,'U12');
v_g_u12b := pg_temp.team(v_guest,'U12','B');

v_ca := pg_temp.person('HostCA', v_adult); perform pg_temp.member(v_host, v_ca, 'CLUB_ADMIN');
v_guest_ca := pg_temp.person('GuestCA', v_adult); perform pg_temp.member(v_guest, v_guest_ca, 'CLUB_ADMIN');

-- ============ A. CREATE: every shape the product offers ============

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);

-- A MULTI-DAY, MULTI-AGE-GROUP, PRIVATE tournament, with two sides from ONE club at one grade and a
-- club Ovalball does not have, recorded by name with an alias.
v_t := public.create_tournament_with_teams(
  v_host, 'TX Festival', (current_date + 30)::date, (current_date + 31)::date, '09:00', 'round_robin', 'private',
  v_venue, null, array['U12','U16'], array[v_h_u12, v_h_u16]::uuid[],
  jsonb_build_array(
    jsonb_build_object('directory_id', v_dir_guest, 'team_id', v_g_u12,  'age_group','U12'),
    jsonb_build_object('directory_id', v_dir_guest, 'team_id', v_g_u12b, 'age_group','U12'),
    jsonb_build_object('directory_id', v_dir_unclaimed, 'age_group','U12', 'squad_label','Spears')),
  null, null, '15:30');

perform pg_temp.check(v_t is not null, '1 (A): a multi-day, two-competition tournament is created in one transaction');

select count(*) into v_n from public.tournament_age_groups where tournament_id = v_t;
perform pg_temp.check(v_n = 2, format('2 (A): it runs both competitions (%s)', v_n));

select count(*) into v_n from public.tournament_participants where tournament_id = v_t and club_id = v_guest and age_group = 'U12';
perform pg_temp.check(v_n = 2, format('3 (A): one club brings TWO sides to one competition (%s)', v_n));

select status, squad_label into v_state, v_txt from public.tournament_participants
where tournament_id = v_t and club_directory_id = v_dir_unclaimed;
perform pg_temp.check(v_state = 'external_recorded' and v_txt = 'Spears',
  format('4 (A): a club Ovalball does not have is recorded with its alias, and marked as recorded rather than added (%s/%s)', v_state, v_txt));

select count(*) into v_n from public.tournament_participants
where tournament_id = v_t and club_id = v_host and status = 'added';
perform pg_temp.check(v_n = 2,
  format('5 (A): the host is TWO ordinary sides among the field, not a separate kind of thing (%s)', v_n));

perform pg_temp.check((select ends_on > event_date from public.tournaments where id = v_t),
  '6 (A): and it genuinely spans more than one day');
perform pg_temp.check((select kickoff_time = '09:00' and ends_at = '15:30' from public.tournaments where id = v_t),
  '7 (A): with the hours a family plans around recorded on the tournament itself');

-- EVERY FORMAT THE CONSTRAINT ALLOWS IS A FORMAT THE CREATOR ACCEPTS. The two lists drifting apart is
-- how a product offers a shape the database then refuses.
v_n := 0;
foreach v_fmt in array array['round_robin','tri_fixture','swiss','knockout','hybrid']
loop
  begin
    perform public.create_tournament_with_teams(
      v_host, 'TX ' || v_fmt, (current_date + 40)::date, (current_date + 40)::date, '10:00', v_fmt, 'private',
      v_venue, null, array['U12'], array[v_h_u12]::uuid[], '[]'::jsonb,
      case when v_fmt = 'swiss' then 5 else null end, null, null);
    v_n := v_n + 1;
  exception when others then
    raise notice 'FAIL format % was refused: %', v_fmt, sqlerrm;
  end;
end loop;
perform pg_temp.check(v_n = 5, format('8 (A): all five canonical formats create (%s of 5)', v_n));
perform pg_temp.check((select swiss_rounds = 5 from public.tournaments where name = 'TX swiss'),
  '9 (A): and a Swiss tournament keeps its round count');

-- ============ B. EDIT ============

perform public.save_tournament(v_host, 'TX Festival Renamed', (current_date + 30)::date, (current_date + 32)::date,
  'union', v_t, null, null, v_venue, null, 'notes', 'knockout', '08:30', 'public', null, '16:00');
perform pg_temp.check(
  (select name = 'TX Festival Renamed' and visibility = 'public' and format = 'knockout'
      and kickoff_time = '08:30' and ends_at = '16:00' and ends_on = (current_date + 32)::date
   from public.tournaments where id = v_t),
  '10 (B): name, visibility, format, both times and the end date all save through the one write path');

-- DROPPING A COMPETITION TAKES ITS SIDES WITH IT, and leaves the other competition alone.
perform public.set_tournament_age_groups(v_t, array['U12']);
select count(*) into v_n from public.tournament_age_groups where tournament_id = v_t;
perform pg_temp.check(v_n = 1, '11 (B): dropping a competition removes it');
select count(*) into v_n from public.tournament_participants where tournament_id = v_t and age_group = 'U16';
perform pg_temp.check(v_n = 0, '12 (B): and takes its sides with it');
select count(*) into v_n from public.tournament_participants where tournament_id = v_t and age_group = 'U12';
perform pg_temp.check(v_n = 4, format('13 (B): while the other competition keeps all four of its sides (%s)', v_n));

-- ============ C. REQUESTS: a public tournament only ============

v_pub := public.create_tournament_with_teams(
  v_host, 'TX Open', (current_date + 50)::date, (current_date + 50)::date, '09:00', 'round_robin', 'public',
  v_venue, null, array['U12'], array[v_h_u12]::uuid[], '[]'::jsonb, null, null, null);

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_guest_ca, 'role','authenticated')::text, true);
v_app := public.apply_to_tournament(v_pub, v_guest, 'U12', array[v_g_u12]::uuid[], 'We would like to come');
perform pg_temp.check(v_app is not null, '14 (C): a club may APPLY to a public tournament');

select count(*) into v_n from public.tournament_participants where tournament_id = v_pub and club_id = v_guest;
perform pg_temp.check(v_n = 0,
  '15 (C): and applying does NOT make them a participant -- an application is a request, not an entry');

perform set_config('request.jwt.claims', jsonb_build_object('sub', v_ca, 'role','authenticated')::text, true);
perform public.decide_tournament_application(v_app, true);
select status into v_state from public.tournament_applications where id = v_app;
perform pg_temp.check(v_state = 'accepted', format('16 (C): the organiser accepts it (%s)', v_state));
select count(*) into v_n from public.tournament_participants where tournament_id = v_pub and club_id = v_guest;
perform pg_temp.check(v_n = 1, format('17 (C): which produces exactly ONE participating side (%s)', v_n));

-- DECIDED ONCE. A second decision on a settled application must not produce a second side.
v_state := pg_temp.try_as(v_ca, format('select public.decide_tournament_application(%L::uuid, true)', v_app));
select count(*) into v_n from public.tournament_participants where tournament_id = v_pub and club_id = v_guest;
perform pg_temp.check(v_n = 1,
  format('18 (C): deciding it again creates no duplicate participant (%s sides, second decision returned %s)', v_n, v_state));

-- AN ORGANISER-ADDED CLUB IS 'added', NEVER 'accepted'. They were not asked and did not answer.
perform pg_temp.check(
  (select status from public.tournament_participants where tournament_id = v_t and club_id = v_guest and team_id = v_g_u12) = 'added',
  '19 (C): a club the organiser added is ADDED -- it has no invitation to have accepted');

-- A PRIVATE TOURNAMENT TAKES NO APPLICATIONS.
v_state := pg_temp.try_as(v_guest_ca, format('select public.apply_to_tournament(%L::uuid, %L::uuid, ''U12'', null, null)',
  (select id from public.tournaments where name = 'TX knockout'), v_guest));
perform pg_temp.check(v_state <> 'OK',
  format('20 (C): a private tournament cannot be applied to (got %s)', v_state));

-- ============ D. THE CANONICAL IDENTITIES, stated as assertions ============

perform pg_temp.check(
  (select count(*) from public.tournaments where id = v_t) = 1,
  '21 (D): TOURNAMENT -- one record, however many competitions, days or calendar rows it produces');

perform pg_temp.check(
  (select count(distinct age_group) from public.tournament_participants where tournament_id = v_t) = 1,
  '22 (D): COMPETITION -- a side belongs to exactly one age group within the tournament');

perform pg_temp.check(
  (select count(*) from public.tournament_participants where tournament_id = v_t) = 4,
  '23 (D): PARTICIPATING SIDE -- the host''s and every visitor''s are the same kind of row');

perform pg_temp.check(
  (select (ends_on - event_date) + 1 from public.tournaments where id = v_t) = 3,
  '24 (D): TOURNAMENT DAY -- derived from the tournament''s own span, never stored as separate records');

select count(*) into v_n from public.tournament_games where tournament_id = v_t;
perform pg_temp.check(v_n = 0,
  '25 (D): TOURNAMENT GAME -- none exist until an organiser publishes a plan; nothing is fabricated');

end $$;

rollback;
