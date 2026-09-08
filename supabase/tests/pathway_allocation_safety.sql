-- No silent cross-pathway placement, anywhere.
--
-- The permanent regressions this file exists for: a girl must not end up in a
-- Boys team, a boy must not end up in a Girls team, and BOTH must be able to
-- play mini-rugby together -- which is what proves the guard is not the naive
-- "player pathway must equal team gender".
--
-- It also covers the Mixed -> split boundary, the one point where a team's
-- progression and a player's placement legitimately diverge: the U11 side has
-- one successor, but the children in it go to two different places.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_from uuid;
  v_u11 uuid; v_boys12 uuid; v_girls12 uuid;
  v_boy uuid; v_girl uuid; v_unknown uuid;
  v_ok boolean; v_err text; v_n int; v_key text; v_status text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'pa@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'P','A','pa@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('PA RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pa-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'pa-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

select id into v_from from public.seasons where rugby_code='union' and season_year_start=2026 and not is_regression_fixture limit 1;
select id into v_to from public.seasons where rugby_code='union' and season_year_start=2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('PA 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U11','mixed','x','pa11') returning id into v_u11;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','boys','x','pa12b') returning id into v_boys12;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','girls','x','pa12g') returning id into v_girls12;

-- Two children of the same age in the same Mixed side.
insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Mini','Boy', date '2015-09-01', 'MALE', true) returning id into v_boy;
insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Mini','Girl', date '2015-09-01', 'FEMALE', true) returning id into v_girl;
insert into public.players (first_name, surname, date_of_birth, active)
values ('Unknown','Pathway', date '2015-09-01', true) returning id into v_unknown;

-- ============ 1. Mini-rugby: both pathways, one Mixed team ============

insert into public.player_team_memberships (player_id, team_id, status) values (v_boy, v_u11, 'active');
insert into public.player_team_memberships (player_id, team_id, status) values (v_girl, v_u11, 'active');

if (select count(*) from public.player_team_memberships where team_id = v_u11 and status='active') = 2 then
  raise notice 'PASS 1: a boy and a girl are both in the same Mixed U11 side -- the guard is not "pathway must equal team gender"';
else
  raise notice 'FAIL 1: mini-rugby rejected one of them';
end if;

insert into public.player_team_memberships (player_id, team_id, status) values (v_unknown, v_u11, 'active');
if (select count(*) from public.player_team_memberships where team_id = v_u11 and status='active') = 3 then
  raise notice 'PASS 2: a player whose pathway is not recorded may still play Mixed rugby -- nothing about the decision needs it';
else
  raise notice 'FAIL 2: an unknown pathway was blocked from Mixed rugby';
end if;

-- ============ 2. The hard regressions ============

v_ok := false;
begin
  insert into public.player_team_memberships (player_id, team_id, status) values (v_girl, v_boys12, 'active');
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%other playing pathway%' then
  raise notice 'PASS 3: a girl CANNOT be written into a Boys U12 -- refused by the membership service, not just hidden in the UI';
else
  raise notice 'FAIL 3: cross-pathway placement accepted (%)', coalesce(v_err,'no error');
end if;

v_ok := false;
begin
  insert into public.player_team_memberships (player_id, team_id, status) values (v_boy, v_girls12, 'active');
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok then
  raise notice 'PASS 4: a boy CANNOT be written into a Girls U12 -- the rule runs both ways';
else
  raise notice 'FAIL 4: reverse cross-pathway placement accepted';
end if;

-- A pending membership is a proposal about a real child, so it is guarded too.
v_ok := false;
begin
  insert into public.player_team_memberships (player_id, team_id, status) values (v_girl, v_boys12, 'pending');
exception when others then v_ok := true;
end;
if v_ok then
  raise notice 'PASS 5: a PENDING cross-pathway membership is refused as well -- it is not proposed and then quietly approved';
else
  raise notice 'FAIL 5: a pending cross-pathway membership was created';
end if;

-- Unknown pathway into a gendered side fails closed, like the resolver.
v_ok := false;
begin
  insert into public.player_team_memberships (player_id, team_id, status) values (v_unknown, v_boys12, 'active');
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%does not know which playing pathway%' then
  raise notice 'PASS 6: an unrecorded pathway cannot be assumed in order to join a gendered team';
else
  raise notice 'FAIL 6: an unknown pathway was defaulted into a gendered team';
end if;

-- ============ 3. The recorded exception is the only way through ============

