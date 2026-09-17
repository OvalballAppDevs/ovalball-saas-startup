-- =====================================================================================================
-- SLICE 6 (5/n) -- recovering an account nobody can simply reset (Phase 2 Y.17, G)
--
-- When somebody loses their authenticator and has no recovery code left, resetting their factors is an
-- administrative act with real consequences, so G gives it three brakes rather than a button:
--
--   1. a 24-hour waiting period, with the account told at the start and at the end, and cancellable by
--      the account holder from any signed-in session -- which is what defends against an attacker who
--      has talked their way past support;
--   2. a reason and an identity-proofing note, recorded;
--   3. for a PRIVILEGED target, a second Site Admin's approval (R2). Never the same person twice.
--
-- THE TWO-PERSON RULE IS NOT SOFTENED FOR CONVENIENCE. Production has exactly one Full Site Admin, so a
-- privileged recovery genuinely cannot be approved today: approved_by <> requested_by has no second
-- person to name. That is the designed outcome, not an oversight (AN-3), and the documented escape is
-- break-glass through the Supabase dashboard owner, outside Ovalball entirely. Relaxing the rule in code
-- so the sole administrator could approve their own reset would remove exactly the protection the rule
-- exists to provide.
-- =====================================================================================================

create table if not exists public.privileged_recovery_requests (
  id                uuid primary key default gen_random_uuid(),
  kind              text not null,
  target_user_id    uuid not null references auth.users(id) on delete cascade,
  requested_by      uuid references auth.users(id),
  requested_by_role text not null,
  proofing_note     text,
  reason            text not null,
  state             text not null default 'PENDING_APPROVAL',
  approved_by       uuid references auth.users(id),
  approved_at       timestamptz,
  execute_after     timestamptz,
  completed_at      timestamptz,
  cancelled_by      uuid references auth.users(id),
  cancel_reason     text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint prr_kind_check  check (kind in ('MFA_RESET','EMAIL_CHANGE','MINOR_MFA_RESET')),
  constraint prr_role_check  check (requested_by_role in ('SITE_ADMIN','GUARDIAN','SELF')),
  constraint prr_state_check check (state in ('PENDING_APPROVAL','WAITING','COMPLETED','CANCELLED','REJECTED','EXPIRED')),
  -- The two-person rule, in the schema rather than only in a function, so no code path can forget it.
  constraint prr_two_person  check (approved_by is null or approved_by <> requested_by),
  constraint prr_waiting_needs_time check (state <> 'WAITING' or execute_after is not null)
);

create index if not exists prr_due_idx on public.privileged_recovery_requests (execute_after)
  where state = 'WAITING';
create index if not exists prr_target_idx on public.privileged_recovery_requests (target_user_id, state);

comment on table public.privileged_recovery_requests is
  'Phase 2 Y.17 / G. A factor reset or email change that needs a waiting period, a reason, and -- for a '
  'privileged target -- a second administrator. The account holder can cancel it while it waits.';

alter table public.privileged_recovery_requests enable row level security;

drop policy if exists prr_select_scoped on public.privileged_recovery_requests;
create policy prr_select_scoped on public.privileged_recovery_requests
  for select to authenticated
  using (
    -- The person it is about. Being told is the defence.
    target_user_id = (select auth.uid())
    -- A guardian sees their child's, because G makes minor recovery guardian-visible by design.
    or (kind = 'MINOR_MFA_RESET' and exists (
          select 1 from public.guardians g
           join public.players pl on pl.id = g.player_id
          where g.guardian_user_id = (select auth.uid()) and g.state = 'ACTIVE'
            and pl.user_id = privileged_recovery_requests.target_user_id))
    or internal.has_site_capability('site.users.security.manage')
  );

revoke all on public.privileged_recovery_requests from anon, authenticated;
grant select on public.privileged_recovery_requests to authenticated;

