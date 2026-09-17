-- =====================================================================================================
-- SLICE 6 (9/n) -- brute force, and the way back in (Phase 2 F "Brute force", G)
--
-- A six-digit code has a million values and rotates every thirty seconds, which is only strong if
-- guessing is capped. F sets that cap: ten failures in fifteen minutes locks the account out of the
-- challenge for fifteen minutes, and every failure is recorded so a run of them is visible.
--
-- The recovery route is the other half. Redeeming a code deletes every factor and leaves the session AT
-- AAL1, forced to enrol again -- it never hands out AAL2. A recovery code that granted assurance would
-- be a shorter, weaker password for exactly the accounts MFA exists to protect.
-- =====================================================================================================

create or replace function public.record_mfa_verification_failure(p_user_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
begin
  if p_user_id is null then return; end if;
  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('mfa.verification_failed', p_user_id, p_user_id, 'authenticator code rejected', '{}'::jsonb);
end $$;

revoke all on function public.record_mfa_verification_failure(uuid) from public, anon, authenticated;
grant execute on function public.record_mfa_verification_failure(uuid) to service_role;

create or replace function public.mfa_challenge_locked(p_user_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select coalesce((
    select count(*) >= 10 from public.security_events
     where event_type = 'mfa.verification_failed'
       and actor_user_id = p_user_id
       and occurred_at > now() - interval '15 minutes'), false);
$$;

revoke all on function public.mfa_challenge_locked(uuid) from public, anon, authenticated;
grant execute on function public.mfa_challenge_locked(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- The recovery route's database half: consume one code, then clear the posture so the person is sent
-- back to enrolment. Deleting the GoTrue factors is the server's job -- only it can call the auth API.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.redeem_recovery_code_for(p_user_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare v_ok boolean;
begin
  v_ok := internal.redeem_recovery_code(p_user_id, p_code);
  if not v_ok then return false; end if;

  update public.account_security_state
     set mfa_enrolled_at = null, updated_at = now()
   where user_id = p_user_id;

  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('mfa.factors_reset', p_user_id, p_user_id, 'recovery code redeemed', '{}'::jsonb);
  return true;
end $$;

revoke all on function public.redeem_recovery_code_for(uuid, text) from public, anon, authenticated;
grant execute on function public.redeem_recovery_code_for(uuid, text) to service_role;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('mfa.verification_failed','IDENTITY','WARNING',false,true,false)
on conflict (event_type) do nothing;

do $$
begin
  raise notice 'Slice 6: guessing a code is capped, and recovery never grants assurance';
end $$;