insert into public.player_team_dispensation
  (player_id, source_team_id, target_team_id, season_id, status, governing_body_reference, eligibility_rule_reference, requested_by)
values (v_girl, v_u11, v_boys12, v_to, 'approved', 'RFU-PATHWAY-REF-1', 'RFU Regulation 15', v_admin);

insert into public.player_team_memberships (player_id, team_id, status) values (v_girl, v_boys12, 'active');
if exists (select 1 from public.player_team_memberships where player_id=v_girl and team_id=v_boys12 and status='active') then
  raise notice 'PASS 7: a recorded governing-body dispensation for that exact player and team is the ONLY way across';
else
  raise notice 'FAIL 7: an approved dispensation did not permit the placement';
end if;
delete from public.player_team_memberships where player_id=v_girl and team_id=v_boys12;
delete from public.player_team_dispensation where player_id=v_girl and target_team_id=v_boys12;

-- ============ 4. History is never re-judged ============

insert into public.player_team_memberships (player_id, team_id, status, ended_at)
values (v_girl, v_boys12, 'ended', now());
if exists (select 1 from public.player_team_memberships where player_id=v_girl and team_id=v_boys12 and status='ended') then
  raise notice 'PASS 8: an ENDED membership is history and is not re-judged by today''s rules';
else
  raise notice 'FAIL 8: recording a historical membership was blocked';
end if;
delete from public.player_team_memberships where player_id=v_girl and team_id=v_boys12;

-- ============ 5. Mixed -> split: the team has one successor, the children two

perform public.generate_rollover_proposal(v_club,'union',v_to);

select ctt.key into v_key
from public.age_grade_rollover_player_proposals pp
join public.canonical_team_types ctt on ctt.id = pp.normal_canonical_team_type_id
where pp.player_id = v_boy;
if v_key = 'u12' then
  raise notice 'PASS 9: at the split, the MALE player''s normal identity is the boys U12 -- taken from HIM, not from the Mixed team';
else
  raise notice 'FAIL 9: male resolved to [%]', coalesce(v_key,'nothing');
end if;

select ctt.key into v_key
from public.age_grade_rollover_player_proposals pp
join public.canonical_team_types ctt on ctt.id = pp.normal_canonical_team_type_id
where pp.player_id = v_girl;
if v_key = 'girls_u12' then
  raise notice 'PASS 10: the FEMALE player in the SAME Mixed side goes to Girls U12 -- the cohort does not travel as one gendered block';
else
  raise notice 'FAIL 10: female resolved to [%]', coalesce(v_key,'nothing');
end if;

-- Neither child is pointed at a team that will be the WRONG age next season.
-- This club's U12 sides are themselves moving up -- boys to U13, girls to
-- Girls U14 -- so nothing here will BE U12 when these children arrive, and the
-- honest answer is that both need a team adding.
if (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id=v_boy) is null
   and (select proposed_team_id from public.age_grade_rollover_player_proposals where player_id=v_girl) is null then
  raise notice 'PASS 11: neither child is pointed at a side that will be the wrong age grade by the time they get there';
else
  raise notice 'FAIL 11: boy proposed [%], girl proposed [%]',
    (select coalesce((select display_name from public.teams where id=pp.proposed_team_id),'null') from public.age_grade_rollover_player_proposals pp where pp.player_id=v_boy),
    (select coalesce((select display_name from public.teams where id=pp.proposed_team_id),'null') from public.age_grade_rollover_player_proposals pp where pp.player_id=v_girl);
end if;

-- Both are held for review with an actionable reason, and neither is
-- cross-assigned to the other pathway's side.
--
-- NOTE a real limitation this exposes: provision_missing_placement_team cannot
-- create next season's U12 here, because the club already runs a U12 TODAY --
-- the cohort that is moving up to U13 -- and teams are identified by what they
-- are now. Adding the missing side has to wait until that identity is vacated
-- at Apply. The children are correctly held rather than misrouted, which is
-- the property that matters; the provisioning timing is recorded as an open
-- issue rather than worked around here.
if (select review_state from public.age_grade_rollover_player_proposals where player_id=v_boy) = 'NEEDS_ATTENTION'
   and (select review_state from public.age_grade_rollover_player_proposals where player_id=v_girl) = 'NEEDS_ATTENTION' then
  raise notice 'PASS 11b: both children are held for a decision rather than placed somewhere approximate';
