-- =====================================================================
-- ONE UNREAD TRUTH
--
-- WHAT WAS WRONG
--
-- Three badges sat in the same header and counted the same rows:
--
--   the bell     count(notifications where read_at is null)   -- EVERY type
--   Messages     unread 'new_fixture_message' notifications
--   Support      unread 'support_ticket_update' notifications
--
-- So an unread fixture message was counted twice -- once beside the speech
-- bubble and again beside the bell -- and so was every support reply. The
-- bell said seven, the notification panel listed seven, and three of them
-- were the same three things the badge next door was already showing. A
-- person clearing their messages watched the bell refuse to move.
--
-- THE RULE
--
-- A badge counts the things a person will find when they press it. A
-- notification surfaced by another badge belongs to that badge, not to this
-- one. Messages are Messenger's. Support replies are Support's. Everything
-- else is the bell's.
--
-- AND THE SPLIT COMES FROM THE REGISTRY, not from a list of type names
-- written here. public.notification_types already says which TOPIC a type
-- belongs to; a type in the 'messages' topic is Messenger's by definition.
-- Adding a new message notification therefore lands in the right badge on
-- the day it is registered, without anybody remembering to update a count.
-- =====================================================================

create or replace function public.my_unread_counts()
returns table (
  notifications integer,
  messages integer,
  support integer,
  total integer
)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  with mine as (
    select n.type
    from public.notifications n
    where n.user_id = auth.uid()
      and n.read_at is null
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
$$;

comment on function public.my_unread_counts() is
  'THE one unread calculation. Returns the caller''s unread counts split by which badge surfaces them, so no notification is counted in two places. The split is driven by public.notification_types.topic_key, never by a hardcoded list.';

revoke all on function public.my_unread_counts() from public, anon;
grant execute on function public.my_unread_counts() to authenticated;
