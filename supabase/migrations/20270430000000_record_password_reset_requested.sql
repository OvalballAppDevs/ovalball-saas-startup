-- =====================================================================================================
-- SLICE 6b.1 -- the event a password reset request is supposed to leave behind
--
-- Phase 2 G requires both `password.reset_requested` and `password.reset_completed`. The second is
-- easy: by then the person holds a recovery session, so record_my_security_change works. The first is
-- not, because it happens BEFORE any session exists -- somebody types an address into a form they are
-- not signed in to.
--
-- Nothing anon-callable could write it. public.record_security_change is executable by neither anon
-- nor authenticated, which is correct. The alternative would have been to reach for the service role
-- from a public request, and Slice 6 deliberately removed the service role from exactly this path
-- (commit 96d65ae); putting it back would undo that for the sake of one audit line.
--
-- So this is the narrowest possible RPC: it takes an email, and it returns void.
--
-- WHY IT CANNOT BE USED TO FIND OUT WHO HAS AN ACCOUNT
--
-- It returns void whether or not the address matches anybody. It raises nothing. It writes only to
-- security_events, which no browser role can read. The caller learns exactly the same thing in both
-- cases, which is nothing -- the same rule /login already follows for sign-in links, and the same
-- rule E states for reset: "Reset request always responds 'If an account exists we've sent a link'".
--
-- The event is written only when the account exists, because an event whose subject is null would say
-- nothing useful and an event for a stranger's typo is not a security fact about anybody.
-- =====================================================================================================

create or replace function public.record_password_reset_requested(p_email text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user uuid;
begin
  if coalesce(btrim(p_email), '') = '' then
    return;
  end if;

  select id into v_user from auth.users
   where lower(email) = lower(btrim(p_email))
     and deleted_at is null
   limit 1;

  -- No match: return silently. Saying anything here -- an error, a different shape, a different
  -- timing profile worth measuring -- would turn a public form into an account-existence oracle.
  if v_user is null then
    return;
  end if;

  perform internal.emit_security_event(
    'password.reset_requested', v_user, 'SUCCESS', null,
    '{}'::jsonb, null, null, null);
end $$;

revoke all on function public.record_password_reset_requested(text) from public;
grant execute on function public.record_password_reset_requested(text) to anon, authenticated;

comment on function public.record_password_reset_requested(text) is
  'Phase 2 G. Records password.reset_requested for a reset asked for by somebody who is not signed in. '
  'Returns void whether or not the address matches an account, and writes only to security_events, '
  'which no browser role can read -- so it cannot be used to discover who has an Ovalball account.';

do $$
begin
  if not exists (select 1 from public.security_event_types where event_type = 'password.reset_requested') then
    raise exception 'Slice 6b.1: password.reset_requested is not a registered event type';
  end if;
  if has_table_privilege('anon', 'public.security_events', 'SELECT') then
    raise exception 'Slice 6b.1: anon can read security_events, so this RPC would become an oracle';
  end if;
  raise notice 'Slice 6b.1: a reset request can leave a mark without revealing who has an account';
end $$;

-- =====================================================================================================
-- ...and the event at the other end of the journey.
--
-- `password.reset_completed` has been a registered event type since Slice 1 and nothing has ever
-- emitted it, because until 6b.1 there was no reset flow to complete. public.record_security_change is
-- the one writer of account-security events, and it refuses any change word it does not know, so the
-- vocabulary is extended by exactly one value rather than a second emitter being introduced beside it.
--
-- PASSWORD_RESET carries the same state changes as PASSWORD_SET -- the password is set, and a forced
-- reset is satisfied by completing one -- and differs only in the event it writes, because "I changed
-- my password" and "I recovered an account I was locked out of" are different facts to read back.
-- =====================================================================================================
create or replace function public.record_security_change(p_user_id uuid, p_change text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_event text;
begin
  if p_user_id is null then return; end if;

  v_event := case p_change
    when 'PASSWORD_SET'        then 'password.set'
    when 'PASSWORD_RESET'      then 'password.reset_completed'
    when 'MFA_ENROLLED'        then 'mfa.enrolled'
    when 'MFA_FACTOR_REMOVED'  then 'mfa.factor_removed'
    when 'SESSIONS_REVOKED'    then 'session.revoked_by_user'
    else null end;
  if v_event is null then
    raise exception 'Unknown security change.' using errcode = '22023';
  end if;

  insert into public.account_security_state (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.account_security_state
     set password_set_at = case when p_change in ('PASSWORD_SET','PASSWORD_RESET') then now() else password_set_at end,
         mfa_enrolled_at = case
           when p_change = 'MFA_ENROLLED' then coalesce(mfa_enrolled_at, now())
           when p_change = 'MFA_FACTOR_REMOVED'
             then (select min(f.updated_at) from auth.mfa_factors f
                    where f.user_id = p_user_id and f.status = 'verified')
           else mfa_enrolled_at end,
         must_reset_password = case when p_change in ('PASSWORD_SET','PASSWORD_RESET') then false else must_reset_password end,
         updated_at = now()
   where user_id = p_user_id;

  -- No metadata beyond WHICH change: a security event about a credential must not carry anything
  -- shaped like the credential.
  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values (v_event, p_user_id, p_user_id, 'account security changed', jsonb_build_object('change', p_change));
end $$;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'record_security_change') !~ 'password\.reset_completed' then
    raise exception 'Slice 6b.1: completing a reset would leave no password.reset_completed event';
  end if;
  raise notice 'Slice 6b.1: both ends of the reset journey leave a mark';
end $$;
