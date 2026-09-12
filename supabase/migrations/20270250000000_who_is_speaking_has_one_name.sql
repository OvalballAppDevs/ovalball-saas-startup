-- =====================================================================
-- WHO IS SPEAKING HAS ONE NAME
--
-- Three places now need to turn (sender_identity_type, sender_identity_id)
-- into the words a recipient reads: the fan-out, when it writes the
-- notification title; the announcement page; and the Messenger inbox row.
--
-- By the third one this had become three implementations of the same
-- sentence -- one in plpgsql and two in TypeScript -- and they had already
-- started to differ, because the inbox had no label at all and would have
-- shown "Announcement" where the other two showed "Under 11 Mixed".
--
-- The name a club is called is not a presentation detail to be re-derived per
-- surface. Ovalball has canonical authorities for it already -- teams.
-- display_name for a team, the Club Directory for a club -- and this function
-- reads those, so a renamed club is renamed everywhere at once.
--
-- FALLING BACK TO THE ACTOR'S NAME is deliberate and is the LAST resort:
-- it applies only to sender_identity_type = 'person', where the person IS the
-- sender. It is never used to paper over a missing team or club name, because
-- attributing an organisation's message to whoever pressed Send is precisely
-- the confusion sender identity exists to remove.
-- =====================================================================

create or replace function internal.sender_identity_label(
  p_identity_type text,
  p_identity_id uuid,
  p_actor_user_id uuid default null
)
returns text
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select coalesce(
    case p_identity_type
      when 'platform' then 'Ovalball'
      -- The canonical derived display form. Never re-derived here: see the
      -- Team Directory rules in CLAUDE.md.
      when 'team' then (select t.display_name from public.teams t where t.id = p_identity_id)
      -- The club's canonical directory name.
      when 'club' then (
        select d.name from public.clubs c
        join public.club_directory d on d.id = c.directory_id
        where c.id = p_identity_id)
      when 'person' then (
        select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), '')
        from public.profiles p where p.id = p_actor_user_id)
      else null
    end,
    'Ovalball'
  );
$$;

comment on function internal.sender_identity_label(text, uuid, uuid) is
  'The words a recipient reads as "who said this", from the canonical name authority for that identity. One implementation, so the notification, the announcement page and the inbox row can never disagree about who spoke.';

revoke all on function internal.sender_identity_label(text, uuid, uuid) from public, anon;
grant execute on function internal.sender_identity_label(text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- THE INBOX NEEDS THE NAME, SO THE READER RETURNS IT
-- ---------------------------------------------------------------------
-- Without this the Messenger list showed announcements titled "Announcement"
-- while the same announcement opened as "Under 11 Mixed" -- the same message
-- attributed two different ways one click apart.
drop function if exists public.my_announcements(integer);

create function public.my_announcements(p_limit integer default 30)
returns table (
  announcement_id uuid,
  title text,
  body text,
  sender_identity_type text,
  sender_identity_id uuid,
  sender_label text,
  reply_mode text,
  withdrawn boolean,
  delivered_at timestamptz,
  read_at timestamptz
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    a.id,
    case when a.status = 'withdrawn' then null else a.title end,
    case when a.status = 'withdrawn'
         then 'This announcement has been withdrawn.'
         else a.body end,
    a.sender_identity_type,
    a.sender_identity_id,
    internal.sender_identity_label(a.sender_identity_type, a.sender_identity_id, a.actor_user_id),
    a.reply_mode,
    a.status = 'withdrawn',
    d.delivered_at,
    d.read_at
  from public.messenger_announcement_deliveries d
  join public.messenger_announcements a on a.id = d.announcement_id
  where d.recipient_user_id = auth.uid()
    and d.status = 'delivered'
  order by d.delivered_at desc
  limit greatest(1, least(coalesce(p_limit, 30), 100));
$$;

comment on function public.my_announcements(integer) is
  'The announcements delivered to the caller, with who sent them. Scoped to their own deliveries, so it can never return another recipient. A withdrawn announcement keeps its place and returns the withdrawal notice instead of its content.';

revoke all on function public.my_announcements(integer) from public, anon;
grant execute on function public.my_announcements(integer) to authenticated;

-- ---------------------------------------------------------------------
-- AND THE FAN-OUT STOPS KEEPING ITS OWN COPY OF THE RULE
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

  -- One call, one answer. Was fifteen lines of CASE here.
  v_sender_label := internal.sender_identity_label(
    a.sender_identity_type, a.sender_identity_id, a.actor_user_id);

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

revoke all on function public.send_announcement(uuid) from public, anon;
grant execute on function public.send_announcement(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- AND THE PAGE CAN ASK FOR IT DIRECTLY
-- ---------------------------------------------------------------------
-- my_announcements answers for RECIPIENTS. The announcement page is also read
-- by the sending side, who has no delivery row of their own, so it needs the
-- same name by a route that does not go through deliveries.
--
-- Scoped to one announcement and gated on being able to see it, so this
-- cannot become a way to enumerate identities: an announcement you may not
-- read returns null rather than a name.
create or replace function public.announcement_sender_label(p_announcement_id uuid)
returns text
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select internal.sender_identity_label(a.sender_identity_type, a.sender_identity_id, a.actor_user_id)
  from public.messenger_announcements a
  where a.id = p_announcement_id
    and (a.actor_user_id = auth.uid()
         or internal.may_send_as(a.sender_identity_type, a.sender_identity_id)
         or internal.is_announcement_recipient(a.id));
$$;

comment on function public.announcement_sender_label(uuid) is
  'Who sent this announcement, in the words a reader sees -- for one announcement the caller may read, and null otherwise.';

revoke all on function public.announcement_sender_label(uuid) from public, anon;
grant execute on function public.announcement_sender_label(uuid) to authenticated;
