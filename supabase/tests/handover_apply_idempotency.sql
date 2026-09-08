-- Season handover APPLY: idempotency, terminal state, and atomicity.
--
-- Apply is the only place a season handover mutates anything, and it is
-- irreversible: it rewrites teams.age_group, snapshots team_season_identity for
-- both seasons, moves memberships and writes audit_log. So a second invocation
-- must not run any of that again, and a FAILING invocation must not run any of
-- it at all.
--
-- The mechanisms under test:
--   * a row lock on the handover plus a terminal-state guard (applied_at)
--   * revalidation before any mutation, so a stale decision set is refused
--   * one transaction around the whole operation, so a failure part-way
--     through leaves the club exactly as it was
--
-- Counts are recorded before, after the first apply, and after the second.
-- Asserting the guard exists is not the same as proving it holds.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_from uuid; v_roll uuid;
  v_team uuid; v_prop uuid; v_player uuid;
  b_identity int; b_audit int; b_teams int; b_members int;
  a1_identity int; a1_audit int; a1_teams int; a1_members int; a1_age text; a1_decision text;
  a2_identity int; a2_audit int; a2_teams int; a2_members int; a2_age text; a2_decision text;
  v_err text; v_ok boolean; v_res record;
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

select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Apply Idem 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;
select id into v_from from public.seasons where rugby_code='union' and season_year_start=2026 and not is_regression_fixture limit 1;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','U16','ai-u16-'||gen_random_uuid()) returning id into v_team;
insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
values ('Apply','Player', date '2010-09-01', true, 'MALE') returning id into v_player;
insert into public.player_team_memberships (player_id, team_id, status) values (v_player, v_team,'active');

v_roll := public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_prop from public.age_grade_rollover_team_proposals
where team_id = v_team order by created_at desc limit 1;

-- ---------- BEFORE ----------
select count(*) into b_identity from public.team_season_identity where team_id = v_team;
select count(*) into b_audit    from public.audit_log where record_id = v_team;
select count(*) into b_teams    from public.teams where club_id = v_club;
select count(*) into b_members  from public.player_team_memberships where team_id = v_team and status='active';
raise notice 'BEFORE  season_identity=% audit=% teams=% memberships=%', b_identity, b_audit, b_teams, b_members;

-- ---------- DECIDE, which must change nothing ----------
perform public.confirm_rollover_team_proposal(v_prop, 'confirm', null, null, null, null);

if (select age_group from public.teams where id = v_team) = 'U16'
   and (select count(*) from public.team_season_identity where team_id = v_team) = b_identity then
  raise notice 'PASS 0 (A): recording the decision changed no live team and wrote no season identity';
else
  raise notice 'FAIL 0 (A): deciding mutated live state before Apply';
end if;

-- ---------- APPLY #1 ----------
perform public.apply_season_handover(v_roll);

select count(*) into a1_identity from public.team_season_identity where team_id = v_team;
select count(*) into a1_audit    from public.audit_log where record_id = v_team;
select count(*) into a1_teams    from public.teams where club_id = v_club;
select count(*) into a1_members  from public.player_team_memberships where team_id = v_team and status='active';
select age_group into a1_age from public.teams where id = v_team;
select decision into a1_decision from public.age_grade_rollover_team_proposals where id = v_prop;
raise notice 'AFTER-1 season_identity=% audit=% teams=% memberships=% age=% decision=%',
  a1_identity, a1_audit, a1_teams, a1_members, a1_age, a1_decision;

if a1_age = 'U17' and a1_decision = 'confirmed' then
  raise notice 'PASS 1 (A): the first apply progressed the team U16 -> U17';
else
  raise notice 'FAIL 1 (A): first apply left age=% decision=%', a1_age, a1_decision;
end if;

if a1_identity = b_identity + 2 then
  raise notice 'PASS 2 (A): the first apply snapshotted BOTH season identities (% -> %)', b_identity, a1_identity;
else
  raise notice 'FAIL 2 (A): season identity rows went % -> %, expected +2', b_identity, a1_identity;
end if;

-- ---------- APPLY #2 (the whole point) ----------
select * into v_res from public.apply_season_handover(v_roll);

