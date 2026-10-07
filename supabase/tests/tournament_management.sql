-- Every participant knows which competition it is in, and editing a tournament edits that tournament.
--
-- THE RULE
--
-- `tournament_participants.age_group` says which competition a side is in. Migration 20270597 made it
-- NOT NULL and updated only the two functions the mobile wizard uses -- leaving four that already
-- existed inserting without a grade, two of them reachable from the WEBSITE. Every one of them would
-- have raised a not-null violation the first time it ran.
--
-- The grade is derivable from the row itself, so 20270598 derives it once at the table rather than
-- editing six callers. This suite proves the derivation, and the three other things that pass depends
-- on: accepting an application enters the side and keeps the application as history, editing a
-- tournament edits THAT tournament rather than making a second one, and removing an age group takes
-- its sides with it after its cost has been reported.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;
do $$
declare
  v_admin uuid := gen_random_uuid();
  v_hdir uuid; v_hclub uuid; v_venue uuid; v_gdir uuid; v_gclub uuid;
  v_ctt uuid; v_team uuid; v_t uuid; v_app uuid; v_n int; v_grade text;
begin
insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'apps@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'App','Test','apps@ovalball-test.invalid');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
select id into v_ctt from public.canonical_team_types where category='youth' and age_group='U9' and gender='mixed' limit 1;

insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('App Host RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','ahost2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_hdir;
insert into public.clubs (directory_id,slug,status) values (v_hdir,'ahost2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_hclub;
insert into public.club_memberships (user_id,club_id,role,status) values (v_admin,v_hclub,'CLUB_ADMIN','active');
insert into public.venues (club_id,name,slug,active) values (v_hclub,'App Ground','ag2-'||substr(gen_random_uuid()::text,1,8),true) returning id into v_venue;

insert into public.club_directory (name,town,county,rugby_code,country,nation,active,verification_status,source,normalized_key)
values ('App Guest RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','aguest2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_gdir;
insert into public.clubs (directory_id,slug,status) values (v_gdir,'aguest2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_gclub;
insert into public.teams (club_id,rugby_code,category,age_group,gender,display_name,slug,canonical_team_type_id,active)
values (v_gclub,'union','youth','U9','mixed','Under 9 Mixed','ag9-'||substr(gen_random_uuid()::text,1,8),v_ctt,true) returning id into v_team;

v_t := public.create_tournament_with_teams(v_hclub,'App Festival',current_date,null,'09:00','round_robin','public',v_venue,null,
       array['U9'], array[]::uuid[], jsonb_build_array(jsonb_build_object('directory_id',v_gdir,'team_id',v_team,'age_group','U9')));
delete from public.tournament_participants where tournament_id=v_t;
raise notice 'PASS 1: a public tournament was created';

-- A. APPLICATION -> ACCEPT (was broken: no age_group)
insert into public.tournament_applications (tournament_id, club_id, age_group, status, applied_by)
values (v_t, v_gclub, 'U9', 'pending', v_admin) returning id into v_app;
insert into public.tournament_application_teams (application_id, team_id) values (v_app, v_team);
perform public.decide_tournament_application(v_app, true);
select count(*) into v_n from public.tournament_participants where tournament_id=v_t;
select age_group into v_grade from public.tournament_participants where tournament_id=v_t limit 1;
if v_n=1 and v_grade='U9' then raise notice 'PASS 2 (A): accepting an application enters the side at U9';
else raise notice 'FAIL 2 (A): % rows, grade %', v_n, v_grade; end if;

select status into v_grade from public.tournament_applications where id=v_app;
if v_grade='accepted' then raise notice 'PASS 3 (A): the application survives as accepted history';
else raise notice 'FAIL 3 (A): application status %', v_grade; end if;

-- Accepting again must not duplicate
perform public.decide_tournament_application(v_app, true);
select count(*) into v_n from public.tournament_participants where tournament_id=v_t;
if v_n=1 then raise notice 'PASS 4 (A): accepting twice does not duplicate the side';
else raise notice 'FAIL 4 (A): % rows after re-accept', v_n; end if;

-- B. THE TRIGGER derives a grade for a caller that supplies none
insert into public.tournament_participants (tournament_id, club_directory_id, canonical_team_type_id, status, invited_by)
values (v_t, v_gdir, v_ctt, 'pending', v_admin);
select age_group into v_grade from public.tournament_participants where tournament_id=v_t and status='pending';
if v_grade='U9' then raise notice 'PASS 5 (B): a row inserted with no grade had U9 derived from its canonical type';
else raise notice 'FAIL 5 (B): derived %', v_grade; end if;

-- C. VISIBILITY is now editable, and it is the SAME tournament
perform public.save_tournament(v_hclub,'App Festival Renamed',current_date,null,'union',v_t,null,null,v_venue,null,null,'knockout','10:30','private');
select count(*) into v_n from public.tournaments where id=v_t and visibility='private' and format='knockout' and name='App Festival Renamed' and kickoff_time='10:30';
if v_n=1 then raise notice 'PASS 6 (C): name, format, kick-off and visibility all updated in place';
else raise notice 'FAIL 6 (C): the edit did not persist'; end if;
select count(*) into v_n from public.tournaments where host_club_id=v_hclub;
if v_n=1 then raise notice 'PASS 7 (C): editing made no second tournament';
else raise notice 'FAIL 7 (C): % tournaments for the host', v_n; end if;

-- D. REMOVING A GRADE reports its cost, then takes its sides with it
select count(*) into v_n from public.count_tournament_age_group_impact(v_t, array['U10']);
if v_n=1 then raise notice 'PASS 8 (D): the impact of dropping U9 is reported before anything changes';
else raise notice 'FAIL 8 (D): impact rows %', v_n; end if;
select count(*) into v_n from public.tournament_participants where tournament_id=v_t;
if v_n=2 then raise notice 'PASS 9 (D): and counting it destroyed nothing';
else raise notice 'FAIL 9 (D): % participants after a count', v_n; end if;

perform public.set_tournament_age_groups(v_t, array['U10']);
select count(*) into v_n from public.tournament_participants where tournament_id=v_t and age_group='U9';
if v_n=0 then raise notice 'PASS 10 (D): dropping U9 removed its sides rather than orphaning them';
else raise notice 'FAIL 10 (D): % U9 sides left behind', v_n; end if;

-- -------------------------------------------------------------------------------------------------
-- E. THE COMPETITION SHAPE, AND THE ONE SHAPE THAT NEEDS A NUMBER.
--
-- Five shapes are offered, and a sixth is not a typo to be tolerated -- an unrecognised format must be
-- refused rather than stored and rendered as itself somewhere later.
--
-- Swiss is the only shape that is incomplete without a round count, and the pairing is enforced BOTH
-- ways: swiss must carry one, and no other shape may. That second half is what stops a tournament
-- that used to be swiss from keeping a stale round count after being changed to knockout.
-- -------------------------------------------------------------------------------------------------

begin
  perform public.save_tournament(v_hclub,'App Festival Renamed',current_date,null,'union',v_t,null,null,v_venue,null,null,'sevens','10:30','private');
  raise notice 'FAIL 11 (E): an unrecognised competition shape was accepted';
exception when others then
  raise notice 'PASS 11 (E): an unrecognised competition shape is refused';
end;

perform public.save_tournament(v_hclub,'App Festival Renamed',current_date,null,'union',v_t,null,null,v_venue,null,null,'swiss','10:30','private',5);
select count(*) into v_n from public.tournaments where id=v_t and format='swiss' and swiss_rounds=5;
if v_n=1 then raise notice 'PASS 12 (E): a swiss tournament keeps the number of rounds it was given';
else raise notice 'FAIL 12 (E): the swiss round count did not persist'; end if;

-- Changing away from swiss must CLEAR the number, not leave it behind.
perform public.save_tournament(v_hclub,'App Festival Renamed',current_date,null,'union',v_t,null,null,v_venue,null,null,'knockout','10:30','private');
select count(*) into v_n from public.tournaments where id=v_t and format='knockout' and swiss_rounds is null;
if v_n=1 then raise notice 'PASS 13 (E): leaving swiss clears the round count rather than stranding it';
else raise notice 'FAIL 13 (E): a stale round count survived a change of shape'; end if;

-- The database refuses the two halves of the pairing directly, so no caller can write them wrong.
begin
  update public.tournaments set format='swiss', swiss_rounds=null where id=v_t;
  raise notice 'FAIL 14 (E): swiss without a round count was stored';
exception when check_violation then
  raise notice 'PASS 14 (E): swiss without a round count is refused by the database';
end;

begin
  update public.tournaments set format='knockout', swiss_rounds=4 where id=v_t;
  raise notice 'FAIL 15 (E): a round count on a non-swiss shape was stored';
exception when check_violation then
  raise notice 'PASS 15 (E): a round count on a non-swiss shape is refused by the database';
end;
end $$;
rollback;
