-- =====================================================================================================
-- SLICE 6 (10/n) -- a throttle that counts a column it can never see
--
-- `internal.security_event_facts` sets `actor_user_id := auth.uid()` on every insert, overwriting
-- whatever the caller passed. That is right: the ACTOR of a security event is whoever performed it,
-- taken from the session, not a value a caller can assert.
--
-- The consequence, which the recovery suite found: the recovery-code and MFA-attempt limits counted
-- past failures by `actor_user_id`, and both run as the SERVICE ROLE -- where `auth.uid()` is null. So
-- every failure was recorded against nobody, the counts were always zero, and THE LIMITS WOULD NEVER
-- HAVE FIRED IN PRODUCTION. Guessing at recovery codes would have been uncapped.
--
-- The right column is `subject_user_id`: the person the event is ABOUT. The trigger does not touch it,
-- precisely because it is a fact the caller has established rather than one the session implies.
-- =====================================================================================================

create or replace function internal.redeem_recovery_code(p_user_id uuid, p_code text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid;
  v_fail int;
begin
  if p_user_id is null or coalesce(btrim(p_code), '') = '' then
    return false;
  end if;

  -- G: five failures in fifteen minutes locks this route for fifteen minutes. Counted on
  -- subject_user_id, because the actor column belongs to the trigger and is null for a service-role
  -- caller -- which is every caller this function has.
  select count(*) into v_fail from public.security_events
   where event_type = 'mfa.recovery_code_failed' and subject_user_id = p_user_id
     and occurred_at > now() - interval '15 minutes';
  if v_fail >= 5 then
    insert into public.security_events (event_type, subject_user_id, reason, metadata)
    values ('mfa.recovery_code_throttled', p_user_id, 'too many recovery code attempts', '{}'::jsonb);
    return false;
  end if;

  select id into v_id from public.account_recovery_codes
   where user_id = p_user_id
     and code_hmac = internal.recovery_code_hash(p_code)
     and used_at is null
   for update;

  if v_id is null then
    insert into public.security_events (event_type, subject_user_id, reason, metadata)
    values ('mfa.recovery_code_failed', p_user_id, 'recovery code not accepted', '{}'::jsonb);
    return false;
  end if;

  update public.account_recovery_codes set used_at = now() where id = v_id and used_at is null;
  if not found then
    -- Consumed between the lock and here. One attempt, one code.
    return false;
  end if;

  insert into public.security_events (event_type, subject_user_id, reason, metadata)
  values ('mfa.recovery_code_used', p_user_id, 'recovery code redeemed',
          jsonb_build_object('remaining',
            (select count(*) from public.account_recovery_codes
              where user_id = p_user_id and used_at is null)));
  return true;
end $$;

revoke all on function internal.redeem_recovery_code(uuid, text) from public, anon, authenticated;
grant execute on function internal.redeem_recovery_code(uuid, text) to service_role;

-- The same mistake, in the same place, for the authenticator attempt limit.
create or replace function public.record_mfa_verification_failure(p_user_id uuid)
returns void language plpgsql security definer set search_path = 'public' as $$
begin
  if p_user_id is null then return; end if;
  insert into public.security_events (event_type, subject_user_id, reason, metadata)
  values ('mfa.verification_failed', p_user_id, 'authenticator code rejected', '{}'::jsonb);
end $$;

create or replace function public.mfa_challenge_locked(p_user_id uuid)
returns boolean language sql stable security definer set search_path = 'public' as $$
  select coalesce((
    select count(*) >= 10 from public.security_events
     where event_type = 'mfa.verification_failed'
       and subject_user_id = p_user_id
       and occurred_at > now() - interval '15 minutes'), false);
$$;

revoke all on function public.record_mfa_verification_failure(uuid) from public, anon, authenticated;
revoke all on function public.mfa_challenge_locked(uuid) from public, anon, authenticated;
grant execute on function public.record_mfa_verification_failure(uuid) to service_role;
grant execute on function public.mfa_challenge_locked(uuid) to service_role;

-- And the generation event, so a code set is attributable to the person it belongs to.
create or replace function internal.generate_recovery_codes(p_user_id uuid)
returns text[] language plpgsql security definer set search_path = '' as $$
declare
  v_batch uuid := gen_random_uuid();
  v_codes text[] := '{}';
  v_code text;
  i int;
begin
  if p_user_id is null then
    raise exception 'No account given.' using errcode = '22023';
  end if;

  delete from public.account_recovery_codes where user_id = p_user_id;

  for i in 1 .. 10 loop
    loop
      v_code := internal.new_invitation_code();
      exit when not exists (
        select 1 from public.account_recovery_codes
         where user_id = p_user_id and code_hmac = internal.recovery_code_hash(v_code));
    end loop;
    insert into public.account_recovery_codes (user_id, code_hmac, batch_id)
    values (p_user_id, internal.recovery_code_hash(v_code), v_batch);
    v_codes := v_codes || v_code;
  end loop;

  update public.account_security_state
     set recovery_codes_generated_at = now(), updated_at = now()
   where user_id = p_user_id;

  insert into public.security_events (event_type, subject_user_id, reason, metadata)
  values ('mfa.recovery_codes_generated', p_user_id, 'recovery codes generated',
          jsonb_build_object('count', 10));

  return v_codes;
end $$;

revoke all on function internal.generate_recovery_codes(uuid) from public, anon, authenticated;
grant execute on function internal.generate_recovery_codes(uuid) to service_role;

do $$
begin
  -- Asserted on the source, not by writing a probe event: security_events is append-only by design
  -- (PG-9), so a migration that inserted one to check itself could never take it back. The BEHAVIOUR
  -- -- that five failures actually lock the route -- is proved in supabase/tests/recovery_codes.sql,
  -- which runs in a transaction it rolls back.
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='internal' and p.proname='redeem_recovery_code') ~ 'actor_user_id' then
    raise exception 'Slice 6: the recovery limit still counts actor_user_id, which is null for its own callers.';
  end if;
  if (select prosrc from pg_proc p join pg_namespace n on n.oid=p.pronamespace
       where n.nspname='public' and p.proname='mfa_challenge_locked') ~ 'actor_user_id' then
    raise exception 'Slice 6: the authenticator limit still counts actor_user_id.';
  end if;
  raise notice 'Slice 6: attempt limits count the person the event is about, and now actually fire';
end $$;
