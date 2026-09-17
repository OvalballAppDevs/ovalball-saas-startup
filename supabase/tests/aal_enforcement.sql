-- =====================================================================================================
-- AAL ENFORCEMENT (Identity/Auth Slice 6, Phase 2 D, F, AG, AI 38/51/52/53)
--
-- Deterministic and self-seeding.
--
-- The thing this suite exists to protect is not "MFA works". It is that turning MFA on is a decision
-- somebody makes deliberately, group by group, and that until they make it NOBODY loses access -- while
-- the moment they do make it, there is no way round it from a browser.
--
-- Every negative here has a positive control beside it. A refusal proves nothing if the same setup would
-- have been refused anyway.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text, p_email text, p_dob date default (current_date - interval '35 years')::date)
returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',p_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'AAL',p_label,p_email,p_dob,'ACTIVE')
  on conflict (id) do update set account_state = 'ACTIVE';
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

-- A real browser session: a row in auth.sessions at a stated assurance level, and a JWT naming it.
create or replace function pg_temp.session_for(p_user uuid, p_aal text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v, p_user, now(), now(), p_aal::auth.aal_level);
  return v;
end $$;

-- Sign in as that session. p_claimed_aal is what the TOKEN says, which is not the same question as what
-- the server recorded -- and telling them apart is the point of D-S6-AUTO-1.
create or replace function pg_temp.as_session(p_user uuid, p_session uuid, p_claimed_aal text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_user, 'role', 'authenticated',
                                         'session_id', p_session, 'aal', p_claimed_aal))::text, true);
end $$;

create or replace function pg_temp.bool_as(p_sql text) returns boolean language plpgsql as $$
declare v boolean;
begin execute p_sql into v; return v; end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_plain uuid; v_admin uuid; v_staff uuid;
  v_s1 uuid; v_s2 uuid; v_s_admin uuid;
  v_dir uuid; v_club uuid; v_team uuid;
  v_n int;
