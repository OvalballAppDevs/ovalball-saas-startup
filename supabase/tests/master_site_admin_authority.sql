-- Full Site Admin authority survives every ordinary product workflow.
--
-- The risk this guards is quiet: Site Admin authority lives in site_admins,
-- club authority lives in club_memberships, and nothing about joining a club,
-- being given a club role, or being processed by a season handover should
-- reach across from one to the other. A Full Site Admin who loses their
-- authority by being made a Club Admin would be locked out of their own
-- platform by an ordinary act.
--
-- Every assertion runs the real path as a real authenticated user.
--
-- Wrapped in begin/rollback: leaves the database exactly as it found it.

begin;

do $$
declare
  v_master uuid := gen_random_uuid();
  v_second uuid := gen_random_uuid();
  v_clubadmin uuid := gen_random_uuid();
  v_dir uuid; v_club uuid; v_to uuid; v_team uuid; v_prop uuid;
  v_err text; v_ok boolean; v_n int;

  function_probe text;
begin

insert into auth.users (id, email, instance_id, aud, role) values
  (v_master   ,'ms-master@ovalball-test.invalid'   ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_second   ,'ms-second@ovalball-test.invalid'   ,'00000000-0000-0000-0000-000000000000','authenticated','authenticated'),
  (v_clubadmin,'ms-clubadmin@ovalball-test.invalid','00000000-0000-0000-0000-000000000000','authenticated','authenticated');
insert into public.profiles (id, first_name, surname, email) values
  (v_master   ,'M','Aster','ms-master@ovalball-test.invalid'),
  (v_second   ,'S','Econd','ms-second@ovalball-test.invalid'),
  (v_clubadmin,'C','Admin','ms-clubadmin@ovalball-test.invalid');

insert into public.site_admins (user_id, status, admin_role) values (v_master,'active','full');

insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
values ('MS RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','ms-'||substr(gen_random_uuid()::text,1,8)) returning id into v_dir;
insert into public.clubs (directory_id, slug, status) values (v_dir,'ms-'||substr(gen_random_uuid()::text,1,8),'active') returning id into v_club;
insert into public.club_memberships (club_id, user_id, role, status) values (v_club, v_clubadmin,'CLUB_ADMIN','active');

insert into public.seasons (name, starts_on, ends_on, active, rugby_code, season_year_start, season_ref, is_regression_fixture, pre_season_starts_on)
values ('MS 27/28','2027-09-01','2028-06-30',true,'union',2027,'27/28',true,'2027-08-01') returning id into v_to;
insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
values (v_club,'union','youth','U16','boys','x','ms1') returning id into v_team;

-- ============ 1. Joining a club ============

insert into public.club_memberships (club_id, user_id, role, status)
values (v_club, v_master, 'BASIC_USER', 'active');

perform set_config('request.jwt.claims', json_build_object('sub', v_master,'role','authenticated')::text, true);
if internal.is_full_site_admin() then
  raise notice 'PASS 1: joining a club as an ordinary member left Full Site Admin authority intact';
else
  raise notice 'FAIL 1: joining a club removed Full Site Admin authority';
end if;

-- ============ 2. Being given a club role ============

update public.club_memberships set role = 'CLUB_ADMIN' where club_id = v_club and user_id = v_master;
if internal.is_full_site_admin() then
  raise notice 'PASS 2: being made a Club Admin did not replace Site Admin authority with club authority';
else
  raise notice 'FAIL 2: a club role replaced Full Site Admin authority';
end if;

update public.club_memberships set role = 'FIXTURE_SECRETARY' where club_id = v_club and user_id = v_master;
if internal.is_full_site_admin() then
  raise notice 'PASS 3: a further club role change still left Site Admin authority untouched';
else
  raise notice 'FAIL 3: a club role change removed Site Admin authority';
end if;

-- ============ 3. A Club Admin cannot reach Site Admin authority ============

perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin,'role','authenticated')::text, true);
perform set_config('role','authenticated', true);
v_ok := false;
begin
  update public.site_admins set admin_role = 'limited' where user_id = v_master;
  get diagnostics v_n = row_count;
  if v_n = 0 then v_ok := true; end if;
exception when others then v_ok := true; v_err := sqlerrm;
end;
perform set_config('role','postgres', true);

if v_ok and (select admin_role from public.site_admins where user_id = v_master) = 'full' then
  raise notice 'PASS 4: a Club Admin cannot downgrade a Full Site Admin -- the write reaches nothing';
else
  raise notice 'FAIL 4: a Club Admin downgraded a Full Site Admin';
end if;

perform set_config('request.jwt.claims', json_build_object('sub', v_clubadmin,'role','authenticated')::text, true);
perform set_config('role','authenticated', true);
v_ok := false;
begin
  delete from public.site_admins where user_id = v_master;
  get diagnostics v_n = row_count;
  if v_n = 0 then v_ok := true; end if;
exception when others then v_ok := true;
end;
perform set_config('role','postgres', true);

if v_ok and exists (select 1 from public.site_admins where user_id = v_master) then
  raise notice 'PASS 5: a Club Admin cannot delete a Site Admin record';
else
  raise notice 'FAIL 5: a Club Admin deleted a Site Admin record';
end if;

-- A club member with no elevated role reaches even less.
perform set_config('request.jwt.claims', json_build_object('sub', v_second,'role','authenticated')::text, true);
perform set_config('role','authenticated', true);
select count(*) into v_n from public.site_admins;
perform set_config('role','postgres', true);
if v_n = 0 then
  raise notice 'PASS 6: someone who is not a Site Admin cannot even read who the Site Admins are';
