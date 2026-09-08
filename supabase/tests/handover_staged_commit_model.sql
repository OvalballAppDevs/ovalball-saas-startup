-- The staged commit model, proven at the two places it was contradicted.
--
-- "Nothing changes until you apply the handover" is a product rule, and until
-- the staged model it was false in the implementation: Confirm mutated the
-- team, the Mixed split created the Girls side, and "Add the missing team"
-- created a live team during review. This suite exists so that cannot come
-- back.
--
-- Part A -- DECIDING CHANGES NOTHING. Confirm, Adjust, Fold, Graduate, a
-- player placement and a Club Holding outcome are each recorded and each
-- leaves live state untouched. Then every one of them is undone, and live
-- state is still untouched.
--
-- Part B -- THE U12 COLLISION. The club runs a U12 today. That cohort becomes
-- U13, and the intake needs a new U12. Two teams cannot hold one identity at
-- any instant, and the old model could not express the gap between "decided"
-- and "done", so the second U12 could not be created at all. Staged, it is
-- planned during review and created inside Apply once the identity is free.
--
-- Part C -- THE MIXED SPLIT, ALL THE WAY THROUGH. A Mixed U11 with a boy and a
-- girl in it. One team, two destinations. Both children must end up in the
-- right side, neither cross-assigned, and their U11 history intact.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_roll uuid;
  v_u13 uuid; v_u18 uuid; v_u15 uuid; v_u15b uuid;
  v_p13 uuid; v_p18 uuid; v_p15 uuid; v_p15b uuid;
  v_kid uuid; v_leaver uuid; v_bee uuid;
  v_prop uuid;
  v_snapshot text; v_after text; v_members text; v_members_after text;
  v_ok boolean; v_err text; v_n int;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'staged@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'St','Ag','staged@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Staged RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','staged-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir,'staged-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

select id into v_to from public.seasons where rugby_code='union' and season_year_start=2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Staged 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

-- =====================================================================
-- PART A -- deciding changes nothing
-- =====================================================================

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U13','boys','U13','sa-13-'||gen_random_uuid()) returning id into v_u13;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U18','boys','U18','sa-18-'||gen_random_uuid()) returning id into v_u18;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U15','boys','U15','sa-15-'||gen_random_uuid()) returning id into v_u15;
insert into public.teams (club_id, rugby_code, category, age_group, gender, squad_designation, display_name, slug)
values (v_club,'union','youth','U15','boys','B','U15 B','sa-15b-'||gen_random_uuid()) returning id into v_u15b;

insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Norm','Kid', date '2013-01-15','MALE',true) returning id into v_kid;
insert into public.player_team_memberships (player_id, team_id, status) values (v_kid, v_u13,'active');

-- Past U18 in Union: the youth pathway ends and he goes to Club Holding.
insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('End','Ofpathway',(current_date - interval '18 years 3 months')::date,'MALE',true) returning id into v_leaver;
insert into public.player_team_memberships (player_id, team_id, status) values (v_leaver, v_u18,'active');

insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Bee','Squadder', date '2011-01-15','MALE',true) returning id into v_bee;
insert into public.player_team_memberships (player_id, team_id, status) values (v_bee, v_u15b,'active');

v_roll := public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_p13  from public.age_grade_rollover_team_proposals where team_id=v_u13;
select id into v_p18  from public.age_grade_rollover_team_proposals where team_id=v_u18;
select id into v_p15  from public.age_grade_rollover_team_proposals where team_id=v_u15;
select id into v_p15b from public.age_grade_rollover_team_proposals where team_id=v_u15b;

-- Exactly what the club looks like before any decision is recorded.
select string_agg(display_name || '/' || age_group || '/' || active::text, ' | ' order by display_name)
into v_snapshot from public.teams where club_id = v_club;
select string_agg(t.display_name || ':' || m.status, ' | ' order by t.display_name)
into v_members from public.player_team_memberships m join public.teams t on t.id=m.team_id
where t.club_id = v_club;

-- Every kind of decision, recorded.
perform public.confirm_rollover_team_proposal(v_p13,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_p15,'adjust','U16',null,null,null);
perform public.confirm_rollover_team_proposal(v_p15b,'fold',null,null,'Not enough players.',null);
perform public.confirm_rollover_team_proposal(v_p18,'graduate',null,null,null,null);

select id into v_prop from public.age_grade_rollover_player_proposals where player_id = v_kid;
perform public.set_rollover_player_placement(v_prop, v_u15);

