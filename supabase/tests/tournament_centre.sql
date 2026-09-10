-- One occasion, many of our teams, different opponents each.
--
-- THE RULES THIS PROTECTS
--
-- 1. ONE canonical tournament_id. Everything belonging to the occasion
--    references that parent; nothing is identified by name, date or venue.
-- 2. Opponents belong to a TEAM's participation, never to a global list that
--    implies every one of our teams plays everyone.
-- 3. Changing the occasion needs authority over every team attending.
--    Changing one team's day needs authority over that team -- and a U12
--    manager must not be able to touch U13.
-- 4. Two pitch reservations of the SAME tournament may overlap. A tournament
--    against anything unrelated still conflicts normally.
-- 5. Rugby code and season come from canonical sources, and code isolation
--    holds at the door.
-- 6. The people going -- players and their guardians -- can see it.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_club_admin uuid := gen_random_uuid();
  v_u12_manager uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_adult uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();

  v_dir uuid; v_club uuid; v_membership uuid;
  v_league_dir uuid; v_league_club uuid; v_league_team uuid;
  v_venue uuid; v_pitch1 uuid; v_pitch2 uuid;
  v_u12 uuid; v_u13 uuid;
  v_opp_a uuid; v_opp_b uuid;
  v_type_u12 uuid; v_type_u13 uuid;
  v_season uuid;

  v_tournament uuid; v_other_tournament uuid;
  v_entry_u12 uuid; v_entry_u13 uuid;
  v_o1 uuid; v_o2 uuid; v_o3 uuid;
  v_game uuid;
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
  v_n int; v_txt text; v_ok boolean; v_uuid uuid;
  v_player uuid; v_guardian_player uuid;
begin

-- ---------------------------------------------------------------- fixtures
insert into auth.users (id, email, instance_id, aud, role) values
  (v_club_admin,'tc-admin-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_u12_manager,'tc-u12-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_parent,'tc-parent-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_adult,'tc-adult-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_stranger,'tc-stranger-'||v_slug||'@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email)
select id, 'Tc', 'Person', email from auth.users where id in (v_club_admin, v_u12_manager, v_parent, v_adult, v_stranger);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TC RUFC '||v_slug,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tc-'||v_slug)
returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'tc-'||v_slug,'active') returning id into v_club;

-- Two opposition identities from the canonical directory. Neither is an
-- Ovalball club, which is the ordinary case.
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TC Opponent A '||v_slug,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tc-a-'||v_slug)
returning id into v_opp_a;
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TC Opponent B '||v_slug,'T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tc-b-'||v_slug)
returning id into v_opp_b;

-- A LEAGUE club, for the code-isolation assertions.
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TC League '||v_slug,'T','T','league','United Kingdom','England',true,'unverified','site_admin_manual','tc-l-'||v_slug)
returning id into v_league_dir;
insert into public.clubs (directory_id, slug, status) values (v_league_dir,'tc-l-'||v_slug,'active') returning id into v_league_club;
insert into public.teams (club_id, display_name, rugby_code, category, age_group, gender, active)
values (v_league_club,'Under 12 Boys','league','youth','U12','boys',true) returning id into v_league_team;

insert into public.venues (name, slug, club_id, active, is_default_home)
values ('TC Ground '||v_slug,'tc-ground-'||v_slug, v_club, true, true) returning id into v_venue;
insert into public.club_pitches (club_id, display_name, sort_order, venue_id) values (v_club,'Pitch 1',1,v_venue) returning id into v_pitch1;
insert into public.club_pitches (club_id, display_name, sort_order, venue_id) values (v_club,'Pitch 2',2,v_venue) returning id into v_pitch2;

insert into public.teams (club_id, display_name, rugby_code, category, age_group, gender, active)
values (v_club,'Under 12 Boys','union','youth','U12','boys',true) returning id into v_u12;
insert into public.teams (club_id, display_name, rugby_code, category, age_group, gender, active)
values (v_club,'Under 13 Boys','union','youth','U13','boys',true) returning id into v_u13;

select id into v_type_u12 from public.canonical_team_types where key = 'u12';
select id into v_type_u13 from public.canonical_team_types where key = 'u13';
select id into v_season from public.seasons where rugby_code = 'union' order by starts_on desc limit 1;

