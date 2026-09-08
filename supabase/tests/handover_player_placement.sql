-- Season handover, end-to-end: a real rollover over real teams and players.
--
-- This exercises the actual generator against real rows rather than probing
-- the resolver functions in isolation. The property under test is that a
-- progressing TEAM does not drag its whole squad with it: each player is
-- validated independently and can reach a different conclusion from the team.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid;
  v_from_u uuid; v_to_u uuid; v_from_l uuid; v_to_l uuid;
  v_t_u16 uuid; v_t_u17 uuid; v_t_gu12 uuid; v_t_gu14 uuid; v_t_lg16 uuid;
  v_p_normal uuid; v_p_nodob uuid; v_p_girl uuid; v_p_lg uuid;
  v_rollover uuid;
  v_n int; v_text text; v_state text; v_alloc text;
begin

-- ---------- a Site Admin actor, so authorisation is real ----------
insert into auth.users (id, email, instance_id, aud, role)
values (v_admin, 'handover-e2e@ovalball-test.invalid', '00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'Handover','E2E','handover-e2e@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role','authenticated')::text, true);

-- ---------- target seasons ----------
insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('E2E Union 27/28', '2027-09-01','2028-06-30', true, 'union', 2027, '27/28', true, '2027-08-01')
returning id into v_to_u;
insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('E2E League 2027', '2027-02-01','2027-10-31', true, 'league', 2027, '2027', true, '2027-01-15')
returning id into v_to_l;
select id into v_from_u from public.seasons where rugby_code='union' and season_year_start=2026 and not is_regression_fixture limit 1;
select id into v_from_l from public.seasons where rugby_code='league' and season_year_start=2026 and not is_regression_fixture limit 1;

-- ---------- a dedicated union club, so the seed club's own teams are
-- ---------- untouched and the canonical identity index cannot collide ----------
insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('E2E Handover RUFC','Testville','Testshire','union','United Kingdom','England', true,'unverified','site_admin_manual','e2e-handover-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir, 'e2e-handover-'||substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','E2E U16','e2e-u16-'||gen_random_uuid()) returning id into v_t_u16;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U17','boys','E2E U17','e2e-u17-'||gen_random_uuid()) returning id into v_t_u17;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','girls','E2E Girls U12','e2e-gu12-'||gen_random_uuid()) returning id into v_t_gu12;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U14','girls','E2E Girls U14','e2e-gu14-'||gen_random_uuid()) returning id into v_t_gu14;

-- ---------- players with deliberately chosen DOBs ----------
-- Union 27/28 -> school year 2027-28. U17 is born 1.09.2010-31.08.2011.
insert into public.players (first_name, surname, date_of_birth, active)
values ('Normal','U17', date '2010-09-01', true) returning id into v_p_normal;
insert into public.players (first_name, surname, date_of_birth, active)
values ('NoDob','Player', null, true) returning id into v_p_nodob;
-- A girl who will be regulatory U13 in 27/28 -> normal identity is Girls U14.
insert into public.players (first_name, surname, date_of_birth, active)
values ('Band','Girl', date '2014-09-01', true) returning id into v_p_girl;

insert into public.player_team_memberships (player_id, team_id, status) values
  (v_p_normal, v_t_u16, 'active'),
  (v_p_nodob,  v_t_u16, 'active'),
  (v_p_girl,   v_t_gu12, 'active');

-- ---------- run the REAL rollover ----------
-- Preparing a handover now runs the per-player check itself. It previously
-- did not -- the generator had no caller anywhere -- so this suite called it
-- by hand and asserted on its return value, which counts rows NEWLY created.
-- That count is now zero on a second call, because prepare already made them.
-- The assertion is re-pointed at what it was always standing in for: the
-- proposals exist, and calling the generator again is safe.
select public.generate_rollover_proposal(v_club, 'union', v_to_u) into v_rollover;

select count(*) into v_n from public.age_grade_rollover_player_proposals where rollover_id = v_rollover;
if v_n >= 3 then
  raise notice 'PASS 1: preparing the handover produced % player proposal(s) from real memberships', v_n;
else
  raise notice 'FAIL 1: only % player proposal(s) exist after prepare', v_n;
end if;

if public.generate_rollover_player_proposals(v_rollover) = 0
   and (select count(*) from public.age_grade_rollover_player_proposals where rollover_id = v_rollover) = v_n then
  raise notice 'PASS 1b: running the generator again created nothing and changed nothing';
