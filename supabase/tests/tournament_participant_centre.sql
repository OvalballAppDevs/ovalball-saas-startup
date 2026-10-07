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
  values (v, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'tc-' || v::text || '@ovalball.test', '',
    now(), now(), now(), '{}'::jsonb, '{}'::jsonb, '', '', '', '', '', '', '', '');
  insert into public.profiles (id, first_name, surname, email, date_of_birth)
  values (v, 'Tc', p_label, 'tc-' || v::text || '@ovalball.test', p_dob)
  on conflict (id) do update set first_name = excluded.first_name;
  return v;
end $$;

create or replace function pg_temp.club(p_label text) returns uuid language plpgsql as $$
declare v_dir uuid; v_club uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('TC ' || p_label || ' RUFC ' || v_tag, 'T', 'T', 'union', 'United Kingdom', 'England', true, 'unverified', 'site_admin_manual', 'tc-' || v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir, 'tc-' || v_tag, 'active') returning id into v_club;
  return v_club;
end $$;

create or replace function pg_temp.team(p_club uuid, p_age text default 'U12') returns uuid language plpgsql as $$
declare v uuid; v_tag text := substr(gen_random_uuid()::text, 1, 8);
begin
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (p_club, 'Under ' || substr(p_age, 2) || ' Boys', 'tc-' || lower(p_age) || '-' || v_tag, 'youth', p_age, 'boys', 'union', true)
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

do $$
declare
  v_adult date := (current_date - interval '40 years')::date;
  v_host uuid; v_guest uuid; v_other uuid;
  v_dir_host uuid; v_dir_guest uuid; v_dir_other uuid; v_dir_unclaimed uuid;
  v_h_u12 uuid; v_h_u16 uuid; v_g_u12 uuid; v_o_u12 uuid;
  v_host_ca uuid;
  v_guest_co uuid; v_mem_guest_co uuid;
  v_other_co uuid; v_mem_other_co uuid;
  v_parent uuid; v_child uuid; v_child2 uuid;
  v_stranger uuid;
  v_t uuid;
  v_r jsonb; v_ctx jsonb; v_u12 jsonb; v_row jsonb;
  v_n int; v_state text;
begin

v_host  := pg_temp.club('Host');
v_guest := pg_temp.club('Guest');
v_other := pg_temp.club('Other');
select directory_id into v_dir_host  from public.clubs where id = v_host;
select directory_id into v_dir_guest from public.clubs where id = v_guest;
select directory_id into v_dir_other from public.clubs where id = v_other;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TC Unclaimed RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tc-unc-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir_unclaimed;

v_h_u12 := pg_temp.team(v_host,'U12');
v_h_u16 := pg_temp.team(v_host,'U16');
v_g_u12 := pg_temp.team(v_guest,'U12');
v_o_u12 := pg_temp.team(v_other,'U12');

v_host_ca := pg_temp.person('HostCA', v_adult); perform pg_temp.member(v_host, v_host_ca, 'CLUB_ADMIN');
v_guest_co := pg_temp.person('GuestCO', v_adult); v_mem_guest_co := pg_temp.member(v_guest, v_guest_co, 'BASIC_USER');
perform pg_temp.team_role(v_mem_guest_co, v_g_u12, 'COACH');
v_other_co := pg_temp.person('OtherCO', v_adult); v_mem_other_co := pg_temp.member(v_other, v_other_co, 'BASIC_USER');
perform pg_temp.team_role(v_mem_other_co, v_o_u12, 'COACH');
v_stranger := pg_temp.person('Stranger', v_adult);

v_parent := pg_temp.person('Parent', v_adult);
v_child  := pg_temp.player(v_g_u12, 'Child', internal.date_of_birth_in_age_grade('union', 'U12'));
perform pg_temp.guardian_of(v_child, v_parent);
v_child2 := pg_temp.player(v_g_u12, 'Sibling', internal.date_of_birth_in_age_grade('union', 'U12'));
perform pg_temp.guardian_of(v_child2, v_parent);

-- Three more players at the OTHER club, so its breakdown is non-trivial and its leakage measurable.
declare
  v_op1 uuid; v_op2 uuid; v_op3 uuid; v_other_parent uuid;
