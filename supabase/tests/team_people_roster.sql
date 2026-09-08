-- Team People: the roster, who may see it, and what archiving a player means.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_dir uuid; v_club uuid; v_team uuid; v_other_team uuid; v_empty_team uuid;
  v_admin uuid := gen_random_uuid();
  v_coach uuid := gen_random_uuid();
  v_parent uuid := gen_random_uuid();
  v_stranger uuid := gen_random_uuid();
  v_admin_m uuid; v_coach_m uuid; v_parent_m uuid;
  v_player uuid; v_player2 uuid;
  v_ptm uuid; v_ptm2 uuid; v_pending uuid;
  v_n int; v_status text; v_may boolean;
begin

-- ---- People and club ----
insert into auth.users (id, email, instance_id, aud, role)
select u.id, u.em, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'
from (values (v_admin,'tp-admin@ovalball-test.invalid'), (v_coach,'tp-coach@ovalball-test.invalid'),
             (v_parent,'tp-parent@ovalball-test.invalid'), (v_stranger,'tp-stranger@ovalball-test.invalid')) u(id, em);
insert into public.profiles (id, first_name, surname, email) values
  (v_admin,'Alice','Adminson','tp-admin@ovalball-test.invalid'),
  (v_coach,'Colin','Coachman','tp-coach@ovalball-test.invalid'),
  (v_parent,'Priya','Parekh','tp-parent@ovalball-test.invalid'),
  (v_stranger,'Sam','Stranger','tp-stranger@ovalball-test.invalid');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Team People RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual',
        'team-people-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'team-people-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

insert into public.club_memberships (user_id, club_id, role, status) values (v_admin, v_club,'CLUB_ADMIN','active') returning id into v_admin_m;
insert into public.club_memberships (user_id, club_id, role, status) values (v_coach, v_club,'BASIC_USER','active') returning id into v_coach_m;
insert into public.club_memberships (user_id, club_id, role, status) values (v_parent, v_club,'BASIC_USER','active') returning id into v_parent_m;

insert into public.teams (club_id, rugby_code, category, age_group, gender, created_by)
values (v_club,'union','youth','U13','boys', v_admin) returning id into v_team;
insert into public.teams (club_id, rugby_code, category, age_group, gender, created_by)
values (v_club,'union','youth','U14','boys', v_admin) returning id into v_other_team;

insert into public.team_permissions (membership_id, team_id, permission, created_by)
values (v_coach_m, v_team, 'coach', v_admin);

-- ---- Players, one active and one waiting ----
insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Tom','Thompson', current_date - interval '13 years', true, 'MALE') returning id into v_player;
insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Wes','Waiting', current_date - interval '13 years', true, 'MALE') returning id into v_player2;

insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team,'active') returning id into v_ptm;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player2, v_team,'pending') returning id into v_pending;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_other_team,'active') returning id into v_ptm2;

insert into public.guardians (guardian_user_id, player_id, relationship_type, status)
values (v_parent, v_player, 'guardian', 'active');

-- =========================================================================
-- A. THE ROSTER
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

select count(*) into v_n from public.team_people(v_team) where kind = 'coach';
if v_n = 1 then raise notice 'PASS 1 (A): the team''s one coach is listed';
else raise notice 'FAIL 1 (A): % coach rows', v_n; end if;

select count(*) into v_n from public.team_people(v_team) where kind = 'player';
if v_n = 2 then raise notice 'PASS 2 (A): both the active player and the one waiting are listed';
else raise notice 'FAIL 2 (A): % player rows', v_n; end if;

select count(*) into v_n from public.team_people(v_team) where kind = 'guardian';
if v_n = 1 then raise notice 'PASS 3 (A): the player''s guardian reaches the team through the player';
else raise notice 'FAIL 3 (A): % guardian rows', v_n; end if;

select status into v_status from public.team_people(v_team) where row_id = v_pending;
if v_status = 'requested' then raise notice 'PASS 4 (A): a pending membership reads as a request, never as a member';
else raise notice 'FAIL 4 (A): pending membership read as %', v_status; end if;