-- CLUB ADMIN, and a TEAM MANAGER for U12 ONLY. The second is the whole point
-- of the authority split.
insert into public.club_memberships (club_id, user_id, role, status)
values (v_club, v_club_admin, 'CLUB_ADMIN', 'active');
insert into public.club_memberships (club_id, user_id, role, status)
values (v_club, v_u12_manager, 'BASIC_USER', 'active') returning id into v_membership;
insert into public.team_permissions (membership_id, team_id, permission) values (v_membership, v_u12, 'manager');

-- A CHILD in U13 and the adult responsible for them; and a player with their
-- OWN ACCOUNT in U12. Neither holds a club membership, which is the normal
-- shape for a family.
-- playing_pathway is required before a player can join a team -- Ovalball
-- never assumes it from the side they are put in.
insert into public.players (first_name, surname, active, playing_pathway, date_of_birth)
values ('Tc','Child', true, 'MALE', current_date - interval '13 years') returning id into v_guardian_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_guardian_player, v_u13, 'active');
insert into public.guardians (guardian_user_id, player_id, status) values (v_parent, v_guardian_player, 'active');

insert into public.players (first_name, surname, active, user_id, playing_pathway, date_of_birth)
values ('Tc','Adult', true, v_adult, 'MALE', current_date - interval '12 years') returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_u12, 'active');

-- ============ A. ONE OCCASION, MANY OF OUR TEAMS ============

perform set_config('role','authenticated',true);
perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role','authenticated')::text, true);

v_tournament := public.save_tournament(
  p_club_id => v_club, p_name => 'TC Festival', p_starts_on => current_date + 30,
  p_ends_on => current_date + 30, p_rugby_code => 'union', p_venue_id => v_venue
);
v_entry_u12 := public.add_tournament_team_entry(v_tournament, v_u12);
v_entry_u13 := public.add_tournament_team_entry(v_tournament, v_u13);

select count(distinct tournament_id) into v_n from public.tournament_team_entries where tournament_id = v_tournament;
if v_n = 1 and (select count(*) from public.tournament_team_entries where tournament_id = v_tournament) = 2 then
  raise notice 'PASS 1 (A): two of our teams attend ONE tournament -- one parent id, two entries';
else
  raise notice 'FAIL 1 (A): % distinct parents for the entries', v_n;
end if;

-- ============ B. DIFFERENT OPPONENTS PER TEAM ============

v_o1 := public.record_tournament_opponent(v_entry_u12, v_opp_a, v_type_u12);
v_o2 := public.record_tournament_opponent(v_entry_u12, v_opp_b, v_type_u12);
v_o3 := public.record_tournament_opponent(v_entry_u13, v_opp_b, v_type_u13);

select count(*) into v_n from public.tournament_entry_opponents where entry_id = v_entry_u12;
if v_n = 2 and (select count(*) from public.tournament_entry_opponents where entry_id = v_entry_u13) = 1 then
  raise notice 'PASS 2 (B): U12 has two opponents and U13 has one -- opponents belong to a TEAM, not to a global list';
else
  raise notice 'FAIL 2 (B): U12 has %, U13 has %', v_n, (select count(*) from public.tournament_entry_opponents where entry_id = v_entry_u13);
end if;

-- The SAME club at two age grades is two canonical identities, never one row
-- implying both of our teams play the same side.
select count(*) into v_n from public.tournament_participants
where tournament_id = v_tournament and club_directory_id = v_opp_b;
if v_n = 2 then
  raise notice 'PASS 3 (B): the same opposition club at two age grades is two canonical identities';
else
  raise notice 'FAIL 3 (B): % participant rows for one club at two grades', v_n;
end if;

-- A game may only be against one of THAT team's own recorded opponents.
begin
  perform public.save_tournament_game(v_entry_u13, v_o1, current_date + 30);
  raise notice 'FAIL 4 (B): U13 was scheduled against one of U12''s opponents';
exception when others then
  raise notice 'PASS 4 (B): a game must be against that team''s own opponent -- cross-team opponents refused';
end;

-- ============ C. THE SCHEDULE ============

