-- Fixtures keep the name the team had in the season they were played.
--
-- Before this resolver existed, a season handover relabelled history: a result
-- the Under-16s played last season was listed under the Under-17s, because
-- every fixture display joins teams.display_name, which the handover rewrites.
-- The per-row snapshot columns on fixtures look like the answer but are
-- captured before insert, never refreshed, and read by nothing.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_admin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_from uuid; v_team uuid; v_prop uuid;
  v_past uuid; v_future uuid;
  v_label text; v_src text; v_age text;
begin

insert into auth.users (id, email, instance_id, aud, role)
values (v_admin,'fxid@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values (v_admin,'F','I','fxid@ovalball-test.invalid');
insert into public.site_admins (user_id, status, admin_role) values (v_admin,'active','full');
perform set_config('request.jwt.claims', json_build_object('sub',v_admin,'role','authenticated')::text, true);

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('FxId RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fxid-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'fxid-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('FxId 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
select id into v_from from public.seasons where rugby_code='union' and season_year_start=2026 and not is_regression_fixture limit 1;

insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','x','fxid1') returning id into v_team;

-- A result already played inside the 26/27 season, and a friendly booked for 27/28.
insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
values (v_team, date '2026-09-05', 'Home', 'Completed', 'Old Rivals') returning id into v_past;
insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
values (v_team, date '2027-10-10', 'Away', 'Booked', 'Next Season Rivals') returning id into v_future;

-- The past fixture is filed against the season it was played in. The future
-- one is booked beyond any season this database defines, so it has no
-- season_id -- which is the case the resolver's fallback has to handle, and
-- the reason a date comparison would not be a safe substitute for it.
if (select season_id from public.fixtures where id=v_past) = v_from then
  raise notice 'PASS 1: the completed result was filed against the season it was played in';
else
  raise notice 'FAIL 1: the past result was filed against the wrong season';
end if;

if (select season_id from public.fixtures where id=v_future) is null then
  raise notice 'PASS 1b: a fixture booked beyond every defined season has no season -- the case the fallback must cover';
else
  raise notice 'FAIL 1b: the future fixture was unexpectedly filed against a season';
end if;

-- ============ Run the handover ============

perform public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_prop from public.age_grade_rollover_team_proposals where team_id=v_team;
perform public.confirm_rollover_team_proposal(v_prop,'confirm',null,null,null,null);

if (select display_name from public.teams where id=v_team) = 'U17' then
  raise notice 'PASS 2: the team is now U17';
else
  raise notice 'FAIL 2: the handover did not progress the team';
end if;

-- ============ The past result keeps the name that played it ============

select owning_team_display_name, owning_team_identity_source
into v_label, v_src
from public.fixture_season_identity where fixture_id = v_past;

if v_label = 'U16' then
  raise notice 'PASS 3: last season''s completed result is still attributed to U16, not relabelled U17';
else
  raise notice 'FAIL 3: the past result is now attributed to [%]', v_label;
end if;

-- 'recorded' means the resolver used a stored identity rather than projecting
-- one forward. A played fixture must never be labelled from a projection.
if v_src = 'recorded' then
  raise notice 'PASS 4: the past name is a RECORDED identity, not a projection or a per-row snapshot';
else
  raise notice 'FAIL 4: the past name came from [%]', v_src;
end if;

-- ============ The future fixture follows the team forward ============

select owning_team_display_name, owning_team_identity_source
into v_label, v_src
from public.fixture_season_identity where fixture_id = v_future;

if v_label = 'U17' then
  raise notice 'PASS 5: next season''s booked fixture belongs to U17 -- the side that will actually play it';
else
  raise notice 'FAIL 5: the future fixture is labelled [%]', v_label;
end if;

-- The stale per-row snapshot would have got this one wrong.
if (select owning_team_display_name_snapshot from public.fixtures where id=v_future) = 'U16' then
  raise notice 'PASS 6: the per-row snapshot still reads U16 here -- which is exactly why the resolver does not use it';
else
  raise notice 'FAIL 6: the snapshot column no longer demonstrates the staleness this resolver exists to avoid';
end if;

-- ============ Age group travels with the name ============

select owning_team_age_group into v_age from public.fixture_season_identity where fixture_id = v_past;
if v_age = 'U16' then
  raise notice 'PASS 7: the age grade recorded against the past result is U16 as played';
else
  raise notice 'FAIL 7: past age grade resolved to [%]', v_age;
end if;

-- ============ A club that never ran a handover still resolves ============

declare
  v_dir2 uuid; v_club2 uuid; v_team2 uuid; v_fx2 uuid;
begin
  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('FxId2 RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','fxid2-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir2;
  insert into public.clubs (directory_id, slug, status) values (v_dir2,'fxid2-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club2;
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club2,'union','youth','U12','boys','x','fxid2t') returning id into v_team2;
  insert into public.fixtures (owning_team_id, kickoff_date, home_away, status, raw_opposition_text)
  values (v_team2, date '2026-09-05', 'Home', 'Completed', 'Someone') returning id into v_fx2;

  select owning_team_display_name, owning_team_identity_source
  into v_label, v_src from public.fixture_season_identity where fixture_id = v_fx2;

  if v_label = 'U12' then
    raise notice 'PASS 8: a club that has never run a handover still resolves, falling back to its only identity';
  else
    raise notice 'FAIL 8: no-handover club resolved to [%]', v_label;
  end if;
end;

-- ============ The register is not a second team directory ============

if (select count(*) from public.team_season_identity where team_id = v_team) = 2 then
  raise notice 'PASS 9: the register holds one row per season for this team -- a record of identity, not a second team';
else
  raise notice 'FAIL 9: register holds % rows for one team', (select count(*) from public.team_season_identity where team_id=v_team);
end if;

if (select count(*) from public.teams where club_id = v_club and active) = 1 then
  raise notice 'PASS 10: the club still has exactly ONE team -- the handover renamed it, it did not clone it';
else
  raise notice 'FAIL 10: the club now has % active teams', (select count(*) from public.teams where club_id=v_club and active);
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
