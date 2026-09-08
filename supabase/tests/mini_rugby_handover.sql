-- Mini-rugby through the season handover.
--
-- The handover used to exclude U6 outright, which silently chose "the cohort
-- stays U6" for every club -- including the ones that progress it. The
-- canonical graph disagreed: next_age_grade_for('U6','mixed','union') is U7,
-- and U7 and U8 rolled automatically. U6 was the only age grade where the
-- handover and the canonical graph said different things.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid;
  v_u6 uuid; v_u7 uuid; v_u8 uuid;
  v_p6 uuid; v_p7 uuid;
  v_manual boolean; v_proposed text; v_txt text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'mini@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'M','R','mini@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Mini RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','mini-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'mini-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('Mini 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U6','mixed','x','m6') returning id into v_u6;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U7','mixed','x','m7') returning id into v_u7;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U8','mixed','x','m8') returning id into v_u8;

perform public.generate_rollover_proposal(v_club,'union',v_to);

-- ============ 1. U6 is no longer invisible ============

select id, requires_manual_choice, proposed_age_group
into v_p6, v_manual, v_proposed
from public.age_grade_rollover_team_proposals where team_id = v_u6;

if v_p6 is not null then
  raise notice 'PASS 1: the U6 cohort now appears in the handover instead of being skipped in silence';
else
  raise notice 'FAIL 1: the U6 cohort still gets no proposal';
end if;

if v_proposed = 'U7' then
  raise notice 'PASS 2: the handover suggests U7, matching the canonical progression graph';
else
  raise notice 'FAIL 2: U6 was offered [%]', coalesce(v_proposed,'(nothing)');
end if;

if v_manual then
  raise notice 'PASS 3: it is offered as a decision, never applied automatically -- a standing U6 intake group is legitimate';
else
  raise notice 'FAIL 3: U6 would progress automatically, deciding for the club';
end if;

-- ============ 2. Deferring keeps a standing intake group exactly as it was ==

perform public.confirm_rollover_team_proposal(v_p6,'defer',null,null,null,null);
if (select age_group from public.teams where id=v_u6) = 'U6'
   and (select decision from public.age_grade_rollover_team_proposals where id=v_p6) = 'deferred' then
  raise notice 'PASS 4: Defer leaves the cohort at U6 -- a club running a permanent intake group ends up where it does today';
else
  raise notice 'FAIL 4: Defer changed the U6 team';
end if;

-- ============ 3. Confirming progresses it like any other age grade ============

delete from public.age_grade_rollover_team_proposals where id = v_p6;
insert into public.age_grade_rollover_team_proposals
  (rollover_id, team_id, current_age_group, proposed_age_group, requires_manual_choice)
select rollover_id, v_u6, 'U6', 'U7', true
from public.age_grade_rollover_team_proposals where team_id = v_u7
returning id into v_p6;

-- U7 has to move out of the way first, exactly as any other club would do it.
select id into v_p7 from public.age_grade_rollover_team_proposals where team_id = v_u8;
perform public.confirm_rollover_team_proposal(v_p7,'confirm',null,null,null,null);
select id into v_p7 from public.age_grade_rollover_team_proposals where team_id = v_u7;
perform public.confirm_rollover_team_proposal(v_p7,'confirm',null,null,null,null);
perform public.confirm_rollover_team_proposal(v_p6,'confirm',null,null,null,null);

select string_agg(age_group, ', ' order by age_group) into v_txt
from public.teams where club_id = v_club and active;
if v_txt = 'U7, U8, U9' then
  raise notice 'PASS 5: the whole mini-rugby band moved up together -- %', v_txt;
else
  raise notice 'FAIL 5: mini band is now [%]', v_txt;
end if;

-- ============ 4. Mini-rugby stays mixed, and stays in band ============

if (select count(*) from public.teams where club_id=v_club and active and gender='mixed') = 3 then
  raise notice 'PASS 6: all three cohorts are still Mixed -- the U6-U11 band does not split by gender';
else
  raise notice 'FAIL 6: a mini-rugby cohort lost its Mixed identity';
end if;

if not exists (
  select 1 from public.age_grade_rollover_team_proposals p
  join public.teams t on t.id = p.team_id
  where t.club_id = v_club and p.is_mixed_boundary
) then
  raise notice 'PASS 7: no mini-rugby cohort was treated as the Mixed U11 -> U12 structural split';
else
  raise notice 'FAIL 7: a mini-rugby cohort was flagged as the U11 -> U12 boundary';
end if;

-- ============ 5. A group leaving the mini band is still flagged ============

declare
  v_u11 uuid; v_grp uuid; v_r uuid;
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U11','mixed','x','m11') returning id into v_u11;
  insert into public.scheduling_groups (club_id, season_id, display_tag, active)
  values (v_club, v_to, 'Minis', true) returning id into v_grp;
  insert into public.scheduling_group_members (group_id, team_id) values (v_grp, v_u11);

  select rollover_id into v_r from public.age_grade_rollover_team_proposals where team_id = v_u7;
  delete from public.age_grade_rollover_group_flags where rollover_id = v_r;
  perform public.generate_rollover_proposal(v_club,'union',v_to);

  if exists (select 1 from public.age_grade_rollover_group_flags where rollover_id = v_r) then
    raise notice 'PASS 8: a scheduling group that would leave the U6-U8 band is still flagged for the club to resolve';
  else
    raise notice 'FAIL 8: a group leaving the mini-rugby band was not flagged';
  end if;
end;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