begin
  v_other_parent := pg_temp.person('OtherParent', v_adult);
  v_op1 := pg_temp.player(v_o_u12, 'OtherA', internal.date_of_birth_in_age_grade('union', 'U12'));
  v_op2 := pg_temp.player(v_o_u12, 'OtherB', internal.date_of_birth_in_age_grade('union', 'U12'));
  v_op3 := pg_temp.player(v_o_u12, 'OtherC', internal.date_of_birth_in_age_grade('union', 'U12'));
  perform pg_temp.guardian_of(v_op1, v_other_parent);
  perform pg_temp.guardian_of(v_op2, v_other_parent);
  perform pg_temp.guardian_of(v_op3, v_other_parent);

  insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name,
                                  conversation_id, format, visibility, kickoff_time, ends_at)
  values (v_host, v_dir_host, 'union', current_date + 14, current_date + 15, 'confirmed', 'TC Festival',
          gen_random_uuid(), 'round_robin', 'private', '09:00', '14:30')
  returning id into v_t;
  insert into public.tournament_age_groups (tournament_id, age_group) values (v_t,'U12'), (v_t,'U16');
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, status)
  values (v_t, v_dir_host,  v_host,  v_h_u12, 'U12', 'added'),
         (v_t, v_dir_host,  v_host,  v_h_u16, 'U16', 'added'),
         (v_t, v_dir_guest, v_guest, v_g_u12, 'U12', 'added'),
         (v_t, v_dir_other, v_other, v_o_u12, 'U12', 'added');
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, age_group, squad_label, status)
  values (v_t, v_dir_unclaimed, null, null, 'U12', 'A', 'external_recorded');

  -- The other club answers: 3 attending... then one changes to CANNOT_ATTEND, so the breakdown differs
  -- from the headline and leakage would be visible.
  perform pg_temp.try_as(v_other_parent, format('select public.respond_to_tournament_attendance(%L::uuid,%L::uuid,''ATTENDING'')', v_t, v_op1));
  perform pg_temp.try_as(v_other_parent, format('select public.respond_to_tournament_attendance(%L::uuid,%L::uuid,''ATTENDING'')', v_t, v_op2));
  perform pg_temp.try_as(v_other_parent, format('select public.respond_to_tournament_attendance(%L::uuid,%L::uuid,''CANNOT_ATTEND'')', v_t, v_op3));
end;

perform pg_temp.try_as(v_parent, format('select public.respond_to_tournament_attendance(%L::uuid,%L::uuid,''ATTENDING'')', v_t, v_child));

-- ============ A. One tournament, one context per competition the viewer is in ============

v_r := pg_temp.centre_as(v_guest_co, v_t);
perform pg_temp.check(v_r is not null, '1 (A): the entered team''s coach reads the participant centre');
perform pg_temp.check((v_r->>'canManage')::boolean is false,
  '2 (A): and is told they do not manage it, so the client never sends them to the organiser''s surface');
perform pg_temp.check(jsonb_array_length(v_r->'contexts') = 1,
  format('3 (A): a coach of one side gets ONE competition context (got %s)', jsonb_array_length(v_r->'contexts')));
perform pg_temp.check(v_r->'contexts'->0->>'ageGroup' = 'U12', '4 (A): and it is their own, U12');

v_r := pg_temp.centre_as(v_host_ca, v_t);
perform pg_temp.check(jsonb_array_length(v_r->'contexts') = 2,
  format('5 (A): a club with a U12 and a U16 side gets TWO contexts over ONE tournament (got %s)', jsonb_array_length(v_r->'contexts')));
select count(*) into v_n from public.tournaments where id = v_t;
perform pg_temp.check(v_n = 1, '6 (A): and there is still exactly one tournament record behind them');

-- ============ B. The competitions do not mix ============

v_r := pg_temp.centre_as(v_host_ca, v_t);
select c into v_u12 from jsonb_array_elements(v_r->'contexts') c where c->>'ageGroup' = 'U12';
select c into v_ctx from jsonb_array_elements(v_r->'contexts') c where c->>'ageGroup' = 'U16';

perform pg_temp.check(jsonb_array_length(v_u12->'sides') = 4,
  format('7 (B): the U12 context carries the four U12 sides (got %s)', jsonb_array_length(v_u12->'sides')));
perform pg_temp.check(jsonb_array_length(v_ctx->'sides') = 1,
  format('8 (B): the U16 context carries only the one U16 side (got %s)', jsonb_array_length(v_ctx->'sides')));
select count(*) into v_n from jsonb_array_elements(v_u12->'sides') s where s->>'clubName' like '%Other%';
perform pg_temp.check(v_n = 1, '9 (B): a U12 club appears in the U12 field');
select count(*) into v_n from jsonb_array_elements(v_ctx->'sides') s where s->>'clubName' like '%Other%';
perform pg_temp.check(v_n = 0, '10 (B): and never in the U16 field -- a parent is not shown another competition''s clubs');

select count(*) into v_n from jsonb_array_elements(v_u12->'sides') s where (s->>'isHost')::boolean;
perform pg_temp.check(v_n = 1, '11 (B): the host is one side among the field, marked as the host');

-- ============ C. THE PRIVACY BOUNDARY, measured in the payload ============

v_r := pg_temp.centre_as(v_guest_co, v_t);
select c into v_u12 from jsonb_array_elements(v_r->'contexts') c where c->>'ageGroup' = 'U12';

