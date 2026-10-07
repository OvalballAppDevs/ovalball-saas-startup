-- A club may bring more than one side to an age group, and the same side only once.
--
-- THE RULE
--
-- A tournament is organised by age group, and a club entering the U9 competition may be bringing
-- Under 9 A, B and C. All three are teams in that competition, so all three must be recordable.
--
-- WHAT WAS WRONG, AND WHY IT WAS INVISIBLE
--
-- `tournament_participants` was unique on (tournament_id, club_directory_id, canonical_team_type_id).
-- A canonical team type LOOKS like a team and is not one: youth types deliberately carry no squad
-- (`canonical_team_types_structure_check` forces fixed_squad_designation IS NULL for every youth
-- grade, because a B squad is an arrangement inside a club rather than part of the canonical
-- identity). So a club's A and B sides at one grade share a type, and the key allowed exactly one of
-- them. The host's own sides go through `tournament_team_entries`, which is keyed on the team, and
-- were never limited -- so the organiser could do for itself what it could not do for anybody else.
--
-- Migration 20270596 replaced the key with one that identifies a SIDE: the real team for an Ovalball
-- club, a typed `squad_label` for a club that is not on Ovalball. 20270597 then moved the competition
-- key from the canonical type to `age_group`, because a canonical type carries a PATHWAY and a club
-- that is not on Ovalball states a grade without stating one.
--
-- WHAT IS ASSERTED
--
-- Both halves, because widening a uniqueness constraint is exactly the change that quietly becomes no
-- uniqueness at all: multiple real sides go in, AND the same side twice is refused BY THE DATABASE
-- rather than by a disabled button. Plus the product rule that an added club is added, not invited.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_ctt uuid;
  v_hdir uuid; v_hclub uuid;
  v_gdir uuid; v_gclub uuid;
  v_edir uuid;
  v_team_a uuid; v_team_b uuid;
  v_tournament uuid;
  v_n int;
  v_ok boolean;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'sides@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Side','Test','sides@ovalball-test.invalid');
insert into public.site_admins (user_id, status, profile_key) values (v_admin,'active', 'SITE_FULL');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

select id into v_ctt from public.canonical_team_types where category='youth' and age_group='U9' and gender='mixed' limit 1;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Sides Host RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','shost-'||substr(gen_random_uuid()::text,1,8))
returning id into v_hdir;
insert into public.clubs (directory_id, slug, status) values (v_hdir,'shost-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_hclub;

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Sides Guest RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sguest-'||substr(gen_random_uuid()::text,1,8))
returning id into v_gdir;
insert into public.clubs (directory_id, slug, status) values (v_gdir,'sguest-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_gclub;

-- A directory row with NO Ovalball account: this is how a club that is not on the platform is entered.
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Sides External RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','sext-'||substr(gen_random_uuid()::text,1,8))
returning id into v_edir;

-- The guest club's TWO U9 sides. Different teams; one shared canonical type.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug, canonical_team_type_id, active)
values (v_gclub,'union','youth','U9','mixed','Under 9 Mixed','su9a-'||substr(gen_random_uuid()::text,1,8),v_ctt,true)
returning id into v_team_a;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug, canonical_team_type_id, active)
values (v_gclub,'union','youth','U9','mixed','B','Under 9 Mixed B','su9b-'||substr(gen_random_uuid()::text,1,8),v_ctt,true)
returning id into v_team_b;

-- ============ A. The shape that made the old key wrong ============

select count(distinct canonical_team_type_id) into v_n from public.teams where id in (v_team_a, v_team_b);
if v_n = 1 then
  raise notice 'PASS 1 (A): a club''s A and B sides at one grade share ONE canonical team type -- which is why a type is not a team';
else
  raise notice 'FAIL 1 (A): the two sides did not share a canonical type (% distinct)', v_n;
end if;

insert into public.tournaments (host_club_id, host_directory_id, rugby_code, event_date, ends_on, status, name, conversation_id, format, visibility)
values (v_hclub, v_hdir, 'union', current_date, current_date, 'confirmed', 'Sides Festival', gen_random_uuid(), 'round_robin', 'private')
returning id into v_tournament;

-- ============ B. Both sides of one club go in ============

insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status)
values (v_tournament, v_gdir, v_gclub, v_team_a, v_ctt, 'U9', 'added'),
       (v_tournament, v_gdir, v_gclub, v_team_b, v_ctt, 'U9', 'added');

