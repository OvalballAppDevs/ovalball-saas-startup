-- =====================================================================================================
-- SLICE 6 (11/n) -- the security writes stop borrowing the service role
--
-- The first cut of Account -> Security called its database writes through the service-role client,
-- passing the user id as an argument. lib/supabase/service-role.ts says, in its own comment, exactly
-- why that is wrong:
--
--     "Never import this from a Server Action reachable by an ordinary authenticated request ... it has
--      no session, no capability check of its own, and bypasses every RLS policy in this project."
--
-- It was also unnecessary. Every one of these operations is a person acting on their OWN account, so
-- the identity does not need to be passed at all: these functions take no user id and read auth.uid().
-- There is nothing to aim at somebody else, no RLS is bypassed, and a missing environment variable
-- cannot turn the Security page into a blank error -- which is how this was found.
--
-- The one genuinely elevated operation, deleting GoTrue factors after a recovery code, stays with the
-- service role in a route handler, exactly where Phase 2 G puts it.
-- =====================================================================================================

-- ---------------------------------------------------------------------------------------------------
-- Replacement codes. R: an account-security change needs a recent authenticator code.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.regenerate_my_recovery_codes()
returns text[] language plpgsql security definer set search_path = 'public' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.recent_aal2(10) then
    raise exception 'Enter a code from your authenticator first.' using errcode = '42501';
  end if;
  return internal.generate_recovery_codes(v_actor);
end $$;

revoke all on function public.regenerate_my_recovery_codes() from public, anon;
grant execute on function public.regenerate_my_recovery_codes() to authenticated;

-- The first set, at enrolment. No recent-code requirement, because verifying the factor IS the proof
-- and demanding another one immediately afterwards would be a loop.
create or replace function public.issue_my_first_recovery_codes()
returns text[] language plpgsql security definer set search_path = 'public' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- Only where there is now a verified factor: this is the enrolment tail, not a way to mint codes.
  if not exists (select 1 from auth.mfa_factors f where f.user_id = v_actor and f.status = 'verified') then
    raise exception 'Set up an authenticator first.' using errcode = '42501';
  end if;
  return internal.generate_recovery_codes(v_actor);
end $$;

revoke all on function public.issue_my_first_recovery_codes() from public, anon;
grant execute on function public.issue_my_first_recovery_codes() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Recording a change to my own security. No user id: whose account it is comes from the session.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.record_my_security_change(p_change text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform public.record_security_change(v_actor, p_change);
end $$;

revoke all on function public.record_my_security_change(text) from public, anon;
grant execute on function public.record_my_security_change(text) to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Sign out my other devices. Keeps THIS session, ends the rest, and works out which is which itself.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.sign_out_my_other_devices()
returns integer language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_session text := auth.jwt() ->> 'session_id';
  v_keep uuid;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.recent_aal2(10) then
    raise exception 'Enter a code from your authenticator first.' using errcode = '42501';
  end if;
  v_keep := case when v_session ~ '^[0-9a-fA-F-]{36}$' then v_session::uuid else null end;
  return public.revoke_my_other_sessions(v_actor, v_keep);
end $$;

revoke all on function public.sign_out_my_other_devices() from public, anon;
grant execute on function public.sign_out_my_other_devices() to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- A failed authenticator code, recorded against the person who tried it.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.record_my_mfa_failure()
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then return; end if;
  perform public.record_mfa_verification_failure(v_actor);
end $$;

revoke all on function public.record_my_mfa_failure() from public, anon;
grant execute on function public.record_my_mfa_failure() to authenticated;

do $$
begin
  -- None of these may take a user id: an argument is something a caller can change.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.proname in ('regenerate_my_recovery_codes','issue_my_first_recovery_codes',
                         'record_my_security_change','sign_out_my_other_devices','record_my_mfa_failure')
       and pg_get_function_identity_arguments(p.oid) like '%uuid%') then
    raise exception 'Slice 6: a self-service security write takes a user id, which a caller could change.';
  end if;
  raise notice 'Slice 6: the security writes read the session instead of being told whose account it is';
end $$;
