-- A club in the directory is not "external", and a club with no team is not a dead end.
--
-- THE RULE
--
-- There are three situations and they must not be conflated:
--
--   1. a directory club WITH teams at the grade  -> its real team rows are added,              status added
--   2. a directory club with NO team at the grade -> the club itself is added with a label,     status added
--   3. a club Ovalball has never heard of         -> a directory row is created from the name,  status external_recorded
--
-- Case 2 is the one that was wrong. The organiser was shown "Wigan does not have a U12 team on
-- Ovalball" and given nowhere to go, and had Wigan been re-entered through the manual fallback the
-- result would have been a SECOND Wigan identity with no connection to the real one.
--
-- WHAT THIS PROVES: that the canonical shape already carries case 2 (a real club_directory_id, a null
-- team_id and a squad label), that two squads coexist while an exact duplicate does not, that status
-- follows where the CLUB came from rather than whether it has claimed an account, and that nothing is
-- ever asked of a club the organiser simply added.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_hdir uuid; v_hclub uuid; v_venue uuid;
  v_wdir uuid;                 -- a canonical directory club, unclaimed, with no teams
  v_cdir uuid; v_cclub uuid;   -- a canonical directory club, claimed, WITH teams
  v_ctt uuid; v_team_a uuid; v_team_b uuid; v_team_u13 uuid;
  v_other_team uuid; v_odir uuid; v_oclub uuid;
  v_mdir uuid;                 -- a manually typed club
  v_t uuid; v_n int; v_status text; v_ok boolean; v_source text;
begin