else
  raise notice 'FAIL 1b: re-running the player generator duplicated proposals';
end if;

-- ============ A. Team progression ============

select proposed_age_group into v_text from public.age_grade_rollover_team_proposals
where rollover_id = v_rollover and team_id = v_t_u16;
if v_text = 'U17' then
  raise notice 'PASS 2 (A): the U16 team proposal targets U17';
else
  raise notice 'FAIL 2 (A): U16 team proposed %', coalesce(v_text,'nothing');
end if;

select proposed_age_group into v_text from public.age_grade_rollover_team_proposals
where rollover_id = v_rollover and team_id = v_t_gu12;
if v_text = 'U14' then
  raise notice 'PASS 3 (A): the Girls U12 team proposal targets the Girls U14 band, not U13';
else
  raise notice 'FAIL 3 (A): Girls U12 team proposed %', coalesce(v_text,'nothing');
end if;

-- ============ B. Normal-age player ============

select review_state, regulatory_age_label, allocation_status
into v_state, v_text, v_alloc
from public.age_grade_rollover_player_proposals
where rollover_id = v_rollover and player_id = v_p_normal;
if v_state = 'READY' and v_text = 'U17' and v_alloc = 'NORMAL_PLACEMENT' then
  raise notice 'PASS 4 (B): the normal-age player resolves U17 / NORMAL_PLACEMENT / READY';
else
  raise notice 'FAIL 4 (B): normal player got state=% age=% alloc=%', v_state, coalesce(v_text,'null'), v_alloc;
end if;

-- ============ C. Missing DOB is never guessed ============

select review_state, regulatory_status, allocation_status, reason
into v_state, v_text, v_alloc, v_text
from public.age_grade_rollover_player_proposals
where rollover_id = v_rollover and player_id = v_p_nodob;
select regulatory_status, allocation_status into v_text, v_alloc
from public.age_grade_rollover_player_proposals where rollover_id = v_rollover and player_id = v_p_nodob;
if v_state = 'NEEDS_ATTENTION' and v_text = 'DOB_REQUIRED' and v_alloc = 'DOB_REQUIRED' then
  raise notice 'PASS 5 (C): the player with no DOB is DOB_REQUIRED / NEEDS_ATTENTION -- never inferred from their U16 team';
else
  raise notice 'FAIL 5 (C): no-DOB player got state=% reg=% alloc=%', v_state, v_text, v_alloc;
end if;

-- ============ D. Union girls band is NOT a dispensation ============

select p.review_state, p.regulatory_age_label, p.allocation_status, p.movement_requirement, c.key
into v_state, v_text, v_alloc, v_alloc, v_text
from public.age_grade_rollover_player_proposals p
left join public.canonical_team_types c on c.id = p.normal_canonical_team_type_id
where p.rollover_id = v_rollover and p.player_id = v_p_girl;

select p.regulatory_age_label, c.key, p.review_state, coalesce(p.movement_requirement,'none')
into v_text, v_alloc, v_state, v_alloc
from public.age_grade_rollover_player_proposals p
left join public.canonical_team_types c on c.id = p.normal_canonical_team_type_id
where p.rollover_id = v_rollover and p.player_id = v_p_girl;

if (select c.key from public.age_grade_rollover_player_proposals p
    join public.canonical_team_types c on c.id = p.normal_canonical_team_type_id
    where p.rollover_id = v_rollover and p.player_id = v_p_girl) = 'girls_u14' then
  raise notice 'PASS 6 (D): the U13 girl maps to the Girls U14 band as her NORMAL identity';
else
  raise notice 'FAIL 6 (D): U13 girl mapped elsewhere';
end if;

if (select coalesce(movement_requirement,'none') from public.age_grade_rollover_player_proposals
    where rollover_id = v_rollover and player_id = v_p_girl) in ('none','permitted','team_approval_only') then
  raise notice 'PASS 7 (D): the 12 -> 14 band move is NOT classified as needing a dispensation';
else
  raise notice 'FAIL 7 (D): the band move was classified as %',
    (select movement_requirement from public.age_grade_rollover_player_proposals
     where rollover_id = v_rollover and player_id = v_p_girl);
end if;

-- ============ E. DOB never lands in the proposal ============

if not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='age_grade_rollover_player_proposals'
    and (column_name ~* 'birth' or column_name ~* '\mdob\M')
) then
  raise notice 'PASS 8 (E): the proposal table has no date-of-birth column -- result stored, input not';
