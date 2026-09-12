-- =====================================================================
-- A TOPIC YOU MAY NOT JOIN IS NOT A CHANNEL
--
-- 20270260000000 gave every container a conversation identity and taught
-- internal.broadcast_fixture_message to announce on a per-container topic:
-- presence:t: for a team conversation, presence:s: for safeguarding,
-- presence:a: for an announcement, presence:d: for a direct conversation.
--
-- The half that was missed is the AUTHORISATION. realtime.messages is
-- RLS-protected by internal.can_access_fixture_presence_topic, and that
-- function only ever learned three prefixes -- 'f', 'r' and 'c'. Every
-- other prefix fell through to `return false`, for BOTH policies on the
-- table (read and write share the predicate).
--
-- So the database has been faithfully broadcasting to four topics that no
-- client on earth is permitted to subscribe to. Nothing errored: a
-- refused subscription is simply a channel that never delivers, which is
-- precisely why this survived a migration that proved the broadcast
-- itself worked. A message was sent to a room with the door locked.
--
-- Each new prefix is authorised by the SAME predicate that already
-- decides whether that person may read the conversation's messages. That
-- is the point: a realtime topic must never be a second, weaker answer to
-- "may you see this". If the read authority changes, the channel changes
-- with it, because they are one function call.
--
-- The announcement case is the only one taking two predicates, because an
-- announcement has two legitimate audiences -- the people who received it
-- and the person who sent it -- and a reply must reach both.
-- =====================================================================

create or replace function internal.can_access_fixture_presence_topic(p_topic text)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_parts text[];
  v_id uuid;
begin
  v_parts := string_to_array(p_topic, ':');
  if array_length(v_parts, 1) <> 3 or v_parts[1] <> 'presence' then
    return false;
  end if;

  v_id := v_parts[3]::uuid;

  -- Each branch defers to the canonical viewer predicate for its
  -- container. No branch reimplements an authority check.
  if v_parts[2] = 'f' then
    return internal.can_access_conversation(v_id);

  elsif v_parts[2] = 'r' then
    return internal.can_access_fixture_conversation(null, v_id);

  elsif v_parts[2] = 'c' then
    return internal.can_access_any_conversation(null, null, v_id);

  -- A team conversation is keyed by the team itself, so the topic carries
  -- a team id and the team predicate reads it directly.
  elsif v_parts[2] = 't' then
    return internal.can_view_team_conversation(v_id);

  elsif v_parts[2] = 's' then
    return internal.can_view_safeguarding_conversation(v_id);

  -- Sender OR recipient: a private reply travels between exactly those two
  -- sides, and the sending side must hear it arrive.
  elsif v_parts[2] = 'a' then
    return internal.is_announcement_recipient(v_id)
        or internal.is_announcement_sender(v_id);

  elsif v_parts[2] = 'd' then
    return internal.can_view_direct_conversation(v_id);
  end if;

  return false;
exception when invalid_text_representation then
  return false;
end;
$$;

comment on function internal.can_access_fixture_presence_topic(text) is
  'Authorises a realtime topic for both reading and presence-writing on realtime.messages. Understands every container that broadcasts: f (fixture), r (fixture request), c (club), t (team), s (safeguarding), a (announcement), d (direct). Each prefix defers to the same predicate that authorises reading that conversation''s messages, so a channel can never become a weaker answer than the message store itself.';
