-- Historical and future fixture identity, and isolation between two cohorts
-- that share an age label a season apart.
--
-- The scenario the product owner specified:
--
--   TEAM A  team_id 100   2026/27 = U12   2027/28 = U13
--   TEAM B  team_id 200                   2027/28 = new U12
--
--   fixture OLD   season 2026/27  owned by 100
--   fixture NEXT  season 2027/28  owned by 100
--
-- After the handover: OLD still reads U12, NEXT reads U13, both still belong
-- to team 100, and team 200 -- which is now the club's U12 -- inherits
-- neither. The U6 intake rule makes this an every-season occurrence at the
-- bottom of the ladder, so it is not a corner case.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_from uuid; v_to uuid;
  v_a uuid; v_b uuid; v_pa uuid;
  v_old uuid; v_next uuid;
  v_label text; v_src text; v_n int;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'iso@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'I','S','iso@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('Iso RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','iso-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'iso-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;

select id into v_from from public.seasons where rugby_code='union' and season_year_start=2026 and not is_regression_fixture limit 1;
-- Use the club-facing next season if the platform already has one, and
-- only create a synthetic one when it does not. Hardcoding an insert here
-- made the suite abort the moment a real 27/28 season existed.
select id into v_to from public.seasons
where rugby_code = 'union' and season_year_start = 2027 limit 1;
if v_to is null then
  insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
  values ('Iso 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
end if;

-- TEAM A: the cohort. Currently U12.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','boys','x','isoa') returning id into v_a;

-- A result already played this season, and one already booked for next.
insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
values (v_a, date '2026-09-05', 'Home', 'Completed', 'Old Rivals') returning id into v_old;
insert into public.fixtures (owning_team_id, season_id, kickoff_date, home_away, status, raw_opposition_text)
values (v_a, v_to, date '2027-10-10', 'Away', 'Booked', 'Next Season Rivals') returning id into v_next;

if (select season_id from public.fixtures where id=v_old) = v_from
   and (select season_id from public.fixtures where id=v_next) = v_to then
  raise notice 'PASS 1: each fixture is filed against the canonical season it belongs to';
else
  raise notice 'FAIL 1: fixtures were filed against the wrong seasons';
end if;

-- ============ Run the handover ============

declare v_roll uuid;
begin
  v_roll := public.generate_rollover_proposal(v_club,'union',v_to);
  select id into v_pa from public.age_grade_rollover_team_proposals where team_id = v_a;
  perform public.confirm_rollover_team_proposal(v_pa,'confirm',null,null,null,null);
  -- The cohort only vacates U12 when the handover is applied, which is exactly
  -- why the club's new U12 cannot be stood up before that point.
  perform public.apply_season_handover(v_roll);
end;

-- TEAM B: the club's NEW U12 for the coming season.
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U12','boys','x','isob') returning id into v_b;

if (select age_group from public.teams where id=v_a) = 'U13'
   and (select age_group from public.teams where id=v_b) = 'U12' then
  raise notice 'PASS 2: the cohort is now U13 and a separate new team holds U12';
else
  raise notice 'FAIL 2: team states are wrong';
end if;

-- ============ 1. Historical identity is frozen ============

select owning_team_display_name, owning_team_identity_source into v_label, v_src
from public.fixture_season_identity where fixture_id = v_old;
if v_label = 'U12' then
  raise notice 'PASS 3: the OLD fixture still reads U12 -- the identity that actually played it';
else
  raise notice 'FAIL 3: the old fixture now reads [%]', v_label;
end if;
-- A played fixture must be labelled from a RECORDED identity, never from a
-- projection: what happened is not something to be re-derived.
if v_src = 'recorded' then
  raise notice 'PASS 4: the played fixture is labelled from a recorded identity, not a projection';
else
  raise notice 'FAIL 4: resolved via [%]', v_src;
end if;

-- ============ 2. Future identity follows the cohort forward ============

select owning_team_display_name into v_label
from public.fixture_season_identity where fixture_id = v_next;
if v_label = 'U13' then
  raise notice 'PASS 5: the NEXT fixture reads U13 -- the identity that will play it';
else
  raise notice 'FAIL 5: the future fixture reads [%]', v_label;
end if;

if (select owning_team_id from public.fixtures where id=v_next) = v_a
   and (select count(*) from public.fixtures where id = v_next) = 1 then
  raise notice 'PASS 6: the future fixture is the SAME fixture and the SAME team -- not duplicated or transferred';
else
  raise notice 'FAIL 6: the future fixture was moved or copied';
end if;

-- ============ 3. One resolver, three answers ============

if (select owning_team_display_name from public.fixture_season_identity where fixture_id=v_old) = 'U12'
   and (select owning_team_display_name from public.fixture_season_identity where fixture_id=v_next) = 'U13' then
  raise notice 'PASS 7: one resolver returns the past identity for the past fixture and the future identity for the future one';
else
  raise notice 'FAIL 7: the resolver does not distinguish the two seasons';
end if;

-- ============ 4. The new cohort inherits nothing ============

select count(*) into v_n from public.fixtures where owning_team_id = v_b;
if v_n = 0 then
  raise notice 'PASS 8: the new U12 owns NO fixtures -- it did not inherit the old cohort''s history by sharing a label';
else
  raise notice 'FAIL 8: the new U12 owns % fixtures', v_n;
end if;

select count(*) into v_n from public.fixtures f
where f.owning_team_id = v_b or f.opponent_team_id = v_b;
if v_n = 0 then
  raise notice 'PASS 9: the new U12 appears on neither side of any historical or future fixture';
else
  raise notice 'FAIL 9: the new U12 is attached to % fixtures', v_n;
end if;

-- Access follows the stable id: the two teams share an age label but nothing else.
if (select count(distinct owning_team_id) from public.fixtures where owning_team_id in (v_a, v_b)) = 1 then
  raise notice 'PASS 10: every fixture in this club still resolves to one stable owning team id';
else
  raise notice 'FAIL 10: fixtures are split across both cohorts';
end if;

-- ============ 5. Access is never scoped by the age label ============

select count(*) into v_n
from pg_policy
where polrelid = 'public.fixtures'::regclass
  and coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '') ~* 'age_group|display_name';
if v_n = 0 then
  raise notice 'PASS 11: no fixture access policy mentions an age group or display name -- authority follows stable ids';
else
  raise notice 'FAIL 11: % fixture policies key off a mutable age label', v_n;
end if;

-- ============ 6. The register holds both cohorts separately ============

select count(*) into v_n from public.team_season_identity where team_id = v_a;
if v_n = 2 then
  raise notice 'PASS 12: the register records the cohort under BOTH seasons -- U12 then U13 -- against one stable id';
else
  raise notice 'FAIL 12: the register holds % rows for the cohort', v_n;
end if;

if (select age_group from public.team_season_identity where team_id=v_a and season_id=v_from) = 'U12'
   and (select age_group from public.team_season_identity where team_id=v_a and season_id=v_to) = 'U13' then
  raise notice 'PASS 13: the register''s two rows say U12 for last season and U13 for next';
else
  raise notice 'FAIL 13: the register rows are wrong';
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
