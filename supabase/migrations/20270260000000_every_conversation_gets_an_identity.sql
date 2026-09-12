-- =====================================================================
-- EVERY CONVERSATION GETS AN IDENTITY
--
-- THE DEFECT
--
-- Realtime in Messenger is a broadcast fired by a trigger on
-- fixture_messages, and the trigger is guarded by:
--
--     if new.conversation_id is not null then ...
--
-- conversation_id is filled by set_fixture_message_conversation_id, which
-- only ever knew about two containers: a fixture (copying the fixture's own
-- conversation id) and a club conversation (using its own id). Four more
-- containers have been added since -- team conversations, safeguarding
-- conversations, announcement replies and direct conversations -- and not one
-- of them sets conversation_id.
--
-- So those four have no realtime at all. Every message in them is delivered
-- correctly, stored correctly, counted correctly, and simply never announced:
-- the other person sees it on their next navigation. A direct message, which
-- is the one container people expect to behave like a chat, was the worst
-- affected.
--
-- THE FIX IS TO THE IDENTITY, NOT TO THE BROADCAST
--
-- The broadcast is fine. What was missing is the stable key it broadcasts on.
-- So the canonical resolver is extended to answer for all seven containers,
-- and the topic name is derived from the same value. No container-specific
-- realtime implementation, no second trigger, no new table: one function that
-- already existed learns about the containers that arrived after it.
--
-- WHY A PREFIX PER CONTAINER
--
-- Topics are strings and two containers could otherwise collide on the same
-- uuid. 'presence:f:' and 'presence:c:' were already in use for fixtures and
-- club conversations; the new ones follow the same shape. The prefix is part
-- of the topic rather than of conversation_id, so the stored identity stays a
-- plain uuid and nothing that reads it has to learn about prefixes.
--
-- SUBSCRIPTION AUTHORITY IS UNCHANGED. Broadcasting on a topic does not grant
-- anybody the right to listen to it: that is decided by the realtime
-- authorisation path and by RLS on the rows a listener then re-reads. This
-- migration makes messages announce themselves; it does not widen who may
-- hear them, and the payload deliberately carries an id and a kind rather
-- than any message content.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE CONVERSATION IDENTITY, FOR EVERY CONTAINER
-- ---------------------------------------------------------------------
create or replace function internal.set_fixture_message_conversation_id()
returns trigger
language plpgsql
set search_path = public, internal, pg_temp
as $$
begin
  if new.conversation_id is not null then
    return new;
  end if;

  if new.fixture_id is not null then
    -- A fixture and its originating request share one conversation, so the
    -- identity is the fixture's own rather than either row id.
    select conversation_id into new.conversation_id from public.fixtures where id = new.fixture_id;

  elsif new.club_conversation_id is not null then
    new.conversation_id := new.club_conversation_id;

  -- The four containers that had no identity, and therefore no realtime.
  elsif new.team_conversation_id is not null then
    new.conversation_id := new.team_conversation_id;

  elsif new.safeguarding_conversation_id is not null then
    new.conversation_id := new.safeguarding_conversation_id;

  elsif new.announcement_id is not null then
    new.conversation_id := new.announcement_id;

  elsif new.direct_conversation_id is not null then
    new.conversation_id := new.direct_conversation_id;
  end if;

  return new;
end;
$$;

comment on function internal.set_fixture_message_conversation_id() is
  'Gives every message a stable conversation identity, whichever of the seven containers it belongs to. A fixture and its request share the fixture''s identity; every other container is its own. This is what the realtime broadcast keys on.';

-- ---------------------------------------------------------------------
-- 2. THE TOPIC
-- ---------------------------------------------------------------------
-- Extracted so the trigger below and any future reader agree on the name
-- without either of them owning the rule.
create or replace function internal.message_realtime_topic(p_message public.fixture_messages)
returns text
language sql
immutable
as $$
  select case
    when p_message.club_conversation_id is not null then 'presence:c:'
    when p_message.team_conversation_id is not null then 'presence:t:'
    when p_message.safeguarding_conversation_id is not null then 'presence:s:'
    when p_message.announcement_id is not null then 'presence:a:'
    when p_message.direct_conversation_id is not null then 'presence:d:'
    else 'presence:f:'
  end || p_message.conversation_id::text;
$$;

comment on function internal.message_realtime_topic(public.fixture_messages) is
  'The realtime topic a message announces itself on. Prefixed per container so two containers cannot collide on the same uuid; the fixture prefix is the default because a fixture message is the case with no distinguishing column set.';

-- ---------------------------------------------------------------------
-- 3. THE BROADCAST
-- ---------------------------------------------------------------------
create or replace function internal.broadcast_fixture_message()
returns trigger
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if new.conversation_id is null then
    return new;
  end if;

  -- NO CONTENT IN THE PAYLOAD. Subscribers are told that something arrived
  -- and re-read through RLS; the broadcast itself must never become a way to
  -- receive a message you are not entitled to read.
  perform realtime.send(
    jsonb_build_object('message_id', new.id, 'kind', new.kind),
    'fixture_message_inserted',
    internal.message_realtime_topic(new),
    true
  );
  return new;
end;
$$;

comment on function internal.broadcast_fixture_message() is
  'Announces a new message on its conversation topic. Carries only an id and a kind: a listener learns that something arrived and re-reads it under RLS, so the broadcast can never deliver content to somebody who may not read it.';