select count(*) into a2_identity from public.team_season_identity where team_id = v_team;
select count(*) into a2_audit    from public.audit_log where record_id = v_team;
select count(*) into a2_teams    from public.teams where club_id = v_club;
select count(*) into a2_members  from public.player_team_memberships where team_id = v_team and status='active';
select age_group into a2_age from public.teams where id = v_team;
select decision into a2_decision from public.age_grade_rollover_team_proposals where id = v_prop;
raise notice 'AFTER-2 season_identity=% audit=% teams=% memberships=% age=% decision=%',
  a2_identity, a2_audit, a2_teams, a2_members, a2_age, a2_decision;

if v_res.already_applied and v_res.teams_progressed = 0 then
  raise notice 'PASS 3 (A): the second apply reported the handover as already applied and did no work';
else
  raise notice 'FAIL 3 (A): the second apply did work: already=% progressed=%', v_res.already_applied, v_res.teams_progressed;
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
if (select applied_at from public.age_grade_rollovers where id = v_roll) is not null
   and public.handover_state(v_roll) = 'COMPLETED' then
  raise notice 'PASS 9 (B): the handover holds an unambiguous terminal state after the retry';
else
  raise notice 'FAIL 9 (B): terminal state is %', public.handover_state(v_roll);
end if;

-- ---------- Decisions are read-only once applied ----------
v_ok := false;
begin
  perform public.undo_rollover_team_decision(v_prop);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%already been applied%' then
  raise notice 'PASS 9b (B): a decision cannot be undone after the handover has run -- that is a separate operational change';
else
  raise notice 'FAIL 9b (B): an applied decision was withdrawn (%)', coalesce(v_err,'accepted');
end if;

-- ---------- ATOMICITY: a failing apply must leave NOTHING behind ----------
--
-- A second handover, made ready, and then broken immediately before Apply by
-- deleting a player's date of birth. Revalidation must catch it, and nothing
-- may move.
declare
  v_dir2 uuid; v_club2 uuid; v_roll2 uuid;
  v_t1 uuid; v_t2 uuid; v_p1 uuid; v_p2 uuid; v_kid uuid;
  c_teams text; c_after text; c_members int; c_members_after int; c_identity int; c_identity_after int;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Atomic RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','atomic-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir2,'atomic-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club2;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U13','boys','U13','at-u13-'||gen_random_uuid()) returning id into v_t1;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U15','boys','U15','at-u15-'||gen_random_uuid()) returning id into v_t2;

  insert into public.players (first_name, surname, date_of_birth, active, playing_pathway)
  values ('Atom','Kid', date '2014-01-15', true, 'MALE') returning id into v_kid;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_kid, v_t1,'active');

  v_roll2 := public.generate_rollover_proposal(v_club2,'union',v_to);
  select id into v_p1 from public.age_grade_rollover_team_proposals where team_id = v_t1;
  select id into v_p2 from public.age_grade_rollover_team_proposals where team_id = v_t2;
  perform public.confirm_rollover_team_proposal(v_p1,'confirm',null,null,null,null);
  perform public.confirm_rollover_team_proposal(v_p2,'confirm',null,null,null,null);

  if public.handover_state(v_roll2) = 'READY' then
    raise notice 'PASS 10 (C): the second handover reached READY with every decision recorded';
  else
    raise notice 'FAIL 10 (C): state is %', public.handover_state(v_roll2);
  end if;

  select string_agg(display_name, ', ' order by display_name) into c_teams
  from public.teams where club_id = v_club2 and active;
  select count(*) into c_members from public.player_team_memberships where player_id = v_kid;
  select count(*) into c_identity from public.team_season_identity
  where team_id in (v_t1, v_t2);

  -- Break one dependency, without touching the handover at all.
  update public.players set date_of_birth = null where id = v_kid;

  v_ok := false;
  begin
    perform public.apply_season_handover(v_roll2);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;

  select string_agg(display_name, ', ' order by display_name) into c_after
  from public.teams where club_id = v_club2 and active;
  select count(*) into c_members_after from public.player_team_memberships where player_id = v_kid;
  select count(*) into c_identity_after from public.team_season_identity
  where team_id in (v_t1, v_t2);

  if v_ok then
    raise notice 'PASS 11 (C): a dependency broken after review made Apply FAIL rather than proceed (%)', left(v_err,70);
  else
    raise notice 'FAIL 11 (C): Apply proceeded on a decision set that no longer held';
  end if;

  if c_after = c_teams then
    raise notice 'PASS 12 (C): NO team moved -- the club still runs exactly [%]', c_after;
  else
    raise notice 'FAIL 12 (C): partial application -- [%] became [%]', c_teams, c_after;
  end if;

  if c_members_after = c_members then
    raise notice 'PASS 13 (C): NO membership moved -- % row(s) before and after', c_members;
  else
    raise notice 'FAIL 13 (C): memberships % -> % after a failed apply', c_members, c_members_after;
  end if;

  if c_identity_after = c_identity then
    raise notice 'PASS 14 (C): the Handover Register was not written by the failed apply';
  else
    raise notice 'FAIL 14 (C): % register rows were left behind', c_identity_after - c_identity;
  end if;

  if (select applied_at from public.age_grade_rollovers where id = v_roll2) is null
     and public.handover_state(v_roll2) <> 'COMPLETED' then
    raise notice 'PASS 15 (C): the handover is NOT marked complete -- it can be repaired and run properly';
  else
    raise notice 'FAIL 15 (C): the failed apply marked the handover complete';
  end if;

  -- Repair, and it applies cleanly.
  update public.players set date_of_birth = date '2014-01-15' where id = v_kid;
  perform internal.refresh_rollover_player_proposals(v_roll2);
  perform public.apply_season_handover(v_roll2);

  select string_agg(display_name, ', ' order by display_name) into c_after
  from public.teams where club_id = v_club2 and active;
  if c_after = 'Under 14 Boys, Under 16 Boys' then
    raise notice 'PASS 16 (C): once the blocker was repaired the same handover applied cleanly -- %', c_after;
  else
    raise notice 'FAIL 16 (C): after repair the club runs [%]', c_after;
  end if;
