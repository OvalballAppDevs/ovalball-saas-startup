-- Season handover PREPARE: one handover per club per target season.
--
-- The defect this guards against was reproduced live against the real RPCs:
-- running prepare twice for the same target season opened two independent
-- rollovers, and applying both advanced every youth team TWO age grades
-- (U16 -> U17 -> U18) while the Handover Register still reported U17.
--
-- These assertions are about the SCOPE of idempotency. Per-proposal
-- idempotency was already proven separately (a repeated confirm of the same
-- proposal is rejected); it does not help when the second apply targets a
-- different proposal in a parallel rollover, which is exactly what happened.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid;
  v_team uuid; v_late uuid;
  v_r1 uuid; v_r2 uuid; v_r3 uuid;
  v_prop uuid; v_n int; v_age text; v_dec text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'prep-idem@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Prep','Idem','prep-idem@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Prep Idem RUFC','Testville','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','prep-idem-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'prep-idem-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Prep Idem 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','PI U16','pi-u16-'||gen_random_uuid()) returning id into v_team;

-- A real player, so the per-player half of prepare has something to check.
declare v_player uuid;
begin
  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('Prep','Player',(current_date - interval '15 years 2 months')::date,true, 'MALE') returning id into v_player;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team,'active');
end;

-- ---------- 1. Prepare twice ----------
v_r1 := public.generate_rollover_proposal(v_club,'union',v_to);
v_r2 := public.generate_rollover_proposal(v_club,'union',v_to);

if v_r1 = v_r2 then
  raise notice 'PASS 1: preparing twice returned the SAME handover, not a parallel one';
else
  raise notice 'FAIL 1: two prepares produced different rollovers % and %', v_r1, v_r2;
end if;

select count(*) into v_n from public.age_grade_rollovers where club_id = v_club and to_season_id = v_to;
if v_n = 1 then
  raise notice 'PASS 2: exactly one handover row exists for this club and season';
else
  raise notice 'FAIL 2: % handover rows exist for one club and season', v_n;
end if;

select count(*) into v_n from public.age_grade_rollover_team_proposals where team_id = v_team;
if v_n = 1 then
  raise notice 'PASS 3: the team has ONE proposal across the whole handover, not one per prepare';
else
  raise notice 'FAIL 3: the team has % competing proposals', v_n;
end if;

-- ---------- 2. Decide, apply, then prepare again ----------
-- Deciding is not applying. The team must still be U16 after Confirm, and only
-- move when the handover itself is run.
select id into v_prop from public.age_grade_rollover_team_proposals where team_id = v_team;
perform public.confirm_rollover_team_proposal(v_prop,'confirm',null,null,null,null);
select age_group into v_age from public.teams where id = v_team;
if v_age <> 'U16' then
  raise notice 'FAIL 4a: deciding the handover moved the team to % before Apply', v_age;
else
  raise notice 'PASS 4a: recording the decision left the live team untouched (still U16)';
end if;

perform public.apply_season_handover(v_r1);
select age_group into v_age from public.teams where id = v_team;
if v_age = 'U16' then
  raise notice 'FAIL 4: the apply did not progress the team';
else
  raise notice 'PASS 4: the team progressed U16 -> % when the handover was applied', v_age;
end if;

v_r3 := public.generate_rollover_proposal(v_club,'union',v_to);
select age_group into v_age from public.teams where id = v_team;

if v_r3 = v_r1 then
  raise notice 'PASS 5: re-preparing AFTER an apply resumed the same handover';
else
  raise notice 'FAIL 5: re-preparing after an apply opened a new handover %', v_r3;
end if;

if v_age = 'U17' then
  raise notice 'PASS 6: the team did NOT advance a second grade -- still U17, not U18';
else
  raise notice 'FAIL 6: re-preparing advanced the team again, to %', v_age;
end if;

select count(*) into v_n from public.age_grade_rollover_team_proposals where team_id = v_team;
select decision into v_dec from public.age_grade_rollover_team_proposals where team_id = v_team limit 1;
if v_n = 1 and v_dec = 'confirmed' then
  raise notice 'PASS 7: the decided proposal survived the re-prepare -- resume, not restart';
else
  raise notice 'FAIL 7: % proposals, decision % after re-prepare', v_n, v_dec;
end if;

-- ---------- 3. A team added later still gets picked up ----------
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U14','boys','PI U14','pi-u14-'||gen_random_uuid()) returning id into v_late;

perform public.generate_rollover_proposal(v_club,'union',v_to);

if exists (select 1 from public.age_grade_rollover_team_proposals where team_id = v_late and rollover_id = v_r1) then
  raise notice 'PASS 8: a team created after the first prepare was topped up into the same handover';
else
  raise notice 'FAIL 8: the late team got no proposal';
end if;

select count(*) into v_n from public.age_grade_rollovers where club_id = v_club and to_season_id = v_to;
if v_n = 1 then
  raise notice 'PASS 9: still exactly one handover after four prepares and one apply';
else
  raise notice 'FAIL 9: % handover rows after repeated prepares', v_n;
end if;

-- ---------- 4. Player proposals are generated, and only once ----------

select count(*) into v_n from public.age_grade_rollover_player_proposals where rollover_id = v_r1;
if v_n > 0 then
  raise notice 'PASS 10a: preparing a handover also produced the per-player check (% player proposal(s))', v_n;
else
  raise notice 'FAIL 10a: no player proposals were generated by prepare';
end if;

perform public.generate_rollover_proposal(v_club,'union',v_to);
if (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = v_r1) = v_n then
  raise notice 'PASS 10b: re-preparing did NOT duplicate the player proposals (still %)', v_n;
else
  raise notice 'FAIL 10b: player proposals went from % to % on a repeat prepare',
    v_n, (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = v_r1);
end if;

-- ---------- 5. The constraint holds even against a direct insert ----------
declare v_blocked boolean := false;
begin
  begin
    insert into public.age_grade_rollovers (club_id, rugby_code, to_season_id)
    values (v_club,'union',v_to);
  exception when unique_violation then v_blocked := true;
  end;
  if v_blocked then
    raise notice 'PASS 11: the database itself refuses a second handover -- not just the function';
  else
    raise notice 'FAIL 11: a parallel handover was inserted directly';
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
