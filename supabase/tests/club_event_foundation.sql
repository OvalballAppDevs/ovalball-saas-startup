-- A club event is its own thing, and it is not public.
--
-- THE RULES THIS FILE HOLDS
--
--   * A viewer may open an event only through a legitimate relationship:
--     platform authority, a role at the club running it, or being one of its
--     participants -- or the adult responsible for one. A forged event id
--     fails CLOSED, returning nothing rather than a redacted shell.
--   * One event is one row however many days it spans, and the span is
--     validated: an event cannot end before it starts.
--   * Location is venue XOR structured external address. Never both, never
--     neither, and never another club's venue.
--   * Teams and pitches are stable ids belonging to the owning club. A forged
--     one is rejected on the server.
--   * Attendance extends the ONE canonical register: one player + one event =
--     one current response, using the same status vocabulary and the same
--     safeguarding resolver as fixtures and training.
--   * On a shared multi-team event, team-scoped staff see THEIR team's
--     register and no one else's. This is the leak the register function
--     exists to prevent.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_clubadmin uuid := gen_random_uuid();
  v_staff_a uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();

  v_dir uuid; v_club uuid; v_dir2 uuid; v_club2 uuid;
  v_team_a uuid; v_team_b uuid; v_team_other uuid;
  v_venue uuid; v_venue2 uuid; v_pitch uuid; v_pitch2 uuid; v_pitch_other uuid;
  v_player_a uuid; v_player_b uuid;
  v_event uuid; v_multi uuid; v_wide uuid;
  v_n int; v_blocked boolean; v_card jsonb; v_membership_a uuid;
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin,'cef-admin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_clubadmin,'cef-clubadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_staff_a,'cef-staffa@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_parent,'cef-parent@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_stranger,'cef-stranger@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

insert into public.profiles (id, first_name, surname, email) values
  (v_admin,'Cef','Admin','cef-admin@ovalball-test.invalid'),
  (v_clubadmin,'Cef','ClubAdmin','cef-clubadmin@ovalball-test.invalid'),
  (v_staff_a,'Cef','StaffA','cef-staffa@ovalball-test.invalid'),
  (v_parent,'Cef','Parent','cef-parent@ovalball-test.invalid'),
  (v_stranger,'Cef','Stranger','cef-stranger@ovalball-test.invalid');

insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('CEF Home RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cef-a-'||v_slug)
returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'cef-a-'||v_slug,'active') returning id into v_club;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('CEF Other RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','cef-b-'||v_slug)
returning id into v_dir2;
insert into public.clubs (directory_id, slug, status) values (v_dir2,'cef-b-'||v_slug,'active') returning id into v_club2;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
values (v_club,'union','youth','U12','boys','Under 12 Boys','cef-a-u12-'||v_slug,false) returning id into v_team_a;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
values (v_club,'union','youth','U14','boys','Under 14 Boys','cef-a-u14-'||v_slug,false) returning id into v_team_b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
values (v_club2,'union','youth','U12','boys','Under 12 Boys','cef-b-u12-'||v_slug,false) returning id into v_team_other;

insert into public.venues (name, slug, club_id, address, latitude, longitude, active)
values ('CEF Ground','cef-ground-'||v_slug, v_club, '1 Test Lane', 53.79, -2.24, true) returning id into v_venue;
insert into public.venues (name, slug, club_id, address, latitude, longitude, active)
values ('CEF Other Ground','cef-other-ground-'||v_slug, v_club2, '2 Test Lane', 53.70, -2.20, true) returning id into v_venue2;

insert into public.club_pitches (club_id, display_name, venue_id) values (v_club,'Pitch 1', v_venue) returning id into v_pitch;
insert into public.club_pitches (club_id, display_name, venue_id) values (v_club,'Pitch 2', v_venue) returning id into v_pitch2;
insert into public.club_pitches (club_id, display_name, venue_id) values (v_club2,'Foreign Pitch', v_venue2) returning id into v_pitch_other;

insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_clubadmin, 'CLUB_ADMIN', 'active');
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_staff_a, 'BASIC_USER', 'active')
  returning id into v_membership_a;

insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Cef','ChildA',(current_date - interval '11 years')::date,'MALE') returning id into v_player_a;
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Cef','ChildB',(current_date - interval '13 years')::date,'MALE') returning id into v_player_b;