else
  raise notice 'FAIL 8 (E): a date-of-birth column exists on the proposal table';
end if;

-- ============ F. PREPARE IDEMPOTENCY, with row counts ============

select count(*) into v_n from public.age_grade_rollover_player_proposals where rollover_id = v_rollover;
perform public.generate_rollover_player_proposals(v_rollover);
select count(*) into v_alloc from public.age_grade_rollover_player_proposals where rollover_id = v_rollover;
if v_n::text = v_alloc then
  raise notice 'PASS 9 (F): running prepare twice left the row count at % -- no duplicates', v_n;
else
  raise notice 'FAIL 9 (F): row count moved from % to % on the second prepare', v_n, v_alloc;
end if;

-- ============ G. LEAGUE GIRLS U16: team stops, players still calculated ============

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('E2E Handover RLFC','Testville','Testshire','league','United Kingdom','England', true,'unverified','site_admin_manual','e2e-handover-l-'||substr(gen_random_uuid()::text,1,8))
returning id into v_dir;
insert into public.clubs (directory_id, slug, status)
values (v_dir, 'e2e-handover-l-'||substr(gen_random_uuid()::text,1,8), 'active') returning id into v_club;

if v_club is null then
  raise notice 'SKIP 10 (G): no league club available to test the Girls U16 boundary';
else
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'league','youth','U16','girls','E2E League Girls U16','e2e-lg16-'||gen_random_uuid())
  returning id into v_t_lg16;

  -- League 2027 -> school year 2026-27. U17 is born 1.09.2009-31.08.2010.
  insert into public.players (first_name, surname, date_of_birth, active)
  values ('League','GirlU17', date '2009-09-01', true) returning id into v_p_lg;
  insert into public.player_team_memberships (player_id, team_id, status) values (v_p_lg, v_t_lg16, 'active');

  select public.generate_rollover_proposal(v_club, 'league', v_to_l) into v_rollover;
  perform public.generate_rollover_player_proposals(v_rollover);

  -- The TEAM has no successor.
  select proposed_age_group, requires_manual_choice::text into v_text, v_state
  from public.age_grade_rollover_team_proposals where rollover_id = v_rollover and team_id = v_t_lg16;
  if v_text is null and v_state = 'true' then
    raise notice 'PASS 10 (G): League Girls U16 team has NO automatic successor and requires manual choice';
  else
    raise notice 'FAIL 10 (G): league girls U16 team proposed % (manual=%)', coalesce(v_text,'null'), v_state;
  end if;

  -- The PLAYER is still calculated independently.
  select regulatory_age_label, review_state, allocation_status into v_text, v_state, v_alloc
  from public.age_grade_rollover_player_proposals where rollover_id = v_rollover and player_id = v_p_lg;
  if v_text = 'U17' and v_state = 'NEEDS_ATTENTION' then
    raise notice 'PASS 11 (G): her regulatory age is still resolved (U17) and surfaced for review';
  else
    raise notice 'FAIL 11 (G): league girl got age=% state=% alloc=%', coalesce(v_text,'null'), v_state, v_alloc;
  end if;

  -- She must NOT have been silently moved to Girls U18.
  if (select coalesce(c.key,'none') from public.age_grade_rollover_player_proposals p
      left join public.canonical_team_types c on c.id = p.normal_canonical_team_type_id
      where p.rollover_id = v_rollover and p.player_id = v_p_lg) = 'none' then
    raise notice 'PASS 12 (G): she was NOT silently allocated to Girls U18 -- no team was invented';
  else
    raise notice 'FAIL 12 (G): she was allocated to %',
      (select c.key from public.age_grade_rollover_player_proposals p
       join public.canonical_team_types c on c.id = p.normal_canonical_team_type_id
       where p.rollover_id = v_rollover and p.player_id = v_p_lg);
  end if;

  if not exists (select 1 from public.canonical_team_types where gender='girls' and age_group='U17') then
    raise notice 'PASS 13 (G): running a real handover created no Girls U17 identity';
  else
    raise notice 'FAIL 13 (G): a Girls U17 identity appeared during handover';
  end if;
end if;

-- ============ H. Fixture call-ups are structurally separate ============

if not exists (
  select 1 from information_schema.columns
  where table_schema='public' and table_name='age_grade_rollover_player_proposals' and column_name ~* 'call_up'
) then
  raise notice 'PASS 14 (H): a handover proposal cannot reference a fixture call-up';
else
  raise notice 'FAIL 14 (H): a handover proposal references a call-up';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
