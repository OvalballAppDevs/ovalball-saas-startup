-- =====================================================================
-- SENDING IS A FAN-OUT, NOT A BROADCAST
--
-- An announcement is composed once and then has to become N private facts:
-- one delivery row, one notification, one unread badge, per person. That is
-- a fan-out, and fan-outs fail halfway. A network blip, a statement timeout,
-- an admin refreshing the page and pressing Send again -- all of them end
-- with some recipients written and some not.
--
-- The answer is not to hope it completes. It is to make RE-RUNNING SEND THE
-- REPAIR: every delivery carries an idempotency key of (announcement,
-- recipient), so a second run inserts exactly the recipients the first run
-- missed and nobody twice. An admin who presses Send again does not send
-- twice; they finish sending.
--
-- WHY THE AUDIENCE IS RESOLVED AT SEND AND NOT AT COMPOSE
--
-- Membership changes. An announcement drafted on Tuesday and sent on Friday
-- must reach Friday's team, not Tuesday's -- including nobody who has left.
-- So the announcement row stores the audience as CRITERIA (audience_spec,
-- scope, exclude_u18) and internal.resolve_audience answers them at the
-- moment of sending. Storing a resolved list at compose time would freeze a
-- roster and quietly send a child's information to a former coach.
--
-- WHAT A RECIPIENT IS TOLD, AND WHAT THEY ARE NOT
--
-- The notification names the sender and the announcement. It does not carry
-- the audience, the recipient count, or any other recipient -- consistent
-- with the delivery table's own RLS, so the two cannot disagree.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE NOTIFICATION TYPE
-- ---------------------------------------------------------------------
-- Registered in the catalogue rather than emitted as a loose string: the
-- foreign key on notifications.type would reject it otherwise, which is the
-- guard working. Topic 'messages', because that is what a recipient
-- experiences this as -- it belongs on the Messenger badge, not the bell.
insert into public.notification_types (type_key, topic_key) values
  ('announcement_received', 'messages')
on conflict (type_key) do nothing;

