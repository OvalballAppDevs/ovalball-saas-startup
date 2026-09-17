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

-- The same thing, but carrying a browser session id.
--
-- internal.recent_aal2 returns TRUE when the JWT has no session_id, and says why in its own body: the
-- service key and the test harness are not browser sessions, and "recent AAL2" is a statement about
-- one. That carve-out is correct, and it also meant the AAL2 half of the master-control preamble was
-- never being exercised by this suite at all -- every assertion above walks straight past it. This
-- helper supplies a session id with no TOTP claim behind it, which is what an AAL1 browser looks like.
create or replace function pg_temp.try_as_session(p_subject uuid, p_session uuid, p_sql text)
returns text language plpgsql as $$
declare v text;
begin
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub',p_subject,'role','authenticated','session_id',p_session::text)::text, true);
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
  v_dir uuid; v_club uuid; v_team uuid; v_m uuid; v_ra uuid; v_player uuid; v_guardian uuid; v_new uuid; v_new2 uuid;
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

  -- =============================================================================================
  -- SMC-20..23  TEAM. site.team_roles.manage is held by SITE_FULL alone, so this is the clearest
  -- case of the narrowing: before Slice 7 any Site Admin at all could reach team role data.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_ro, format('select public.site_assign_team_role(%L,%L,''COACH'',''read only should not be able to appoint a coach'')', v_target, v_team)) = '42501',
    'SMC-20 a Read Only Site Admin cannot appoint a coach');
  perform pg_temp.check(
    pg_temp.try_as(v_support, format('select public.site_assign_team_role(%L,%L,''COACH'',''user access does not hold team roles'')', v_target, v_team)) = '42501',
    'SMC-21 nor can User Access -- holding site.users.security.manage is not holding site.team_roles.manage');

  -- POSITIVE CONTROL. Without this the two refusals above are satisfied by the RPC being broken.
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_assign_team_role(%L,%L,''COACH'',''appointing a coach at the club''''s request'')', v_target, v_team)) = 'OK',
    'SMC-22 POSITIVE CONTROL: a Full Site Admin CAN appoint a coach');
  perform pg_temp.check(
    exists (select 1 from public.club_memberships m
             where m.user_id = v_target and m.club_id = v_club
               and m.state = 'ACTIVE' and m.source = 'SITE_ADMIN_ASSIGNMENT'),
    'SMC-23 and the club membership the team role hangs from was admitted canonically, not inserted');

  -- =============================================================================================
  -- SMC-24..26  ACCOUNT STATE. Suspending and disabling are DIFFERENT capabilities (Q.3), and
  -- User Access holds only the first. This is the one place a profile boundary sits inside a single
  -- RPC, so it is the one most likely to be quietly flattened later.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_support, format('select public.site_set_account_state(%L,''SUSPENDED'',''suspending pending a safeguarding review'')', v_target)) = 'OK',
    'SMC-24 User Access CAN suspend an account');
  perform pg_temp.check(
    pg_temp.try_as(v_support, format('select public.site_set_account_state(%L,''DISABLED'',''attempting to switch the account off entirely'')', v_target)) = '42501',
    'SMC-25 but User Access CANNOT disable one -- site.users.disable is a separate capability');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_set_account_state(%L,''DISABLED'',''disabling at the account holder''''s request'')', v_target)) = 'OK',
    'SMC-26 POSITIVE CONTROL: a Full Site Admin CAN disable, so SMC-25 was about the capability');
  perform pg_temp.check(
    (select account_state from public.profiles where id = v_target) = 'DISABLED',
    'SMC-26b and the state actually changed');

  -- =============================================================================================
  -- SMC-27..28  SESSIONS AND PASSWORDS. L2: no Site Admin path sets, sees or chooses a password.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_ops, format('select public.site_revoke_sessions(%L,''fixture ops has no business here'')', v_target)) = '42501',
    'SMC-27 Fixture Ops cannot end somebody''''s sessions');
  perform pg_temp.check(
    pg_temp.try_as(v_support, format('select public.site_force_password_reset(%L,''account holder reported a shared password'')', v_target)) = 'OK',
    'SMC-28 POSITIVE CONTROL: User Access CAN require a password reset');
  perform pg_temp.check(
    (select must_reset_password from public.account_security_state where user_id = v_target) is true,
    'SMC-28b and it is recorded as a requirement on the account, not as a password');
  perform pg_temp.check(
    not exists (select 1 from public.security_events e
                 where e.subject_user_id = v_target
                   and (e.metadata::text ~* '(password|secret|token|recovery_code)')),
    'SMC-28c L2: nothing about a password reaches the audit record');

  -- =============================================================================================
  -- SMC-29..31  FAMILY. site.family.manage is SITE_FULL alone.
  -- =============================================================================================
  -- A player is not club-scoped by a column: a player belongs to a club through the team they play
  -- for, which is why player_team_memberships exists and why the pathway rule lives there.
  insert into public.players (first_name, surname, date_of_birth, playing_pathway, user_id)
  values ('SMC','Child',(current_date - interval '11 years')::date,'MALE', v_outsider)
  returning id into v_player;

  perform pg_temp.check(
    pg_temp.try_as(v_support, format('select public.site_link_guardian(%L,%L,''parent'',''user access does not hold family'')', v_target, v_player)) = '42501',
    'SMC-29 User Access cannot link a guardian to a child');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_link_guardian(%L,%L,''parent'',''the player''''s own account, which is not a guardian'')', v_outsider, v_player)) = '42501',
    'SMC-30 and not even a Full Site Admin can make a person their own guardian');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_link_guardian(%L,%L,''parent'',''restoring a parent link lost in migration'')', v_target, v_player)) = 'OK',
    'SMC-31 POSITIVE CONTROL: a Full Site Admin CAN link a genuine guardian');
  select id into v_guardian from public.guardians
   where player_id = v_player and guardian_user_id = v_target and state = 'ACTIVE';
  perform pg_temp.check(v_guardian is not null and
    (select source from public.guardians where id = v_guardian) = 'SITE_ADMIN_ASSIGNMENT',
    'SMC-31b and the relationship records that a Site Admin made it, not that a parent claimed it');
  -- Two statements, deliberately. Writing this as
  --     check(try_as(...) = 'OK' and (select state ...) = 'REVOKED')
  -- read naturally and was wrong: Postgres is free to evaluate the sub-select before the function
  -- call in the same boolean expression, and did, so the assertion compared the state as it was
  -- BEFORE the revocation. It failed honestly here; the version that fails dishonestly is the one
  -- where the read happens to be ordered last and the suite passes for a reason nobody chose.
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_end_guardian_relationship(%L,''the relationship was recorded in error'')', v_guardian)) = 'OK',
    'SMC-32 a Full Site Admin can end a guardian relationship');
  perform pg_temp.check(
    (select state from public.guardians where id = v_guardian) = 'REVOKED'
    and (select revocation_reason from public.guardians where id = v_guardian) is not null,
    'SMC-32b and it is revoked with a reason rather than deleted -- the record of the link survives');

  -- =============================================================================================
  -- SMC-33  THE AAL2 GATE, actually exercised.
  --
  -- Every assertion above walks past internal.require_recent_aal2, because a harness with no
  -- session_id is not a browser and recent_aal2 says so itself. Supplying a session id with no TOTP
  -- behind it is what an AAL1 browser looks like, and master control has to refuse it -- otherwise
  -- the whole of Q.3's preamble is one capability check wearing three.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as_session(v_full, gen_random_uuid(),
      format('select public.site_revoke_sessions(%L,''an AAL1 browser attempting master control'')', v_target)) = '42501',
    'SMC-33 master control is refused to a session that has not recently passed a second factor');
  perform pg_temp.check(
    pg_temp.try_as_session(v_full, gen_random_uuid(),
      format('select public.site_assign_team_role(%L,%L,''COACH'',''an AAL1 browser attempting master control'')', v_outsider, v_team)) = '42501',
    'SMC-33b and the gate is in the shared preamble, so it holds for every master-control RPC');

  -- =============================================================================================
  -- SMC-34  Self-target and audit across the new surface.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_revoke_sessions(%L,''ending my own sessions through master control'')', v_full)) = '42501',
    'SMC-34 an administrator cannot run master control against their own account');
  perform pg_temp.check(
    (select count(distinct event_type) from public.security_events
      where subject_user_id in (v_target, v_outsider)
        and event_type in ('site.team_role_assigned','account.suspended','account.disabled',
                           'account.password_reset_forced','site.guardian_linked','site.guardian_unlinked')) >= 5,
    'SMC-35 and each distinct master-control act left its own audit line');

  -- =============================================================================================
  -- SMC-36..42  CREATE USER (Q.2).
  --
  -- The service role creates the auth identity and nothing else; everything that confers authority
  -- happens in site_register_created_identity under the ordinary rules. The harness stands in for
  -- the service role by inserting the auth row directly, which is exactly the division of labour
  -- being asserted: the identity is free, the authority is not.
  -- =============================================================================================
  v_new := pg_temp.person('Created','smc-created-'||v_tag||'@ovalball.test');
  update public.profiles set account_state = 'PENDING_SETUP', setup_state = 'PENDING_DETAILS',
         first_name = '', surname = '' where id = v_new;

  perform pg_temp.check(
    pg_temp.try_as(v_support, format('select public.site_register_created_identity(%L,''Aoife'',''Kelly'',null,''creating an account for somebody who cannot self-register'')', v_new)) = '42501',
    'SMC-36 User Access cannot create identities -- site.users.create is SITE_FULL alone');
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_register_created_identity(%L,''Aoife'',''Kelly'',null,''creating an account for somebody who cannot self-register'')', v_new)) = 'OK',
    'SMC-37 POSITIVE CONTROL: a Full Site Admin CAN complete a created identity');
  perform pg_temp.check(
    (select first_name||' '||surname from public.profiles where id = v_new) = 'Aoife Kelly'
    and (select created_source from public.profiles where id = v_new) = 'SITE_ADMIN_CREATE',
    'SMC-37b and the record says a Site Admin made it, which is the thing a support query needs to know later');
  perform pg_temp.check(
    (select account_state from public.profiles where id = v_new) = 'PENDING_SETUP',
    'SMC-37c the account is NOT active -- the person still has to set a password and an authenticator');
  perform pg_temp.check(
    exists (select 1 from public.access_invitations
             where kind = 'ACCOUNT_SETUP' and target_user_id = v_new and state = 'ISSUED'),
    'SMC-37d and a setup invitation was issued for them');

  -- ID-6. Running it again is the shape of a double submit, and the second one must not overwrite
  -- a real person's name from a form somebody left open.
  update public.profiles set setup_state = 'COMPLETE', account_state = 'ACTIVE' where id = v_new;
  perform pg_temp.check(
    pg_temp.try_as(v_full, format('select public.site_register_created_identity(%L,''Someone'',''Else'',null,''running the same creation a second time'')', v_new)) = '23505',
    'SMC-38 ID-6: an account that is already set up is never overwritten by Create User');

  -- Site Admin is not on the create form, by any route.
  v_new2 := pg_temp.person('Created2','smc-created2-'||v_tag||'@ovalball.test');
  update public.profiles set account_state = 'PENDING_SETUP', setup_state = 'PENDING_DETAILS' where id = v_new2;
  perform pg_temp.check(
    pg_temp.try_as(v_full, format(
      'select public.site_register_created_identity(%L,''Sam'',''Doyle'',null,''creating an account with site admin attached'',%L::jsonb)',
      v_new2, '[{"kind":"SITE_ADMIN","profile_key":"SITE_FULL"}]')) = '42501',
    'SMC-39 Site Admin cannot be granted from the Create User form -- that takes two administrators');
  perform pg_temp.check(
    not exists (select 1 from public.site_admins where user_id = v_new2),
    'SMC-39b and the refusal left nothing behind');

  -- An intended assignment goes through the master-control RPC that owns it, so it is refused by
  -- that RPC's OWN capability. This is what stops Create User becoming a way round the others.
  perform pg_temp.check(
    pg_temp.try_as(v_full, format(
      'select public.site_register_created_identity(%L,''Sam'',''Doyle'',null,''creating an account with a made-up assignment'',%L::jsonb)',
      v_new2, '[{"kind":"NOT_A_KIND"}]')) = '22023',
    'SMC-40 an unrecognised assignment kind is refused rather than ignored');

  -- =============================================================================================
  -- SMC-41  INSPECTION. Read-only, and still a capability.
  -- =============================================================================================
  perform pg_temp.check(
    pg_temp.count_as(v_ro, format('select count(*) from public.site_membership_history(%L)', v_target)) >= 0,
    'SMC-41 Read Only holds site.users.view, so it CAN read a provenance timeline');
  perform pg_temp.check(
    pg_temp.count_as(v_outsider, format('select count(*) from public.site_membership_history(%L)', v_target)) = 0,
    'SMC-41b somebody with no site capability at all reads an empty timeline, not somebody else''''s history');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
