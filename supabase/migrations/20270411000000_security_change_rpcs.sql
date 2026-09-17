-- =====================================================================================================
-- SLICE 6 (8/n) -- the writes the Security page makes (Phase 2 F, G, H)
--
-- Three service-role entry points, each doing exactly one thing the server layer cannot do for itself:
-- mint recovery codes, record that a security change happened, and revoke this person's other sessions.
--
-- They take a user id because the SERVICE ROLE calls them, and the service role has no auth.uid() to
-- read. That makes the caller responsible for having established whose account it is -- which the server
-- action does, from a verified session, before it ever gets here. None of them is reachable from a
-- browser: `authenticated` has no EXECUTE on any of them.
-- =====================================================================================================

create or replace function public.generate_recovery_codes_for(p_user_id uuid)
returns text[] language plpgsql security definer set search_path = 'public' as $$
begin
  if p_user_id is null then
    raise exception 'No account given.' using errcode = '22023';
  end if;
  return internal.generate_recovery_codes(p_user_id);
end $$;

revoke all on function public.generate_recovery_codes_for(uuid) from public, anon, authenticated;
grant execute on function public.generate_recovery_codes_for(uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Recording that something changed. The posture row and a security event, together, so the two cannot
-- drift apart -- the event says it happened and the row says what is true now.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.record_security_change(p_user_id uuid, p_change text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare v_event text;
begin
  if p_user_id is null then return; end if;

  v_event := case p_change
    when 'PASSWORD_SET'        then 'password.set'
    when 'MFA_ENROLLED'        then 'mfa.enrolled'
    when 'MFA_FACTOR_REMOVED'  then 'mfa.factor_removed'
    when 'SESSIONS_REVOKED'    then 'session.revoked_by_user'
    else null end;
  if v_event is null then
    raise exception 'Unknown security change.' using errcode = '22023';
  end if;

  insert into public.account_security_state (user_id) values (p_user_id) on conflict (user_id) do nothing;
  update public.account_security_state
     set password_set_at = case when p_change = 'PASSWORD_SET' then now() else password_set_at end,
         mfa_enrolled_at = case
           when p_change = 'MFA_ENROLLED' then coalesce(mfa_enrolled_at, now())
           when p_change = 'MFA_FACTOR_REMOVED'
             then (select min(f.updated_at) from auth.mfa_factors f
                    where f.user_id = p_user_id and f.status = 'verified')
           else mfa_enrolled_at end,
         must_reset_password = case when p_change = 'PASSWORD_SET' then false else must_reset_password end,
         updated_at = now()
   where user_id = p_user_id;

  -- No metadata beyond WHICH change: a security event about a credential must not carry anything
  -- shaped like the credential.
  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values (v_event, p_user_id, p_user_id, 'account security changed', jsonb_build_object('change', p_change));
end $$;

revoke all on function public.record_security_change(uuid, text) from public, anon, authenticated;
grant execute on function public.record_security_change(uuid, text) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- Sign out other devices. Keeps the CURRENT session, ends the rest.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.revoke_my_other_sessions(p_user_id uuid, p_keep_session_id uuid default null)
returns integer language plpgsql security definer set search_path = 'public' as $$
declare v_n integer;
begin
  if p_user_id is null then return 0; end if;
  v_n := internal.revoke_all_sessions(p_user_id, p_keep_session_id);
  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('session.revoked_by_user', p_user_id, p_user_id, 'signed out other devices',
          jsonb_build_object('sessions_ended', v_n));
  return v_n;
end $$;

revoke all on function public.revoke_my_other_sessions(uuid, uuid) from public, anon, authenticated;
grant execute on function public.revoke_my_other_sessions(uuid, uuid) to service_role;

-- ---------------------------------------------------------------------------------------------------
-- What the Security page shows about sessions. The caller's own, and nothing identifying beyond what
-- they need to recognise a device they are looking at.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.my_sessions()
returns table (session_id uuid, created_at timestamptz, refreshed_at timestamptz,
               user_agent text, aal text, is_current boolean)
language sql stable security definer set search_path = '' as $$
  select s.id, s.created_at, s.refreshed_at, s.user_agent, s.aal::text,
         s.id::text = (auth.jwt() ->> 'session_id')
    from auth.sessions s
   where s.user_id = (select auth.uid())
   order by s.created_at desc;
$$;

revoke all on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('password.set','IDENTITY','WARNING',false,true,false),
       ('mfa.enrolled','IDENTITY','INFO',false,true,false),
       ('mfa.factor_removed','IDENTITY','WARNING',false,true,false),
       ('session.revoked_by_user','IDENTITY','INFO',false,true,false),
       ('session.aal_insufficient','IDENTITY','WARNING',false,true,false)
on conflict (event_type) do nothing;

do $$
begin
  if has_function_privilege('authenticated','public.generate_recovery_codes_for(uuid)','EXECUTE')
     or has_function_privilege('authenticated','public.record_security_change(uuid,text)','EXECUTE')
     or has_function_privilege('authenticated','public.revoke_my_other_sessions(uuid,uuid)','EXECUTE') then
    raise exception 'Slice 6: a browser role can call a security write that takes a user id.';
  end if;
  raise notice 'Slice 6: the security writes exist, and no browser can reach them';
end $$;