v_game := public.save_tournament_game(v_entry_u12, v_o1, current_date + 30, p_start_time => '10:00', p_duration_minutes => 30, p_pitch_id => v_pitch1);
perform public.save_tournament_game(v_entry_u13, v_o3, current_date + 30, p_start_time => '10:20', p_duration_minutes => 30, p_pitch_id => v_pitch2);

select count(*) into v_n from public.tournament_games where tournament_id = v_tournament;
if v_n = 2 then
  raise notice 'PASS 5 (C): each team''s games hang off its own entry, under one tournament';
else
  raise notice 'FAIL 5 (C): % games recorded', v_n;
end if;

-- A game outside the days the tournament runs is refused.
begin
  perform public.save_tournament_game(v_entry_u12, v_o1, current_date + 90);
  raise notice 'FAIL 6 (C): a game was scheduled on a day the tournament is not running';
exception when others then
  raise notice 'PASS 6 (C): a game must fall on a day the tournament is running';
end;

-- ============ D. TOURNAMENT GAMES ARE NOT FIXTURES ============
--
-- The whole decision, asserted: creating a tournament and its games creates no
-- fixtures rows, so Match Centre, the Fixtures list, attendance invitations
-- and the two-club result workflow are untouched by a festival.

select count(*) into v_n from public.fixtures where owning_team_id in (v_u12, v_u13);
if v_n = 0 then
  raise notice 'PASS 7 (D): a tournament creates no fixtures -- Match Centre and the fixture result workflow are untouched';
else
  raise notice 'FAIL 7 (D): % fixtures rows were created by a tournament', v_n;
end if;

-- ============ E. PITCHES: SAME-TOURNAMENT OVERLAP IS LEGITIMATE ============

perform public.reserve_tournament_pitch(v_tournament, v_pitch1, current_date + 30, '09:30', '14:00');
perform public.reserve_tournament_pitch(v_tournament, v_pitch2, current_date + 30, '09:30', '14:00');
select count(*) into v_n from public.tournament_pitches where tournament_id = v_tournament;
if v_n = 2 then
  raise notice 'PASS 8 (E): one tournament holds two pitches over the same period -- accepted, not a self-conflict';
else
  raise notice 'FAIL 8 (E): % reservations stored', v_n;
end if;

-- A tournament can only reserve its host club's own pitches.
perform set_config('role','postgres',true);
declare v_foreign_pitch uuid;
begin
  select cp.id into v_foreign_pitch from public.club_pitches cp where cp.club_id <> v_club limit 1;
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role','authenticated')::text, true);
  if v_foreign_pitch is not null then
    begin
      perform public.reserve_tournament_pitch(v_tournament, v_foreign_pitch, current_date + 30, '09:30', '10:00');
      raise notice 'FAIL 9 (E): a tournament reserved a pitch belonging to another club';
    exception when others then
      raise notice 'PASS 9 (E): a tournament cannot reserve another club''s pitch';
    end;
  else
    raise notice 'PASS 9 (E): skipped -- no foreign pitch present to attempt';
  end if;
end;

-- ============ F. AUTHORITY: THE OCCASION vs ONE TEAM ============

perform set_config('request.jwt.claims', json_build_object('sub', v_u12_manager, 'role','authenticated')::text, true);

-- The U12 manager runs U12's day.
if internal.can_manage_tournament_entry(v_entry_u12) then
  raise notice 'PASS 10 (F): the U12 manager can manage U12''s own participation';
else
  raise notice 'FAIL 10 (F): the U12 manager cannot manage U12';
end if;

-- ...and NOT U13's.
if not internal.can_manage_tournament_entry(v_entry_u13) then
  raise notice 'PASS 11 (F): the U12 manager cannot manage U13''s participation';
else
  raise notice 'FAIL 11 (F): the U12 manager can manage U13 -- team authority leaked across the parent';
end if;

begin
  perform public.save_tournament_game(v_entry_u13, v_o3, current_date + 30, p_start_time => '13:00');
  raise notice 'FAIL 12 (F): the U12 manager changed U13''s schedule';
exception when others then
  raise notice 'PASS 12 (F): the U12 manager is refused U13''s schedule server-side';
end;

begin
  perform public.record_tournament_opponent(v_entry_u13, v_opp_a, v_type_u13);
  raise notice 'FAIL 13 (F): the U12 manager changed U13''s opponents';
