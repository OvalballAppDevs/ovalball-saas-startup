-- =====================================================================================================
-- A NOTIFICATION CAN BE DISMISSED (owner product decision, notifications UX pass).
--
-- Until now the inbox had no delete and no dismiss: "read is not resolved", and nothing a person did to
-- a notification could make it disappear. The owner has now asked for dismissal (swipe to delete in
-- the bell's quick view and the Notifications Centre). This builds it as a server fact, not a phone-local
-- hide, so the website and the app agree about what is in the inbox.
--
-- SOFT, AND REVERSIBLE. `dismissed_at` hides the row from its owner everywhere -- the read policy, the
-- paged feed, the unread counts -- and `restore_notification` puts it back exactly as it was, which is
-- what makes an "Undo" honest. Dismissing does NOT touch `read_at`, so a restored unread notification
-- is still unread.
--
-- DISMISSED IS NOT RESOLVED. The job a notification was about lives in its own domain and in the
-- attention projection; dismissing the message about it changes nothing there. A result that still
-- needs confirming stays in Needs Attention after its notification is gone from the inbox.
--
-- DELIVERY IS UNTOUCHED. Mandatory delivery is about whether a notification arrives; once it has
-- arrived, its owner may tidy it away like any other.
-- =====================================================================================================

alter table public.notifications add column dismissed_at timestamptz;

comment on column public.notifications.dismissed_at is
  'When the recipient dismissed (deleted) this notification from their inbox. Hidden from them everywhere while set; restore_notification clears it. Never set by anyone but the recipient.';

create index notifications_user_id_visible_idx
  on public.notifications (user_id, created_at desc)
  where dismissed_at is null;

-- The owner's read policy now ends at dismissal, so every direct read (the website's bell and page,
-- message-thread read receipts) hides a dismissed row without each query having to remember to.
drop policy notifications_select_self on public.notifications;
create policy notifications_select_self on public.notifications for select
  using (user_id = (select auth.uid()) and dismissed_at is null);

-- The update guard still refuses any change to what a notification SAYS. read_at and dismissed_at are
-- the recipient's own state about it, and are the only two things that may change.
create or replace function internal.enforce_notification_read_only_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.type <> old.type or new.title <> old.title or new.body <> old.body
     or new.data is distinct from old.data or new.user_id <> old.user_id
     or new.created_at <> old.created_at then
    raise exception 'Only read_at and dismissed_at may be changed on a notification.';
  end if;
  return new;
end;
$$;

-- ---- The definer reads bypass RLS, so each says it explicitly ---------------------------------------

create or replace function public.my_notifications(
  p_limit integer default 20,
  p_before_created_at timestamp with time zone default null,
  p_before_id uuid default null,
  p_unread_only boolean default false
)
returns table(id uuid, type text, topic_key text, title text, body text, data jsonb, read_at timestamp with time zone, created_at timestamp with time zone)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select n.id, n.type, t.topic_key, n.title, n.body, n.data, n.read_at, n.created_at
  from public.notifications n
  left join public.notification_types t on t.type_key = n.type
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    and coalesce(t.topic_key, '') <> 'messages'
    and n.type <> 'support_ticket_update'
    and (not coalesce(p_unread_only, false) or n.read_at is null)
    and (
      p_before_created_at is null
      or n.created_at < p_before_created_at
      or (n.created_at = p_before_created_at and p_before_id is not null and n.id < p_before_id)
    )
  order by n.created_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 20), 50));
$function$;

create or replace function public.my_unread_counts()
returns table(notifications integer, messages integer, support integer, total integer)
language sql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
  with mine as (
    select n.type
    from public.notifications n
    where n.user_id = auth.uid()
      and n.read_at is null
      and n.dismissed_at is null
  ),
  classified as (
    select
      case
        -- Messenger's own badge. Driven by the topic, so a future message
        -- type is counted correctly the moment it is registered.
        when t.topic_key = 'messages' then 'messages'
        -- Support has its own header control and its own destination.
        when m.type = 'support_ticket_update' then 'support'
        else 'notifications'
      end as bucket
    from mine m
    left join public.notification_types t on t.type_key = m.type
  )
  select
    count(*) filter (where bucket = 'notifications')::integer,
    count(*) filter (where bucket = 'messages')::integer,
    count(*) filter (where bucket = 'support')::integer,
    count(*)::integer
  from classified;
$function$;

