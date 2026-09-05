-- Phase D (message request half): a genuine club-to-club direct
-- conversation, distinct from both fixture conversations (which stay
-- exactly as they are -- this migration touches nothing about their own
-- canonical relationship) and from Partnership Requests (club_partnerships
-- is a completely separate relationship; accepting a Message Request
-- never creates a partnership, and vice versa).
--
-- Architecture decision (documented per the brief's own request): rather
-- than migrating the existing, well-tested fixture_messages/RLS/realtime/
-- attachments/notifications infrastructure onto a brand-new generic
-- "conversations" table (a large, risky rewrite of already-correct code),
-- fixture_messages gains a THIRD nullable "which thread" column
-- (club_conversation_id) alongside the existing fixture_id/
-- fixture_request_id, widening its own num_nonnulls check from 2-of-2 to
-- exactly-one-of-3. This reuses the entire existing message primitive --
-- rendering, kind/system_event convention, realtime broadcast, read/
-- unread, moderation -- for free. The one shared authorization function,
-- internal.can_access_fixture_conversation(fixture_id, fixture_request_id),
-- is NOT touched (it stays a 2-argument function; ~15 existing call sites
-- across message_policies/contact_cards/document_library/conversation_*
-- keep calling it exactly as they do today). A new, separate
-- internal.can_access_any_conversation(fixture_id, fixture_request_id,
-- club_conversation_id) is added instead, and swapped in ONLY at the
-- handful of places that need to recognise a club conversation too
-- (fixture_messages' own RLS, its attachments' RLS, the presence/realtime
-- topic check, and club_conversations' own RLS). Deliberately deferred in
-- this pass (reported, not silently unsupported): document-library
-- sharing, contact-card sharing, and "add a participant" inside a club
-- conversation -- those RPCs are coupled to
-- internal.resolve_my_fixture_club_id(fixture_id, fixture_request_id) and
-- the existing per-club message policy resolution keyed off a fixture;
-- widening that whole surface is a real follow-up, not a five-line
-- change, and pretending it works today would violate "if a feature is
-- not actually implemented, report the dependency instead of pretending
-- it works." Plain text messages, attachments-free, are fully supported.

-- ============================================================
-- 1. club_conversations: ONE canonical conversation identity per
--    unordered club pair (its own id -- there is no mirror-row problem
--    here the way fixtures have one, since a club conversation belongs
--    to no team and needs no per-side ownership row).
-- ============================================================

create table public.club_conversations (
  id uuid primary key default gen_random_uuid(),
  requesting_club_id uuid not null references public.clubs(id),
  recipient_club_id uuid not null references public.clubs(id),
  status text not null default 'pending' check (status in ('pending', 'accepted', 'declined')),
  requested_by uuid not null references auth.users(id),
  responded_by uuid references auth.users(id),
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (requesting_club_id <> recipient_club_id)
);

comment on table public.club_conversations is
  'A direct club-to-club conversation, entirely separate from club_partnerships (a Message Request accepted never creates a partnership, and an active partnership never implies an accepted conversation -- see section 7 of the brief). Deliberately club-scoped, never team-scoped -- a club-level discussion ("can your club attend our summer festival?") has nothing to do with any one fixture.';

-- Deterministic uniqueness on the UNORDERED pair -- Burnley->Rossendale and
-- Rossendale->Burnley are the SAME conversation, never two crossing ones.
-- Excludes 'declined' so a fresh request can be made later (subject to the
-- RPC's own cooldown), same convention as club_partnerships excluding
-- 'revoked'.
create unique index club_conversations_unique_active_pair_idx
  on public.club_conversations (least(requesting_club_id, recipient_club_id), greatest(requesting_club_id, recipient_club_id))
  where status <> 'declined';

alter table public.club_conversations enable row level security;

create trigger audit_row_change after insert or update or delete on public.club_conversations
  for each row execute function internal.audit_row_change();

-- ============================================================
-- 2. fixture_messages widened: exactly one of THREE thread columns now,
--    not two.
-- ============================================================

alter table public.fixture_messages add column club_conversation_id uuid references public.club_conversations(id);

alter table public.fixture_messages drop constraint fixture_messages_check;
alter table public.fixture_messages add constraint fixture_messages_check
  check (num_nonnulls(fixture_request_id, fixture_id, club_conversation_id) = 1);

-- ============================================================
-- 3. internal.can_access_any_conversation: the widened boundary, used
--    ONLY where club-conversation support is actually needed. Everywhere
--    else keeps calling the original 2-argument
--    internal.can_access_fixture_conversation unchanged.
-- ============================================================

create or replace function internal.can_access_any_conversation(p_fixture_id uuid, p_fixture_request_id uuid, p_club_conversation_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select
    (p_club_conversation_id is null and internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id))
    or (p_club_conversation_id is not null and (
      internal.is_site_admin()
      or exists (
        select 1 from public.club_conversations cc
        where cc.id = p_club_conversation_id
          and (internal.can_manage_club_fixtures(cc.requesting_club_id) or internal.can_manage_club_fixtures(cc.recipient_club_id))
      )
    ));
$$;

comment on function internal.can_access_any_conversation(uuid, uuid, uuid) is
  'True for a real fixture/request conversation participant (delegates entirely to the unchanged internal.can_access_fixture_conversation) OR a club official (Club Admin/Fixtures Admin) of either side of a club conversation. Site Admin always included via can_access_fixture_conversation''s own escape hatch, and explicitly again for the club branch.';

grant execute on function internal.can_access_any_conversation(uuid, uuid, uuid) to authenticated;

drop policy fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages for select
  using (internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id));

drop policy fixture_messages_insert_scoped on public.fixture_messages;
create policy fixture_messages_insert_scoped on public.fixture_messages for insert
  with check (
    sender_user_id = (select auth.uid())
    and internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
    and (club_conversation_id is null or (select status from public.club_conversations where id = club_conversation_id) = 'accepted')
  );

comment on policy fixture_messages_insert_scoped on public.fixture_messages is
  'A club conversation only accepts ordinary human messages once accepted -- the pending state''s own first message and the accepted system event are both written by SECURITY DEFINER RPCs (start_or_get_club_conversation / respond_to_club_conversation), which bypass this policy entirely, exactly like every other system-event insert in this app.';

drop policy fixture_message_attachments_select_scoped on public.fixture_message_attachments;
create policy fixture_message_attachments_select_scoped on public.fixture_message_attachments for select
  using (
    exists (
      select 1 from public.fixture_messages m
      where m.id = message_id and internal.can_access_any_conversation(m.fixture_id, m.fixture_request_id, m.club_conversation_id)
    )
  );

-- ============================================================
-- 4. Conversation-identity + notification + realtime plumbing: the SAME
--    triggers every fixture message already goes through, each widened
--    with one extra branch.
-- ============================================================

create or replace function internal.set_fixture_message_conversation_id()
returns trigger
language plpgsql
as $$
begin
  if new.conversation_id is not null then
    return new;
  end if;
  if new.fixture_id is not null then
    select conversation_id into new.conversation_id from public.fixtures where id = new.fixture_id;
  elsif new.club_conversation_id is not null then
    -- A club conversation's own id IS its conversation identity -- no
    -- lookup needed, unlike a fixture where two DIFFERENT row ids share
    -- one derived value.
    new.conversation_id := new.club_conversation_id;
  end if;
  return new;
end;
$$;

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
  v_cc public.club_conversations;
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

  elsif new.club_conversation_id is not null then
    select * into v_cc from public.club_conversations where id = new.club_conversation_id;

    -- Only relevant while the conversation is actually usable -- the
    -- pending-state first message and the accepted system event both fire
    -- this trigger too, but "you have a new message" would be a strange
    -- thing to tell someone about their own just-sent first message
    -- (already covered by the dedicated club_message_request_received
    -- notification) or about a system event they'll see the moment they
    -- open the now-accepted conversation.
    if v_cc.status = 'accepted' and new.kind = 'message' then
      insert into public.notifications (user_id, type, title, body, data)
      select distinct cm.user_id, 'new_fixture_message', 'New message',
        format('%s sent a club message.', v_sender_name),
        jsonb_build_object('club_conversation_id', new.club_conversation_id, 'message_id', new.id)
      from public.club_memberships cm
      where cm.club_id in (v_cc.requesting_club_id, v_cc.recipient_club_id)
        and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        and cm.user_id <> new.sender_user_id;
    end if;
  end if;

  return new;
end;
$$;

create or replace function internal.broadcast_fixture_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.conversation_id is not null then
    perform realtime.send(
      jsonb_build_object('message_id', new.id, 'kind', new.kind),
      'fixture_message_inserted',
      (case when new.club_conversation_id is not null then 'presence:c:' else 'presence:f:' end) || new.conversation_id::text,
      true
    );
  end if;
  return new;
end;
$$;

create or replace function internal.can_access_fixture_presence_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_parts text[];
begin
  v_parts := string_to_array(p_topic, ':');
  if array_length(v_parts, 1) <> 3 or v_parts[1] <> 'presence' then
    return false;
  end if;
  if v_parts[2] = 'f' then
    return internal.can_access_conversation(v_parts[3]::uuid);
  elsif v_parts[2] = 'r' then
    return internal.can_access_fixture_conversation(null, v_parts[3]::uuid);
  elsif v_parts[2] = 'c' then
    return internal.can_access_any_conversation(null, null, v_parts[3]::uuid);
  else
    return false;
  end if;
exception when invalid_text_representation then
  return false;
end;
$$;

-- ============================================================
-- 5. club_conversations RLS -- select only. Every write goes through the
--    two RPCs below (SECURITY DEFINER, bypass RLS), never a direct
--    client insert/update.
-- ============================================================

create policy club_conversations_select_scoped on public.club_conversations for select
  using (internal.can_access_any_conversation(null, null, id));

-- ============================================================
-- 6. start_or_get_club_conversation: the "+ New Message" entry point.
--    Reuses an existing accepted/pending conversation for the pair if one
--    already exists (never a crossing duplicate in either direction);
--    skips the request stage entirely for an already-active partnership
--    (section 3/17); applies a 48h cooldown after a decline and a simple
--    5-pending-outgoing anti-spam cap (sections 20/21) rather than
--    inventing CAPTCHA or a larger throttling system.
-- ============================================================

create or replace function public.start_or_get_club_conversation(p_my_club_id uuid, p_target_club_id uuid, p_first_message text)
returns table(conversation_id uuid, status text, is_new boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing public.club_conversations;
  v_target_status text;
  v_are_partners boolean;
  v_new_id uuid;
  v_pending_outgoing_count integer;
  v_trimmed_message text;
  v_my_club_name text;
begin
  if not (internal.is_site_admin() or internal.can_manage_club_fixtures(p_my_club_id)) then
    raise exception 'Not authorized to message on behalf of this club.' using errcode = '42501';
  end if;
  if p_my_club_id = p_target_club_id then
    raise exception 'You cannot start a conversation with your own club.';
  end if;

  select c.status into v_target_status from public.clubs c where c.id = p_target_club_id;
  if v_target_status is null then
    raise exception 'Club not found.';
  end if;
  if v_target_status <> 'active' then
    raise exception 'This club is not currently active on Ovalball -- direct messaging is not available yet.' using errcode = 'P0001';
  end if;

  select cc.* into v_existing from public.club_conversations cc
  where least(cc.requesting_club_id, cc.recipient_club_id) = least(p_my_club_id, p_target_club_id)
    and greatest(cc.requesting_club_id, cc.recipient_club_id) = greatest(p_my_club_id, p_target_club_id)
    and cc.status <> 'declined'
  order by cc.created_at desc
  limit 1;

  if v_existing.id is not null then
    return query select v_existing.id, v_existing.status, false;
    return;
  end if;

  v_trimmed_message := nullif(trim(coalesce(p_first_message, '')), '');
  if v_trimmed_message is null then
    raise exception 'A first message is required to start a conversation.';
  end if;

  if exists (
    select 1 from public.club_conversations cc
    where least(cc.requesting_club_id, cc.recipient_club_id) = least(p_my_club_id, p_target_club_id)
      and greatest(cc.requesting_club_id, cc.recipient_club_id) = greatest(p_my_club_id, p_target_club_id)
      and cc.status = 'declined' and cc.responded_at > now() - interval '48 hours'
  ) then
    raise exception 'This club recently declined a message request -- please wait before trying again.' using errcode = 'P0001';
  end if;

  select count(*) into v_pending_outgoing_count from public.club_conversations cc
  where cc.requesting_club_id = p_my_club_id and cc.status = 'pending';
  if v_pending_outgoing_count >= 5 then
    raise exception 'You have too many pending message requests already -- wait for one to be answered before starting another.' using errcode = 'P0001';
  end if;

  select exists (
    select 1 from public.club_partnerships cp
    where cp.status = 'active'
      and least(cp.requesting_club_id, cp.partner_club_id) = least(p_my_club_id, p_target_club_id)
      and greatest(cp.requesting_club_id, cp.partner_club_id) = greatest(p_my_club_id, p_target_club_id)
  ) into v_are_partners;

  insert into public.club_conversations (requesting_club_id, recipient_club_id, status, requested_by, responded_by, responded_at)
  values (
    p_my_club_id, p_target_club_id, case when v_are_partners then 'accepted' else 'pending' end, auth.uid(),
    case when v_are_partners then auth.uid() else null end, case when v_are_partners then now() else null end
  )
  returning id into v_new_id;

  insert into public.fixture_messages (club_conversation_id, sender_user_id, body, kind)
  values (v_new_id, auth.uid(), v_trimmed_message, 'message');

  if not v_are_partners then
    select cd.name into v_my_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = p_my_club_id;
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'club_message_request_received', 'New message request',
      format('%s wants to start a conversation with your club.', coalesce(v_my_club_name, 'A club')),
      jsonb_build_object('club_conversation_id', v_new_id, 'requesting_club_id', p_my_club_id)
    from public.club_memberships cm
    where cm.club_id = p_target_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;

  return query select v_new_id, (case when v_are_partners then 'accepted' else 'pending' end)::text, true;
end;
$$;

revoke execute on function public.start_or_get_club_conversation(uuid, uuid, text) from public;
grant execute on function public.start_or_get_club_conversation(uuid, uuid, text) to authenticated;

-- ============================================================
-- 7. respond_to_club_conversation: accept writes the required system
--    event ("Message request accepted by <Club>") into the SAME
--    conversation the original first message already lives in -- never a
--    second, disconnected conversation, never a duplicated first message.
--    Decline notifies the requesting club's officials with a restrained
--    message, never exposing which individual person declined.
-- ============================================================

create or replace function public.respond_to_club_conversation(p_conversation_id uuid, p_approve boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_c public.club_conversations;
  v_recipient_club_name text;
begin
  select * into v_c from public.club_conversations where id = p_conversation_id for update;
  if not found then raise exception 'Message request not found.'; end if;
  if v_c.status <> 'pending' then raise exception 'This request has already been answered.'; end if;

  if not (internal.is_site_admin() or internal.can_manage_club_fixtures(v_c.recipient_club_id)) then
    raise exception 'Only the invited club may respond to this message request.' using errcode = '42501';
  end if;

  update public.club_conversations
  set status = case when p_approve then 'accepted' else 'declined' end,
      responded_by = auth.uid(), responded_at = now()
  where id = p_conversation_id;

  if p_approve then
    select cd.name into v_recipient_club_name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = v_c.recipient_club_id;
    insert into public.fixture_messages (club_conversation_id, sender_user_id, body, kind)
    values (p_conversation_id, auth.uid(), format('Message request accepted by %s', coalesce(v_recipient_club_name, 'the club')), 'system_event');
  else
    insert into public.notifications (user_id, type, title, body, data)
    select cm.user_id, 'club_message_request_declined', 'Message request declined',
      format('Your message request to %s was declined.', coalesce((select cd.name from public.clubs c join public.club_directory cd on cd.id = c.directory_id where c.id = v_c.recipient_club_id), 'the club')),
      jsonb_build_object('club_conversation_id', p_conversation_id)
    from public.club_memberships cm
    where cm.club_id = v_c.requesting_club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY');
  end if;
end;
$$;

revoke execute on function public.respond_to_club_conversation(uuid, boolean) from public;
grant execute on function public.respond_to_club_conversation(uuid, boolean) to authenticated;