if (select count(*) from public.age_grade_rollover_team_proposals
    where rollover_id = v_roll and decision <> 'pending') = 4 then
  raise notice 'PASS 1: all four team decisions were recorded';
else
  raise notice 'FAIL 1: only % decision(s) recorded',
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id=v_roll and decision <> 'pending');
end if;

if (select allocation_status from public.age_grade_rollover_player_proposals where player_id = v_leaver) = 'CLUB_HOLDING' then
  raise notice 'PASS 2: the player past U18 is proposed for Club Holding';
else
  raise notice 'FAIL 2: allocation is [%]',
    (select allocation_status from public.age_grade_rollover_player_proposals where player_id=v_leaver);
end if;

select string_agg(display_name || '/' || age_group || '/' || active::text, ' | ' order by display_name)
into v_after from public.teams where club_id = v_club;
select string_agg(t.display_name || ':' || m.status, ' | ' order by t.display_name)
into v_members_after from public.player_team_memberships m join public.teams t on t.id=m.team_id
where t.club_id = v_club;

if v_after = v_snapshot then
  raise notice 'PASS 3: after Confirm, Adjust, Fold AND Graduate, every live team is byte-for-byte what it was';
else
  raise notice 'FAIL 3: live teams changed at decision time -- [%] became [%]', v_snapshot, v_after;
end if;

if v_members_after = v_members then
  raise notice 'PASS 4: no membership moved, ended or appeared -- including the Club Holding player and the folded squad';
else
  raise notice 'FAIL 4: memberships changed at decision time';
end if;

if not exists (select 1 from public.team_season_identity
               where team_id in (v_u13,v_u15,v_u15b,v_u18) and season_id = v_to) then
  raise notice 'PASS 5: nothing was written into the Handover Register for the target season either';
else
  raise notice 'FAIL 5: the target season identity was recorded before the handover ran';
end if;

if not exists (select 1 from public.player_graduation_queue where club_id = v_club) then
  raise notice 'PASS 6: deciding to graduate a cohort put nobody into the holding list yet';
else
  raise notice 'FAIL 6: the graduation queue was written at decision time';
end if;

-- ---------- Undo, until Apply ----------

perform public.undo_rollover_team_decision(v_p13);
perform public.undo_rollover_team_decision(v_p15);
perform public.undo_rollover_team_decision(v_p15b);
perform public.undo_rollover_team_decision(v_p18);
select id into v_prop from public.age_grade_rollover_player_proposals where player_id = v_kid;
perform public.clear_rollover_player_placement(v_prop);

if (select count(*) from public.age_grade_rollover_team_proposals
    where rollover_id = v_roll and decision <> 'pending') = 0 then
  raise notice 'PASS 7: every decision was withdrawn -- Confirm, Adjust, Fold and Graduate are all reversible before Apply';
else
  raise notice 'FAIL 7: % decision(s) could not be withdrawn',
    (select count(*) from public.age_grade_rollover_team_proposals where rollover_id=v_roll and decision <> 'pending');
end if;

if (select selected_team_id from public.age_grade_rollover_player_proposals where player_id = v_kid) is null then
  raise notice 'PASS 8: a player placement can be changed back too';
else
  raise notice 'FAIL 8: the placement survived being cleared';
end if;

select string_agg(display_name || '/' || age_group || '/' || active::text, ' | ' order by display_name)
into v_after from public.teams where club_id = v_club;
if v_after = v_snapshot then
  raise notice 'PASS 9: deciding and then undoing left the club exactly as it started';
else
  raise notice 'FAIL 9: undo did not restore -- [%]', v_after;
end if;

-- =====================================================================
-- PART B -- the U12 collision: an identity vacated inside Apply
-- =====================================================================

