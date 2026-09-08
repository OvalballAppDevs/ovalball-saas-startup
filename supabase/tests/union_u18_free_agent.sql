-- The end of the youth pathway: club holding, never an automatic adult team.
--
-- PRODUCT RULE: Union U18 does not become Men's 1st or Women's 1st. Players
-- leaving U18 go to a free-agent / club-holding state and wait for an
-- authorised assignment. Both the male and female pathways.
--
-- The holding state is the existing player_graduation_queue at
-- 'pending_placement' -- no second free-agent subsystem.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_fixsec uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid;
  v_u18b uuid; v_u18g uuid; v_snr uuid;
  v_boy uuid; v_girl uuid;
  v_pb uuid; v_pg uuid;
  v_alloc text; v_review text; v_target uuid; v_reason text;
  v_n int; v_err text; v_ok boolean;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_admin ,'fa-admin@ovalball-test.invalid' ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_fixsec,'fa-fixsec@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_admin ,'F','A','fa-admin@ovalball-test.invalid'),
  (v_fixsec,'F','S','fa-fixsec@ovalball-test.invalid');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('FA RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fa-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'fa-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.club_memberships (club_id, user_id, role, status) values
  (v_club, v_admin ,'CLUB_ADMIN','active'),
  (v_club, v_fixsec,'FIXTURE_SECRETARY','active');

-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('FA 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U18','boys','x','fa1') returning id into v_u18b;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U18','girls','x','fa2') returning id into v_u18g;
-- The club DOES run a senior side, so nothing but the rule stops an auto-assign.
insert into public.teams (club_id, rugby_code, category, gender, team_number, display_name, slug)
values (v_club,'union','senior','mens',1,'x','fa3') returning id into v_snr;

insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Leaver','Boy',(current_date - interval '18 years 3 months')::date,'MALE',true) returning id into v_boy;
insert into public.players (first_name, surname, date_of_birth, playing_pathway, active)
values ('Leaver','Girl',(current_date - interval '18 years 3 months')::date,'FEMALE',true) returning id into v_girl;
insert into public.player_team_memberships (player_id, team_id, status) values (v_boy, v_u18b,'active');
insert into public.player_team_memberships (player_id, team_id, status) values (v_girl, v_u18g,'active');

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
perform public.generate_rollover_proposal(v_club,'union',v_to);

-- ============ 1. The proposal says holding, not Men's 1st ============

select allocation_status, review_state, proposed_team_id, reason
into v_alloc, v_review, v_target, v_reason
from public.age_grade_rollover_player_proposals where player_id = v_boy;

if v_alloc = 'CLUB_HOLDING' then
  raise notice 'PASS 1: a Union player past U18 resolves to CLUB_HOLDING';
else
  raise notice 'FAIL 1: allocation is [%]', v_alloc;
end if;

if v_target is null then
  raise notice 'PASS 2: no target team is proposed -- Ovalball does not select anyone for adult rugby';
else
  raise notice 'FAIL 2: a target team was proposed (%)', (select display_name from public.teams where id=v_target);
end if;

if v_target is distinct from v_snr then
  raise notice 'PASS 3: the club''s senior side was NOT auto-assigned even though it exists';
else
  raise notice 'FAIL 3: the player was proposed for the senior team automatically';
end if;

if v_review = 'READY' then
  raise notice 'PASS 4: ageing out is reported as a normal outcome, not an exception to be resolved';
else
  raise notice 'FAIL 4: review state is [%]', v_review;
end if;

-- ============ 2. The same rule for the girls' pathway ============

select allocation_status into v_alloc
from public.age_grade_rollover_player_proposals where player_id = v_girl;
if v_alloc = 'CLUB_HOLDING' then
  raise notice 'PASS 5: the female Union pathway terminates the same way';
else
  raise notice 'FAIL 5: girls'' allocation is [%]', v_alloc;
end if;

-- ============ 3. A genuine mid-pathway gap is still a question ============
-- League Girls U17 must NOT be swallowed by the holding rule: that grade sits
-- inside the pathway, so its absence remains an open question.

select allocation_status into v_alloc
from public.resolve_normal_operational_identity(
  'league',
  (select id from public.seasons where rugby_code='league' and not is_regression_fixture order by starts_on desc limit 1),
  (current_date - interval '17 years 3 months')::date, 'FEMALE');
if v_alloc = 'NEEDS_ATTENTION' then
  raise notice 'PASS 6: the League Girls U17 gap is still NEEDS_ATTENTION -- a missing grade, not an aged-out player';
else
  raise notice 'FAIL 6: the League Girls U17 gap resolved to [%]', v_alloc;
end if;

-- ============ 4. Graduating is Club Admin authority ============

select id into v_pb from public.age_grade_rollover_team_proposals where team_id = v_u18b;

perform set_config('request.jwt.claims', json_build_object('sub', v_fixsec,'role','authenticated')::text, true);
v_ok := false;
begin
  perform public.confirm_rollover_team_proposal(v_pb,'graduate',null,null,null,null);
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%Club Admin%' then
  raise notice 'PASS 7: a Fixture Secretary cannot graduate a cohort through the handover either';
else
  raise notice 'FAIL 7: graduation via handover escaped the Club Admin gate (%)', coalesce(v_err,'accepted');
end if;

-- ============ 5. Graduate puts players into holding ============

perform set_config('request.jwt.claims', json_build_object('sub', v_admin,'role','authenticated')::text, true);
perform public.confirm_rollover_team_proposal(v_pb,'graduate',null,null,null,null);

if (select decision from public.age_grade_rollover_team_proposals where id=v_pb) = 'graduated' then
  raise notice 'PASS 8: the handover records graduation as its own decision, distinct from folding';
else
  raise notice 'FAIL 8: decision is [%]', (select decision from public.age_grade_rollover_team_proposals where id=v_pb);
end if;

-- Staged: recording the graduation must archive nothing and move nobody yet.
if (select active from public.teams where id = v_u18b)
   and exists (select 1 from public.player_team_memberships where player_id=v_boy and status='active') then
  raise notice 'PASS 8b: the cohort is still live and the player still on its roster -- graduation is a decision until Apply';
else
  raise notice 'FAIL 8b: recording graduation archived the cohort before Apply';
end if;

-- Settle everything else, then run the handover for real.
declare v_rest record; v_roll uuid;
begin
  select rollover_id into v_roll from public.age_grade_rollover_team_proposals where id = v_pb;
  for v_rest in
    select p.id, p.proposed_age_group from public.age_grade_rollover_team_proposals p
    where p.rollover_id = v_roll and p.decision = 'pending'
  loop
    if v_rest.proposed_age_group is null then
      perform public.confirm_rollover_team_proposal(v_rest.id,'graduate',null,null,null,null);
    else
      perform public.confirm_rollover_team_proposal(v_rest.id,'confirm',null,null,null,null);
    end if;
  end loop;
  perform public.apply_season_handover(v_roll);
end;

if (select status from public.player_graduation_queue where player_id = v_boy) = 'pending_placement' then
  raise notice 'PASS 9: the player is in the club''s existing holding list, awaiting authorised assignment';
else
  raise notice 'FAIL 9: the player was not placed in holding';
end if;

if not exists (select 1 from public.player_team_memberships where player_id=v_boy and status='active') then
  raise notice 'PASS 10: holding means NO active team membership -- not a live place on an archived cohort';
else
  raise notice 'FAIL 10: the player still holds an active membership';
end if;

if not exists (select 1 from public.player_team_memberships where player_id=v_boy and team_id=v_snr) then
  raise notice 'PASS 11: no adult team membership was created by the handover';
else
  raise notice 'FAIL 11: the handover assigned the player to a senior team';
end if;

-- ============ 6. Identity and history survive ============

if exists (select 1 from public.players where id = v_boy) then
  raise notice 'PASS 12: the same player_id persists -- no new Player record was made';
else
  raise notice 'FAIL 12: the player record was replaced';
end if;

select count(*) into v_n from public.player_team_memberships where player_id = v_boy and team_id = v_u18b;
if v_n = 1 and (select status from public.player_team_memberships where player_id=v_boy and team_id=v_u18b) = 'ended'
   and (select ended_at is not null from public.player_team_memberships where player_id=v_boy and team_id=v_u18b) then
  raise notice 'PASS 13: the membership row remains, ended and dated -- the player''s history with that cohort is intact';
else
  raise notice 'FAIL 13: the historical membership was destroyed or left open';
end if;

if exists (select 1 from public.club_memberships where club_id = v_club)
   and (select club_id from public.player_graduation_queue where player_id = v_boy) = v_club then
  raise notice 'PASS 14: the player is still held against the club, not detached from it';
else
  raise notice 'FAIL 14: the club relationship was lost';
end if;

-- ============ 7. Assignment stays an authorised act ============

declare v_q uuid;
begin
  select id into v_q from public.player_graduation_queue where player_id = v_boy;
  perform public.place_graduating_player(v_q, v_snr);
  if exists (select 1 from public.player_team_memberships where player_id=v_boy and team_id=v_snr and status='active') then
    raise notice 'PASS 15: an authorised person CAN later place the free agent on the senior team';
  else
    raise notice 'FAIL 15: the free agent could not be placed';
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