select a into v_row from jsonb_array_elements(v_u12->'attendance') a where (a->>'isMine')::boolean;
perform pg_temp.check(v_row->>'attending' = '1',
  format('12 (C): a coach sees their OWN side''s attending count (got %s)', v_row->>'attending'));
perform pg_temp.check(v_row->>'unsure' is not null and v_row->>'cannotAttend' is not null and v_row->>'awaiting' is not null,
  '13 (C): and their own side''s full breakdown');
perform pg_temp.check(v_row->>'awaiting' = '1',
  format('14 (C): including who has not answered -- one of the two children (got %s)', v_row->>'awaiting'));

select a into v_row from jsonb_array_elements(v_u12->'attendance') a where a->>'clubName' like '%Other%';
perform pg_temp.check(v_row->>'attending' = '2',
  format('15 (C): another club''s ATTENDING number crosses the boundary, because the day is organised around it (got %s)', v_row->>'attending'));
perform pg_temp.check(v_row->>'cannotAttend' is null,
  ' 16 (C): but their CANNOT ATTEND does not -- and is ABSENT FROM THE PAYLOAD, not merely undrawn');
perform pg_temp.check(v_row->>'unsure' is null, '17 (C): nor their unsure');
perform pg_temp.check(v_row->>'awaiting' is null, '18 (C): nor how many of them have not answered');

perform pg_temp.check(v_r::text not like '%OtherA%' and v_r::text not like '%OtherB%' and v_r::text not like '%OtherC%',
  '19 (C): and no other club''s player is NAMED anywhere in the payload');

select a into v_row from jsonb_array_elements(v_u12->'attendance') a where a->>'clubName' like '%Unclaimed%';
perform pg_temp.check(v_row->>'attending' is null,
  '20 (C): a club that is not on Ovalball reports nothing rather than nought -- there is nobody to ask');

-- ============ D. Who may answer, and for whom ============

v_r := pg_temp.centre_as(v_parent, v_t);
perform pg_temp.check(jsonb_array_length(v_r->'myPlayers') = 2,
  format('21 (D): a guardian of two children in an entered side is offered both (got %s)', jsonb_array_length(v_r->'myPlayers')));
select p into v_row from jsonb_array_elements(v_r->'myPlayers') p where p->>'firstName' = 'Child';
perform pg_temp.check((v_row->>'canRespond')::boolean, '22 (D): and may answer for them');
perform pg_temp.check(v_row->>'status' = 'ATTENDING', '23 (D): with the answer already recorded shown back');
perform pg_temp.check((v_row->>'isSelf')::boolean is false, '24 (D): marked as somebody else, so the question names the child');

v_r := pg_temp.centre_as(v_guest_co, v_t);
perform pg_temp.check(jsonb_array_length(v_r->'myPlayers') = 0,
  '25 (D): a COACH is offered nobody to answer for -- there is no staff override here either');

-- ============ E. Not being in it is not seeing it ============

perform pg_temp.check(pg_temp.centre_as(v_stranger, v_t) is null,
  '26 (E): a signed-in stranger reads nothing at all from a private tournament');

-- ============ F. The agenda is a projection, and says so when it is empty ============

perform pg_temp.check(jsonb_array_length(v_u12->'games') = 0,
  '27 (F): an unpublished programme is an EMPTY list -- never a fabricated game');

insert into public.tournament_games (tournament_id, side_a_id, side_b_id, age_group, game_date, start_time, status, sort_order)
select v_t,
  (select id from public.tournament_participants where tournament_id = v_t and club_id = v_guest and age_group = 'U12'),
  (select id from public.tournament_participants where tournament_id = v_t and club_id = v_other and age_group = 'U12'),
  'U12', current_date + 14, '10:00', 'SCHEDULED', 1;

v_r := pg_temp.centre_as(v_guest_co, v_t);
select c into v_u12 from jsonb_array_elements(v_r->'contexts') c where c->>'ageGroup' = 'U12';
perform pg_temp.check(jsonb_array_length(v_u12->'games') = 1,
  '28 (F): a published game appears, read from the organiser''s own planning record');
select c into v_ctx from jsonb_array_elements(v_r->'contexts') c where c->>'ageGroup' = 'U12';
perform pg_temp.check((v_ctx->'games'->0->'sideA'->>'isMine')::boolean or (v_ctx->'games'->0->'sideB'->>'isMine')::boolean,
  '29 (F): with the viewer''s own side marked, which is what they are scanning for');

-- ============ G. One tournament, one answer, across a multi-day festival ============

select count(*) into v_n from public.player_fixture_attendance where tournament_id = v_t and player_id = v_child;
perform pg_temp.check(v_n = 1,
  '30 (G): a two-day tournament holds ONE attendance row for a player, not one per day');
perform pg_temp.check((select ends_on > event_date from public.tournaments where id = v_t),
  '31 (G): and it genuinely spans two days, so the assertion above is about a multi-day case');

end $$;

rollback;
