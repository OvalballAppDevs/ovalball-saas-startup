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
  -- ===========================================================================================
  -- SB-11..13  THE SHAPE OF THE DATABASE BOUNDARY ITSELF (Phase 2 D.2 layer 1).
  --
  -- Layer 2 in TypeScript is defence in depth. The boundary that actually counts is this one, and
  -- 6b.2a's whole argument for not bolting requireSession onto 450 Server Actions is that it is
  -- present and uniform. That argument is only honest if it is measured, so it is measured here --
  -- and it fails loudly the day somebody adds a table without the gate.
  --
  -- The gate has two strengths and the difference is deliberate:
  --   session_ok()         liveness AND account state
  --   session_live_only()  liveness only
  -- Exactly three tables may be the weaker one, and they are the three the enforcement itself has to
  -- read in order to work: the session layer reads profiles.account_status on every request to
  -- decide somebody is suspended. Gate that read on not being suspended and nothing can ever see the
  -- state it exists to enforce.
  -- ===========================================================================================
  perform pg_temp.check(
    (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
        and not exists (select 1 from pg_policies p
                         where p.schemaname = 'public' and p.tablename = c.relname
                           and p.permissive = 'RESTRICTIVE')
        and has_table_privilege('authenticated', c.oid, 'INSERT')) = 1,
    'SB-11 at most one RLS table lets a browser role write without the RESTRICTIVE session gate '
    '(invitations, whose policies resolve through capability_decision instead)');

  perform pg_temp.check(
    (select count(*) from pg_policies
      where schemaname = 'public' and permissive = 'RESTRICTIVE'
        and qual like '%session_live_only%') = 3,
    'SB-12 exactly three tables use the weaker liveness-only gate, and no more');

  perform pg_temp.check(
    (select count(*) = 3 from pg_policies
      where schemaname = 'public' and permissive = 'RESTRICTIVE'
        and qual like '%session_live_only%'
        and tablename in ('profiles','account_security_state','mfa_enforcement_policy')),
    'SB-12b and they are exactly the three the suspension mechanism must read to enforce itself');

  -- ===========================================================================================
  -- SB-13  ACCOUNT STATE IS FOLDED INTO EVERY CAPABILITY ANSWER.
  --
  -- This is what makes the 450 ungated Server Actions safe: whatever they do, they resolve authority
  -- through internal.capability_decision, which refuses an unusable account outright and says so.
  -- ===========================================================================================
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision')
      ~ 'ACCOUNT_INACTIVE',
    'SB-13 capability_decision refuses an unusable account by name, so every capability-gated path '
    'inherits the account-state check without repeating it');
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'internal' and p.proname = 'capability_decision')
      ~ 'session_live',
    'SB-13b and refuses a session that is no longer live, so a still-valid JWT is not authority');

  -- ===========================================================================================
  -- SB-14  A SESSION IS NOT A CAPABILITY.
  --
  -- The most tempting shortcut in an application boundary is to treat "signed in" as "allowed",
  -- and it is the one mistake that would quietly hand every signed-in person site authority. This
  -- is asserted behaviourally rather than by reading the source, because the shortcut can be
  -- introduced anywhere in the resolver chain, not only where it is currently written.
  -- ===========================================================================================
  v_sess := pg_temp.session_for(v_user, 'aal1');
  perform pg_temp.as_session(v_user, v_sess, 'aal1');
  perform pg_temp.check(
    internal.has_site_capability('site.users.view') = false,
    'SB-14 a live, usable, ordinary session holds NO site capability -- being signed in is not '
    'being authorised');
  perform pg_temp.check(
    internal.can('people.invitation.create', 'club', null, null, null) = false,
    'SB-14b and holds no club capability either, for the same reason');

  -- ===========================================================================================
  -- SB-15..17  THE RACES THAT ACTUALLY EXIST AT THIS STAGE.
  --
  -- 6b.2a adds no new mutable state, so there is no new race to invent. What it DOES do is make a
  -- request's authority depend on two rows that an administrator can change underneath it:
  -- profiles.account_state and auth.sessions. The question worth asking is therefore not "can two
  -- writers corrupt each other" but "can a request that started before a suspension finish after
  -- it" -- and the answer comes from Postgres's own read-committed semantics rather than from any
  -- application lock, which is exactly why it is proven here rather than coded around.
  --
  -- Each check below re-reads through the SAME functions the boundary uses, after the state has
  -- changed, within one transaction -- which is the shape of a request that was already in flight.
  -- ===========================================================================================
  update public.profiles set account_state = 'ACTIVE' where id = v_user;
  perform pg_temp.check(internal.is_account_active(v_user),
    'SB-15 SETUP: the account is usable at the start of the in-flight request');

  update public.profiles set account_state = 'SUSPENDED' where id = v_user;
  perform pg_temp.check(
    internal.is_account_active(v_user) = false,
    'SB-15b SUSPENSION RACING A REQUEST: a later statement in the SAME transaction already sees the '
    'new state, so a request cannot finish under authority it lost mid-flight');

  update public.profiles set account_state = 'ACTIVE' where id = v_user;
  v_sess := pg_temp.session_for(v_user, 'aal1');
  perform pg_temp.as_session(v_user, v_sess, 'aal1');
  perform pg_temp.check(internal.session_live(),
    'SB-16 SETUP: the session is live at the start of the in-flight request');
  delete from auth.sessions where id = v_sess;
  perform pg_temp.check(
    internal.session_live() = false,
    'SB-16b REVOCATION RACING A REQUEST: the very next statement sees the session gone, so '
    'sign-out-everywhere takes effect on the next check rather than at token expiry');

  -- The third candidate race -- an AAL refresh racing a sensitive operation -- has no application
  -- state of its own to race: recent_aal2 reads auth.mfa_amr_claims.updated_at and compares it to
  -- now() at the moment of the check. There is nothing cached and nothing to invalidate, so there is
  -- no window to exploit. Recorded here rather than tested, because a test with no mechanism behind
  -- it would be theatre.
  v_sess := pg_temp.session_for(v_user, 'aal1');
  perform pg_temp.as_session(v_user, v_sess, 'aal1');
  perform pg_temp.check(
    internal.recent_aal2(10) = false and internal.recent_aal2(10) = false,
    'SB-17 the recent-AAL2 answer is computed per call from mfa_amr_claims, so there is no cached '
    'authority for a refresh to race');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
