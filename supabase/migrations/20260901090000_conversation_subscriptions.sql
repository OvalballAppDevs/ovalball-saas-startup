-- Chat participant management: Remove / Leave / Mute. Deliberately
-- separate from authorization (can_access_fixture_conversation) per the
-- brief's own guidance -- CAN ACCESS (role or explicit grant) never
-- changes here; only SUBSCRIBED TO NOTIFICATIONS / ACTIVE PARTICIPANT
-- state does. None of this touches club_memberships, team_permissions,
-- or fixture_messages history.

create table public.fixture_conversation_subscriptions (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid references public.fixtures(id),
  fixture_request_id uuid references public.fixture_requests(id),
  user_id uuid not null references public.profiles(id),
  muted boolean not null default false,
  left_at timestamptz,
  updated_at timestamptz not null default now(),
  check (num_nonnulls(fixture_id, fixture_request_id) = 1)
);

comment on table public.fixture_conversation_subscriptions is
  'Per-user participation/notification state for a fixture conversation -- muted and/or left. Absence of a row means the default state (subscribed, active). Never a substitute for RLS: a muted/left user with real role-derived or explicit-grant access can still read the conversation if they navigate to it directly.';

create unique index fixture_conversation_subscriptions_fixture_user_key
  on public.fixture_conversation_subscriptions (fixture_id, user_id) where fixture_id is not null;
create unique index fixture_conversation_subscriptions_request_user_key
  on public.fixture_conversation_subscriptions (fixture_request_id, user_id) where fixture_request_id is not null;

alter table public.fixture_conversation_subscriptions enable row level security;

create policy fixture_conversation_subscriptions_select on public.fixture_conversation_subscriptions for select
  using (internal.can_access_fixture_conversation(fixture_id, fixture_request_id));

-- Writes are RPC-only (below) -- no insert/update/delete policy for any role.