insert into public.player_team_memberships (player_id, team_id, status) values (v_player_a, v_team_a, 'active');
insert into public.player_team_memberships (player_id, team_id, status) values (v_player_b, v_team_b, 'active');
insert into public.guardians (guardian_user_id, player_id, status) values (v_parent, v_player_a, 'active');

-- TEAM ADMINISTRATION on TEAM A ONLY -- 'team_admin' maps to TEAM_MANAGER,
-- which is the role profile that holds both team.attendance.view and
-- calendar.manage at team scope. That single grant is what both the
-- multi-team leak test and the partial-authority test turn on.
--
-- Deliberately NOT 'coach': coach maps to TEAM_STAFF, which holds
-- attendance-view but not calendar.manage. Running a team's training is not
-- the same as administering the club's event programme, and that narrower
-- line is the intended one.
insert into public.team_permissions (membership_id, team_id, permission)
values (v_membership_a, v_team_a, 'team_admin');

insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, created_by)
values (v_club, 'CEF Awards Night', current_date + 10, current_date + 10, v_venue, v_clubadmin)
returning id into v_event;
insert into public.club_event_teams (event_id, team_id) values (v_event, v_team_a);

-- ============ A. SPAN AND SHAPE ============

-- One row, many days: a seven-day event is ONE event id, and the calendar
-- derives the span. Eight rows would make moving it eight edits.
insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, created_by)
values (v_club, 'CEF Centenary Weekend', date '2026-09-07', date '2026-09-14', v_venue, v_clubadmin)
returning id into v_multi;
select count(*) into v_n from public.club_events where id = v_multi;
if v_n = 1 and (select ends_on - starts_on from public.club_events where id = v_multi) = 7 then
  raise notice 'PASS 1 (A): a seven-day event is one row spanning seven days, not eight rows';
else
  raise notice 'FAIL 1 (A): multi-day event stored as % row(s)', v_n;
end if;

-- End before start is refused by the database itself, not only by a form.
begin
  insert into public.club_events (club_id, name, starts_on, ends_on, venue_id)
  values (v_club, 'CEF Backwards', current_date + 5, current_date + 2, v_venue);
  raise notice 'FAIL 2 (A): an event ending before it starts was accepted';
exception when check_violation then
  raise notice 'PASS 2 (A): an event cannot end before it starts';
end;

-- Location is exactly one model.
begin
  insert into public.club_events (club_id, name, starts_on, ends_on, venue_id, external_location_name)
  values (v_club, 'CEF Two Places', current_date + 5, current_date + 5, v_venue, 'Also here');
  raise notice 'FAIL 3 (A): an event held a venue AND an external location at once';
exception when check_violation then
  raise notice 'PASS 3 (A): venue XOR external location -- an event cannot claim two';
end;

begin
  insert into public.club_events (club_id, name, starts_on, ends_on)
  values (v_club, 'CEF Nowhere', current_date + 5, current_date + 5);
  raise notice 'FAIL 4 (A): an event was accepted with no location at all';
exception when check_violation then
  raise notice 'PASS 4 (A): an event must resolve a location -- neither is not an option';
end;

-- ============ B. WHO MAY SEE IT ============

if internal.club_event_visible_row(v_event, v_club, false) then
  raise notice 'FAIL 5 (B): the rule admitted a caller with no identity at all';
else
  raise notice 'PASS 5 (B): with no authenticated identity the rule denies -- visibility is earned';
end if;

perform set_config('role','authenticated',true);

-- The participant's guardian: both doors agree.
perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
select count(*) into v_n from public.club_events where id = v_event;
v_card := public.get_club_event_card(v_event);
if v_n = 1 and v_card is not null then
  raise notice 'PASS 6 (B): an active guardian of a participating player sees the event at both doors';
else
  raise notice 'FAIL 6 (B): guardian table_rows=% card_null=%', v_n, (v_card is null);
end if;

-- Somebody with a role at the club running it.
perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin, 'role','authenticated')::text, true);
select count(*) into v_n from public.club_events where id = v_event;
if v_n = 1 then
  raise notice 'PASS 7 (B): a member of the club running the event sees it';
