-- =====================================================================================================
-- SLICE 6 (12/n) -- redeeming a recovery code needs no elevated client (Phase 2 G)
--
-- Phase 2 G describes the recovery route calling the admin API through the service role to delete the
-- factors. It does not have to. `internal.revoke_session` already deletes from `auth.sessions` as a
-- definer function owned by postgres, and the same owner holds DELETE on `auth.mfa_factors`,
-- `auth.mfa_challenges` and `auth.mfa_amr_claims` -- verified read-only on production before this was
-- written, not assumed from the local stack.
--
-- So the whole flow becomes one function on the PERSON'S OWN SESSION: consume a code, delete their
-- factors, clear the posture. No service-role client, no user id passed in, and nothing in the
-- authenticated request path that bypasses RLS. lib/supabase/service-role.ts warns in its own comment
-- against exactly that, and it was right to.
--
-- WHAT THIS STILL DOES NOT DO: grant assurance. The session stays at AAL1 with no factor at all, which
-- is the state the enrolment page exists for.
-- =====================================================================================================

create or replace function public.redeem_my_recovery_code(p_code text)
returns boolean language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_ok boolean;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  -- Consumes exactly one code, or refuses. Throttling and the one-time rule live in here.
  v_ok := internal.redeem_recovery_code(v_actor, p_code);
  if not v_ok then
    return false;
  end if;

  -- The authenticator is gone as far as Ovalball is concerned, so it must be gone in GoTrue too --
  -- otherwise the person is still challenged by a factor they have just told us they cannot reach.
  -- Challenges and amr entries go with it: a challenge outliving its factor is a dangling row, and an
  -- amr entry claiming a totp method for a factor that no longer exists is a claim about a proof that
  -- can no longer be made.
  delete from auth.mfa_challenges c
   where c.factor_id in (select f.id from auth.mfa_factors f where f.user_id = v_actor);
  delete from auth.mfa_amr_claims a
   where a.authentication_method = 'totp'
     and a.session_id in (select s.id from auth.sessions s where s.user_id = v_actor);
  delete from auth.mfa_factors f where f.user_id = v_actor;

  update public.account_security_state
     set mfa_enrolled_at = null, updated_at = now()
   where user_id = v_actor;

  insert into public.security_events (event_type, subject_user_id, reason, metadata)
  values ('mfa.factors_reset', v_actor, 'recovery code redeemed', '{}'::jsonb);

  return true;
end $$;

comment on function public.redeem_my_recovery_code(text) is
  'Phase 2 G. Consumes one recovery code and removes every authenticator, on the caller''s own session. '
  'Never grants AAL2: the session stays AAL1 with no factor, and the person enrols again.';

revoke all on function public.redeem_my_recovery_code(text) from public, anon;
grant execute on function public.redeem_my_recovery_code(text) to authenticated;

do $$
begin
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='redeem_my_recovery_code') ~ 'aal2' then
    raise exception 'Slice 6: redeeming a recovery code touches the assurance level.';
  end if;
  if pg_get_function_identity_arguments(to_regprocedure('public.redeem_my_recovery_code(text)')) like '%uuid%' then
    raise exception 'Slice 6: the recovery route takes a user id, which a caller could change.';
  end if;
  raise notice 'Slice 6: recovery runs on the person''s own session, with no elevated client at all';
end $$;
