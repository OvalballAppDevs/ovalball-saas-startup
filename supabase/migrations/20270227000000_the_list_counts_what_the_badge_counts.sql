-- =====================================================================
-- THE LIST COUNTS WHAT THE BADGE COUNTS
--
-- public.my_unread_counts made the header badges agree with each other: the
-- Messenger badge counts every unread notification in the `messages` topic,
-- and the bell no longer counts them a second time.
--
-- One level down, they still disagreed. The conversation list beside that
-- badge built its per-conversation unread count by querying
--
--     type = 'new_fixture_message'
--
-- and the `messages` topic holds four types, not one. So a staff message on a
-- fixture, or a club message request, was counted by the badge and by nothing
-- in the list underneath it. The badge said three; the list showed two and
-- every conversation in it looked read. A person clicking through to find the
-- third one found nothing, and the badge stayed at three.
--
-- SAME FIX AS THE BADGE, SAME REASON. The set of "message" types is not a
-- list written in a query -- it is whatever public.notification_types files
-- under the `messages` topic. Registering a new message type puts it in the
-- badge and in the list on the same day, and neither can drift from the
-- other, because there is only one definition of what a message notification
-- is.
--
-- The function returns the CONVERSATION KEYS the notification carries rather
-- than a total, because the list needs to know which conversation each unread
-- belongs to. A notification carrying none of the three keys is still counted
-- by the badge -- it is genuinely unread -- and simply matches no row in the
-- list, which is the honest outcome rather than a silently dropped count.
-- =====================================================================

create or replace function public.my_unread_message_counts()
returns table (
  fixture_id uuid,
  fixture_request_id uuid,
  club_conversation_id uuid,
  unread integer
)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  select
    (n.data ->> 'fixture_id')::uuid,
    (n.data ->> 'fixture_request_id')::uuid,
    (n.data ->> 'club_conversation_id')::uuid,
    count(*)::integer
  from public.notifications n
  join public.notification_types t on t.type_key = n.type
  where n.user_id = auth.uid()
    and n.read_at is null
    and t.topic_key = 'messages'
  group by 1, 2, 3;
$$;

comment on function public.my_unread_message_counts() is
  'Unread message notifications for the caller, grouped by the conversation each one belongs to. Membership of the `messages` topic is decided by public.notification_types, exactly as public.my_unread_counts decides the Messenger badge, so the list and the badge cannot disagree.';

revoke all on function public.my_unread_message_counts() from public, anon;
grant execute on function public.my_unread_message_counts() to authenticated;
