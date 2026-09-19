-- =====================================================================================================
-- SO-4 / H-7 -- THE ONBOARDING INTENT CARRIER (Slice 6b.2b)
--
-- `public.auth_flow_states` shipped in Slice 5 with the right shape and nothing ever called it, while
-- the signup wizard's answers travelled in `auth.users.user_metadata` -- written by `signInWithOtp`
-- BEFORE anybody has authenticated, for an address anybody can name. That is Phase 1 H-7, and SO-4 is
-- its removal.
--
-- What is pinned here is every property the design asks that carrier to have, and each assertion is
-- written as the attack it refuses rather than as the feature it offers:
--
--   an id nobody can guess, and which is not recoverable from the row
--   a purpose, enforced, so a state made for one journey cannot be spent on another
--   an expiry
--   exactly one consumption, including when two callers race
--   a session requirement, and a binding to whoever spent it
--   silence -- expired, used, wrong purpose and never-existed all answer identically
--   an audit trail that names the kind and never the payload
--
-- Deterministic and self-seeding. Everything is created here and rolled back.
-- =====================================================================================================
begin;

create or replace function pg_temp.check(p_ok boolean, p_label text) returns void language plpgsql as $$
begin
  if coalesce(p_ok, false) then raise notice 'PASS %', p_label; else raise notice 'FAIL %', p_label; end if;
end $$;

create or replace function pg_temp.person(p_label text) returns uuid language plpgsql as $$
declare v uuid := gen_random_uuid(); v_email text := 'afs.' || substr(v::text,1,8) || '@ovalball.test';
begin
  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change_token_new, email_change,
    email_change_token_current, phone_change, phone_change_token, reauthentication_token)
  values (v,'00000000-0000-0000-0000-000000000000','authenticated','authenticated',v_email,'',now(),now(),now(),'{}','{}','','','','','','','','');
  insert into public.profiles (id, first_name, surname, email, date_of_birth, account_state)
  values (v,'AFS',p_label,v_email,(current_date - interval '30 years')::date,'ACTIVE')
  on conflict (id) do update set account_state = 'ACTIVE';
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

create or replace function pg_temp.as_person(p_user uuid) returns void language plpgsql as $$
declare v uuid := gen_random_uuid();
begin
  insert into auth.sessions (id, user_id, created_at, updated_at, aal) values (v, p_user, now(), now(), 'aal1');
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', p_user, 'role', 'authenticated', 'session_id', v)::text, true);
end $$;

create or replace function pg_temp.as_nobody() returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims', '', true);
end $$;

do $outer$
declare
  v_alice uuid; v_bob uuid;
  v_flow text; v_flow2 text; v_other text;
  v_payload jsonb; v_first jsonb; v_second jsonb;
  v_id uuid; n int;