-- ============================================================
-- Mute -- self only, reversible, never affects who else sees you as a
-- participant.
-- ============================================================
create or replace function public.set_fixture_conversation_mute(p_fixture_id uuid, p_fixture_request_id uuid, p_muted boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized for this conversation.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    insert into public.fixture_conversation_subscriptions (fixture_id, user_id, muted)
    values (p_fixture_id, auth.uid(), p_muted)
    on conflict (fixture_id, user_id) where fixture_id is not null
      do update set muted = excluded.muted, updated_at = now();
  else
    insert into public.fixture_conversation_subscriptions (fixture_request_id, user_id, muted)
    values (p_fixture_request_id, auth.uid(), p_muted)
    on conflict (fixture_request_id, user_id) where fixture_request_id is not null
      do update set muted = excluded.muted, updated_at = now();
  end if;
end;
$$;

-- ============================================================
-- Leave -- self only. Stops routine notifications and drops out of the
-- active participant list; does NOT touch club/team standing and does
-- NOT delete any message history.
-- ============================================================
create or replace function public.leave_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized for this conversation.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    insert into public.fixture_conversation_subscriptions (fixture_id, user_id, left_at)
    values (p_fixture_id, auth.uid(), now())
    on conflict (fixture_id, user_id) where fixture_id is not null
      do update set left_at = now(), updated_at = now();
  else
    insert into public.fixture_conversation_subscriptions (fixture_request_id, user_id, left_at)
    values (p_fixture_request_id, auth.uid(), now())
    on conflict (fixture_request_id, user_id) where fixture_request_id is not null
      do update set left_at = now(), updated_at = now();
  end if;

  select p.first_name || ' ' || p.surname into v_display_name from public.profiles p where p.id = auth.uid();
  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s left the conversation', v_display_name), 'system_event');
end;
$$;

-- ============================================================
-- Rejoin -- self only, requires the caller still genuinely has real
-- access (role-derived or an existing explicit grant); clears left_at.
-- ============================================================
create or replace function public.rejoin_fixture_conversation(p_fixture_id uuid, p_fixture_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_display_name text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You no longer have access to this fixture conversation.' using errcode = '42501';
  end if;

  update public.fixture_conversation_subscriptions
  set left_at = null, updated_at = now()
  where user_id = auth.uid()
    and ((p_fixture_id is not null and fixture_id = p_fixture_id) or (p_fixture_request_id is not null and fixture_request_id = p_fixture_request_id));

  select p.first_name || ' ' || p.surname into v_display_name from public.profiles p where p.id = auth.uid();
  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s rejoined the conversation', v_display_name), 'system_event');
end;
$$;

-- ============================================================
-- Remove -- an authorized manager removes a fellow member of THEIR OWN
-- club side (never the opponent's) from active participation. Never
-- deletes club_memberships/team_permissions, never deletes messages.
-- ============================================================
create or replace function public.remove_fixture_conversation_participant(p_fixture_id uuid, p_fixture_request_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_my_club_id uuid;
  v_target_club_id uuid;
  v_target_display text;
  v_actor_display text;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'Use Leave Conversation to remove yourself.' using errcode = '42501';
  end if;
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    raise exception 'You are not authorized to manage participants in this conversation.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    select owning_team_id, opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures where id = p_fixture_id;
  else
    select r.requesting_team_id, r.target_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select c.club_id into v_my_club_id
  from public.club_memberships c
  where c.user_id = auth.uid() and c.status = 'active'
    and c.club_id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
  limit 1;
  if v_my_club_id is null then
    select t.club_id into v_my_club_id
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;
  if v_my_club_id is null and not internal.is_site_admin() then
    raise exception 'You do not have a club to manage participants from on this fixture.' using errcode = '42501';
  end if;

  select c.club_id into v_target_club_id
  from public.club_memberships c
  where c.user_id = p_user_id and c.status = 'active'
    and c.club_id in (select club_id from public.teams where id in (v_owning_team_id, v_opponent_team_id))
  limit 1;
  if v_target_club_id is null or (v_target_club_id <> v_my_club_id and not internal.is_site_admin()) then
    raise exception 'You can only manage participants from your own club''s side of this fixture.' using errcode = '42501';
  end if;

  if p_fixture_id is not null then
    insert into public.fixture_conversation_subscriptions (fixture_id, user_id, left_at)
    values (p_fixture_id, p_user_id, now())
    on conflict (fixture_id, user_id) where fixture_id is not null
      do update set left_at = now(), updated_at = now();
  else
    insert into public.fixture_conversation_subscriptions (fixture_request_id, user_id, left_at)
    values (p_fixture_request_id, p_user_id, now())
    on conflict (fixture_request_id, user_id) where fixture_request_id is not null
      do update set left_at = now(), updated_at = now();
  end if;

  delete from public.fixture_conversation_participants
  where user_id = p_user_id
    and ((p_fixture_id is not null and fixture_id = p_fixture_id) or (p_fixture_request_id is not null and fixture_request_id = p_fixture_request_id));

  select p.first_name || ' ' || p.surname into v_target_display from public.profiles p where p.id = p_user_id;
  select p.first_name || ' ' || p.surname into v_actor_display from public.profiles p where p.id = auth.uid();
  insert into public.fixture_messages (fixture_id, fixture_request_id, sender_user_id, body, kind)
  values (p_fixture_id, p_fixture_request_id, auth.uid(), format('%s removed %s from the conversation', v_actor_display, v_target_display), 'system_event');
end;
$$;

revoke execute on function public.set_fixture_conversation_mute(uuid, uuid, boolean) from public;
grant execute on function public.set_fixture_conversation_mute(uuid, uuid, boolean) to authenticated;
revoke execute on function public.leave_fixture_conversation(uuid, uuid) from public;
grant execute on function public.leave_fixture_conversation(uuid, uuid) to authenticated;
revoke execute on function public.rejoin_fixture_conversation(uuid, uuid) from public;
grant execute on function public.rejoin_fixture_conversation(uuid, uuid) to authenticated;
revoke execute on function public.remove_fixture_conversation_participant(uuid, uuid, uuid) from public;
grant execute on function public.remove_fixture_conversation_participant(uuid, uuid, uuid) to authenticated;

-- ============================================================
-- Exclude muted/left users from routine message notifications --
-- CREATE OR REPLACE keeps the same recipient-resolution query, adding
-- one NOT EXISTS clause per branch.
-- ============================================================
create or replace function internal.notify_fixture_message_recipients()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fixture public.fixtures;
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_sender_name text;
begin
  select coalesce(p.first_name || ' ' || p.surname, 'Someone') into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  if new.fixture_id is not null then
    select * into v_fixture from public.fixtures where id = new.fixture_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New fixture message',
      format('%s sent a message about your fixture.', v_sender_name),
      jsonb_build_object('fixture_id', new.fixture_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and tp.permission in ('team_admin', 'coach', 'manager')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      join public.teams t on t.club_id = cm.club_id
      where t.id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      union
      select p.user_id as recipient
      from public.fixture_conversation_participants p
      where p.fixture_id = new.fixture_id
    ) recipients
    where recipient <> new.sender_user_id
      and not exists (
        select 1 from public.fixture_conversation_subscriptions s
        where s.fixture_id = new.fixture_id and s.user_id = recipient and (s.muted or s.left_at is not null)
      );

  elsif new.fixture_request_id is not null then
    select * into v_req from public.fixture_requests where id = new.fixture_request_id;
    select * into v_group from public.fixture_request_groups where id = v_req.group_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New fixture message',
      format('%s sent a message about your fixture request.', v_sender_name),
      jsonb_build_object('fixture_request_id', new.fixture_request_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from public.team_permissions tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_req.requesting_team_id, v_req.target_team_id)
        and tp.permission in ('team_admin', 'coach', 'manager')
      union
      select cm.user_id as recipient
      from public.club_memberships cm
      where cm.club_id in (v_group.requesting_club_id, v_group.opponent_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
      union
      select p.user_id as recipient
      from public.fixture_conversation_participants p
      where p.fixture_request_id = new.fixture_request_id
    ) recipients
    where recipient <> new.sender_user_id
      and not exists (
        select 1 from public.fixture_conversation_subscriptions s
        where s.fixture_request_id = new.fixture_request_id and s.user_id = recipient and (s.muted or s.left_at is not null)
      );
  end if;

  return new;
end;
$$;