-- A guardian is on the roster of every team their child plays for, and no
-- other. Tom is in both sides, so his guardian belongs on both.
select count(*) into v_n from public.team_people(v_other_team) where kind = 'guardian';
if v_n = 1 then raise notice 'PASS 5 (A): a guardian appears on each team their child actually plays for';
else raise notice 'FAIL 5 (A): % guardian rows on the second team their child plays for', v_n; end if;

-- And nowhere else: a team with no players has no parents.
insert into public.teams (club_id, rugby_code, category, age_group, gender, created_by)
values (v_club,'union','youth','U15','boys', v_admin) returning id into v_empty_team;
select count(*) into v_n from public.team_people(v_empty_team) where kind = 'guardian';
if v_n = 0 then raise notice 'PASS 5b (A): a team with no players has no parents or guardians attached to it';
else raise notice 'FAIL 5b (A): % guardian rows on a team with no players', v_n; end if;

-- =========================================================================
-- B. WHO MAY LOOK
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_coach,'role','authenticated')::text, true);
begin
  select count(*) into v_n from public.team_people(v_team);
  if v_n > 0 then raise notice 'PASS 6 (B): a coach assigned to this team sees its people without a club-wide role';
  else raise notice 'FAIL 6 (B): the coach saw an empty roster'; end if;
exception when others then
  raise notice 'FAIL 6 (B): the coach was refused: %', sqlerrm;
end;

perform set_config('request.jwt.claims', json_build_object('sub', v_stranger,'role','authenticated')::text, true);
begin
  perform count(*) from public.team_people(v_team);
  raise notice 'FAIL 7 (B): somebody with no relationship to the club read the roster';
exception when others then
  raise notice 'PASS 7 (B): somebody with no relationship to the club is refused';
end;

-- =========================================================================
-- C. ARCHIVING IS NOT DELETING
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
perform public.archive_player_team_membership(v_ptm);

select status into v_status from public.player_team_memberships where id = v_ptm;
if v_status = 'ended' then raise notice 'PASS 8 (C): the archived player''s membership row survives, marked ended';
else raise notice 'FAIL 8 (C): membership status is %', v_status; end if;

if exists (select 1 from public.players where id = v_player and active) then
  raise notice 'PASS 9 (C): the player themselves is untouched -- they left a team, not the sport';
else raise notice 'FAIL 9 (C): archiving a team place deactivated the player'; end if;

select status into v_status from public.player_team_memberships where id = v_ptm2;
if v_status = 'active' then raise notice 'PASS 10 (C): their place in the OTHER team is unaffected';
else raise notice 'FAIL 10 (C): the other team''s membership became %', v_status; end if;

select status into v_status from public.team_people(v_team) where row_id = v_ptm;
if v_status = 'archived' then raise notice 'PASS 11 (C): the roster shows them as archived, still present';
else raise notice 'FAIL 11 (C): archived player reads as %', coalesce(v_status,'absent'); end if;

-- Restoring puts them back.
perform public.restore_player_team_membership(v_ptm);
select status into v_status from public.player_team_memberships where id = v_ptm;
if v_status = 'active' then raise notice 'PASS 12 (C): an archived player can be restored';
else raise notice 'FAIL 12 (C): restore left status %', v_status; end if;

-- A request is not a place in the team, so it cannot be archived.
begin
  perform public.archive_player_team_membership(v_pending);
  raise notice 'FAIL 13 (C): a pending request was archived as though it were a member';
exception when others then
  raise notice 'PASS 13 (C): a pending request is declined, never archived';
end;

-- =========================================================================
-- D. WHO MAY CHANGE
-- =========================================================================

perform set_config('request.jwt.claims', json_build_object('sub', v_parent,'role','authenticated')::text, true);
begin
  perform public.archive_player_team_membership(v_ptm);
  raise notice 'FAIL 14 (D): a parent archived a player from the team';
exception when others then
  raise notice 'PASS 14 (D): a parent cannot change the team''s roster';
end;

select status into v_status from public.player_team_memberships where id = v_ptm;
if v_status = 'active' then raise notice 'PASS 15 (D): the refused write changed nothing';
else raise notice 'FAIL 15 (D): the row is now %', v_status; end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