select count(*) into v_n from public.tournament_participants where tournament_id = v_tournament;
if v_n = 2 then
  raise notice 'PASS 2 (B): one club may bring TWO sides to one age group';
else
  raise notice 'FAIL 2 (B): expected 2 participants, found %', v_n;
end if;

select count(distinct canonical_team_type_id) into v_n from public.tournament_participants where tournament_id = v_tournament;
if v_n = 1 then
  raise notice 'PASS 3 (B): and both are recorded at the SAME age group, not split across two';
else
  raise notice 'FAIL 3 (B): the two sides landed at % different grades', v_n;
end if;

-- ============ C. The same side twice is refused by the database ============

v_ok := false;
begin
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status)
  values (v_tournament, v_gdir, v_gclub, v_team_a, v_ctt, 'U9', 'added');
exception when unique_violation then
  v_ok := true;
end;
if v_ok then
  raise notice 'PASS 4 (C): the same team cannot be added to one tournament twice -- refused by the unique index, not by a disabled button';
else
  raise notice 'FAIL 4 (C): a duplicate team entry was accepted';
end if;

-- ============ D. An external club may also bring two sides ============

insert into public.tournament_participants (tournament_id, club_directory_id, canonical_team_type_id, squad_label, age_group, status)
values (v_tournament, v_edir, null, 'A', 'U9', 'external_recorded'),
       (v_tournament, v_edir, null, 'B', 'U9', 'external_recorded');

select count(*) into v_n from public.tournament_participants where tournament_id = v_tournament and status = 'external_recorded';
if v_n = 2 then
  raise notice 'PASS 5 (D): a club that is not on Ovalball may bring two sides, told apart by squad_label and no account';
else
  raise notice 'FAIL 5 (D): expected 2 external sides, found %', v_n;
end if;

v_ok := false;
begin
  insert into public.tournament_participants (tournament_id, club_directory_id, canonical_team_type_id, squad_label, age_group, status)
  values (v_tournament, v_edir, null, 'A', 'U9', 'external_recorded');
exception when unique_violation then
  v_ok := true;
end;
if v_ok then
  raise notice 'PASS 6 (D): and the same external side twice is still one side';
else
  raise notice 'FAIL 6 (D): a duplicate external side was accepted';
end if;

-- ============ E. A row answers "which side" once ============

v_ok := false;
begin
  insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, squad_label, age_group, status)
  values (v_tournament, v_gdir, v_gclub, v_team_b, v_ctt, 'C', 'U9', 'added');
exception when check_violation then
  v_ok := true;
end;
if v_ok then
  raise notice 'PASS 7 (E): a side cannot be both a real team and a typed external label';
else
  raise notice 'FAIL 7 (E): a row carried both a team and a squad label';
end if;

-- ============ F. Added is not invited ============

select count(*) into v_n from public.tournament_participants
where tournament_id = v_tournament and status in ('pending','accepted','declined');
if v_n = 0 then
  raise notice 'PASS 8 (F): nothing the organiser added is waiting for the other club to answer';
else
  raise notice 'FAIL 8 (F): % participant(s) carry an invitation status', v_n;
end if;

select count(*) into v_n from public.tournament_participants
where tournament_id = v_tournament and (responded_at is not null or responded_by is not null);
if v_n = 0 then
  raise notice 'PASS 9 (F): and none carries a response, because none was asked for';
else
  raise notice 'FAIL 9 (F): % participant(s) carry a response', v_n;
end if;

-- ============ G. Removing a side removes the entry, never the team ============

delete from public.tournament_participants where tournament_id = v_tournament and team_id = v_team_b;

select count(*) into v_n from public.teams where id = v_team_b and active;
if v_n = 1 then
  raise notice 'PASS 10 (G): taking a side out of a tournament leaves the club''s team exactly as it was';
else
  raise notice 'FAIL 10 (G): the team record did not survive being removed from the tournament';
end if;

-- And it can be entered again afterwards.
insert into public.tournament_participants (tournament_id, club_directory_id, club_id, team_id, canonical_team_type_id, age_group, status)
values (v_tournament, v_gdir, v_gclub, v_team_b, v_ctt, 'U9', 'added');
select count(*) into v_n from public.tournament_participants where tournament_id = v_tournament and team_id = v_team_b;
if v_n = 1 then
  raise notice 'PASS 11 (G): and it can be added back';
else
  raise notice 'FAIL 11 (G): the removed side could not be added back';
end if;

end $$;

rollback;
