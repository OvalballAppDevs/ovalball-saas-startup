-- A MESSENGER PEOPLE CAN TALK IN (Ovalball Messaging, 7 Oct 2026).
--
-- One canonical message table (`fixture_messages`, seven containers) stays the only message store. This migration
-- adds what a modern messenger needs ON that store, each piece judged by the server:
--
--   1. REACTIONS  -- `message_reactions`, one per person per message (a different emoji CHANGES it, the same emoji
--      takes it back), from a fixed set. Written only through `set_message_reaction`, which asks exactly the
--      "may this person post here" rule the send policy asks (`internal.can_post_to_message`). Read through RLS that
--      defers to the message's own visibility, so a reaction is never visible where its message is not.
--   2. REPLIES    -- `fixture_messages.reply_to_message_id`, refused unless the parent is a message in the SAME
--      conversation. The reader shows the parent through the parent's own RLS; a deleted parent reads as deleted.
--   3. ONE MESSAGE PER SEND -- `fixture_messages.client_message_id` + a unique index per sender, and
--      `send_conversation_message`, SECURITY INVOKER so the insert policy (recipient authority, safeguarding,
--      blocks, policy) judges it exactly as before; a retried send returns the first message, never a second.
--   4. PRESENCE   -- `my_direct_presence()`: when the OTHER person in each of my direct conversations was last active
--      (the app's 60-second foreground heartbeat, `touch_last_active`). Only for my own direct conversations, only
--      adults (direct messaging is adult-only), never across a personal block. No directory, no device, no place.
--   5. REQUEST THREADS HEAR NEW MESSAGES -- a request message has no `conversation_id`, so it never broadcast;
--      it now broadcasts on `presence:r:<request>`, the topic its authority already recognised.
--   6. A PUSH NEVER CARRIES THE MESSAGE -- security-safeguarding-standard §17: message pushes say who and where,
--      not what. The in-app notification (behind a signed-in session) keeps its preview.
--   7. A DOCUMENT SHARED IN A DIRECT MESSAGE OPENS FOR ITS RECIPIENT -- 20270574 restored the pre-20270534 shared
--      branch of `can_access_document_storage_path` (fixture threads only), so a direct-message recipient could
--      read the row but not the file. The branch asks `can_read_attached_message` again, and a share in a deleted
--      message no longer opens anything (the privacy-preserving reading of a withdrawn share).
--
-- Typing is NOT stored: it is an ephemeral broadcast on the conversation's private topic, authorised by the
-- existing `fixture_presence_write` policy on realtime.messages.

-- ---------------------------------------------------------------------------------------------------------------
-- 0. WHO MAY POST INTO THE CONVERSATION A MESSAGE BELONGS TO -- the insert policy's own rule, per container.
-- ---------------------------------------------------------------------------------------------------------------
create or replace function internal.can_post_to_message(p_message_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select exists (
    select 1 from public.fixture_messages m
    where m.id = p_message_id
      and m.deleted_at is null
      and m.kind = 'message'
      and m.announcement_id is null
      and (
        (m.team_conversation_id is not null and internal.can_send_team_conversation(m.team_conversation_id))
        or (m.safeguarding_conversation_id is not null and internal.can_send_safeguarding_conversation(m.safeguarding_conversation_id))
        or (m.direct_conversation_id is not null
            and internal.can_view_direct_conversation(m.direct_conversation_id)
            and internal.may_direct_message((select case when d.user_a = auth.uid() then d.user_b else d.user_a end
                                               from public.direct_conversations d where d.id = m.direct_conversation_id)))
        or (m.team_conversation_id is null and m.safeguarding_conversation_id is null and m.direct_conversation_id is null
            and internal.can_access_any_conversation(m.fixture_id, m.fixture_request_id, m.club_conversation_id)
            and (m.club_conversation_id is null
                 or (select cc.status from public.club_conversations cc where cc.id = m.club_conversation_id) = 'accepted'))
      )
  )
$function$;

revoke all on function internal.can_post_to_message(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 1. REACTIONS
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.message_reactions (
  message_id uuid not null references public.fixture_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id),
  -- A fixed, friendly set: a youth sport's messenger has no free-text reactions to moderate.
  constraint message_reactions_emoji_allowed check (emoji in ('👍', '❤️', '😂', '🎉', '👏', '🙌'))
);

create index if not exists message_reactions_message_idx on public.message_reactions (message_id);

alter table public.message_reactions enable row level security;

-- Visible exactly where the message is: the subquery runs under the reader's own RLS on fixture_messages.
drop policy if exists message_reactions_select_where_message_visible on public.message_reactions;
create policy message_reactions_select_where_message_visible on public.message_reactions
  for select to authenticated
  using (exists (select 1 from public.fixture_messages m where m.id = message_reactions.message_id));

drop policy if exists session_ok_required on public.message_reactions;
create policy session_ok_required on public.message_reactions as restrictive
  for all to authenticated
  using ((select internal.session_ok())) with check ((select internal.session_ok()));

revoke all on public.message_reactions from public, anon, authenticated;
grant select on public.message_reactions to authenticated;

/**
 * Set, change or take back my reaction to one message. `p_emoji` null takes it back; the same emoji as mine takes
 * it back; another emoji changes it. Repeating the same call leaves one row (the primary key), so a retry is safe.
 * Returns the message's reactions, so the caller shows the server's answer.
 */
create or replace function public.set_message_reaction(p_message_id uuid, p_emoji text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_message public.fixture_messages;
  v_mine text;
begin
  perform internal.require_live_session();
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_emoji is not null and p_emoji not in ('👍', '❤️', '😂', '🎉', '👏', '🙌') then
    raise exception 'Choose one of the reactions shown.' using errcode = '22023';
  end if;

  select * into v_message from public.fixture_messages where id = p_message_id;
  -- One answer for "no such message" and "not yours to react to": an id must reveal nothing.
  if v_message.id is null or not internal.can_post_to_message(p_message_id) then
    raise exception 'That message isn''t available.' using errcode = '42501';
  end if;

  select emoji into v_mine from public.message_reactions where message_id = p_message_id and user_id = v_uid;

  if p_emoji is null or p_emoji = v_mine then
    delete from public.message_reactions where message_id = p_message_id and user_id = v_uid;
  else
    insert into public.message_reactions (message_id, user_id, emoji)
    values (p_message_id, v_uid, p_emoji)
    on conflict (message_id, user_id) do update set emoji = excluded.emoji, created_at = now();
  end if;

  -- Everyone in the conversation hears that reactions changed and re-reads them through RLS: no content here.
  if v_message.conversation_id is not null or v_message.fixture_request_id is not null then
    perform realtime.send(
      jsonb_build_object('message_id', p_message_id, 'kind', 'reaction'),
      'message_reaction_changed',
      internal.message_realtime_topic(v_message),
      true
    );
  end if;

  return coalesce((
    select jsonb_agg(jsonb_build_object('emoji', r.emoji, 'count', r.n, 'mine', r.mine) order by r.n desc, r.emoji)
      from (select emoji, count(*)::int as n, bool_or(user_id = v_uid) as mine
              from public.message_reactions where message_id = p_message_id group by emoji) r
  ), '[]'::jsonb);
end;
$function$;

revoke all on function public.set_message_reaction(uuid, text) from public, anon;
grant execute on function public.set_message_reaction(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. REPLIES and 3. ONE MESSAGE PER SEND
-- ---------------------------------------------------------------------------------------------------------------
alter table public.fixture_messages add column if not exists reply_to_message_id uuid references public.fixture_messages(id) on delete set null;
alter table public.fixture_messages add column if not exists client_message_id uuid;

create unique index if not exists fixture_messages_sender_client_message_key
  on public.fixture_messages (sender_user_id, client_message_id) where client_message_id is not null;
create index if not exists fixture_messages_reply_to_idx on public.fixture_messages (reply_to_message_id) where reply_to_message_id is not null;
-- The two containers that were never indexed for their own thread reads.
create index if not exists fixture_messages_team_conversation_idx on public.fixture_messages (team_conversation_id, created_at desc) where team_conversation_id is not null;
create index if not exists fixture_messages_safeguarding_conversation_idx on public.fixture_messages (safeguarding_conversation_id, created_at desc) where safeguarding_conversation_id is not null;

create or replace function internal.enforce_reply_in_same_conversation()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_parent public.fixture_messages;
begin
  if new.reply_to_message_id is null then
    return new;
  end if;
  select * into v_parent from public.fixture_messages where id = new.reply_to_message_id;
  if v_parent.id is null
     or v_parent.kind <> 'message'
     or v_parent.fixture_id is distinct from new.fixture_id
     or v_parent.fixture_request_id is distinct from new.fixture_request_id
     or v_parent.club_conversation_id is distinct from new.club_conversation_id
     or v_parent.team_conversation_id is distinct from new.team_conversation_id
     or v_parent.safeguarding_conversation_id is distinct from new.safeguarding_conversation_id
     or v_parent.announcement_id is distinct from new.announcement_id
     or v_parent.direct_conversation_id is distinct from new.direct_conversation_id then
    raise exception 'You can only reply to a message in this conversation.' using errcode = '22023';
  end if;
  return new;
end;
$function$;

drop trigger if exists fixture_messages_reply_in_same_conversation on public.fixture_messages;
create trigger fixture_messages_reply_in_same_conversation
  before insert on public.fixture_messages
  for each row execute function internal.enforce_reply_in_same_conversation();

-- A reply's parent and a message's client id never change after the fact.
create or replace function internal.freeze_message_reply_and_client_id()
 returns trigger
 language plpgsql
 set search_path to 'public', 'pg_temp'
as $function$
begin
  if new.client_message_id is distinct from old.client_message_id
     or (new.reply_to_message_id is distinct from old.reply_to_message_id and new.reply_to_message_id is not null) then
    raise exception 'A message''s reply and send reference cannot change.' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists fixture_messages_freeze_reply_and_client_id on public.fixture_messages;
create trigger fixture_messages_freeze_reply_and_client_id
  before update on public.fixture_messages
  for each row execute function internal.freeze_message_reply_and_client_id();

/**
 * SEND ONE MESSAGE, ONCE. Runs as the caller (SECURITY INVOKER): `fixture_messages_insert_scoped` -- recipient
 * authority, the adult-only direct rule, blocks, club policy, an accepted club conversation -- judges the insert
 * exactly as it judges a direct insert today. `p_client_message_id` is the sender's own id for this send: the same
 * id again (a retry after a dropped connection, a double tap) returns the message already sent.
 */
create or replace function public.send_conversation_message(
  p_kind text,
  p_target_id uuid,
  p_body text,
  p_client_message_id uuid,
  p_reply_to_message_id uuid default null
)
 returns uuid
 language plpgsql
 security invoker
 set search_path to 'public', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_body text := nullif(btrim(coalesce(p_body, '')), '');
  v_id uuid;
begin
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if v_body is null then
    raise exception 'Write a message first.' using errcode = '22023';
  end if;
  if p_client_message_id is null then
    raise exception 'A send reference is required.' using errcode = '22023';
  end if;
  if p_kind not in ('fixture', 'request', 'club', 'team', 'safeguarding', 'direct') then
    raise exception 'That conversation isn''t available.' using errcode = '22023';
  end if;

  -- Already sent with this reference: the first message is the answer.
  select id into v_id from public.fixture_messages where sender_user_id = v_uid and client_message_id = p_client_message_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.fixture_messages (
    fixture_id, fixture_request_id, club_conversation_id, team_conversation_id, safeguarding_conversation_id, direct_conversation_id,
    sender_user_id, body, kind, content_type, client_message_id, reply_to_message_id
  ) values (
    case when p_kind = 'fixture' then p_target_id end,
    case when p_kind = 'request' then p_target_id end,
    case when p_kind = 'club' then p_target_id end,
    case when p_kind = 'team' then p_target_id end,
    case when p_kind = 'safeguarding' then p_target_id end,
    case when p_kind = 'direct' then p_target_id end,
    v_uid, v_body, 'message', 'text', p_client_message_id, p_reply_to_message_id
  )
  on conflict (sender_user_id, client_message_id) where client_message_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    -- Lost a race with the same send: the row that won is this send.
    select id into v_id from public.fixture_messages where sender_user_id = v_uid and client_message_id = p_client_message_id;
  end if;
  return v_id;
end;
$function$;

revoke all on function public.send_conversation_message(text, uuid, text, uuid, uuid) from public, anon;
grant execute on function public.send_conversation_message(text, uuid, text, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. PRESENCE, for my own direct conversations only
-- ---------------------------------------------------------------------------------------------------------------
create or replace function public.my_direct_presence()
 returns table(conversation_id uuid, other_user_id uuid, last_active_at timestamptz)
 language plpgsql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
begin
  perform internal.require_live_session();
  if v_uid is null then
    return;
  end if;
  return query
    select d.id, o.other, p.last_active_at
      from public.direct_conversations d
      cross join lateral (select case when d.user_a = v_uid then d.user_b else d.user_a end as other) o
      join public.profiles p on p.id = o.other
     where (d.user_a = v_uid or d.user_b = v_uid)
       and internal.is_adult_messaging_user(o.other)
       and internal.is_adult_messaging_user(v_uid)
       and not exists (
         select 1 from public.user_message_blocks b
          where b.lifted_at is null
            and ((b.blocker_user_id = v_uid and b.blocked_user_id = o.other) or (b.blocker_user_id = o.other and b.blocked_user_id = v_uid))
       );
end;
$function$;

revoke all on function public.my_direct_presence() from public, anon;
grant execute on function public.my_direct_presence() to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 5. REQUEST THREADS BROADCAST
-- ---------------------------------------------------------------------------------------------------------------
create or replace function internal.message_realtime_topic(p_message fixture_messages)
 returns text
 language sql
 immutable
as $function$
  select case
    when p_message.fixture_request_id is not null then 'presence:r:' || p_message.fixture_request_id::text
    else case
      when p_message.club_conversation_id is not null then 'presence:c:'
      when p_message.team_conversation_id is not null then 'presence:t:'
      when p_message.safeguarding_conversation_id is not null then 'presence:s:'
      when p_message.announcement_id is not null then 'presence:a:'
      when p_message.direct_conversation_id is not null then 'presence:d:'
      else 'presence:f:'
    end || p_message.conversation_id::text
  end;
$function$;

create or replace function internal.broadcast_fixture_message()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if new.conversation_id is null and new.fixture_request_id is null then
    return new;
  end if;

  -- NO CONTENT IN THE PAYLOAD. Subscribers are told that something arrived and re-read through RLS; the
  -- broadcast itself must never become a way to receive a message you are not entitled to read.
  perform realtime.send(
    jsonb_build_object('message_id', new.id, 'kind', new.kind),
    'fixture_message_inserted',
    internal.message_realtime_topic(new),
    true
  );
  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 6. A PUSH NEVER CARRIES THE MESSAGE
-- ---------------------------------------------------------------------------------------------------------------
create or replace function internal.deliver_push_notification()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_messages jsonb;
  v_is_message boolean := new.type in ('new_direct_message', 'new_fixture_message', 'announcement_received');
  v_body text;
begin
  if coalesce(new.data ->> 'push', 'true') = 'false' then
    return new;
  end if;
  if not internal.should_deliver_notification(new.user_id, new.type, 'push') then
    return new;
  end if;

  -- §17: who and where, never what. A fixture message's first line is "<Sender> · <fixture>"; the quoted text
  -- below it stays in the app, behind a signed-in session.
  v_body := case new.type
    when 'new_direct_message' then 'Sent you a message.'
    when 'new_fixture_message' then split_part(coalesce(new.body, ''), E'\n', 1)
    when 'announcement_received' then 'New announcement. Open Ovalball to read it.'
    else new.body
  end;

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'to', t.token,
      'title', new.title,
      'body', v_body,
      'data', jsonb_build_object('type', new.type, 'notificationId', new.id) || coalesce(new.data, '{}'::jsonb),
      'sound', 'default'
    )
    -- A message push offers Reply and View (the app registers the category); everything else is plain.
    || case when new.type in ('new_direct_message', 'new_fixture_message') then jsonb_build_object('categoryId', 'ovalball-message') else '{}'::jsonb end
  ), '[]'::jsonb)
  into v_messages
  from public.push_device_tokens t
  where t.user_id = new.user_id;

  if jsonb_array_length(v_messages) = 0 then
    return new;
  end if;

  -- FIRE-AND-FORGET, deliberately: a push failing is not a reason to fail the write that already told this
  -- person in the app.
  perform net.http_post(
    url := 'https://exp.host/--/api/v2/push/send',
    headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
    body := v_messages
  );

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 7. A DOCUMENT SHARED IN A DIRECT MESSAGE OPENS FOR ITS RECIPIENT
-- ---------------------------------------------------------------------------------------------------------------
create or replace function internal.can_access_document_storage_path(p_object_name text, p_write boolean)
 returns boolean
 language plpgsql
 stable
 security definer
 set search_path to 'public'
as $function$
declare
  v_parts text[];
  v_owner_id uuid;
  v_team_id uuid;
begin
  v_parts := storage.foldername(p_object_name);
  v_owner_id := v_parts[1]::uuid;

  if array_length(v_parts, 1) = 2 then
    v_team_id := v_parts[2]::uuid;
    if not exists (select 1 from public.teams t where t.id = v_team_id and t.club_id = v_owner_id) then
      return false;
    end if;
    if p_write then
      return internal.can_manage_document_library(v_owner_id, null)
          or (exists (select 1 from public.teams t_guard where t_guard.id = v_team_id and t_guard.club_id = v_owner_id) and internal.can('team.team.manage', 'team', v_owner_id, v_team_id, null))
          or (v_owner_id is not null and internal.can('club.profile.edit', 'club', v_owner_id, null, null));
    end if;
    return internal.can_view_document_library(v_owner_id, null)
        or (exists (select 1 from public.teams t_guard where t_guard.id = v_team_id and t_guard.club_id = v_owner_id) and internal.can('team.roster.view', 'team', v_owner_id, v_team_id, null));
  end if;

  if p_write then
    return internal.can_manage_document_library(
      (select id from public.clubs where id = v_owner_id),
      (select id from public.club_directory where id = v_owner_id)
    );
  end if;
  return internal.can_view_document_library(
    (select id from public.clubs where id = v_owner_id),
    (select id from public.club_directory where id = v_owner_id)
  )
  -- SHARED INTO A CONVERSATION I MAY READ (fixture, request, club or direct): the same rule that shows me the
  -- share row (`club_documents_select_shared`). A share in a message since deleted opens nothing.
  or exists (
    select 1 from public.club_documents d
    join public.fixture_message_document_refs r on r.document_id = d.id
    join public.fixture_messages m on m.id = r.message_id
    where d.storage_path = p_object_name
      and m.deleted_at is null
      and internal.can_read_attached_message(m.id)
  );
exception when invalid_text_representation then
  return false;
end;
$function$;