-- ---------------------------------------------------------------------------------------------------
-- Is this target privileged? Decides whether a second administrator is required.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.recovery_target_is_privileged(p_user_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select internal.derive_enforcement_group(p_user_id) = 'PRIVILEGED';
$$;

-- ---------------------------------------------------------------------------------------------------
-- Raise a request. A privileged target waits for a second administrator; an ordinary one starts the
-- 24-hour clock immediately, because there is nothing further to decide.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.request_privileged_recovery(
  p_target_user_id uuid, p_kind text, p_reason text, p_proofing_note text default null)
returns uuid language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_id uuid;
  v_privileged boolean;
  v_role text;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;
  if p_kind not in ('MFA_RESET','EMAIL_CHANGE','MINOR_MFA_RESET') then
    raise exception 'Unknown recovery kind.' using errcode = '22023';
  end if;

  -- Who is asking decides what they may ask for.
  if internal.has_site_capability('site.users.security.manage') then
    v_role := 'SITE_ADMIN';
  elsif p_kind = 'MINOR_MFA_RESET' and exists (
          select 1 from public.guardians g join public.players pl on pl.id = g.player_id
           where g.guardian_user_id = v_actor and g.state = 'ACTIVE' and pl.user_id = p_target_user_id) then
    v_role := 'GUARDIAN';
  else
    raise exception 'You are not authorised to request that.' using errcode = '42501';
  end if;

  -- An administrator may not start a recovery against themselves: that is the self-target rule, and it
  -- is what stops this becoming a way to shed your own second factor.
  if v_role = 'SITE_ADMIN' and p_target_user_id = v_actor then
    raise exception 'You cannot start a recovery for your own account.' using errcode = '42501';
  end if;

  if exists (select 1 from public.privileged_recovery_requests
              where target_user_id = p_target_user_id and state in ('PENDING_APPROVAL','WAITING')) then
    raise exception 'A recovery is already in progress for that account.' using errcode = '23505';
  end if;

  v_privileged := internal.recovery_target_is_privileged(p_target_user_id);

  insert into public.privileged_recovery_requests
    (kind, target_user_id, requested_by, requested_by_role, proofing_note, reason, state, execute_after)
  values (p_kind, p_target_user_id, v_actor, v_role, p_proofing_note, btrim(p_reason),
          case when v_privileged then 'PENDING_APPROVAL' else 'WAITING' end,
          case when v_privileged then null else now() + interval '24 hours' end)
  returning id into v_id;

  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('recovery.requested', v_actor, p_target_user_id, btrim(p_reason),
          jsonb_build_object('request_id', v_id, 'kind', p_kind, 'privileged_target', v_privileged));

  -- The account is told at the start. G makes this the defence against a social-engineered request.
  insert into public.notifications (user_id, type, title, body, data)
  values (p_target_user_id, 'account_recovery_requested', 'Someone asked to reset your sign-in security',
          'If this was not you, cancel it now from Account -> Security. Nothing changes for 24 hours.',
          jsonb_build_object('request_id', v_id, 'kind', p_kind));

  return v_id;
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The second administrator. R2.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.approve_privileged_recovery(p_request_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_req public.privileged_recovery_requests;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.has_site_capability('site.users.security.manage') then
    raise exception 'You are not authorised to approve a recovery.' using errcode = '42501';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required.' using errcode = '22023';
  end if;

  select * into v_req from public.privileged_recovery_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'Recovery request not found.' using errcode = 'P0002';
  end if;
  if v_req.state <> 'PENDING_APPROVAL' then
    raise exception 'That request has already been decided (%).', v_req.state using errcode = 'P0001';
  end if;
  -- The rule this whole table exists for.
  if v_req.requested_by = v_actor then
    raise exception 'A recovery must be approved by a different administrator.' using errcode = '42501';
  end if;
  if v_req.target_user_id = v_actor then
    raise exception 'You cannot approve a recovery of your own account.' using errcode = '42501';
  end if;

  update public.privileged_recovery_requests
     set state = 'WAITING', approved_by = v_actor, approved_at = now(),
         execute_after = now() + interval '24 hours', updated_at = now()
   where id = p_request_id;

  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('recovery.approved', v_actor, v_req.target_user_id, btrim(p_reason),
          jsonb_build_object('request_id', p_request_id));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- Cancellation. The account holder may always stop it; so may a guardian for a child's.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.cancel_privileged_recovery(p_request_id uuid, p_reason text default null)
returns void language plpgsql security definer set search_path = 'public' as $$
declare
  v_actor uuid := auth.uid();
  v_req public.privileged_recovery_requests;
begin
  if v_actor is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_req from public.privileged_recovery_requests where id = p_request_id for update;
  if v_req.id is null then
    raise exception 'Recovery request not found.' using errcode = 'P0002';
  end if;
  if v_req.state not in ('PENDING_APPROVAL','WAITING') then
    raise exception 'That request is no longer open.' using errcode = 'P0001';
  end if;

  if not (v_req.target_user_id = v_actor
          or internal.has_site_capability('site.users.security.manage')
          or (v_req.kind = 'MINOR_MFA_RESET' and exists (
                select 1 from public.guardians g join public.players pl on pl.id = g.player_id
                 where g.guardian_user_id = v_actor and g.state = 'ACTIVE'
                   and pl.user_id = v_req.target_user_id))) then
    raise exception 'You are not part of that request.' using errcode = '42501';
  end if;

  update public.privileged_recovery_requests
     set state = 'CANCELLED', cancelled_by = v_actor, cancel_reason = p_reason, updated_at = now()
   where id = p_request_id;

  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('recovery.cancelled', v_actor, v_req.target_user_id, coalesce(p_reason, 'cancelled'),
          jsonb_build_object('request_id', p_request_id));
end $$;

-- ---------------------------------------------------------------------------------------------------
-- The executor. Marks requests due; the server deletes the factors, because only it may call GoTrue.
-- ---------------------------------------------------------------------------------------------------
create or replace function internal.due_recovery_requests()
returns setof public.privileged_recovery_requests language sql stable security definer set search_path = '' as $$
  select * from public.privileged_recovery_requests
   where state = 'WAITING' and execute_after <= now();
$$;

create or replace function internal.complete_recovery_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v_req public.privileged_recovery_requests;
begin
  select * into v_req from public.privileged_recovery_requests where id = p_request_id for update;
  if v_req.id is null or v_req.state <> 'WAITING' then
    return;   -- already cancelled or completed; nothing to do and nothing to complain about
  end if;
  update public.privileged_recovery_requests
     set state = 'COMPLETED', completed_at = now(), updated_at = now() where id = p_request_id;

  update public.account_security_state set mfa_enrolled_at = null, updated_at = now()
   where user_id = v_req.target_user_id;

  insert into public.security_events (event_type, actor_user_id, subject_user_id, reason, metadata)
  values ('mfa.factors_reset', v_req.requested_by, v_req.target_user_id, v_req.reason,
          jsonb_build_object('request_id', p_request_id, 'kind', v_req.kind));

  insert into public.notifications (user_id, type, title, body, data)
  values (v_req.target_user_id, 'account_recovery_completed', 'Your sign-in security was reset',
          'Set up your authenticator again the next time you sign in.',
          jsonb_build_object('request_id', p_request_id));
end $$;

revoke all on function internal.due_recovery_requests() from public, anon, authenticated;
revoke all on function internal.complete_recovery_request(uuid) from public, anon, authenticated;
grant execute on function internal.due_recovery_requests() to service_role;
grant execute on function internal.complete_recovery_request(uuid) to service_role;

revoke all on function public.request_privileged_recovery(uuid,text,text,text) from public, anon;
revoke all on function public.approve_privileged_recovery(uuid,text) from public, anon;
revoke all on function public.cancel_privileged_recovery(uuid,text) from public, anon;
grant execute on function public.request_privileged_recovery(uuid,text,text,text) to authenticated;
grant execute on function public.approve_privileged_recovery(uuid,text) to authenticated;
grant execute on function public.cancel_privileged_recovery(uuid,text) to authenticated;

-- Being told that somebody has asked to reset your sign-in security is the DEFENCE against a
-- social-engineered recovery, so it is mandatory: there is no preference that can switch it off. The
-- account_security topic is where the rest of that correspondence already lives.
insert into public.notification_types (type_key, topic_key, mandatory_override)
values ('account_recovery_requested', 'account_security', true),
       ('account_recovery_completed', 'account_security', true)
on conflict (type_key) do nothing;

insert into public.security_event_types (event_type, category, severity, club_visible, subject_visible, requires_reason)
values ('recovery.requested','IDENTITY','WARNING',false,true,true),
       ('recovery.approved','IDENTITY','CRITICAL',false,true,true),
       ('recovery.cancelled','IDENTITY','WARNING',false,true,false)
on conflict (event_type) do nothing;

do $$
begin
  if not exists (select 1 from pg_constraint where conname='prr_two_person'
                   and conrelid='public.privileged_recovery_requests'::regclass) then
    raise exception 'Slice 6: the two-person rule is not in the schema.';
  end if;
  raise notice 'Slice 6: privileged recovery needs a reason, 24 hours, and a SECOND administrator';
end $$;