exception when others then
  raise notice 'PASS 13 (F): the U12 manager is refused U13''s opponents';
end;

-- The whole occasion reaches every team, so a manager of one does not get it.
if not internal.can_manage_tournament(v_tournament) then
  raise notice 'PASS 14 (F): managing one attending team does not confer authority over the whole occasion';
else
  raise notice 'FAIL 14 (F): a single-team manager holds whole-tournament authority';
end if;

begin
  perform public.reserve_tournament_pitch(v_tournament, v_pitch1, current_date + 30, '15:00', '16:00');
  raise notice 'FAIL 15 (F): a single-team manager reserved a club pitch for the whole occasion';
exception when others then
  raise notice 'PASS 15 (F): reserving a pitch is whole-occasion authority, refused to a single-team manager';
end;

-- ...but the club admin does hold it.
perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role','authenticated')::text, true);
if internal.can_manage_tournament(v_tournament) then
  raise notice 'PASS 16 (F): club-scope authority manages the whole occasion';
else
  raise notice 'FAIL 16 (F): the club admin cannot manage the occasion';
end if;

-- ============ G. VISIBILITY: THE PEOPLE WHO ARE GOING ============

perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
if internal.tournament_visible_row(v_tournament) then
  raise notice 'PASS 17 (G): a guardian of a player in an entered team can see the tournament';
else
  raise notice 'FAIL 17 (G): a guardian cannot see their own child''s tournament';
end if;
if public.get_tournament_centre(v_tournament) is not null then
  raise notice 'PASS 18 (G): the guardian receives the Tournament Centre payload';
else
  raise notice 'FAIL 18 (G): the guardian receives no payload';
end if;
if not internal.can_manage_tournament(v_tournament) and not internal.can_manage_tournament_entry(v_entry_u13) then
  raise notice 'PASS 19 (G): viewing confers no management authority on a guardian';
else
  raise notice 'FAIL 19 (G): a guardian holds management authority';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_adult, 'role','authenticated')::text, true);
if internal.tournament_visible_row(v_tournament) then
  raise notice 'PASS 20 (G): a player with their own account in an entered team can see the tournament';
else
  raise notice 'FAIL 20 (G): a self-account player cannot see their own team''s tournament';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
if not internal.tournament_visible_row(v_tournament) and public.get_tournament_centre(v_tournament) is null then
  raise notice 'PASS 21 (G): an unrelated signed-in user sees nothing -- a forged id returns no payload';
else
  raise notice 'FAIL 21 (G): an unrelated user could read the tournament';
end if;

-- ============ H. RUGBY CODE AND SEASON ============

perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role','authenticated')::text, true);

begin
  perform public.add_tournament_team_entry(v_tournament, v_league_team);
  raise notice 'FAIL 22 (H): a League team was entered into a Union tournament';
exception when others then
  raise notice 'PASS 22 (H): code isolation holds -- a League team cannot enter a Union tournament';
end;

begin
  perform public.record_tournament_opponent(v_entry_u12, v_league_dir, v_type_u12);
  raise notice 'FAIL 23 (H): a League club was recorded as an opponent in a Union tournament';
exception when others then
  raise notice 'PASS 23 (H): a League club cannot be an opponent in a Union tournament';
end;

select season_id into v_uuid from public.tournaments where id = v_tournament;
if v_uuid is not null and v_uuid = (
  select s.id from public.seasons s
  where s.rugby_code = 'union' and (current_date + 30) between s.starts_on and s.ends_on
  order by s.starts_on desc limit 1
) then
  raise notice 'PASS 24 (H): the season resolved from the canonical register, not from a hardcoded cutoff';
else
  raise notice 'FAIL 24 (H): season_id is % -- not the canonical register''s answer', v_uuid;
end if;

-- ============ I. CANCELLATION ============

perform public.cancel_tournament(v_tournament, 'Waterlogged');

select status, cancellation_reason into v_txt, v_txt from public.tournaments where id = v_tournament;
select count(*) into v_n from public.tournaments where id = v_tournament and status = 'cancelled' and cancelled_at is not null;
if v_n = 1 then
  raise notice 'PASS 25 (I): a cancelled tournament is retained and marked, never deleted';
