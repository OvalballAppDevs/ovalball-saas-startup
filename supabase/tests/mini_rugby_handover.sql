-- Mini-rugby through the season handover, under the U6 product rule.
--
-- PRODUCT RULE: the existing U6 cohort progresses to U7 AND a new U6
-- operational team is created for the incoming intake. Deterministic -- not a
-- decision put to the club, and not a cohort left sitting at U6.
--
-- Two earlier behaviours were wrong: excluding U6 (silently "it stays U6"),
-- and offering U6 as a manual choice (shipping an undecided product question
-- as if it were a feature). Both are asserted against below.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_roll uuid;
  v_u6 uuid; v_u7 uuid; v_u8 uuid;
  v_p6 uuid; v_p7 uuid; v_p8 uuid;
  v_intake uuid; v_intake2 uuid;
  v_manual boolean; v_proposed text; v_txt text; v_n int; v_err text; v_ok boolean;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'mini@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'M','R','mini@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Mini RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','mini-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'mini-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Mini 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U6','mixed','x','m6') returning id into v_u6;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U7','mixed','x','m7') returning id into v_u7;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U8','mixed','x','m8') returning id into v_u8;

v_roll := public.generate_rollover_proposal(v_club,'union',v_to);

-- ============ 1. U6 is ordinary automatic progression ============

select id, requires_manual_choice, proposed_age_group into v_p6, v_manual, v_proposed
from public.age_grade_rollover_team_proposals where team_id = v_u6;

if v_p6 is not null and v_proposed = 'U7' then
  raise notice 'PASS 1: the U6 cohort is proposed for U7, matching the canonical progression graph';
else
  raise notice 'FAIL 1: U6 was offered [%]', coalesce(v_proposed,'(nothing)');
end if;

if not v_manual then
  raise notice 'PASS 2: U6 -> U7 is AUTOMATIC -- the product rule is not put to the club as a decision';
else
  raise notice 'FAIL 2: U6 still requires a manual choice';
end if;

-- ============ 2. Decide, then apply: cohort moves up, intake team appears ============
--
-- U6 uses the same staged model as everything else. Deciding to move the U6
-- cohort up STAGES the new intake team rather than creating it; both happen at
-- Apply, in the order that makes them possible.

select id into v_p8 from public.age_grade_rollover_team_proposals where team_id = v_u8;
select id into v_p7 from public.age_grade_rollover_team_proposals where team_id = v_u7;
perform public.confirm_rollover_team_proposal(v_p8,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_p7,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_p6,'confirm',null,null,null,null);

if (select age_group from public.teams where id = v_u6) = 'U6'
   and (select count(*) from public.teams where club_id = v_club and active) = 3 then
  raise notice 'PASS 2b: recording the decisions changed nothing -- still three teams, U6 still U6';
else
  raise notice 'FAIL 2b: deciding the mini band changed live teams before Apply';
end if;

if exists (select 1 from public.age_grade_rollover_planned_teams
           where rollover_id = v_roll and origin = 'U6_INTAKE') then
  raise notice 'PASS 2c: the new U6 intake is PLANNED as a consequence of moving the cohort up';
else
  raise notice 'FAIL 2c: no U6 intake was planned';
end if;

perform public.apply_season_handover(v_roll);

if (select age_group from public.teams where id = v_u6) = 'U7' then
  raise notice 'PASS 3: the existing U6 cohort progressed to U7 and was NOT mutated back to U6';
else
  raise notice 'FAIL 3: the U6 cohort is now %', (select age_group from public.teams where id=v_u6);
end if;

select intake_team_id into v_intake from public.age_grade_rollover_team_proposals where id = v_p6;
if v_intake is not null and v_intake <> v_u6 then
  raise notice 'PASS 4: a NEW stable team id was created for the incoming U6 intake';
else
  raise notice 'FAIL 4: no separate intake team was created';
end if;

if (select age_group from public.teams where id = v_intake) = 'U6'
   and (select active from public.teams where id = v_intake) then
  raise notice 'PASS 5: the intake team is an active U6';
else
  raise notice 'FAIL 5: the intake team is not an active U6';
end if;

if (select gender from public.teams where id = v_intake) = 'mixed' then
  raise notice 'PASS 6: the intake team is Mixed, as mini-rugby requires';
else
  raise notice 'FAIL 6: the intake team gender is %', (select gender from public.teams where id=v_intake);
end if;

select string_agg(age_group, ', ' order by age_group) into v_txt
from public.teams where club_id = v_club and active;
if v_txt = 'U6, U7, U8, U9' then
  raise notice 'PASS 7: the club now runs % -- the band moved up and the intake slot was refilled', v_txt;
else
  raise notice 'FAIL 7: the club now runs [%]', v_txt;
end if;

-- ============ 3. Idempotence ============

v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_p6,'confirm',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 8: applying the U6 proposal again is rejected as already decided';
else
  raise notice 'FAIL 8: the U6 proposal applied twice';
end if;