else
  raise notice 'FAIL 11b: a child was not held for review';
end if;

if (select normal_canonical_team_type_id from public.age_grade_rollover_player_proposals where player_id=v_boy)
   is distinct from
   (select normal_canonical_team_type_id from public.age_grade_rollover_player_proposals where player_id=v_girl) then
  raise notice 'PASS 11c: their allocations remain DIFFERENT -- the split survives being held for review';
else
  raise notice 'FAIL 11c: both children resolved to the same identity';
end if;

select allocation_status into v_status from public.age_grade_rollover_player_proposals where player_id=v_unknown;
if v_status = 'CLASSIFICATION_REQUIRED' then
  raise notice 'PASS 12: the child whose pathway is unrecorded is held for review at the split, not sent either way';
else
  raise notice 'FAIL 12: unknown pathway resolved to [%]', v_status;
end if;

-- ============ 6. No fallback when the club lacks the right team ============

declare
  v_dir2 uuid; v_club2 uuid; v_b12 uuid; v_g uuid; v_prop uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('PA2 RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','pa2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'pa2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club2;
  -- This club runs ONLY a boys side at that age.
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U12','boys','x','pa2b') returning id into v_b12;

  insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
  values ('Lone','Girl', date '2015-09-01', 'FEMALE', true) returning id into v_g;

  select canonical_key, allocation_status into v_key, v_status
  from public.resolve_normal_operational_identity('union', v_to, date '2015-09-01', 'FEMALE');
  if v_key = 'girls_u12' then
    raise notice 'PASS 13: her correct identity is still Girls U12 even though this club does not run one';
  else
    raise notice 'FAIL 13: identity resolved to [%]', coalesce(v_key,'nothing');
  end if;

  v_ok := false;
  begin
    insert into public.player_team_memberships (player_id, team_id, status) values (v_g, v_b12, 'active');
  exception when others then v_ok := true;
  end;
  if v_ok then
    raise notice 'PASS 14: and she still cannot be put in the Boys side just because it is the only one at that age';
  else
    raise notice 'FAIL 14: a missing Girls team fell back to the Boys team';
  end if;
end;

-- ============ 7. Signup and handover give the SAME answer ============

declare v_signup_key text; v_handover_key text;
begin
  select ctt.key into v_handover_key
  from public.age_grade_rollover_player_proposals pp
  join public.canonical_team_types ctt on ctt.id = pp.normal_canonical_team_type_id
  where pp.player_id = v_girl;

  select canonical_key into v_signup_key
  from public.resolve_normal_operational_identity(
    'union', v_to, (select date_of_birth from public.players where id=v_girl),
    (select playing_pathway from public.players where id=v_girl));

  if v_signup_key = v_handover_key then
    raise notice 'PASS 15: signup and handover return the SAME canonical identity (%) -- one authority, not two interpretations', v_signup_key;
  else
    raise notice 'FAIL 15: signup said [%] and handover said [%]', v_signup_key, v_handover_key;
  end if;
end;

-- ============ 8. Every membership writer is covered by construction =========

select count(*) into v_n
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~ 'insert into public\.player_team_memberships';
if v_n >= 6 and exists (select 1 from pg_trigger where tgname = 'player_membership_pathway_guard') then
  raise notice 'PASS 16: % membership writers exist and all pass through ONE guard -- the rule is not copied into each caller', v_n;
else
  raise notice 'FAIL 16: the single guard is missing';
end if;

-- ============ 9. No creation path can skip the question ============

select count(*) into v_n
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~ 'insert into public\.players'
  and pg_get_functiondef(p.oid) !~ 'playing_pathway';
if v_n = 0 then
  raise notice 'PASS 17: every function that creates a player records a pathway, or reads one a request carried';
else
  raise notice 'FAIL 17: % creation path(s) still write a player with no pathway', v_n;
end if;

-- Adding the parameter with a DEFAULT created a SECOND function rather than
-- replacing the first, and a five-argument call resolves to the exact arity
-- match -- so the legacy overloads had to go, or the requirement was optional.
select count(*) into v_n
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('add_child_for_guardian','create_player_for_guardian','request_child_link')
  and pg_get_function_arguments(p.oid) not like '%playing_pathway%';
if v_n = 0 then
  raise notice 'PASS 18: no legacy overload survives that would let a caller skip the pathway entirely';
else
  raise notice 'FAIL 18: % legacy overload(s) still accept no pathway', v_n;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