else
  raise notice 'FAIL 25 (I): the tournament row did not survive cancellation as cancelled';
end if;

select count(*) into v_n from public.tournament_pitches where tournament_id = v_tournament and reserved_on >= current_date;
if v_n = 0 then
  raise notice 'PASS 26 (I): cancelling released the future pitch reservations';
else
  raise notice 'FAIL 26 (I): % future reservations still held by a cancelled tournament', v_n;
end if;

select count(*) into v_n from public.tournament_games where tournament_id = v_tournament;
if v_n = 2 then
  raise notice 'PASS 27 (I): the games are kept as history';
else
  raise notice 'FAIL 27 (I): % games survived cancellation', v_n;
end if;

begin
  perform public.save_tournament_game(v_entry_u12, v_o1, current_date + 30, p_start_time => '11:00');
  raise notice 'FAIL 28 (I): a cancelled tournament was still editable';
exception when others then
  raise notice 'PASS 28 (I): a cancelled tournament refuses further changes';
end;

-- ============ MD. MULTI-DAY IS ONE TOURNAMENT ============
--
-- A three-day festival is ONE row spanning the dates. One row per day would
-- give three tournament ids for one occasion, and every link, every pitch
-- reservation and every schedule would have to pick one of them.

perform set_config('request.jwt.claims', json_build_object('sub', v_club_admin, 'role','authenticated')::text, true);
declare
  v_md uuid; v_md_entry uuid; v_md_opp uuid;
begin
  v_md := public.save_tournament(
    p_club_id => v_club, p_name => 'TC Three Day', p_starts_on => current_date + 60,
    p_ends_on => current_date + 62, p_rugby_code => 'union', p_venue_id => v_venue
  );
  select count(*) into v_n from public.tournaments where name = 'TC Three Day';
  if v_n = 1 and (select ends_on - event_date from public.tournaments where id = v_md) = 2 then
    raise notice 'PASS 31 (MD): a three-day festival is ONE tournament row spanning the dates';
  else
    raise notice 'FAIL 31 (MD): % rows for a multi-day tournament', v_n;
  end if;

  v_md_entry := public.add_tournament_team_entry(v_md, v_u12);
  v_md_opp := public.record_tournament_opponent(v_md_entry, v_opp_a, v_type_u12);
  perform public.save_tournament_game(v_md_entry, v_md_opp, current_date + 61, p_start_time => '11:00', p_duration_minutes => 30);
  raise notice 'PASS 32 (MD): a game on the middle day of the span is accepted';

  begin
    perform public.save_tournament_game(v_md_entry, v_md_opp, current_date + 70, p_start_time => '11:00');
    raise notice 'FAIL 33 (MD): a game outside the span was accepted';
  exception when others then
    raise notice 'PASS 33 (MD): a game outside the span is refused';
  end;

  -- The Calendar's own overlap window finds a festival already in progress.
  select count(*) into v_n from public.club_visible_tournaments
  where event_date <= (current_date + 61) and ends_on >= (current_date + 61) and id = v_md;
  if v_n = 1 then
    raise notice 'PASS 34 (MD): the Calendar overlap window finds a festival already in progress';
  else
    raise notice 'FAIL 34 (MD): the overlap window missed a running festival';
  end if;
end;

-- ============ J. NO WRITE PATH AROUND THE RPCS ============
--
-- The tables carry SELECT policies and no write policies at all, so a crafted
-- PostgREST insert has nothing to land on even for a legitimate club admin.

begin
  insert into public.tournament_team_entries (tournament_id, team_id, club_id)
  values (v_tournament, v_u12, v_club);
  raise notice 'FAIL 29 (J): a direct insert bypassed the tournament RPCs';
exception when others then
  raise notice 'PASS 29 (J): the tournament tables have no write policy -- a direct insert is refused';
end;

begin
  update public.tournament_games set start_time = '23:00' where id = v_game;
  if found then
    raise notice 'FAIL 30 (J): a direct update bypassed the tournament RPCs';
  else
    raise notice 'PASS 30 (J): a direct update reaches no rows -- writes go through the RPCs';
  end if;
exception when others then
  raise notice 'PASS 30 (J): a direct update is refused -- writes go through the RPCs';
end;

perform set_config('role','postgres',true);

end $$;

rollback;