select count(*) into v_n from public.teams
where club_id = v_club and active and age_group = 'U6' and squad_designation is null;
if v_n = 1 then
  raise notice 'PASS 9: exactly ONE active primary U6 exists -- no indistinguishable duplicate';
else
  raise notice 'FAIL 9: % active primary U6 teams exist', v_n;
end if;

-- Re-preparing must not produce a second intake either.
perform public.generate_rollover_proposal(v_club,'union',v_to);
select count(*) into v_n from public.teams
where club_id = v_club and active and age_group = 'U6' and squad_designation is null;
if v_n = 1 then
  raise notice 'PASS 10: re-preparing the handover created no second U6';
else
  raise notice 'FAIL 10: re-preparing produced % U6 teams', v_n;
end if;

-- The database refuses a duplicate regardless of code path.
v_ok := false;
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U6','mixed','x','m6dup');
exception when unique_violation then v_ok := true;
end;
if v_ok then
  raise notice 'PASS 11: the database itself refuses a second active primary U6';
else
  raise notice 'FAIL 11: a duplicate U6 was inserted directly';
end if;

-- ============ 4. The ordering dependency is now Apply's problem, not the club's ============
--
-- Every mini season contains the same knot: the U6 cohort cannot become U7
-- until last season's U6 -- now the U7s -- has moved to U8. The old model made
-- that the club's problem, refusing the decision and telling them which team
-- to confirm first. Staged, the club decides in any order and Apply untangles
-- it, because nothing has moved until then.

declare
  v_dir2 uuid; v_club2 uuid; v_a6 uuid; v_a7 uuid; v_pa6 uuid; v_pa7 uuid; v_roll2 uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Mini2 RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','mini2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'mini2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club2;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U6','mixed','x','m2a') returning id into v_a6;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U7','mixed','x','m2b') returning id into v_a7;

  v_roll2 := public.generate_rollover_proposal(v_club2,'union',v_to);
  select id into v_pa6 from public.age_grade_rollover_team_proposals where team_id = v_a6;
  select id into v_pa7 from public.age_grade_rollover_team_proposals where team_id = v_a7;

  -- Decide the U6 FIRST -- the order that used to be refused.
  v_ok := true;
  begin
    perform public.confirm_rollover_team_proposal(v_pa6,'confirm',null,null,null,null);
  exception when others then v_ok := false; v_err := sqlerrm;
  end;

  if v_ok then
    raise notice 'PASS 12: the U6 cohort can be decided before the U7s -- there is no ordering constraint on a decision';
  else
    raise notice 'FAIL 12: deciding U6 first was refused (%)', v_err;
  end if;

  if (select age_group from public.teams where id = v_a6) = 'U6'
     and (select age_group from public.teams where id = v_a7) = 'U7' then
    raise notice 'PASS 13: neither cohort moved -- the decision is staged, so the U7 place is not contested yet';
  else
    raise notice 'FAIL 13: deciding moved a cohort before Apply';
  end if;

  perform public.confirm_rollover_team_proposal(v_pa7,'confirm',null,null,null,null);
  perform public.apply_season_handover(v_roll2);

  if (select age_group from public.teams where id = v_a7) = 'U8'
     and (select age_group from public.teams where id = v_a6) = 'U7'
     and (select count(*) from public.teams where club_id = v_club2 and active and age_group = 'U6') = 1 then
    raise notice 'PASS 13b: Apply sequenced it -- U7 vacated first, then U6 took its place, then a new U6 intake was created';
  else
    raise notice 'FAIL 13b: the club now runs [%]',
      (select string_agg(age_group, ', ' order by age_group) from public.teams where club_id = v_club2 and active);
  end if;
end;

-- ============ 5. No squads are invented for the intake ============

if not exists (
  select 1 from public.teams
  where club_id = v_club and age_group = 'U6' and squad_designation is not null
) then
  raise notice 'PASS 14: no B or C squad was created for the intake team';
else
  raise notice 'FAIL 14: a squad was invented for the new U6';
end if;

-- ============ 6. The two U6 cohorts are different stable teams ============

if v_intake <> v_u6 and (select age_group from public.teams where id = v_u6) = 'U7' then
  raise notice 'PASS 15: last season''s U6 and this season''s U6 are DIFFERENT stable team ids -- history must follow the id, not the label';
else
  raise notice 'FAIL 15: the intake team and the progressed cohort are not properly distinct';
end if;

-- ============ 7. Mini band stays mixed and in band ============

if (select count(*) from public.teams where club_id=v_club and active and gender='mixed') = 4 then
  raise notice 'PASS 16: every mini cohort is still Mixed -- the U6-U11 band does not split by gender';
else
  raise notice 'FAIL 16: a mini-rugby cohort lost its Mixed identity';
end if;

if not exists (
  select 1 from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where t.club_id = v_club and p.is_mixed_boundary
) then
  raise notice 'PASS 17: no mini-rugby cohort was treated as the Mixed U11 -> U12 structural split';
else
  raise notice 'FAIL 17: a mini-rugby cohort was flagged as the U11 -> U12 boundary';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
