-- Season handover APPLY: idempotency, terminal state, and atomicity.
--
-- Prepare-idempotency was already proven. This is the harder half: the apply
-- path performs irreversible mutation -- it rewrites teams.age_group, snapshots
-- team_season_identity for both seasons, and writes audit_log -- so a second
-- invocation must not run any of that again.
--
-- The mechanism under test is a row lock plus a terminal-state guard:
--   select ... from age_grade_rollover_team_proposals ... FOR UPDATE
--   if decision <> 'pending' then raise
-- A concurrent second caller blocks on the lock, then sees the committed
-- decision and is rejected. Every mutation sits inside that same function
-- call, so a failure rolls the whole apply back (design A, atomic).
--
-- Counts are recorded before, after the first apply, and after the second.
-- Asserting the guard exists is not the same as proving it holds.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_from uuid;
  v_team uuid; v_prop uuid; v_player uuid;
  b_identity int; b_audit int; b_teams int; b_members int;
  a1_identity int; a1_audit int; a1_teams int; a1_members int; a1_age text; a1_decision text;
  a2_identity int; a2_audit int; a2_teams int; a2_members int; a2_age text; a2_decision text;
  v_err text; v_ok boolean;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'apply-idem@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Apply','Idem','apply-idem@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Apply Idem RUFC','Testville','Testshire','union','United Kingdom','England',true,'unverified','site_admin_manual','apply-idem-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'apply-idem-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Apply Idem 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;
select id into v_from from public.seasons where rugby_code='union' and season_year_start=2026 and not is_regression_fixture limit 1;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','AI U16','ai-u16-'||gen_random_uuid()) returning id into v_team;
insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Apply','Player', date '2010-09-01', true, 'MALE') returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team,'active');

perform public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_prop from public.age_grade_rollover_team_proposals
where team_id = v_team order by created_at desc limit 1;

-- ---------- BEFORE ----------
select count(*) into b_identity from public.team_season_identity where team_id = v_team;
select count(*) into b_audit    from public.audit_log where record_id = v_team;
select count(*) into b_teams    from public.teams where club_id = v_club;
select count(*) into b_members  from public.player_team_memberships where team_id = v_team and status='active';
raise notice 'BEFORE  season_identity=% audit=% teams=% memberships=%', b_identity, b_audit, b_teams, b_members;

-- ---------- APPLY #1 ----------
perform public.confirm_rollover_team_proposal(v_prop, 'confirm', null, null, null, null);

select count(*) into a1_identity from public.team_season_identity where team_id = v_team;
select count(*) into a1_audit    from public.audit_log where record_id = v_team;
select count(*) into a1_teams    from public.teams where club_id = v_club;
select count(*) into a1_members  from public.player_team_memberships where team_id = v_team and status='active';
select age_group into a1_age from public.teams where id = v_team;
select decision into a1_decision from public.age_grade_rollover_team_proposals where id = v_prop;
raise notice 'AFTER-1 season_identity=% audit=% teams=% memberships=% age=% decision=%',
  a1_identity, a1_audit, a1_teams, a1_members, a1_age, a1_decision;

if a1_age = 'U17' and a1_decision = 'confirmed' then
  raise notice 'PASS 1 (A): the first apply progressed the team U16 -> U17 and marked the proposal confirmed';
else
  raise notice 'FAIL 1 (A): first apply left age=% decision=%', a1_age, a1_decision;
end if;

if a1_identity = b_identity + 2 then
  raise notice 'PASS 2 (A): the first apply snapshotted BOTH season identities (% -> %)', b_identity, a1_identity;
else
  raise notice 'FAIL 2 (A): season identity rows went % -> %, expected +2', b_identity, a1_identity;
end if;

-- ---------- APPLY #2 (the whole point) ----------
v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_prop, 'confirm', null, null, null, null);
exception when others then
  v_ok := true; v_err := sqlerrm;
end;