begin
  -- ---------------------------------------------------------------------------------------------
  -- Fixtures: an ordinary person (NONE), a club staffer (STAFF) and a Site Admin (PRIVILEGED).
  -- ---------------------------------------------------------------------------------------------
  v_plain := pg_temp.person('PLAIN','aal-plain-'||v_tag||'@ovalball.test');
  v_staff := pg_temp.person('STAFF','aal-staff-'||v_tag||'@ovalball.test');
  v_admin := pg_temp.person('ADMIN','aal-admin-'||v_tag||'@ovalball.test');

  insert into public.club_directory (name, town, county, rugby_code, country, nation, active, verification_status, source, normalized_key)
  values ('AAL '||v_tag||' RUFC','T','T','union','United Kingdom','England',true,'unverified','site_admin_manual','aal-'||v_tag) returning id into v_dir;
  insert into public.clubs (directory_id, slug, status) values (v_dir,'aal-'||v_tag,'active') returning id into v_club;
  insert into public.teams (club_id, display_name, slug, category, age_group, gender, rugby_code, active)
  values (v_club,'Under 12 Boys','aal-u12-'||v_tag,'youth','U12','boys','union',true) returning id into v_team;
  insert into public.club_memberships (club_id,user_id,role,status) values (v_club,v_staff,'BASIC_USER','active');
  insert into public.site_admins (user_id,status,admin_role) values (v_admin,'active','full');
  perform internal.refresh_account_security_state(v_staff);
  perform internal.refresh_account_security_state(v_admin);

  -- ---------------------------------------------------------------------------------------------
  -- AE-A  The rollout groups are derived from what somebody holds.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(internal.derive_enforcement_group(v_admin) = 'PRIVILEGED',
    'AE-A1 a Site Admin is PRIVILEGED');
  perform pg_temp.check(internal.derive_enforcement_group(v_plain) = 'NONE',
    'AE-A2 somebody holding nothing is NONE');
  perform pg_temp.check(
    (select enforcement_group from public.account_security_state where user_id = v_admin) = 'PRIVILEGED',
    'AE-A3 and the stored row agrees with the rule, because it is refreshed from it');

  -- A Club Admin is PRIVILEGED the moment they hold it, without anybody moving them by hand.
  perform internal.grant_role((select id from public.club_memberships where user_id=v_staff and club_id=v_club),
                              'CLUB_ADMIN', null, 'SITE_ADMIN_ASSIGNMENT', 'aal matrix');
  perform internal.refresh_account_security_state(v_staff);
  perform pg_temp.check(
    (select enforcement_group from public.account_security_state where user_id = v_staff) = 'PRIVILEGED',
    'AE-A4 becoming a Club Admin moves you into PRIVILEGED with no separate step');

  -- ---------------------------------------------------------------------------------------------
  -- AE-B  T0: enforcement is OFF, and NOBODY loses access. This is the release invariant.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select count(*) from public.mfa_enforcement_policy where require_aal2_from is not null) = 0,
    'AE-B1 every rollout group ships not enforced');

  v_s1 := pg_temp.session_for(v_plain, 'aal1');
  perform pg_temp.as_session(v_plain, v_s1);
  perform pg_temp.check(internal.session_aal_ok(), 'AE-B2 an AAL1 session is accepted while nothing is enforced');
  perform pg_temp.check(internal.session_ok(),     'AE-B3 and session_ok is true, so the database is open to them as before');

  v_s_admin := pg_temp.session_for(v_admin, 'aal1');
  perform pg_temp.as_session(v_admin, v_s_admin);
  perform pg_temp.check(internal.session_ok(),
    'AE-B4 including the Site Admin -- the sole administrator is not locked out by this release');

  -- ---------------------------------------------------------------------------------------------
  -- AE-C  Turn PRIVILEGED on. Now the boundary bites, and only for that group.
  -- ---------------------------------------------------------------------------------------------
  update public.mfa_enforcement_policy
     set require_aal2_from = now() - interval '1 minute', reason = 'aal matrix'
   where enforcement_group = 'PRIVILEGED';

  perform pg_temp.as_session(v_admin, v_s_admin);
  perform pg_temp.check(not internal.session_aal_ok(),
    'AE-C1 an AAL1 session in an ENFORCED group is refused');
  perform pg_temp.check(not internal.session_ok(),
    'AE-C2 and session_ok goes false, so every capability and every table follows');

  -- POSITIVE CONTROL: the same person, same everything, at AAL2.
  update auth.sessions set aal = 'aal2' where id = v_s_admin;
  perform pg_temp.check(internal.session_aal_ok(),
    'AE-C3 POSITIVE CONTROL: the same person at AAL2 is accepted -- the refusal was about assurance');
  perform pg_temp.check(internal.session_ok(), 'AE-C4 and session_ok is true again');

  -- The unenforced group is untouched by somebody else's rollout.
  perform pg_temp.as_session(v_plain, v_s1);
  perform pg_temp.check(internal.session_ok(),
    'AE-C5 an unenforced group is unaffected -- rollout is group by group, not all at once');

  -- ---------------------------------------------------------------------------------------------
  -- AE-D  THE STALE TOKEN (AI "stale AAL claim"). D-S6-AUTO-1.
  -- ---------------------------------------------------------------------------------------------
  update auth.sessions set aal = 'aal1' where id = v_s_admin;
  perform pg_temp.as_session(v_admin, v_s_admin, 'aal2');   -- the TOKEN still says aal2
  perform pg_temp.check(not internal.session_aal_ok(),
    'AE-D1 STALE CLAIM: a token asserting aal2 over an aal1 session is refused -- the server row decides');
  perform pg_temp.check(
    (select prosrc !~ 'auth\.jwt\(\)\s*->>\s*''aal''' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='session_aal_ok'),
    'AE-D2 and the decision never reads the aal claim at all, so there is nothing to forge');

  -- POSITIVE CONTROL: a token claiming NOTHING over an aal2 session is still fine.
  update auth.sessions set aal = 'aal2' where id = v_s_admin;
  perform pg_temp.as_session(v_admin, v_s_admin, null);
  perform pg_temp.check(internal.session_aal_ok(),
    'AE-D3 POSITIVE CONTROL: with no aal claim at all an aal2 session is accepted');

  -- ---------------------------------------------------------------------------------------------
  -- AE-E  Revocation (H, AI 53). Deleting the session row is what makes it real.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(internal.session_ok(), 'AE-E1 the session works before it is revoked');
  perform internal.revoke_session(v_s_admin);
  perform pg_temp.as_session(v_admin, v_s_admin, 'aal2');
  perform pg_temp.check(not internal.session_ok(),
    'AE-E2 REVOKED: a stolen token whose session row is gone is refused on the next request');
  perform pg_temp.check(not internal.session_aal_ok(),
    'AE-E3 and no aal claim in that token can bring it back');

  -- ---------------------------------------------------------------------------------------------
  -- AE-F  Per-person overrides -- the escape hatch a rollout needs.
  -- ---------------------------------------------------------------------------------------------
  v_s_admin := pg_temp.session_for(v_admin, 'aal1');
  update public.account_security_state
     set enforcement_override = 'EXEMPT_UNTIL_DATE', enforcement_override_until = now() + interval '1 day'
   where user_id = v_admin;
  perform pg_temp.as_session(v_admin, v_s_admin);
  perform pg_temp.check(internal.session_aal_ok(),
    'AE-F1 an explicit exemption keeps one person working through a rollout that would strand them');

  update public.account_security_state
     set enforcement_override = 'FORCE_NOW', enforcement_override_until = null where user_id = v_admin;
  perform pg_temp.check(not internal.session_aal_ok(),
    'AE-F2 and FORCE_NOW enforces one person early, before their group');

  update public.account_security_state set enforcement_override = null where user_id = v_admin;
  update public.mfa_enforcement_policy set require_aal2_from = null where enforcement_group = 'PRIVILEGED';

  -- ---------------------------------------------------------------------------------------------
  -- AE-G  R: holding AAL2 is not the same as having just proved it (F).
  -- ---------------------------------------------------------------------------------------------
  v_s2 := pg_temp.session_for(v_plain, 'aal2');
  perform pg_temp.as_session(v_plain, v_s2);
  perform pg_temp.check(not internal.recent_aal2(10),
    'AE-G1 an AAL2 session that has never verified a code does not satisfy R');

  insert into auth.mfa_amr_claims (id, session_id, authentication_method, created_at, updated_at)
  values (gen_random_uuid(), v_s2, 'totp', now() - interval '2 minutes', now() - interval '2 minutes');
  perform pg_temp.check(internal.recent_aal2(10),
    'AE-G2 POSITIVE CONTROL: a code verified two minutes ago does');
  perform pg_temp.check(not internal.recent_aal2(1),
    'AE-G3 and the window is real -- the same session fails a one-minute R');

  update auth.mfa_amr_claims set updated_at = now() - interval '4 hours' where session_id = v_s2;
  perform pg_temp.check(not internal.recent_aal2(10),
    'AE-G4 STEP-UP EXPIRY: an old verification stops satisfying R, so the person is asked again');

  -- ---------------------------------------------------------------------------------------------
  -- AE-H  The gate is in the DATABASE, not the browser (AA, AI 51).
  -- ---------------------------------------------------------------------------------------------
  select count(*) into v_n from pg_policy where polname = 'session_ok_required' and polpermissive = false;
  perform pg_temp.check(v_n > 100,
    format('AE-H1 the session gate is installed on %s tables, not just in the application', v_n));
  perform pg_temp.check(
    (select count(*) from pg_policy where polname='session_ok_required' and polpermissive) = 0,
    'AE-H2 and every one of them is RESTRICTIVE, so it can only take access away, never grant it');
  perform pg_temp.check(
    not exists (select 1 from pg_policy p join pg_class c on c.oid=p.polrelid
                 where p.polname='session_ok_required' and has_table_privilege('anon', c.oid, 'SELECT')),
    'AE-H3 and it never landed on a publicly readable table, so signed-out reading is unchanged');

  -- The setup path stays reachable, or an account could never become usable.
  perform pg_temp.check(
    (select pg_get_expr(polqual, polrelid) from pg_policy p join pg_class c on c.oid=p.polrelid
      where p.polname='session_ok_required' and c.relname='profiles') like '%session_live_only%',
    'AE-H4 SETUP PATH: profiles keeps the weaker live-session gate, so setup cannot deadlock');

  -- ---------------------------------------------------------------------------------------------
  -- AE-I  SLICE 5 REGRESSION: redemption inherits this, and has no second mechanism of its own.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select prosrc ~ 'session_ok' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='redeem_invitation'),
    'AE-I1 invitation redemption still goes through session_ok rather than checking authentication itself');
  perform pg_temp.check(
    (select prosrc !~ 'mfa_|aal2|authenticator' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='redeem_invitation'),
    'AE-I2 and it grew no invitation-specific authentication mechanism of its own');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
