-- =====================================================================================================
-- SITE ADMIN MASTER CONTROL (Identity/Auth Slice 7, Phase 2 Q.1, Q.3, R; AI 36-41)
--
-- Deterministic and self-seeding.
--
-- The claim this suite has to defend is Q.1's: Site Admin authority is a set of explicit site.*
-- capabilities, and master control is a set of named operations -- NOT a policy bypass and NOT a
-- property of the label "Site Admin".
--
-- Before Slice 7 a Read Only Site Admin could update the club directory, delete a competition entry
-- and cancel a fixture, because ninety policies and sixty function bodies asked `is_site_admin()`,
-- which is true for every profile. Most of what is below is that difference.
--
-- Every refusal has a positive control. A test that only proves somebody was refused proves nothing
-- about WHY, and the commonest way to fake this whole suite is to refuse everybody.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'SMC',p_label,p_email,(current_date - interval '36 years')::date,'ACTIVE');
  return v;
end $$;

create or replace function pg_temp.admin(p_user uuid, p_role text, p_profile text) returns void language plpgsql as $$
begin
  insert into public.site_admins (user_id, status, admin_role, profile_key)
  values (p_user, 'active', p_role, p_profile)
  on conflict (user_id) do update set status='active', admin_role=excluded.admin_role, profile_key=excluded.profile_key;
end $$;