create or replace function public.mark_all_notifications_read()
returns integer
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare v_n integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  update public.notifications n
     set read_at = now()
   where n.user_id = auth.uid()
     and n.read_at is null
     and n.dismissed_at is null
     and coalesce((select t.topic_key from public.notification_types t where t.type_key = n.type), '') <> 'messages'
     and n.type <> 'support_ticket_update';
  get diagnostics v_n = row_count;
  return v_n;
end;
$function$;

-- ---- Dismiss, and put back ----------------------------------------------------------------------------

-- A notification id is not a permission: only the recipient's own row is ever touched. True when a row
-- changed, so a second dismiss of the same row is a quiet no-op rather than an error.
create or replace function public.dismiss_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare v_n integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  update public.notifications n
     set dismissed_at = now()
   where n.id = p_id and n.user_id = auth.uid() and n.dismissed_at is null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;

create or replace function public.restore_notification(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare v_n integer;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  perform internal.require_live_session();
  update public.notifications n
     set dismissed_at = null
   where n.id = p_id and n.user_id = auth.uid() and n.dismissed_at is not null;
  get diagnostics v_n = row_count;
  return v_n > 0;
end;
$function$;

-- ---- The website's bell, and the messenger's own counts, leave a dismissed row out too -----------
-- (Found in review: these definer reads bypass RLS and were not covered by the first pass.)

CREATE OR REPLACE FUNCTION public.my_bell_notifications(p_limit integer DEFAULT 8)
 RETURNS TABLE(id uuid, type text, title text, body text, data jsonb, read_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
  select n.id, n.type, n.title, n.body, n.data, n.read_at, n.created_at
  from public.notifications n
  left join public.notification_types t on t.type_key = n.type
  where n.user_id = auth.uid()
    and n.dismissed_at is null
    -- Messenger's, and Support's. Everything else is the bell's.
    and coalesce(t.topic_key, '') <> 'messages'
    and n.type <> 'support_ticket_update'
  -- NEWEST FIRST, with the id as the tie-break -- the same order my_notifications pages in.
  order by n.created_at desc, n.id desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$function$;

CREATE OR REPLACE FUNCTION public.my_unread_message_counts()
 RETURNS TABLE(fixture_id uuid, fixture_request_id uuid, club_conversation_id uuid, unread integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
  select
    (n.data ->> 'fixture_id')::uuid,
    (n.data ->> 'fixture_request_id')::uuid,
    (n.data ->> 'club_conversation_id')::uuid,
    count(*)::integer
  from public.notifications n
  join public.notification_types t on t.type_key = n.type
  where n.user_id = auth.uid()
    and n.read_at is null
    and n.dismissed_at is null
    and t.topic_key = 'messages'
  group by 1, 2, 3;
$function$;

CREATE OR REPLACE FUNCTION public.my_direct_conversations(p_limit integer DEFAULT 50)
 RETURNS TABLE(conversation_id uuid, other_user_id uuid, other_display_name text, last_message_at timestamp with time zone, last_message_preview text, last_message_from_me boolean, unread integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
  with mine as (
    select d.id,
           case when d.user_a = auth.uid() then d.user_b else d.user_a end as other_id,
           d.last_message_at
    from public.direct_conversations d
    where d.user_a = auth.uid() or d.user_b = auth.uid()
  ),
  latest as (
    select distinct on (m.direct_conversation_id)
           m.direct_conversation_id, m.body, m.content_type, m.deleted_at, m.sender_user_id
    from public.fixture_messages m
    where m.direct_conversation_id in (select id from mine)
    order by m.direct_conversation_id, m.created_at desc
  ),
  unread as (
    select (n.data ->> 'direct_conversation_id')::uuid as cid, count(*)::integer as c
    from public.notifications n
    where n.user_id = auth.uid() and n.read_at is null and n.dismissed_at is null and n.type = 'new_direct_message'
    group by 1
  )
  select
    mine.id,
    mine.other_id,
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
    mine.last_message_at,
    case
      when l.deleted_at is not null then 'Message deleted'
      when l.content_type = 'image' and coalesce(btrim(l.body), '') = '' then 'Photo'
      else l.body
    end,
    l.sender_user_id = auth.uid(),
    coalesce(u.c, 0)
  from mine
  join public.profiles p on p.id = mine.other_id
  left join latest l on l.direct_conversation_id = mine.id
  left join unread u on u.cid = mine.id
  order by mine.last_message_at desc nulls last
  limit greatest(1, least(coalesce(p_limit, 50), 200));
$function$;

revoke all on function public.dismiss_notification(uuid) from public;
revoke all on function public.restore_notification(uuid) from public;
grant execute on function public.dismiss_notification(uuid) to authenticated;
grant execute on function public.restore_notification(uuid) to authenticated;