select count(*) into a2_identity from public.team_season_identity where team_id = v_team;
select count(*) into a2_audit    from public.audit_log where record_id = v_team;
select count(*) into a2_teams    from public.teams where club_id = v_club;
select count(*) into a2_members  from public.player_team_memberships where team_id = v_team and status='active';
select age_group into a2_age from public.teams where id = v_team;
select decision into a2_decision from public.age_grade_rollover_team_proposals where id = v_prop;
raise notice 'AFTER-2 season_identity=% audit=% teams=% memberships=% age=% decision=%',
  a2_identity, a2_audit, a2_teams, a2_members, a2_age, a2_decision;

if v_ok then
  raise notice 'PASS 3 (A): the second apply was REJECTED cleanly (%)', left(v_err, 60);
else
  raise notice 'FAIL 3 (A): the second apply was accepted';
end if;

-- ---------- THE ASSERTIONS THAT MATTER ----------
if a2_age = 'U17' then
  raise notice 'PASS 4 (A): the team did NOT progress twice -- still U17, not U18';
else
  raise notice 'FAIL 4 (A): the team advanced again to %', a2_age;
end if;

if a2_identity = a1_identity then
  raise notice 'PASS 5 (A): season identity rows unchanged by the retry (% = %)', a1_identity, a2_identity;
else
  raise notice 'FAIL 5 (A): season identity rows % -> % on retry', a1_identity, a2_identity;
end if;

if a2_audit = a1_audit then
  raise notice 'PASS 6 (A): audit rows unchanged by the retry (% = %)', a1_audit, a2_audit;
else
  raise notice 'FAIL 6 (A): audit rows % -> % on retry', a1_audit, a2_audit;
end if;

if a2_teams = a1_teams then
  raise notice 'PASS 7 (A): no team was created by the retry (% = %)', a1_teams, a2_teams;
else
  raise notice 'FAIL 7 (A): team count % -> % on retry', a1_teams, a2_teams;
end if;

if a2_members = a1_members then
  raise notice 'PASS 8 (A): memberships unchanged by the retry (% = %)', a1_members, a2_members;
else
  raise notice 'FAIL 8 (A): memberships % -> % on retry', a1_members, a2_members;
end if;

-- ---------- TERMINAL STATE ----------
if a2_decision = 'confirmed' then
  raise notice 'PASS 9 (B): the proposal holds an unambiguous terminal state after the retry';
else
  raise notice 'FAIL 9 (B): terminal state is %', a2_decision;
end if;

-- ---------- ATOMICITY: a failing apply must leave nothing behind ----------
declare
  v_team2 uuid; v_prop2 uuid; c_before int; c_after int; c_age text;
begin
  -- A second U16 team, plus an existing U17 to collide with, so the apply's
  -- team UPDATE raises unique_violation part-way through the function.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U16','girls','AI G16','ai-g16-'||gen_random_uuid()) returning id into v_team2;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U18','girls','AI G18','ai-g18-'||gen_random_uuid());

  perform public.generate_rollover_proposal(v_club,'union',v_to);
  select id into v_prop2 from public.age_grade_rollover_team_proposals
  where team_id = v_team2 order by created_at desc limit 1;

  select count(*) into c_before from public.team_season_identity where team_id = v_team2;

  v_ok := false;
  begin
    perform public.confirm_rollover_team_proposal(v_prop2, 'confirm', null, null, null, null);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;

  select count(*) into c_after from public.team_season_identity where team_id = v_team2;
  select age_group into c_age from public.teams where id = v_team2;

  if v_ok then
    raise notice 'PASS 10 (C): a colliding apply FAILED rather than silently merging (%)', left(v_err,70);
  else
    raise notice 'FAIL 10 (C): the colliding apply succeeded';
  end if;

  if c_after = c_before and c_age = 'U16' then
    raise notice 'PASS 11 (C): the failed apply left NOTHING behind -- identity rows % = %, team still %', c_before, c_after, c_age;
  else
    raise notice 'FAIL 11 (C): partial state after failure -- identity % -> %, age now %', c_before, c_after, c_age;
  end if;

  -- And retry after the failure is still possible (proposal not consumed).
  if (select decision from public.age_grade_rollover_team_proposals where id = v_prop2) = 'pending' then
    raise notice 'PASS 12 (C): the proposal is still pending after the failure -- retry starts cleanly';
  else
    raise notice 'FAIL 12 (C): the failed apply consumed the proposal';
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
