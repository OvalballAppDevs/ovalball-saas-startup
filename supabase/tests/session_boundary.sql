-- =====================================================================================================
-- THE SERVER SESSION BOUNDARY (Slice 6b.2; Phase 2 D.2 enforcement layer 2)
--
-- `lib/auth/require-session.ts` existed with ZERO callers. 6b.2 wires it into the (app) layout and
-- every Slice-6 protected Server Action. Everything it decides, it decides from ONE database answer:
-- public.my_session_assurance(). So the honest way to test the boundary is to drive that function
-- through every state a real session can be in and assert the answers the TypeScript maps to a
-- refusal -- rather than to grep the source for an import, which proves only that somebody typed it.
--
-- The single most important property here is NOT a refusal. It is that T0 STAYS T0: with no
-- enforcement group switched on, an AAL1 session must be told it is fine. Phase 2 D.2 literally says
-- `requireSession({ aal: 'aal2' })`, and wiring that literally onto a platform with zero enrolled
-- factors would have redirected every single user to /security/verify for ever.
--
-- Deterministic and self-seeding.
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
  values (v,'SB',p_label,p_email,(current_date - interval '33 years')::date,'ACTIVE');
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

create or replace function pg_temp.session_for(p_user uuid, p_aal text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal)
  values (v, p_user, now(), now(), p_aal::auth.aal_level);
  return v;
end $$;

create or replace function pg_temp.as_session(p_user uuid, p_session uuid, p_claimed_aal text default null)
returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    jsonb_strip_nulls(jsonb_build_object('sub', p_user, 'role', 'authenticated',
                                         'session_id', p_session, 'aal', p_claimed_aal))::text, true);
end $$;

/** The one answer the whole server boundary is built on. */
create or replace function pg_temp.assurance() returns jsonb language plpgsql as $$
declare v jsonb;
begin
  select public.my_session_assurance() into v;
  return v;
end $$;

do $$
declare
  v_tag  text := substr(gen_random_uuid()::text,1,8);
  v_user uuid; v_sess uuid; v_a jsonb;
begin
  v_user := pg_temp.person('Person', 'sb-'||v_tag||'@ovalball.test');
  v_sess := pg_temp.session_for(v_user, 'aal1');

  -- ===========================================================================================
  -- SB-01..03  T0. THE PROPERTY THAT MUST NOT BREAK.
  -- ===========================================================================================
  perform pg_temp.as_session(v_user, v_sess, 'aal1');
  v_a := pg_temp.assurance();
  perform pg_temp.check((v_a->>'session_live')::boolean,   'SB-01 a live AAL1 session reads as live');
  perform pg_temp.check((v_a->>'account_usable')::boolean, 'SB-02 and an ACTIVE account reads as usable');
  perform pg_temp.check(
    (v_a->>'enforcement_required')::boolean = false,
    'SB-03 T0: with no enforcement group switched on, AAL1 is NOT required to step up -- this is what '
    'stops requireSession locking the whole platform out of an application that has zero TOTP factors');

  -- ===========================================================================================
  -- SB-04  ...but an operation that ASKS for AAL2 still does not get it from an AAL1 session.
  -- The TypeScript reads `aal`; T0 relaxes the standing requirement, never a specific demand.
  -- ===========================================================================================
  perform pg_temp.check(v_a->>'aal' is distinct from 'aal2',
    'SB-04 and the session still reports AAL1, so an operation that demands aal2 is still refused');
  perform pg_temp.check((v_a->>'recent_aal2')::boolean = false,
    'SB-04b and recent_aal2 is false, so a recentMinutes operation is refused at T0 as well');

  -- ===========================================================================================
  -- SB-05..06  SUSPENSION. D-S6B-AUTO-10: suspended => no usable authority, full stop.
  -- ===========================================================================================
  update public.profiles set account_state = 'SUSPENDED', state_reason = 'session boundary fixture'
    where id = v_user;
  v_a := pg_temp.assurance();
  perform pg_temp.check((v_a->>'account_usable')::boolean = false,
    'SB-05 a SUSPENDED account is not usable, so every guarded action refuses it');
  perform pg_temp.check((v_a->>'session_live')::boolean,
    'SB-05b even though the session ROW is still live -- the refusal is about the account, and the two '
    'are deliberately different questions');

  update public.profiles set account_state = 'DISABLED' where id = v_user;
  perform pg_temp.check((pg_temp.assurance()->>'account_usable')::boolean = false,
    'SB-06 a DISABLED account is not usable either');

  update public.profiles set account_state = 'ACTIVE' where id = v_user;
  perform pg_temp.check((pg_temp.assurance()->>'account_usable')::boolean,
    'SB-06b POSITIVE CONTROL: reinstating makes it usable again, so SB-05/06 measured the state and '
    'not something permanently broken by the fixture');

  -- ===========================================================================================
  -- SB-07..08  REVOKED SESSION. A stolen refresh token stops working on its next request.
  -- ===========================================================================================
  delete from auth.sessions where id = v_sess;
  v_a := pg_temp.assurance();
  perform pg_temp.check((v_a->>'session_live')::boolean = false,
    'SB-07 a revoked session is not live, so the boundary refuses it even with a valid-looking token');

  v_sess := pg_temp.session_for(v_user, 'aal1');
  perform pg_temp.as_session(v_user, v_sess, 'aal1');
  perform pg_temp.check((pg_temp.assurance()->>'session_live')::boolean,
    'SB-08 POSITIVE CONTROL: a fresh session is live again');

  -- ===========================================================================================
  -- SB-09  NO SESSION AT ALL -- the direct-POST case, with no cookie of any kind.
  -- ===========================================================================================
  perform set_config('request.jwt.claims', null, true);
  perform pg_temp.check(
    (pg_temp.assurance()->>'session_live')::boolean is distinct from true,
    'SB-09 with no claims at all nothing reads as live, so a direct invocation is refused');

  -- ===========================================================================================
  -- SB-10  A CLAIMED AAL IS NOT A GRANTED AAL.
  -- The token is attacker-influenced in the threat model; the recorded session row is not.
  -- ===========================================================================================
  perform pg_temp.as_session(v_user, v_sess, 'aal2');
  perform pg_temp.check((pg_temp.assurance()->>'recent_aal2')::boolean = false,
    'SB-10 a token CLAIMING aal2 does not produce recent_aal2 -- that is read from mfa_amr_claims, '
    'not from anything the caller can assert');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