end;

-- ---------- CONCURRENCY: a decision set that changed under the reviewer ----
declare
  v_dir3 uuid; v_club3 uuid; v_roll3 uuid; v_t3 uuid; v_p3 uuid; v_rev int;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Race RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','race-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dir3;
  insert into public.clubs (directory_id, slug, status)
  values (v_dir3,'race-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club3;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club3,'union','youth','U13','boys','U13','rc-'||gen_random_uuid()) returning id into v_t3;

  v_roll3 := public.generate_rollover_proposal(v_club3,'union',v_to);
  select id into v_p3 from public.age_grade_rollover_team_proposals where team_id = v_t3;
  perform public.confirm_rollover_team_proposal(v_p3,'confirm',null,null,null,null);

  -- What the reviewer read.
  select decisions_revision into v_rev from public.age_grade_rollovers where id = v_roll3;

  -- Somebody else changes their mind in the meantime.
  perform public.undo_rollover_team_decision(v_p3);
  perform public.confirm_rollover_team_proposal(v_p3,'adjust','U15',null,null,null);

  v_ok := false;
  begin
    perform public.apply_season_handover(v_roll3, v_rev);
  exception when others then v_ok := true; v_err := sqlerrm;
  end;

  if v_ok and v_err like '%changed since you reviewed them%' then
    raise notice 'PASS 17 (D): applying a decision set that changed under the reviewer is refused, not applied silently';
  else
    raise notice 'FAIL 17 (D): a stale snapshot was applied (%)', coalesce(v_err,'accepted');
  end if;

  if (select age_group from public.teams where id = v_t3) = 'U13' then
    raise notice 'PASS 18 (D): the rejected apply changed nothing';
  else
    raise notice 'FAIL 18 (D): the rejected apply moved the team to %', (select age_group from public.teams where id=v_t3);
  end if;

  -- Re-reading the current revision applies fine.
  select decisions_revision into v_rev from public.age_grade_rollovers where id = v_roll3;
  perform public.apply_season_handover(v_roll3, v_rev);
  if (select age_group from public.teams where id = v_t3) = 'U15' then
    raise notice 'PASS 19 (D): applying the decisions actually on file works, and applies the LATEST decision';
  else
    raise notice 'FAIL 19 (D): the team is %', (select age_group from public.teams where id=v_t3);
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