-- ---------------------------------------------------------------------
-- 2. COMPOSE
-- ---------------------------------------------------------------------
-- Authority is checked twice on purpose, because they are two different
-- questions: may_send_as asks "may you speak as this identity", and
-- resolve_audience asks "may you address these people". A Club Admin of
-- club A may speak as club A and may not address club B's families.
create or replace function public.create_announcement(
  p_sender_identity_type text,
  p_sender_identity_id uuid,
  p_scope text,
  p_scope_id uuid,
  p_body text,
  p_title text default null,
  p_reply_mode text default 'NO_REPLY',
  p_audience_spec jsonb default '{}'::jsonb,
  p_exclude_u18 boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if not internal.may_send_as(p_sender_identity_type, p_sender_identity_id) then
    raise exception 'You are not authorised to send as that identity.' using errcode = '42501';
  end if;

  -- Resolving here is a DRY RUN: it costs one pass and means the composer
  -- refuses at compose time rather than accepting a draft that can never be
  -- sent. The result is deliberately discarded -- the audience that counts
  -- is the one resolved at send.
  perform 1 from internal.resolve_audience(
    p_scope, p_scope_id, p_audience_spec, p_exclude_u18, p_sender_identity_type, p_reply_mode) limit 1;

  insert into public.messenger_announcements (
    actor_user_id, sender_identity_type, sender_identity_id,
    scope, scope_id, audience_spec, exclude_u18, reply_mode,
    title, body, status
  ) values (
    auth.uid(), p_sender_identity_type, p_sender_identity_id,
    p_scope, p_scope_id, coalesce(p_audience_spec, '{}'::jsonb), coalesce(p_exclude_u18, false),
    coalesce(p_reply_mode, 'NO_REPLY'),
    nullif(btrim(coalesce(p_title, '')), ''), btrim(p_body), 'draft'
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_announcement(text, uuid, text, uuid, text, text, text, jsonb, boolean) from public, anon;
grant execute on function public.create_announcement(text, uuid, text, uuid, text, text, text, jsonb, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 3. SEND
-- ---------------------------------------------------------------------
create or replace function public.send_announcement(p_announcement_id uuid)
returns integer
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  a public.messenger_announcements;
  v_sender_label text;
  v_total integer;
begin
  select * into a from public.messenger_announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement not found.';
  end if;
  if not (a.actor_user_id = auth.uid()
          or internal.may_send_as(a.sender_identity_type, a.sender_identity_id)) then
    raise exception 'You are not authorised to send this announcement.' using errcode = '42501';
  end if;
  if a.status = 'withdrawn' then
    raise exception 'This announcement has been withdrawn and cannot be sent.';
  end if;

  update public.messenger_announcements
  set status = 'sending', fanout_state = 'in_progress', updated_at = now()
  where id = p_announcement_id and status <> 'sent';

  -- WHO IS SPEAKING, as the recipient will read it. Resolved from the
  -- canonical name authorities, never assembled from the actor's own name --
  -- the message came from the team, not from whoever was holding the phone.
  v_sender_label := case a.sender_identity_type
    when 'platform' then 'Ovalball'
    -- The club's canonical directory name, not a copy held anywhere else.
    when 'club' then (
      select d.name from public.clubs c
      join public.club_directory d on d.id = c.directory_id
      where c.id = a.sender_identity_id)
    -- teams.display_name is the canonical derived display form -- the one
    -- name a team is called site-wide. Never re-derived here.
    when 'team' then (select t.display_name from public.teams t where t.id = a.sender_identity_id)
    else (
      select btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, ''))
      from public.profiles p where p.id = a.actor_user_id)
  end;
  v_sender_label := nullif(btrim(coalesce(v_sender_label, '')), '');
  v_sender_label := coalesce(v_sender_label, 'Ovalball');

  -- THE FAN-OUT. on conflict do nothing is what makes a second press of Send
  -- finish the job instead of doing it again.
  with resolved as (
    select * from internal.resolve_audience(
      a.scope, a.scope_id, a.audience_spec, a.exclude_u18, a.sender_identity_type, a.reply_mode)
  ),
  delivered as (
    insert into public.messenger_announcement_deliveries (
      announcement_id, recipient_user_id, status, delivered_at,
      safeguarding_route, concerning_player_id, idempotency_key
    )
    select p_announcement_id, r.recipient_user_id, 'delivered', now(),
           r.safeguarding_route, r.concerning_player_id,
           p_announcement_id::text || ':' || r.recipient_user_id::text
    from resolved r
    on conflict (idempotency_key) do nothing
    returning recipient_user_id
  )
  insert into public.notifications (user_id, type, title, body, data)
  select
    d.recipient_user_id,
    'announcement_received',
    v_sender_label,
    coalesce(a.title, left(a.body, 140)),
    -- Deliberately no audience, no recipient count and no other recipient.
    jsonb_build_object(
      'announcement_id', p_announcement_id,
      'sender_identity_type', a.sender_identity_type,
      'sender_identity_id', a.sender_identity_id,
      'reply_mode', a.reply_mode
    )
  from delivered d;

  select count(*) into v_total
  from public.messenger_announcement_deliveries
  where announcement_id = p_announcement_id;

  update public.messenger_announcements
  set status = 'sent',
      sent_at = coalesce(sent_at, now()),
      fanout_state = 'complete',
      resolved_recipient_count = v_total,
      updated_at = now()
  where id = p_announcement_id;

  return v_total;
end;
$$;

comment on function public.send_announcement(uuid) is
  'Resolves the audience AT SEND TIME and writes one delivery and one notification per recipient. Idempotent: running it again completes an interrupted fan-out and never delivers to anybody twice.';

revoke all on function public.send_announcement(uuid) from public, anon;
grant execute on function public.send_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- 4. READ
-- ---------------------------------------------------------------------
-- One call marks both, so the delivery record and the unread badge cannot
-- drift apart and leave a recipient with a badge for something they read.
create or replace function public.mark_announcement_read(p_announcement_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  update public.messenger_announcement_deliveries
  set read_at = coalesce(read_at, now())
  where announcement_id = p_announcement_id
    and recipient_user_id = auth.uid()
    and status = 'delivered';

  update public.notifications
  set read_at = coalesce(read_at, now())
  where user_id = auth.uid()
    and type = 'announcement_received'
    and (data ->> 'announcement_id') = p_announcement_id::text;
end;
$$;

revoke all on function public.mark_announcement_read(uuid) from public, anon;
grant execute on function public.mark_announcement_read(uuid) to authenticated;
