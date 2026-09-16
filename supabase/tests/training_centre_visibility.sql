-- A training session is not public.
--
-- THE RULE
--
-- A viewer may open a training session only if they hold a legitimate
-- relationship to it: platform authority, a role at the club that runs it, or
-- being one of its participants -- or the adult responsible for one. Changing
-- the training_session_id in the URL must not grant access to anything.
--
-- WHY THIS TEST EXISTS
--
-- Before Training Centre, it did. public.training_sessions carried one policy,
-- `USING (true)`, granted to PUBLIC; and public.get_training_session_card is
-- SECURITY DEFINER and looked the session up with no visibility check at all,
-- so it handed back another club's team, date, venue, pitch and coach's notes
-- to anybody holding an id. Training Centre is the surface that would have
-- made that reachable in one click.
--
-- WHERE IT IS ENFORCED
--
-- In the database, at both doors, through ONE rule --
-- internal.training_session_visible_row. The RLS policy and the RPC resolve
-- through the same function, so they cannot drift into two different answers.
-- These assertions run at the boundary a page actually reads, not against a
-- component.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_member uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_other_parent uuid := gen_random_uuid();

  v_dir uuid; v_club uuid; v_team uuid; v_session uuid; v_player uuid;
  v_dir2 uuid; v_club2 uuid; v_team2 uuid; v_player2 uuid;
  v_group uuid; v_group_session uuid; v_season uuid;
  v_n int;
  v_blocked boolean;
  v_slug text := substr(gen_random_uuid()::text, 1, 8);
begin

-- ---------------------------------------------------------------
-- A club, a team, a session, a player and their parent.
-- ---------------------------------------------------------------
insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin,'tcv-admin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_coach,'tcv-coach@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_member,'tcv-member@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_parent,'tcv-parent@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_stranger,'tcv-stranger@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_other_parent,'tcv-other@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');

insert into public.profiles (id, first_name, surname, email) values
  (v_admin,'Tcv','Admin','tcv-admin@ovalball-test.invalid'),
  (v_coach,'Tcv','Coach','tcv-coach@ovalball-test.invalid'),
  (v_member,'Tcv','Member','tcv-member@ovalball-test.invalid'),
  (v_parent,'Tcv','Parent','tcv-parent@ovalball-test.invalid'),
  (v_stranger,'Tcv','Stranger','tcv-stranger@ovalball-test.invalid'),
  (v_other_parent,'Tcv','Other','tcv-other@ovalball-test.invalid');

insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TCV Home RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tcv-a-'||v_slug)
returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'tcv-a-'||v_slug,'active') returning id into v_club;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('TCV Other RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','tcv-b-'||v_slug)
returning id into v_dir2;
insert into public.clubs (directory_id, slug, status) values (v_dir2,'tcv-b-'||v_slug,'active') returning id into v_club2;

-- active=false keeps these fixtures out of the canonical-team-type constraint,
-- which is a Team Directory rule and not what this file is testing.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
values (v_club,'union','youth','U12','boys','Under 12 Boys','tcv-a-u12-'||v_slug,false) returning id into v_team;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, active)
values (v_club2,'union','youth','U12','boys','Under 12 Boys','tcv-b-u12-'||v_slug,false) returning id into v_team2;

-- The coach coaches the training team; the member holds nothing but a club membership; the
-- stranger holds nothing anywhere.
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_coach, 'BASIC_USER', 'active');
insert into public.team_permissions (membership_id, team_id, permission)
  select id, v_team, 'coach' from public.club_memberships where club_id = v_club and user_id = v_coach;
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_member, 'BASIC_USER', 'active');

-- playing_pathway is required before a player may join a gendered team --
-- Ovalball never assumes it from the side they are being added to.
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tcv','Child', (current_date - interval '11 years')::date, 'MALE') returning id into v_player;
insert into public.players (first_name, surname, date_of_birth, playing_pathway)
values ('Tcv','Elsewhere', (current_date - interval '11 years')::date, 'MALE') returning id into v_player2;

insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team, 'active');
insert into public.player_team_memberships (player_id, team_id, status) values (v_player2, v_team2, 'active');

insert into public.guardians (guardian_user_id, player_id, status) values (v_parent, v_player, 'active');
insert into public.guardians (guardian_user_id, player_id, status) values (v_other_parent, v_player2, 'active');

insert into public.training_sessions (club_id, team_id, session_date, start_time)
values (v_club, v_team, current_date + 3, '18:00') returning id into v_session;

-- ============ A. NO IDENTITY, NO SESSION ============
--
-- The rule's default answer. With no authenticated caller there is no site
-- admin, no club membership and no guardian relationship to find, so it must
-- come back false -- the shape that makes every case below an ALLOW that has
-- to be earned rather than a DENY that has to be remembered.

if internal.training_session_visible_row(v_club, v_team, null) then
  raise notice 'FAIL 1 (A): the rule admitted a caller with no identity at all';
else
  raise notice 'PASS 1 (A): with no authenticated identity the rule denies -- visibility is earned, never assumed';
end if;

-- ============ B. WHO MAY SEE IT ============
--
-- Each probe assumes one identity and asks BOTH doors: the table (RLS) and the
-- RPC the Training Centre page actually calls. They must agree every time.

perform set_config('role','authenticated',true);

-- The participant's guardian.
perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_session;
begin
  perform 1 from public.get_training_session_card(v_session);
  v_blocked := false;
exception when others then v_blocked := true;
end;
if v_n = 1 and not v_blocked then
  raise notice 'PASS 2 (B): an active guardian of a participating player sees the session at both doors';
else
  raise notice 'FAIL 2 (B): guardian table_rows=% rpc_blocked=%', v_n, v_blocked;