else
  raise notice 'FAIL 7 (B): club member saw % rows', v_n;
end if;

-- A stranger holding nothing anywhere: the forged-id case.
perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
select count(*) into v_n from public.club_events where id = v_event;
v_card := public.get_club_event_card(v_event);
if v_n = 0 and v_card is null then
  raise notice 'PASS 8 (B): a forged event id returns nothing at both doors -- fails closed, no redacted shell';
else
  raise notice 'FAIL 8 (B): stranger table_rows=% card_null=%', v_n, (v_card is null);
end if;

-- ============ C. FORGED IDS ON WRITE ============

perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin, 'role','authenticated')::text, true);

-- Another club's team.
begin
  perform public.save_club_event(v_club, 'CEF Forged Team', current_date + 20, current_date + 20,
    null, null, null, null, false, array[v_team_other], '{}', v_venue);
  raise notice 'FAIL 9 (C): an event was created naming another club''s team';
exception when others then
  raise notice 'PASS 9 (C): a team from another club is rejected on the server';
end;

-- Another club's pitch.
begin
  perform public.save_club_event(v_club, 'CEF Forged Pitch', current_date + 20, current_date + 20,
    null, null, null, null, false, array[v_team_a], array[v_pitch_other], v_venue);
  raise notice 'FAIL 10 (C): an event reserved another club''s pitch';
exception when others then
  raise notice 'PASS 10 (C): a pitch from another club is rejected on the server';
end;

-- Another club's venue.
begin
  perform public.save_club_event(v_club, 'CEF Forged Venue', current_date + 20, current_date + 20,
    null, null, null, null, false, array[v_team_a], '{}', v_venue2);
  raise notice 'FAIL 11 (C): an event was created at another club''s venue';
exception when others then
  raise notice 'PASS 11 (C): a venue from another club is rejected on the server';
end;

-- A stranger creating anything at all at this club.
perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
begin
  perform public.save_club_event(v_club, 'CEF Trespass', current_date + 20, current_date + 20,
    null, null, null, null, false, array[v_team_a], '{}', v_venue);
  raise notice 'FAIL 12 (C): a stranger created an event at a club they hold nothing at';
exception when others then
  raise notice 'PASS 12 (C): creating an event requires capability at the club';
end;

-- ============ D. ATTENDANCE IS THE ONE REGISTER ============

perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);

perform public.respond_to_event_attendance(v_event, v_player_a, 'ATTENDING');
perform public.respond_to_event_attendance(v_event, v_player_a, 'CANNOT_ATTEND');
select count(*) into v_n from public.player_fixture_attendance where event_id = v_event and player_id = v_player_a;
if v_n = 1 and (select status from public.player_fixture_attendance where event_id = v_event and player_id = v_player_a) = 'CANNOT_ATTEND' then
  raise notice 'PASS 13 (D): one player plus one event is one current response, updated in place';
else
  raise notice 'FAIL 13 (D): % attendance rows after two responses', v_n;
end if;

-- The row is on the SAME register fixtures and training use, and the
-- activity check keeps it about exactly one activity.
begin
  insert into public.player_fixture_attendance (event_id, training_session_id, player_id, status, responded_by_user_id, response_source)
  values (v_event, gen_random_uuid(), v_player_a, 'ATTENDING', v_parent, 'guardian');
  raise notice 'FAIL 14 (D): one attendance row claimed two activities at once';
exception when others then
  raise notice 'PASS 14 (D): an attendance row is about exactly one activity';
end;

-- Responding for a player who is not involved in the event.
begin
  perform public.respond_to_event_attendance(v_event, v_player_b, 'ATTENDING');
  raise notice 'FAIL 15 (D): a response was recorded for a player not involved in the event';
exception when others then
  raise notice 'PASS 15 (D): a response outside the player-event relationship is refused';
end;

-- ============ E. MULTI-TEAM REGISTER MUST NOT LEAK ============
--
-- The event below involves Team A and Team B. The staff member holds
-- attendance authority on Team A only, and must see Team A's players and
-- nobody else's -- the exact leak a shared event invites.

perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin, 'role','authenticated')::text, true);
-- Created through the canonical writer, which is the ONLY way in: these
-- tables carry no INSERT policy at all, so a client cannot assemble an event
-- row by hand even holding club authority.
select public.save_club_event(v_club, 'CEF Shared Presentation', current_date + 12, current_date + 12,
  null, null, null, null, false, array[v_team_a, v_team_b], '{}', v_venue) into v_wide;

-- Club-scoped authority sees both teams.
select count(distinct team_id) into v_n from public.get_club_event_register(v_wide);
if v_n = 2 then
  raise notice 'PASS 16 (E): club attendance authority sees every participating team on a shared event';
else
  raise notice 'FAIL 16 (E): club admin saw % team(s) on a two-team event', v_n;
end if;

-- Team-scoped authority sees ONLY its own team.
perform set_config('request.jwt.claims', json_build_object('sub', v_staff_a, 'role','authenticated')::text, true);
select count(distinct team_id) into v_n from public.get_club_event_register(v_wide);
if v_n = 1 and not exists (select 1 from public.get_club_event_register(v_wide) r where r.team_id = v_team_b) then
  raise notice 'PASS 17 (E): team-scoped staff see their own team only -- the other team''s players never appear';
else
  raise notice 'FAIL 17 (E): team-scoped staff saw % team(s) on a shared event', v_n;
end if;

-- And a stranger sees nothing at all.
perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
select count(*) into v_n from public.get_club_event_register(v_wide);
if v_n = 0 then
  raise notice 'PASS 18 (E): a viewer with no relationship gets an empty register, not a partial one';
else
  raise notice 'FAIL 18 (E): stranger read % register row(s)', v_n;
end if;

-- ============ E2. TEAM AUTHORITY OVER A SHARED EVENT IS NOT PARTIAL ============
--
-- Found in browser UAT: the Under 11 team admin was offered Edit and Cancel on
-- an event involving two OTHER teams as well, because authority was granted on
-- ANY matching team rather than ALL of them. Cancel takes no team list, so
-- that was a real ability to call off two other teams' event.

perform set_config('request.jwt.claims', json_build_object('sub', v_staff_a, 'role','authenticated')::text, true);
if internal.can_manage_club_event(v_wide) then
  raise notice 'FAIL 22 (E2): team-scoped staff can manage an event involving a team they do not manage';
else
  raise notice 'PASS 22 (E2): a shared event needs club scope -- one team''s admin cannot cancel two other teams'' event';
end if;

-- And they DO still manage an event confined to their own team.
if internal.can_manage_club_event(v_event) then
  raise notice 'PASS 23 (E2): team-scoped staff still manage their own team''s own event';
else
  raise notice 'FAIL 23 (E2): team-scoped staff lost management of their own team''s event';
end if;

-- ============ F. CLUB-WIDE SCOPE IS EXPRESSED ONCE ============

perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin, 'role','authenticated')::text, true);
perform public.save_club_event(v_club, 'CEF Open Day', current_date + 30, current_date + 30,
  null, null, null, null, true, '{}', '{}', v_venue);
select count(*) into v_n
from public.club_event_teams cet
join public.club_events e on e.id = cet.event_id
where e.club_id = v_club and e.name = 'CEF Open Day';
if v_n = 0 then
  raise notice 'PASS 19 (F): a club-wide event writes no per-team rows -- adding a team later cannot leave it out';
else
  raise notice 'FAIL 19 (F): club-wide event materialised % team row(s)', v_n;
end if;

-- A club-wide event still reaches the club's players.
perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
select count(*) into v_n from public.club_events where name = 'CEF Open Day' and club_id = v_club;
if v_n = 1 then
  raise notice 'PASS 20 (F): a club-wide event reaches a participating family without naming their team';
else
  raise notice 'FAIL 20 (F): guardian saw % club-wide event(s)', v_n;
end if;

-- ============ G. ANON HAS NO CLUB SOCIAL CALENDAR ============

perform set_config('role','anon',true);
perform set_config('request.jwt.claims', json_build_object('role','anon')::text, true);
select count(*) into v_n from public.club_events;
if v_n = 0 then
  raise notice 'PASS 21 (G): anonymous readers see no club events at all';
else
  raise notice 'FAIL 21 (G): anon read % club event(s)', v_n;
end if;

perform set_config('role','postgres',true);

end $$;

rollback;