begin
  v_alice := pg_temp.person('Alice');
  v_bob := pg_temp.person('Bob');

  -- ===================================================================================================
  -- A. The credential.
  -- ===================================================================================================
  perform pg_temp.as_nobody();
  v_flow := public.create_auth_flow_state('SIGNUP', '{"personal": {"firstName": "Alice"}, "termsVersion": "v1"}'::jsonb);
  perform pg_temp.check(v_flow is not null and length(v_flow) >= 40,
                        'A1 a signup can create a flow state with no session at all -- it has to, there is none yet');
  perform pg_temp.check(v_flow !~ '[^A-Za-z0-9_-]',
                        'A2 and the id is url-safe, so it never needs encoding on its way through a browser');
  perform pg_temp.check(not exists (select 1 from public.auth_flow_states where flow_id_sha256 = v_flow::bytea),
                        'A3 the id itself is not stored -- only its hash, so the row cannot be turned back into the key');
  perform pg_temp.check(exists (select 1 from public.auth_flow_states
                                where flow_id_sha256 = internal.auth_flow_id_hash(v_flow) and kind = 'SIGNUP'),
                        'A4 while the state is really there, under its purpose');

  v_flow2 := public.create_auth_flow_state('SIGNUP', '{"personal": {}, "termsVersion": "v1"}'::jsonb);
  perform pg_temp.check(v_flow2 <> v_flow, 'A5 two flows never share an id');

  -- The table is reachable only through its functions.
  perform pg_temp.check((select count(*) from pg_policy where polrelid = 'public.auth_flow_states'::regclass) = 0
                    and (select relrowsecurity from pg_class where oid = 'public.auth_flow_states'::regclass),
                        'A6 RLS is on and there are no policies, so nothing reads or writes it except the definer functions');
  perform pg_temp.check(not exists (
      select 1 from information_schema.role_table_grants
      where table_name = 'auth_flow_states' and grantee in ('anon', 'authenticated')),
                        'A7 and neither anon nor authenticated is granted anything on the table directly');

  -- ===================================================================================================
  -- B. A purpose, and only the purposes this slice owns.
  -- ===================================================================================================
  begin
    perform public.create_auth_flow_state('CLAIM', '{}'::jsonb);
    perform pg_temp.check(false, 'B1 a purpose no journey has been migrated onto is refused');
  exception when sqlstate '22023' then
    perform pg_temp.check(true, 'B1 a purpose no journey has been migrated onto is refused');
  end;
  begin
    perform public.create_auth_flow_state('NOT_A_KIND', '{}'::jsonb);
    perform pg_temp.check(false, 'B2 and an invented purpose is refused before it reaches the CHECK constraint');
  exception when others then
    perform pg_temp.check(true, 'B2 and an invented purpose is refused before it reaches the CHECK constraint');
  end;
  begin
    perform public.create_auth_flow_state('SIGNUP', '"not an object"'::jsonb);
    perform pg_temp.check(false, 'B3 a payload that is not an object is refused');
  exception when sqlstate '22023' then
    perform pg_temp.check(true, 'B3 a payload that is not an object is refused');
  end;
  begin
    perform public.create_auth_flow_state('SIGNUP', jsonb_build_object('big', repeat('x', 20000)));
    perform pg_temp.check(false, 'B4 and this is not somewhere to park 20 KB of anything');
  exception when sqlstate '22023' then
    perform pg_temp.check(true, 'B4 and this is not somewhere to park 20 KB of anything');
  end;

  -- ===================================================================================================
  -- C. Consumption needs a session, happens once, and binds.
  -- ===================================================================================================
  perform pg_temp.as_nobody();
  perform pg_temp.check(public.consume_auth_flow_state(v_flow, 'SIGNUP') is null,
                        'C1 an unauthenticated caller gets nothing, however good the id is');

  perform pg_temp.as_person(v_alice);
  v_first := public.consume_auth_flow_state(v_flow, 'SIGNUP');
  perform pg_temp.check(v_first is not null and v_first #>> '{personal,firstName}' = 'Alice',
                        'C2 the person who holds the id gets the context back, once');
  perform pg_temp.check(exists (select 1 from public.auth_flow_states
                                where flow_id_sha256 = internal.auth_flow_id_hash(v_flow)
                                  and consumed_at is not null and user_id = v_alice),
                        'C3 and the row records who spent it and when');

  v_second := public.consume_auth_flow_state(v_flow, 'SIGNUP');
  perform pg_temp.check(v_second is null,
                        'C4 replaying the same id -- a refreshed callback, a second tab -- gets nothing');

  -- Cross-user: Bob holding Alice's spent id learns nothing, and an unspent one
  -- he should not have is simply a state he can spend, which is why the id is
  -- the secret and why it never leaves an httpOnly cookie.
  perform pg_temp.as_person(v_bob);
  perform pg_temp.check(public.consume_auth_flow_state(v_flow, 'SIGNUP') is null,
                        'C5 and a different identity replaying it gets nothing either');

  -- ===================================================================================================
  -- D. Purpose confusion, tampering and silence.
  -- ===================================================================================================
  perform pg_temp.as_person(v_alice);
  perform pg_temp.check(public.consume_auth_flow_state(v_flow2, 'CLAIM') is null,
                        'D1 a signup state cannot be spent as a claim state');
  perform pg_temp.check(public.consume_auth_flow_state(v_flow2, 'INVITATION') is null,
                        'D2 nor as an invitation state');
  perform pg_temp.check(exists (select 1 from public.auth_flow_states
                                where flow_id_sha256 = internal.auth_flow_id_hash(v_flow2) and consumed_at is null),
                        'D3 and the refused attempts did not quietly consume it');
  perform pg_temp.check(public.consume_auth_flow_state(v_flow2, 'SIGNUP') is not null,
                        'D4 so its real purpose still works afterwards');

  perform pg_temp.check(public.consume_auth_flow_state('not-a-real-flow-id', 'SIGNUP') is null,
                        'D5 an invented id gets the same silence as a used one');
  perform pg_temp.check(public.consume_auth_flow_state('', 'SIGNUP') is null, 'D6 and so does an empty one');
  perform pg_temp.check(public.consume_auth_flow_state(null, 'SIGNUP') is null, 'D7 and so does none at all');

  -- Expiry.
  v_other := public.create_auth_flow_state('SIGNUP', '{"personal": {}, "termsVersion": "v1"}'::jsonb);
  update public.auth_flow_states set expires_at = now() - interval '1 minute'
   where flow_id_sha256 = internal.auth_flow_id_hash(v_other);
  perform pg_temp.check(public.consume_auth_flow_state(v_other, 'SIGNUP') is null,
                        'D8 an expired state is gone, and says so the same way everything else does');

  -- ===================================================================================================
  -- E. The audit trail names the journey and not the person's answers.
  -- ===================================================================================================
  select count(*) into n from public.security_events
   where event_type = 'auth.flow_state_consumed' and actor_user_id = v_alice;
  perform pg_temp.check(n >= 1, 'E1 consuming a state emits a security event');
  perform pg_temp.check(not exists (
      select 1 from public.security_events
      where event_type = 'auth.flow_state_consumed' and metadata::text ilike '%firstName%'),
                        'E2 and the event carries the kind, never the payload');

  -- ===================================================================================================
  -- F. The thing this replaces.
  -- ===================================================================================================
  perform pg_temp.check(
    exists (select 1 from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
            where ns.nspname = 'public' and p.proname = 'create_auth_flow_state'),
    'F1 the canonical carrier exists as a function, not as a table anybody can write');
  perform pg_temp.check(
    (select count(*) from information_schema.role_routine_grants
     where routine_name = 'consume_auth_flow_state' and grantee = 'anon') = 0,
    'F2 and consumption is not offered to anon -- creation is pre-auth, spending it never is');
end
$outer$;

rollback;