end if;

-- Somebody with a role at the club running it.
perform set_config('request.jwt.claims', json_build_object('sub', v_coach, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_session;
begin
  perform 1 from public.get_training_session_card(v_session);
  v_blocked := false;
exception when others then v_blocked := true;
end;
if v_n = 1 and not v_blocked then
  raise notice 'PASS 3 (B): the team''s coach sees the session at both doors';
else
  raise notice 'FAIL 3 (B): coach table_rows=% rpc_blocked=%', v_n, v_blocked;
end if;

-- Slice 4E (AA.3 row 4e, J.9 line 504): an ordinary club member does NOT. training.session.view
-- reaches CA and FS at the club and CO, TM and PL at the team, and the key is safeguarding
-- sensitive, because a training session is a standing record of where named children will be.
perform set_config('request.jwt.claims', json_build_object('sub', v_member, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_session;
begin
  perform 1 from public.get_training_session_card(v_session);
  v_blocked := false;
exception when others then v_blocked := true;
end;
if v_n = 0 and v_blocked then
  raise notice 'PASS 3 (C): an ordinary club member sees the session at neither door';
else
  raise notice 'FAIL 3 (C): club member table_rows=% rpc_blocked=%', v_n, v_blocked;
end if;

-- Platform authority.
perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_session;
if v_n = 1 then
  raise notice 'PASS 4 (B): Site Admin retains platform authority';
else
  raise notice 'FAIL 4 (B): Site Admin cannot see the session';
end if;

-- ============ C. NEGATIVE AUTHORIZATION ============
--
-- The whole point. Holding the id must buy nothing.

perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_session;
begin
  perform 1 from public.get_training_session_card(v_session);
  v_blocked := false;
exception when others then v_blocked := true;
end;
if v_n = 0 and v_blocked then
  raise notice 'PASS 5 (C): an unrelated signed-in account is refused at BOTH doors -- the id alone grants nothing';
else
  raise notice 'FAIL 5 (C): stranger table_rows=% rpc_blocked=% -- a pasted id returned another club''s session', v_n, v_blocked;
end if;

-- A guardian at a DIFFERENT club. Legitimate on the platform, and legitimate
-- for their own child -- which is exactly why this one matters: a real
-- relationship somewhere must not become a relationship everywhere.
perform set_config('request.jwt.claims', json_build_object('sub', v_other_parent, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_session;
begin
  perform 1 from public.get_training_session_card(v_session);
  v_blocked := false;
exception when others then v_blocked := true;
end;
if v_n = 0 and v_blocked then
  raise notice 'PASS 6 (C): a guardian at another club is refused this club''s session';
else
  raise notice 'FAIL 6 (C): other-club guardian table_rows=% rpc_blocked=%', v_n, v_blocked;
end if;

perform set_config('role','postgres',true);

-- ============ D. MINI-RUGBY / SCHEDULING GROUPS ============
--
-- A group session has no team_id at all. Participation resolves through the
-- group's member teams -- the same join the register and the attendance write
-- already use -- so the guardian of a child in a member team must see it, and
-- a stranger still must not.

select id into v_season from public.seasons order by starts_on desc limit 1;
insert into public.scheduling_groups (club_id, display_tag, season_id) values (v_club, 'TCV Minis', v_season) returning id into v_group;
insert into public.scheduling_group_members (group_id, team_id) values (v_group, v_team);
insert into public.training_sessions (club_id, scheduling_group_id, session_date, start_time)
values (v_club, v_group, current_date + 4, '10:00') returning id into v_group_session;

perform set_config('role','authenticated',true);

perform set_config('request.jwt.claims', json_build_object('sub', v_parent, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_group_session;
if v_n = 1 then
  raise notice 'PASS 7 (D): a group session is visible to the guardian of a child in one of its member teams';
else
  raise notice 'FAIL 7 (D): a Mini-Rugby group session is hidden from a real participant''s guardian';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_stranger, 'role','authenticated')::text, true);
select count(*) into v_n from public.training_sessions where id = v_group_session;
if v_n = 0 then
  raise notice 'PASS 8 (D): a group session is not public either';
else
  raise notice 'FAIL 8 (D): a stranger can read a Mini-Rugby group session';
end if;

perform set_config('role','postgres',true);

-- ============ E. ONE ANSWER PER PLAYER PER SESSION ============
--
-- Section 14's invariant, and the reason a Training Centre response cannot
-- land on next Tuesday: the row is keyed on THIS occurrence's id.

insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
values (v_session, v_player, 'ATTENDING', v_parent, 'guardian')
on conflict (training_session_id, player_id) where training_session_id is not null
do update set status = excluded.status;

insert into public.player_fixture_attendance (training_session_id, player_id, status, responded_by_user_id, response_source)
values (v_session, v_player, 'CANNOT_ATTEND', v_parent, 'guardian')
on conflict (training_session_id, player_id) where training_session_id is not null
do update set status = excluded.status;

select count(*) into v_n from public.player_fixture_attendance where training_session_id = v_session and player_id = v_player;
if v_n = 1 then
  raise notice 'PASS 9 (E): answering twice updates one canonical row rather than accumulating responses';
else
  raise notice 'FAIL 9 (E): % attendance rows exist for one player on one session', v_n;
end if;

-- And it did not touch the group session, which is a different occurrence.
select count(*) into v_n from public.player_fixture_attendance where training_session_id = v_group_session;
if v_n = 0 then
  raise notice 'PASS 10 (E): a response belongs to its own occurrence and reaches no other session';
else
  raise notice 'FAIL 10 (E): responding to one session wrote % rows against another', v_n;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
