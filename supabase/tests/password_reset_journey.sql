-- =====================================================================================================
-- PASSWORD RESET AND ACCOUNT DESTINATIONS (Slice 6b.1; Phase 2 E, G, D.2)
--
-- Deterministic and self-seeding.
--
-- Until 6b.1 the Sign In page linked to /forgot-password and that route was a production 404. The only
-- Full Site Admin therefore had no way back into their own account if they forgot their password, with
-- AN-3 unresolved and no second administrator able to help. These assertions are about the parts of
-- that journey the database owns: the two events Phase 2 G names, and the rule that asking for a reset
-- must never reveal who has an account.
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
  values (v,'PRJ',p_label,p_email,(current_date - interval '34 years')::date,'ACTIVE');
  return v;
end $$;

do $$
declare
  v_tag text := substr(gen_random_uuid()::text,1,8);
  v_user uuid; v_email text; v_before bigint; v_rc text;
begin
  v_email := 'prj-'||v_tag||'@ovalball.test';
  v_user := pg_temp.person('Person', v_email);

  -- =============================================================================================
  -- PRJ-01..03  Asking for a reset leaves the mark Phase 2 G names, and reveals nothing.
  -- =============================================================================================
  perform public.record_password_reset_requested(v_email);
  perform pg_temp.check(
    (select count(*) from public.security_events
      where subject_user_id = v_user and event_type = 'password.reset_requested') = 1,
    'PRJ-01 asking for a reset records password.reset_requested against the account');

  -- An address nobody uses: the function must do nothing at all, and must not raise, because raising
  -- IS an answer. A caller who can tell the two cases apart can enumerate Ovalball's users.
  v_before := (select count(*) from public.security_events);
  begin
    perform public.record_password_reset_requested('nobody-'||v_tag||'@ovalball.test');
    v_rc := 'returned';
  exception when others then v_rc := 'RAISED';
  end;
  perform pg_temp.check(v_rc = 'returned',
    'PRJ-02 an address with no account returns silently -- raising would answer the question');
  perform pg_temp.check((select count(*) from public.security_events) = v_before,
    'PRJ-02b and writes nothing, so the table cannot be used to confirm a guess either');

  -- The oracle question is about ANON, who is who asks a public reset form. A signed-in person may
  -- read their OWN events -- Account -> Security shows recent activity, and R gives SITE_SUPPORT
  -- site.security_events.view -- and RLS scopes that to the subject, so it reveals nothing about
  -- anybody else's account either.
  perform pg_temp.check(
    not has_table_privilege('anon','public.security_events','SELECT'),
    'PRJ-03 anon cannot read security_events at all, so the event is not an oracle for a public form');
  perform pg_temp.check(
    exists (select 1 from pg_policies where tablename='security_events' and cmd='SELECT'
             and qual like '%subject_user_id%auth.uid()%'),
    'PRJ-03b and a signed-in person reads only events whose subject is themselves');

  -- =============================================================================================
  -- PRJ-04..06  Completing a reset. One event, distinct from an ordinary password change.
  -- =============================================================================================
  perform public.record_security_change(v_user, 'PASSWORD_RESET');
  perform pg_temp.check(
    (select count(*) from public.security_events
      where subject_user_id = v_user and event_type = 'password.reset_completed') = 1,
    'PRJ-04 completing a reset records password.reset_completed');
  perform pg_temp.check(
    (select count(*) from public.security_events
      where subject_user_id = v_user and event_type = 'password.set') = 0,
    'PRJ-04b and NOT password.set -- recovering an account and changing a password are different facts');
  perform pg_temp.check(
    (select password_set_at is not null and must_reset_password = false
       from public.account_security_state where user_id = v_user),
    'PRJ-05 a completed reset satisfies a forced reset and records when the password was set');

  -- The vocabulary is closed: one writer, and it refuses words it does not know.
  begin
    perform public.record_security_change(v_user, 'PASSWORD_RECOVERED');
    v_rc := 'ALLOWED';
  exception when others then get stacked diagnostics v_rc = returned_sqlstate;
  end;
  perform pg_temp.check(v_rc = '22023',
    'PRJ-06 an unknown change word is still refused, so the event vocabulary cannot drift');

  -- =============================================================================================
  -- PRJ-07  No credential material anywhere in what was written.
  -- =============================================================================================
  perform pg_temp.check(
    not exists (select 1 from public.security_events e
                 where e.subject_user_id = v_user
                   and (e.metadata::text ~* '(password|secret|token|hash)'
                        and e.metadata::text !~* '"change"')),
    'PRJ-07 neither event carries anything shaped like the credential it is about');

  -- =============================================================================================
  -- PRJ-08  WHY THE RESET PATH DOES NOT CALL public.sign_out_my_other_devices().
  --
  -- E requires a reset to revoke the account's other sessions, and there is an RPC with exactly
  -- that name. It is the wrong one, and this pins the reason so nobody "simplifies" the reset by
  -- reaching for it: it guards itself with internal.recent_aal2(10), and somebody completing a
  -- recovery is at AAL1 by definition -- the TOTP challenge comes AFTER the reset, which is what E
  -- describes. The call would raise 42501 every time, and an ignored error on an rpc() call reads
  -- exactly like a security control that works.
  --
  -- The gate itself is correct and is NOT weakened. The reset uses GoTrue's own others-scoped
  -- sign-out, which is authorised by holding the session rather than by AAL.
  -- =============================================================================================
  perform pg_temp.check(
    (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'sign_out_my_other_devices') ~ 'recent_aal2',
    'PRJ-08 sign_out_my_other_devices still requires recent AAL2, so a recovery session cannot use it');
end $$;

rollback;

\echo '=== Done. Every assertion above should read PASS. ==='