insert into auth.users (id,email,instance_id,aud,role)
values (v_admin,'dirsides@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id,first_name,surname,email) values (v_admin,'Dir','Sides','dirsides@ovalball-test.invalid');

-- The host.
insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('DS Host RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','dsh-'||substr(gen_random_uuid()::text,1,8)) returning id into v_hdir;
insert into public.clubs (directory_id,slug,status) values (v_hdir,'dsh-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_hclub;
insert into public.club_memberships (user_id,club_id,role,status) values (v_admin,v_hclub,'CLUB_ADMIN','active');
insert into public.venues (club_id,name,slug,active) values (v_hclub,'DS Ground','dsg-'||substr(gen_random_uuid()::text,1,8),true) returning id into v_venue;

-- A REAL DIRECTORY CLUB THAT HAS NOT CLAIMED ITS ACCOUNT AND HAS NO TEAMS -- the Wigan case. Its
-- source is a governing-body style import, exactly like the real row.
insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('DS Wigan RUFC','Wigan','Greater Manchester','union','United Kingdom','England',true,'unverified','rugbyunionmap_current_league','dsw-'||substr(gen_random_uuid()::text,1,8)) returning id into v_wdir;

-- A CLAIMED DIRECTORY CLUB WITH TWO SIDES AT U12 AND ONE AT U13.
select id into v_ctt from public.canonical_team_types where category='youth' and age_group='U12' and gender='boys' limit 1;
insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('DS Preston RUFC','T','T','union','United Kingdom','England',true,'unverified','local_dev_seed','dsp-'||substr(gen_random_uuid()::text,1,8)) returning id into v_cdir;
insert into public.clubs (directory_id,slug,status) values (v_cdir,'dsp-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_cclub;
insert into public.teams (club_id,rugby_code,category,age_group,gender,display_name,slug,canonical_team_type_id,active,squad_designation)
values (v_cclub,'union','youth','U12','boys','Under 12 Boys','dsp12a-'||substr(gen_random_uuid()::text,1,8),v_ctt,true,null) returning id into v_team_a;
insert into public.teams (club_id,rugby_code,category,age_group,gender,display_name,slug,canonical_team_type_id,active,squad_designation)
values (v_cclub,'union','youth','U12','boys','Under 12 Boys B','dsp12b-'||substr(gen_random_uuid()::text,1,8),v_ctt,true,'B') returning id into v_team_b;

-- A THIRD CLUB, to prove a team cannot be hung off the wrong club.
insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('DS Other RUFC','T','T','union','United Kingdom','England',true,'unverified','local_dev_seed','dso-'||substr(gen_random_uuid()::text,1,8)) returning id into v_odir;
insert into public.clubs (directory_id,slug,status) values (v_odir,'dso-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_oclub;
insert into public.teams (club_id,rugby_code,category,age_group,gender,display_name,slug,canonical_team_type_id,active)
values (v_oclub,'union','youth','U12','boys','Under 12 Boys','dso12-'||substr(gen_random_uuid()::text,1,8),v_ctt,true) returning id into v_other_team;

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
v_t := public.save_tournament(v_hclub,'DS Festival',current_date,null,'union',null,null,null,v_venue,null,null,'round_robin','09:00','private');
perform public.set_tournament_age_groups(v_t, array['U12','U13']);

-- =====================================================================================================
-- A. THE CANONICAL CLAIM MODEL. Claimed means a `clubs` row exists for the directory row -- nothing
--    else. It is never inferred from teams, a crest, an email, or appearing in search.
-- =====================================================================================================

select count(*) into v_n from public.clubs where directory_id = v_wdir;
if v_n = 0 then raise notice 'PASS 1 (A): the Wigan-style club is unclaimed -- no clubs row for its directory row';
else raise notice 'FAIL 1 (A): the fixture club is claimed, so this suite is not testing what it says'; end if;

select count(*) into v_n from public.teams t join public.clubs c on c.id=t.club_id where c.directory_id = v_wdir;
if v_n = 0 then raise notice 'PASS 2 (A): and it has no teams at all, which is the situation being fixed';
else raise notice 'FAIL 2 (A): the fixture club has teams'; end if;

-- =====================================================================================================
-- B. A DIRECTORY CLUB WITH NO TEAM AT THE GRADE IS STILL ADDABLE, and keeps its own identity.
-- =====================================================================================================

perform public.add_tournament_participant_team(v_t, v_wdir, null, null, 'U12 A', 'U12');
select count(*) into v_n from public.tournament_participants
 where tournament_id=v_t and club_directory_id=v_wdir and team_id is null and squad_label='U12 A' and age_group='U12';
if v_n=1 then raise notice 'PASS 3 (B): a directory club with no team is added, keeping its real club_directory_id';
else raise notice 'FAIL 3 (B): the directory-backed side was not recorded'; end if;

select status into v_status from public.tournament_participants where tournament_id=v_t and club_directory_id=v_wdir and squad_label='U12 A';
if v_status = 'added' then raise notice 'PASS 4 (B): it is "added" -- an unclaimed directory club is not "external"';
else raise notice 'FAIL 4 (B): status is %, so an unclaimed canonical club is still being called external', v_status; end if;

select count(*) into v_n from public.tournament_participants
 where tournament_id=v_t and club_directory_id=v_wdir and (responded_at is not null or status in ('pending','accepted','declined'));
if v_n=0 then raise notice 'PASS 5 (B): nothing was asked of it -- no pending state and no response recorded';
else raise notice 'FAIL 5 (B): an organiser-added side is waiting on an answer'; end if;

-- A SECOND SQUAD for the same club at the same grade.
perform public.add_tournament_participant_team(v_t, v_wdir, null, null, 'U12 B', 'U12');
select count(*) into v_n from public.tournament_participants where tournament_id=v_t and club_directory_id=v_wdir and age_group='U12';
if v_n=2 then raise notice 'PASS 6 (B): two squad labels coexist for one club at one grade';
else raise notice 'FAIL 6 (B): % sides for the club', v_n; end if;

-- The exact duplicate does not.
perform public.add_tournament_participant_team(v_t, v_wdir, null, null, 'U12 A', 'U12');
select count(*) into v_n from public.tournament_participants where tournament_id=v_t and club_directory_id=v_wdir and age_group='U12' and squad_label='U12 A';
if v_n=1 then raise notice 'PASS 7 (B): the same squad label twice is still one side -- refused by the database, not the UI';
else raise notice 'FAIL 7 (B): % rows for U12 A', v_n; end if;

-- A SIDE WITH NO LABEL AT ALL is a real state: the club is coming, the squad is unnamed.
perform public.add_tournament_participant_team(v_t, v_wdir, null, null, null, 'U12');
select count(*) into v_n from public.tournament_participants where tournament_id=v_t and club_directory_id=v_wdir and age_group='U12' and squad_label is null;
if v_n=1 then raise notice 'PASS 8 (B): a club can be added at a grade without naming the squad';
else raise notice 'FAIL 8 (B): an unnamed side was not recorded'; end if;

-- =====================================================================================================
-- C. AGE-GROUP ISOLATION. A U12 side is not in the U13 competition.
-- =====================================================================================================

select count(*) into v_n from public.tournament_participants where tournament_id=v_t and club_directory_id=v_wdir and age_group='U13';
if v_n=0 then raise notice 'PASS 9 (C): the directory-backed U12 sides do not appear at U13';
else raise notice 'FAIL 9 (C): % of them leaked into U13', v_n; end if;

-- The same club at a DIFFERENT grade is a different side, not a duplicate.
perform public.add_tournament_participant_team(v_t, v_wdir, null, null, 'U13 A', 'U13');
select count(*) into v_n from public.tournament_participants where tournament_id=v_t and club_directory_id=v_wdir and age_group='U13';
if v_n=1 then raise notice 'PASS 10 (C): the same club may also bring a side at another grade';
else raise notice 'FAIL 10 (C): % sides at U13', v_n; end if;

-- =====================================================================================================
-- D. REAL TEAMS STILL WORK, and cannot be hung off the wrong club.
-- =====================================================================================================

perform public.add_tournament_participant_team(v_t, v_cdir, v_team_a, null, null, 'U12');
perform public.add_tournament_participant_team(v_t, v_cdir, v_team_b, null, null, 'U12');
select count(*) into v_n from public.tournament_participants where tournament_id=v_t and club_directory_id=v_cdir and team_id is not null;
if v_n=2 then raise notice 'PASS 11 (D): a claimed club''s two real U12 sides are both added as real teams';
else raise notice 'FAIL 11 (D): % real sides', v_n; end if;

select status into v_status from public.tournament_participants where tournament_id=v_t and team_id=v_team_a;
if v_status='added' then raise notice 'PASS 12 (D): and they are "added", not invited';
else raise notice 'FAIL 12 (D): status %', v_status; end if;

v_ok := false;
begin
  -- Another club's team, claimed under Wigan's directory id.
  perform public.add_tournament_participant_team(v_t, v_wdir, v_other_team, null, null, 'U12');
exception when others then v_ok := true;
end;
if v_ok then raise notice 'PASS 13 (D): a team belonging to another club cannot be attached to this one';
else raise notice 'FAIL 13 (D): a foreign team was attached to the wrong club'; end if;

-- =====================================================================================================
-- E. THE GENUINE MANUAL FALLBACK stays external_recorded, and does NOT duplicate a canonical club.
-- =====================================================================================================

insert into public.club_directory (name,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('DS Nowhere RFC','union','United Kingdom','England',true,'unverified','tournament_manual_entry','tme-'||substr(gen_random_uuid()::text,1,8)) returning id into v_mdir;
perform public.add_tournament_participant_team(v_t, v_mdir, null, null, 'U12 A', 'U12');

select status into v_status from public.tournament_participants where tournament_id=v_t and club_directory_id=v_mdir;
if v_status='external_recorded' then raise notice 'PASS 14 (E): a club that exists only because somebody typed it is "external_recorded"';
else raise notice 'FAIL 14 (E): status %, so the manual fallback is indistinguishable from a real club', v_status; end if;

select count(*) into v_n from public.club_directory where lower(name)='ds wigan rufc';
if v_n=1 then raise notice 'PASS 15 (E): adding sides never created a second row for a club already in the directory';
else raise notice 'FAIL 15 (E): % directory rows for the same club', v_n; end if;

-- =====================================================================================================
-- F. THE STATUS RULE IS ABOUT PROVENANCE, NOT CLAIM. Both of these clubs are unclaimed; only one of
--    them was typed in. They must not get the same status.
-- =====================================================================================================

select count(*) into v_n from public.clubs where directory_id in (v_wdir, v_mdir);
if v_n=0 then
  select count(distinct status) into v_n from public.tournament_participants where club_directory_id in (v_wdir, v_mdir) and tournament_id=v_t;
  if v_n=2 then raise notice 'PASS 16 (F): two unclaimed clubs, two different statuses -- the rule reads where the club came from';
  else raise notice 'FAIL 16 (F): both unclaimed clubs got the same status, so claim is still driving the rule'; end if;
else
  raise notice 'FAIL 16 (F): the fixture clubs are not both unclaimed';
end if;


-- =====================================================================================================
-- G. RECORDING A CLUB BY NAME HAPPENS SERVER SIDE, AND MATCHES BEFORE IT CREATES.
--
-- The management tab used to insert into club_directory from the CLIENT, which RLS refuses -- so "Add
-- Club Manually" failed for every club administrator while the create wizard's equivalent worked.
-- Both now call the same function with a name, which is also what stops a typed name that IS a known
-- club from inventing a second copy of it.
-- =====================================================================================================

-- A name Ovalball already has resolves to THAT club, and the side is `added`.
perform public.add_tournament_participant_team(v_t, null, null, null, 'U12 C', 'U12', 'DS Wigan RUFC');
select count(*) into v_n from public.club_directory where lower(name) = 'ds wigan rufc';
if v_n=1 then raise notice 'PASS 17 (G): typing the name of a club already in the directory did not create a second one';
else raise notice 'FAIL 17 (G): % directory rows named DS Wigan RUFC', v_n; end if;

select status into v_status from public.tournament_participants where tournament_id=v_t and squad_label='U12 C';
if v_status='added' then raise notice 'PASS 18 (G): and the side is recorded against the real club, as "added"';
else raise notice 'FAIL 18 (G): status %', v_status; end if;

-- A name Ovalball does NOT have creates the row, stamped as a manual entry.
perform public.add_tournament_participant_team(v_t, null, null, null, 'U12 A', 'U12', 'DS Unknown RFC');
select d.source, p.status into v_source, v_status
from public.tournament_participants p join public.club_directory d on d.id=p.club_directory_id
where p.tournament_id=v_t and d.name='DS Unknown RFC';
if v_source='tournament_manual_entry' and v_status='external_recorded' then
  raise notice 'PASS 19 (G): a club Ovalball has never heard of is created as a manual entry and recorded as external';
else raise notice 'FAIL 19 (G): source=%, status=%', v_source, v_status; end if;

-- A name with no club at all is refused rather than writing a nameless row.
v_ok := false;
begin
  perform public.add_tournament_participant_team(v_t, null, null, null, 'U12 Z', 'U12', '   ');
exception when others then v_ok := true;
end;
if v_ok then raise notice 'PASS 20 (G): a blank club name is refused';
else raise notice 'FAIL 20 (G): a blank club name was accepted'; end if;

-- The host cannot be entered as a participant by name either.
-- THE HOST IS A SIDE LIKE ANY OTHER since 20270605000000. It used to be refused here and kept in a
-- separate table, and that split was the reason a game could not be played between two visiting clubs.
-- The assertion is inverted deliberately: the host MUST now be representable as a side.
perform public.add_tournament_participant_team(v_t, null, null, null, 'H', 'U12', 'DS Host RUFC');
select count(*) into v_n from public.tournament_participants p
join public.tournaments t on t.id = p.tournament_id
where p.tournament_id = v_t and p.club_directory_id = t.host_directory_id and p.squad_label = 'H';
if v_n = 1 then raise notice 'PASS 21 (G): the host is a side like any other -- a game may be played between two visitors';
else raise notice 'FAIL 21 (G): the host could not be recorded as a side'; end if;

end $$;
rollback;