create or replace function pg_temp.as_(p_subject uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', jsonb_build_object('sub',p_subject,'role','authenticated')::text, true);
end $$;

-- SETS THE ROLE, not just the claims.
--
-- A statement run without `set local role authenticated` runs as the OWNER, and RLS does not apply to
-- the owner -- so a table-level assertion would pass whatever the policies say. SMC-11 caught exactly
-- that here: a Read Only Site Admin appeared to delete a club alias, and had in fact deleted it as
-- postgres. Every table assertion in this file would otherwise have been decoration.
--
-- The RPC assertions do not depend on this, because those functions are SECURITY DEFINER and read
-- auth.uid() themselves -- but they are run the same way, because a harness with two modes is a
-- harness somebody uses the wrong one of.
create or replace function pg_temp.try_as(p_subject uuid, p_sql text) returns text language plpgsql as $$
declare v text;
begin
  perform pg_temp.as_(p_subject);
  begin
    set local role authenticated;
    execute p_sql;
    v := 'OK';
  exception when others then get stacked diagnostics v = returned_sqlstate;
  end;
  reset role;
  perform set_config('request.jwt.claims','', true);
  return v;
end $$;

create or replace function pg_temp.count_as(p_subject uuid, p_sql text) returns bigint language plpgsql as $$
declare v bigint;
begin
  perform pg_temp.as_(p_subject);
  set local role authenticated;
  execute p_sql into v;
  reset role;
  perform set_config('request.jwt.claims','', true);
  return coalesce(v, -1);
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_full uuid; v_ro uuid; v_data uuid; v_support uuid; v_ops uuid;
  v_target uuid; v_outsider uuid;
  v_dir uuid; v_club uuid; v_team uuid; v_m uuid; v_ra uuid;
  v_n bigint;
begin
  v_full    := pg_temp.person('FULL','smc-full-'||v_tag||'@ovalball.test');
  v_ro      := pg_temp.person('RO','smc-ro-'||v_tag||'@ovalball.test');
  v_data    := pg_temp.person('DATA','smc-data-'||v_tag||'@ovalball.test');
  v_support := pg_temp.person('SUPPORT','smc-sup-'||v_tag||'@ovalball.test');
  v_ops     := pg_temp.person('OPS','smc-ops-'||v_tag||'@ovalball.test');
  v_target  := pg_temp.person('TARGET','smc-target-'||v_tag||'@ovalball.test');
  v_outsider:= pg_temp.person('OUTSIDER','smc-out-'||v_tag||'@ovalball.test');

  perform pg_temp.admin(v_full,'full','SITE_FULL');
  perform pg_temp.admin(v_ro,'read_only','SITE_RO');
  perform pg_temp.admin(v_data,'club_data','SITE_DATA');
  perform pg_temp.admin(v_support,'user_access','SITE_SUPPORT');
  perform pg_temp.admin(v_ops,'fixture_ops','SITE_OPS');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('SMC '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'verified','site_admin_manual','smc-'||v_tag)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'smc-'||v_tag,'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','smc-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team;

  -- =============================================================================================
  -- SMC-01  The label is gone. Nothing asks whether somebody IS a Site Admin.
  -- =============================================================================================
  perform pg_temp.check(
    (select count(*) from pg_policies p where p.schemaname in ('public','storage')
      and (coalesce(p.qual,'')||' '||coalesce(p.with_check,'')) ~ '\m(is_site_admin|is_full_site_admin|is_club_admin)\(') = 0,
    'SMC-01 PG-15: no RLS policy asks whether somebody is a Site Admin');
  perform pg_temp.check(
    (select count(*) from pg_proc f join pg_namespace n on n.oid=f.pronamespace
      where n.nspname in ('public','internal') and f.prosecdef and f.proname <> 'is_site_admin'
        and f.prosrc ~ '\mis_site_admin\(') = 0,
    'SMC-02 PG-16: no SECURITY DEFINER body asks it either');

  -- =============================================================================================
  -- SMC-03  READ ONLY calls master control. This is AI 36.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.site_add_club_membership(%L,%L,''read only trying to add somebody'')', v_target, v_club)) = '42501',
    'SMC-03 a Read Only Site Admin cannot add a club membership');
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.site_assign_club_role(%L,%L,''CLUB_ADMIN'',''read only trying to grant a role'')', v_target, v_club)) = '42501',
    'SMC-04 nor assign a club role');

  -- POSITIVE CONTROL: the identical call by a Full Site Admin.
  perform pg_temp.as_(v_full);
  v_m := public.site_add_club_membership(v_target, v_club, 'full site admin adding the target for the matrix');
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check(v_m is not null,
    'SMC-05 POSITIVE CONTROL: a Full Site Admin performs the same call, so the refusals were about capability');

  -- =============================================================================================
  -- SMC-06  A non-FULL profile with the WRONG capability. AI 37.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_data, format('select public.site_assign_club_role(%L,%L,''CLUB_ADMIN'',''club data trying to grant a role'')', v_outsider, v_club)) = '42501',
    'SMC-06 Club Data holds directory and claims authority, not the power to grant club roles');
  perform pg_temp.check(
    pg_temp.try_as(v_ops, format('select public.site_add_club_membership(%L,%L,''fixture ops trying to add somebody'')', v_outsider, v_club)) = '42501',
    'SMC-07 nor does Fixture Operations');

  -- =============================================================================================
  -- SMC-08  Reads narrow by profile too, which is the half nobody notices.
  -- =============================================================================================
  perform pg_temp.check(pg_temp.count_as(v_full, format('select count(*) from public.club_directory where id = %L', v_dir)) = 1,
    'SMC-08 a Full Site Admin reads the club directory');
  perform pg_temp.check(pg_temp.count_as(v_data, format('select count(*) from public.club_directory where id = %L', v_dir)) = 1,
    'SMC-09 so does Club Data, because site.directory.manage is genuinely theirs');

  -- A Read Only admin may read the directory (it is active, and the policy has a public branch) but
  -- may NOT write it. Before Slice 7 they could.
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('update public.club_directory set town = ''Nope'' where id = %L', v_dir)) <> 'OK'
    or (select town from public.club_directory where id = v_dir) <> 'Nope',
    'SMC-10 a Read Only Site Admin cannot WRITE the directory -- before Slice 7 the label let them');
  -- club_aliases is a different shape of refusal, and worth saying accurately rather than lumping in
  -- with the policy tests: `authenticated` holds only SELECT on it, so NO browser role can delete an
  -- alias whatever their profile. The GRANT is the outer boundary (Z-3) and the policy never gets a
  -- say. An assertion pretending the policy refused Read Only would be measuring the wrong thing, and
  -- its positive control could never pass -- which is how this was noticed.
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.club_aliases','DELETE')
    and not has_table_privilege('authenticated','public.club_aliases','UPDATE')
    and not has_table_privilege('authenticated','public.club_aliases','INSERT'),
    'SMC-11 club aliases are not writable by any browser role at all -- the grant refuses before the policy');
  perform pg_temp.check(
    (select count(*) from pg_policies where tablename='club_aliases'
      and coalesce(qual,with_check) like '%site.directory.manage%') = 3,
    'SMC-11b and behind that, all three write policies name the capability rather than the label');

  -- POSITIVE CONTROL for the write: Club Data holds site.directory.manage and can.
  perform pg_temp.as_(v_data);
  set local role authenticated;
  update public.club_directory set town = 'Datatown' where id = v_dir;
  reset role;
  perform set_config('request.jwt.claims','',true);
  perform pg_temp.check((select town from public.club_directory where id = v_dir) = 'Datatown',
    'SMC-12 POSITIVE CONTROL: Club Data CAN write the directory, so SMC-10 was about authority');

  -- =============================================================================================
  -- SMC-13  Master control still obeys every canonical rule. It writes lower-scope records; it does
  -- not get to ignore what those records mean.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_assign_club_role(%L,%L,''COACH'',''trying to put a club role at team scope'')', v_target, v_club)) = '22023',
    'SMC-13 a team-scoped role cannot be assigned as a club role, even by a Full Site Admin');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_add_club_membership(%L,%L,''adding somebody who does not exist'')', gen_random_uuid(), v_club)) = 'P0002',
    'SMC-14 and the target has to be a real identity');

  -- =============================================================================================
  -- SMC-15  Reason, self-target and audit. Q.3's preamble.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_add_club_membership(%L,%L,''too short'')', v_outsider, v_club)) = '22023',
    'SMC-15 a reason under ten characters is refused -- the audit line is read by somebody who was not there');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_assign_club_role(%L,%L,''CLUB_ADMIN'',''granting authority to myself here'')', v_full, v_club)) = '42501',
    'SMC-16 SELF-TARGET: an administrator cannot grant themselves club authority');
  perform pg_temp.check(
    (select count(*) from public.security_events
      where event_type like 'site.%' and subject_user_id = v_target and reason is not null) >= 1,
    'SMC-17 every master-control mutation leaves a mark naming the subject and the reason');

  -- =============================================================================================
  -- SMC-18  A Site Admin is NOT a club member. Platform authority is not club authority.
  -- =============================================================================================
  perform pg_temp.check(
    not exists (select 1 from public.club_memberships m where m.user_id = v_full and m.club_id = v_club),
    'SMC-18 performing master control on a club does not make the administrator a member of it');
  perform pg_temp.check(
    not internal.can('club.people.manage', 'club', v_club, null, null),
    'SMC-19 and with no session at all, nobody holds club authority here');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