declare
  v_dirb uuid; v_clubb uuid; v_rollb uuid;
  v_teamA uuid; v_u11 uuid; v_pA uuid; v_p11 uuid;
  v_starter uuid; v_sprop uuid; v_planned uuid; v_teamB uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Vacate RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','vacate-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dirb;
  insert into public.clubs (directory_id, slug, status)
  values (v_dirb,'vacate-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_clubb;

  -- Team A: the club's U12 today. It is going to become U13.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_clubb,'union','youth','U12','boys','U12','vb-12-'||gen_random_uuid()) returning id into v_teamA;
  -- And a U11 whose boy will be U12 next season, so a U12 is genuinely needed.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_clubb,'union','youth','U11','mixed','U11','vb-11-'||gen_random_uuid()) returning id into v_u11;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Vac','Starter', date '2016-01-15','MALE',true) returning id into v_starter;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_starter, v_u11,'active');

  v_rollb := public.generate_rollover_proposal(v_clubb,'union',v_to);
  select id into v_pA  from public.age_grade_rollover_team_proposals where team_id=v_teamA;
  select id into v_p11 from public.age_grade_rollover_team_proposals where team_id=v_u11;

  perform public.confirm_rollover_team_proposal(v_pA,'confirm',null,null,null,null);
  -- The Mixed cohort becomes Boys U12, and the club adds a Girls side too.
  perform public.confirm_mixed_boundary_rollover(v_p11, true, null, null);

  if (select age_group from public.teams where id=v_teamA) = 'U12'
     and (select count(*) from public.teams where club_id=v_clubb and active) = 2 then
    raise notice 'PASS 10: with both decisions recorded, the club still runs its two teams and A is still U12';
  else
    raise notice 'FAIL 10: a decision moved a team';
  end if;

  if (select count(*) from public.teams where club_id=v_clubb and active and age_group='U12') = 1 then
    raise notice 'PASS 11: exactly ONE live U12 exists during review -- planning a team creates no duplicate identity';
  else
    raise notice 'FAIL 11: % live U12 teams during review',
      (select count(*) from public.teams where club_id=v_clubb and active and age_group='U12');
  end if;

  perform public.apply_season_handover(v_rollb);

  if (select age_group from public.teams where id=v_teamA) = 'U13' then
    raise notice 'PASS 12: at Apply, team A vacated U12 and became U13 -- the same stable team, a new age grade';
  else
    raise notice 'FAIL 12: team A is %', (select age_group from public.teams where id=v_teamA);
  end if;

  select id into v_teamB from public.teams
  where club_id=v_clubb and active and age_group='U12' and gender='boys';

  if v_teamB is not null and v_teamB <> v_teamA then
    raise notice 'PASS 13: a DIFFERENT stable team id now holds U12 -- history follows the id, not the label';
  else
    raise notice 'FAIL 13: no separate team took the U12 identity';
  end if;

  if (select count(*) from public.teams where club_id=v_clubb and active and age_group='U12' and gender='boys') = 1 then
    raise notice 'PASS 14: exactly one Boys U12 after Apply -- no duplicate current identity at any point';
  else
    raise notice 'FAIL 14: % Boys U12 teams after Apply',
      (select count(*) from public.teams where club_id=v_clubb and active and age_group='U12' and gender='boys');
  end if;

  if (select team_id from public.player_team_memberships where player_id=v_starter and status='active') = v_teamB then
    raise notice 'PASS 15: the child who will be U12 is in the side that IS U12, not the one that used to be';
  else
    raise notice 'FAIL 15: the child landed in [%]',
      (select t.display_name from public.player_team_memberships m join public.teams t on t.id=m.team_id
       where m.player_id=v_starter and m.status='active');
  end if;
end;

-- =====================================================================
-- PART C -- the Mixed split, decided and applied
-- =====================================================================