else
  raise notice 'FAIL 6: a non-admin can read % site admin rows', v_n;
end if;

-- ============ 4. A season handover cannot touch it ============

perform set_config('request.jwt.claims', json_build_object('sub', v_master,'role','authenticated')::text, true);
perform public.generate_rollover_proposal(v_club,'union',v_to);
select id into v_prop from public.age_grade_rollover_team_proposals where team_id = v_team;
perform public.confirm_rollover_team_proposal(v_prop,'confirm',null,null,null,null);

if (select admin_role from public.site_admins where user_id = v_master) = 'full'
   and (select status from public.site_admins where user_id = v_master) = 'active' then
  raise notice 'PASS 7: running a season handover on their own club left the master admin exactly as before';
else
  raise notice 'FAIL 7: the handover altered Site Admin authority';
end if;

-- Graduating a cohort ends memberships; it must not end this one.
declare v_u18 uuid; v_p18 uuid;
begin
  insert into public.teams (club_id, rugby_code, category, age_group, gender, display_name, slug)
  values (v_club,'union','youth','U18','boys','x','ms2') returning id into v_u18;
  perform public.generate_rollover_proposal(v_club,'union',v_to);
  select id into v_p18 from public.age_grade_rollover_team_proposals where team_id = v_u18;
  perform public.confirm_rollover_team_proposal(v_p18,'graduate',null,null,null,null);

  if internal.is_full_site_admin() then
    raise notice 'PASS 8: graduating a cohort -- which ends player memberships -- left Site Admin authority untouched';
  else
    raise notice 'FAIL 8: graduation processing removed Site Admin authority';
  end if;
end;

-- ============ 5. The last Full Site Admin cannot be removed ============
--
-- This database has a real developer Full Site Admin, so the master account
-- created above is not the last one yet. Remove the other full admins first --
-- legitimate while this one exists -- so the guard is genuinely being asked
-- about the last remaining administrator rather than one of several.

delete from public.site_admins where user_id <> v_master and admin_role = 'full';
select count(*) into v_n from public.site_admins where status = 'active' and admin_role = 'full';
if v_n = 1 then
  raise notice 'PASS 8b: the scenario is set up correctly -- exactly one Full Site Admin remains';
else
  raise notice 'FAIL 8b: % full admins remain, so the next assertions would not test the guard', v_n;
end if;

v_ok := false;
begin
  delete from public.site_admins where user_id = v_master;
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%last remaining Full Site Admin%' then
  raise notice 'PASS 9: the last Full Site Admin cannot be DELETED';
else
  raise notice 'FAIL 9: the last Full Site Admin was deleted (%)', coalesce(v_err,'no error');
end if;

v_ok := false;
begin
  update public.site_admins set admin_role = 'limited' where user_id = v_master;
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%last remaining Full Site Admin%' then
  raise notice 'PASS 10: the last Full Site Admin cannot be DOWNGRADED to a lesser role';
else
  raise notice 'FAIL 10: the last Full Site Admin was downgraded (%)', coalesce(v_err,'no error');
end if;

v_ok := false;
begin
  update public.site_admins set status = 'suspended' where user_id = v_master;
exception when others then v_ok := true; v_err := sqlerrm;
end;
if v_ok and v_err like '%last remaining Full Site Admin%' then
  raise notice 'PASS 11: the last Full Site Admin cannot be DEACTIVATED';
else
  raise notice 'FAIL 11: the last Full Site Admin was deactivated (%)', coalesce(v_err,'no error');
end if;

-- Role replacement is the same event wearing different clothes.
v_ok := false;
begin
  update public.site_admins set admin_role = 'limited', status = 'active' where user_id = v_master;
exception when others then v_ok := true;
end;
if v_ok and (select admin_role from public.site_admins where user_id = v_master) = 'full' then
  raise notice 'PASS 12: authority cannot be removed by replacing the role while leaving the row active';
else
  raise notice 'FAIL 12: role replacement stripped the last Full Site Admin';
end if;

-- ============ 6. With a second Full admin, ordinary management resumes ======

insert into public.site_admins (user_id, status, admin_role) values (v_second,'active','full');
delete from public.site_admins where user_id = v_master;
if not exists (select 1 from public.site_admins where user_id = v_master)
   and exists (select 1 from public.site_admins where user_id = v_second and admin_role = 'full') then
  raise notice 'PASS 13: once a second Full Site Admin exists, the first can be removed through the ordinary path';
else
  raise notice 'FAIL 13: legitimate admin management is blocked even with a second Full admin';
end if;

-- ============ 7. Nothing in the club or handover domain writes site_admins ==

select count(*) into v_n
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname in ('public','internal') and p.prokind = 'f'
  and pg_get_functiondef(p.oid) ~* '(insert into|update|delete from)\s+public\.site_admins'
  -- Exclude the site-admin capability setters themselves: they are the
  -- deliberate management surface, and several of them carry a domain word
  -- in their name (set_site_admin_team_catalogue_capability).
  and p.proname !~* 'site_admin'
  and (p.proname ~* 'rollover|handover|graduat|club_membership|fold_team|team' );
if v_n = 0 then
  raise notice 'PASS 14: no club, team or handover function writes to site_admins at all';
else
  raise notice 'FAIL 14: % club/handover function(s) write to site_admins', v_n;
end if;

end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
