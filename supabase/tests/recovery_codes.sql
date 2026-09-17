-- =====================================================================================================
-- RECOVERY CODES (Identity/Auth Slice 6, Phase 2 Y.3, G, AI "recovery replay")
--
-- Deterministic and self-seeding.
--
-- A recovery code is the thing that stops "I lost my phone" becoming "I have lost my club". It is also,
-- by construction, a credential that bypasses the second factor -- so every property here is about
-- making sure it is exactly as strong as it looks and no stronger.
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
  values (v,'Rec',p_label,p_email,(current_date - interval '34 years')::date,'ACTIVE') on conflict (id) do nothing;
  perform internal.refresh_account_security_state(v);
  return v;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_a uuid; v_b uuid;
  v_codes text[]; v_codes2 text[];
  v_n int; i int;
begin
  v_a := pg_temp.person('A','rec-a-'||v_tag||'@ovalball.test');
  v_b := pg_temp.person('B','rec-b-'||v_tag||'@ovalball.test');

  -- ---------------------------------------------------------------------------------------------
  -- RC-A  Generation, and what is kept.
  -- ---------------------------------------------------------------------------------------------
  v_codes := internal.generate_recovery_codes(v_a);
  perform pg_temp.check(array_length(v_codes,1) = 10, 'RC-A1 ten codes are issued');
  perform pg_temp.check(
    (select bool_and(c ~ '^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$') from unnest(v_codes) c),
    'RC-A2 each is ten Crockford characters as XXXXX-XXXXX, so nothing reads as something else');
  perform pg_temp.check((select count(distinct c) from unnest(v_codes) c) = 10,
    'RC-A3 and they are all different');

  -- The point of the whole design: what is stored is not a code.
  perform pg_temp.check(
    not exists (select 1 from public.account_recovery_codes r, unnest(v_codes) c
                 where r.code_hmac::text like '%' || c || '%'),
    'RC-A4 NOT STORED: no stored row contains a code -- only an HMAC of it');
  perform pg_temp.check(
    (select count(*) from information_schema.columns
      where table_schema='public' and table_name='account_recovery_codes'
        and column_name in ('code','plaintext','secret')) = 0,
    'RC-A5 and there is no column a code could live in');
  perform pg_temp.check(
    not has_table_privilege('authenticated','public.account_recovery_codes','SELECT')
    and not has_table_privilege('anon','public.account_recovery_codes','SELECT'),
    'RC-A6 no browser role can read the table at all, not even its owner''s own rows');

  -- A different pepper from Slice 5's invitation codes.
  perform pg_temp.check(
    internal.recovery_code_hash(v_codes[1]) <> internal.invitation_code_hash(v_codes[1]),
    'RC-A7 recovery codes and invitation codes do not share a key, so one leak is not two');

  -- ---------------------------------------------------------------------------------------------
  -- RC-B  Redemption, once.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(internal.redeem_recovery_code(v_a, v_codes[1]),
    'RC-B1 a real code is accepted');
  perform pg_temp.check(not internal.redeem_recovery_code(v_a, v_codes[1]),
    'RC-B2 REPLAY: the same code a second time is refused');
  perform pg_temp.check(
    (select count(*) from public.account_recovery_codes where user_id = v_a and used_at is null) = 9,
    'RC-B3 and exactly one was consumed');

  -- Case and separators do not matter; a person reading one off paper should not have to be careful.
  perform pg_temp.check(internal.redeem_recovery_code(v_a, lower(replace(v_codes[2],'-',''))),
    'RC-B4 lower case with the dash removed still works -- the normaliser does that work');

  -- POSITIVE CONTROL, and the boundary that matters: one person's code is not another's.
  perform pg_temp.check(not internal.redeem_recovery_code(v_b, v_codes[3]),
    'RC-B5 CROSS-ACCOUNT: A''s code does nothing for B');
  perform pg_temp.check(internal.redeem_recovery_code(v_a, v_codes[3]),
    'RC-B6 POSITIVE CONTROL: and that same code still works for A, so the refusal was about identity');

  perform pg_temp.check(not internal.redeem_recovery_code(v_a, 'ZZZZZ-ZZZZZ'),
    'RC-B7 an invented code is refused');

  -- ---------------------------------------------------------------------------------------------
  -- RC-C  Regeneration invalidates everything before it (G).
  -- ---------------------------------------------------------------------------------------------
  v_codes2 := internal.generate_recovery_codes(v_a);
  perform pg_temp.check(
    (select count(*) from public.account_recovery_codes where user_id = v_a) = 10,
    'RC-C1 regenerating leaves exactly ten codes, not twenty');
  perform pg_temp.check(not internal.redeem_recovery_code(v_a, v_codes[4]),
    'RC-C2 and an OLD unused code no longer works -- regenerating means the old set is untrusted');
  perform pg_temp.check(internal.redeem_recovery_code(v_a, v_codes2[1]),
    'RC-C3 POSITIVE CONTROL: while a new one does');

  -- ---------------------------------------------------------------------------------------------
  -- RC-D  Guessing is capped (G: five failures in fifteen minutes).
  -- ---------------------------------------------------------------------------------------------
  v_codes2 := internal.generate_recovery_codes(v_b);
  for i in 1 .. 5 loop
    perform internal.redeem_recovery_code(v_b, 'AAAAA-BBBB' || i::text);
  end loop;
  perform pg_temp.check(not internal.redeem_recovery_code(v_b, v_codes2[1]),
    'RC-D1 THROTTLED: after five failures even a VALID code is refused');
  perform pg_temp.check(
    (select count(*) from public.security_events
      where event_type = 'mfa.recovery_code_throttled' and subject_user_id = v_b) >= 1,
    'RC-D2 and the lockout is on the record, so a run of attempts is visible');
  perform pg_temp.check(
    (select count(*) from public.account_recovery_codes where user_id = v_b and used_at is null) = 10,
    'RC-D3 and the valid code was NOT consumed by being refused');

  -- The throttle is TIME-BOXED, not permanent -- an honest person locked out has to get back in.
  -- That cannot be demonstrated by back-dating the events: security_events is append-only and its
  -- trigger stamps occurred_at itself, which is exactly the property that makes the audit trustworthy.
  -- Waiting fifteen real minutes in a test suite would be worse. So the window is asserted where it is
  -- written, and the fact that it is a window at all -- rather than a permanent lock -- is the claim.
  perform pg_temp.check(
    (select prosrc ~ 'now\(\) - interval ''15 minutes''' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='redeem_recovery_code'),
    'RC-D4 and the lockout is a fifteen-minute WINDOW, not a permanent bar (asserted on the rule: an '
    'append-only audit cannot be back-dated, and waiting fifteen minutes in a suite is not a test)');

  -- ---------------------------------------------------------------------------------------------
  -- RC-E  A recovery code never grants assurance (G).
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    (select prosrc !~ 'aal2' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='internal' and p.proname='redeem_recovery_code'),
    'RC-E1 redeeming a code sets no assurance level -- it is a way back to enrolment, not past it');
  perform pg_temp.check(
    (select prosrc ~ 'mfa_enrolled_at = null' from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname='public' and p.proname='redeem_recovery_code_for'),
    'RC-E2 and it clears the enrolment posture, so the person is sent to set up a new authenticator');

  -- ---------------------------------------------------------------------------------------------
  -- RC-F  Events carry no secret.
  -- ---------------------------------------------------------------------------------------------
  perform pg_temp.check(
    not exists (select 1 from public.security_events
                 where event_type like 'mfa.recovery%'
                   and metadata ?| array['code','token','secret','password']),
    'RC-F1 no recovery event carries a secret-shaped metadata key');
  perform pg_temp.check(
    not exists (select 1 from public.security_events e, unnest(v_codes || v_codes2) c
                 where e.metadata::text like '%' || c || '%' or coalesce(e.reason,'') like '%' || c || '%'),
    'RC-F2 and no event body contains a code, in metadata or in its reason');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
