-- =====================================================================
-- THE BELL LISTS WHAT THE BELL COUNTS
--
-- public.my_unread_counts stopped the bell counting messages a second time,
-- and public.my_unread_message_counts stopped the conversation list counting
-- fewer of them than its own badge. One place was still left.
--
-- The bell's badge read 3 and the panel underneath it listed 6 -- the three
-- it counts plus the three "New fixture message" rows belonging to the speech
-- bubble next door. So the number and the list it opens contradicted each
-- other on screen, at the same moment, six pixels apart. Marking them read
-- from the panel then moved a badge that was never showing them.
--
-- SAME SPLIT, SAME SOURCE. A notification surfaced by another badge belongs
-- to that badge. The bell shows everything else -- and "everything else" is
-- decided by public.notification_types.topic_key, exactly as the count is, so
-- the list and the number are two readings of one definition and cannot
-- disagree again.
--
-- WHY A FUNCTION RATHER THAN A FILTER IN THE QUERY. The panel used to fetch
-- `notifications where user_id = me`, and adding `and type not in (...)`
-- would put a second copy of the split in TypeScript -- the exact shape that
-- produced this bug, one layer higher. There is one definition of what the
-- bell holds, and this is it.
--
-- Read-only and scoped to auth.uid(), like the counts beside it: it returns
-- the caller's own notifications and cannot be asked for anybody else's.
-- =====================================================================

create or replace function public.my_bell_notifications(p_limit integer default 8)
returns table (
  id uuid,
  type text,
  title text,
  body text,
  data jsonb,
  read_at timestamptz,
  created_at timestamptz
)
language sql
stable security definer
set search_path = public, internal, pg_temp
as $$
  select n.id, n.type, n.title, n.body, n.data, n.read_at, n.created_at
  from public.notifications n
  left join public.notification_types t on t.type_key = n.type
  where n.user_id = auth.uid()
    -- Messenger's, and Support's. Everything else is the bell's.
    and coalesce(t.topic_key, '') <> 'messages'
    and n.type <> 'support_ticket_update'
  order by n.created_at desc
  limit greatest(1, least(coalesce(p_limit, 8), 50));
$$;

comment on function public.my_bell_notifications(integer) is
  'The notifications the bell surfaces: the caller''s own, excluding those another badge already shows. The exclusion is driven by public.notification_types.topic_key, the same definition public.my_unread_counts uses for the badge, so the bell''s list and the bell''s number cannot disagree.';

revoke all on function public.my_bell_notifications(integer) from public, anon;
grant execute on function public.my_bell_notifications(integer) to authenticated;