declare
  v_dirc uuid; v_clubc uuid; v_rollc uuid;
  v_mixed uuid; v_pmixed uuid;
  v_harry uuid; v_isla uuid;
  v_boys_team uuid; v_girls_team uuid;
  v_hprop uuid; v_iprop uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('Split RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','split-'||substr(gen_random_uuid()::text,1,8))
  returning id into v_dirc;
  insert into public.clubs (directory_id, slug, status)
  values (v_dirc,'split-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_clubc;

  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_clubc,'union','youth','U11','mixed','U11','sp-11-'||gen_random_uuid()) returning id into v_mixed;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Harry','Mixed', date '2016-01-15','MALE',true) returning id into v_harry;
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Isla','Mixed', date '2016-01-15','FEMALE',true) returning id into v_isla;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_harry, v_mixed,'active');
  insert into public.player_team_memberships (player_id, team_id, status) values (v_isla, v_mixed,'active');

  v_rollc := public.generate_rollover_proposal(v_clubc,'union',v_to);
  select id into v_pmixed from public.age_grade_rollover_team_proposals where team_id=v_mixed;

  -- Before the club answers the split question, neither child has a
  -- destination -- and crucially the BOY is not quietly carried along with the
  -- team while the girl is left behind.
  if (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id=v_harry) is null
     and (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id=v_isla) is null then
    raise notice 'PASS 16: at an unanswered Mixed split neither child is pointed anywhere -- the boy is not carried by the team';
  else
    raise notice 'FAIL 16: harry=[%] isla=[%]',
      (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id=v_harry),
      (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id=v_isla);
  end if;

  if (select normal_canonical_team_type_id from public.age_grade_rollover_player_proposals where player_id=v_harry)
     is distinct from
     (select normal_canonical_team_type_id from public.age_grade_rollover_player_proposals where player_id=v_isla) then
    raise notice 'PASS 17: their canonical allocations differ -- one team, two destinations';
  else
    raise notice 'FAIL 17: both children resolved to the same identity';
  end if;

  -- The club answers: the cohort continues as Boys U12, and a Girls U12 is added.
  perform public.confirm_mixed_boundary_rollover(v_pmixed, true, null, null);

  if (select gender from public.teams where id=v_mixed) = 'mixed'
     and (select count(*) from public.teams where club_id=v_clubc) = 1 then
    raise notice 'PASS 18: answering the split created no Girls team and changed no gender -- both are consequences of Apply';
  else
    raise notice 'FAIL 18: the split decision mutated live state';
  end if;

  select review_state into v_err from public.age_grade_rollover_player_proposals where player_id=v_isla;
  if v_err = 'READY' then
    raise notice 'PASS 19: the girl now has a destination -- the Girls side the club has decided to run';
  else
    raise notice 'FAIL 19: the girl reads [%]', v_err;
  end if;

  perform public.apply_season_handover(v_rollc);

  select id into v_boys_team from public.teams
  where club_id=v_clubc and active and age_group='U12' and gender='boys';
  select id into v_girls_team from public.teams
  where club_id=v_clubc and active and age_group='U12' and gender='girls';

  if v_boys_team = v_mixed then
    raise notice 'PASS 20: the continuing cohort kept its stable team id and became Boys U12';
  else
    raise notice 'FAIL 20: the Mixed cohort did not continue as the Boys side';
  end if;

  if v_girls_team is not null and v_girls_team <> v_mixed then
    raise notice 'PASS 21: a separate Girls U12 was created at Apply';
  else
    raise notice 'FAIL 21: no Girls U12 exists after Apply';
  end if;

  if (select team_id from public.player_team_memberships where player_id=v_harry and status='active') = v_boys_team then
    raise notice 'PASS 22: Harry is in the Boys U12';
  else
    raise notice 'FAIL 22: Harry is in [%]',
      (select t.display_name from public.player_team_memberships m join public.teams t on t.id=m.team_id
       where m.player_id=v_harry and m.status='active');
  end if;

  if (select team_id from public.player_team_memberships where player_id=v_isla and status='active') = v_girls_team then
    raise notice 'PASS 23: Isla is in the Girls U12';
  else
    raise notice 'FAIL 23: Isla is in [%]',
      (select t.display_name from public.player_team_memberships m join public.teams t on t.id=m.team_id
       where m.player_id=v_isla and m.status='active');
  end if;

  if not exists (
    select 1 from public.player_team_memberships m
    where m.status = 'active'
      and ((m.player_id = v_harry and m.team_id = v_girls_team)
        or (m.player_id = v_isla and m.team_id = v_boys_team))
  ) then
    raise notice 'PASS 24: neither child is cross-assigned to the other pathway''s side';
  else
    raise notice 'FAIL 24: a child was placed across the pathway split';
  end if;

  -- History. Both played for the Mixed U11 and that must remain true.
  select count(*) into v_n from public.player_team_memberships
  where team_id = v_mixed and player_id = v_isla and status = 'ended';
  if v_n = 1 then
    raise notice 'PASS 25: Isla''s membership of the Mixed cohort is ended and KEPT -- her U11 season is still hers';
  else
    raise notice 'FAIL 25: % ended membership row(s) for the girl', v_n;
  end if;

  if (select display_name from public.team_season_identity
      where team_id = v_mixed and season_id = (select from_season_id from public.age_grade_rollovers where id = v_rollc))
     = 'Under 11 Mixed' then
    raise notice 'PASS 26: the Register records that this team WAS U11 in the season it played as U11';
  else
    raise notice 'FAIL 26: the previous season identity reads [%]',
      (select display_name from public.team_season_identity where team_id=v_mixed
       and season_id=(select from_season_id from public.age_grade_rollovers where id=v_rollc));
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
