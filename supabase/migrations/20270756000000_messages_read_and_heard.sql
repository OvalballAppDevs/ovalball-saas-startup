-- =====================================================================================================================
-- MESSAGING, PREMIUM PASS: READ RECEIPTS, VOICE NOTES, AND NOTIFICATION ACTIONS THAT FIT THE CONVERSATION
--
-- 1. READ RECEIPTS, server-authoritative. `message_reads` holds one row per (message, reader) -- written ONLY by
--    `mark_thread_read`, which advances the caller's own cursor through messages they can actually read. Nobody can
--    write a read for somebody else, read a receipt for a message that is not theirs, or see one across a block.
--    `message_receipts` answers for the caller's OWN messages only: "read" in a direct conversation, "read by N" in a
--    group. There is no "delivered": the platform cannot know a device received anything, so it does not say so.
-- 2. VOICE NOTES ride the canonical attachment model: the same private bucket, the same path-scoped storage policy,
--    the same `can_post_to_message_target` authority as any attachment. A new media type is not a new permission.
--    AAC (audio/mp4) only, two minutes at most, two megabytes at most; idempotent by the client's send reference.
-- 3. A DELETED MESSAGE'S FILE becomes unreadable at the storage layer as well as hidden by the reader.
-- 4. PUSH ACTIONS by conversation type (direct / fixture / club), still with no message content in the push.
-- =====================================================================================================================

-- ---------------------------------------------------------------------------------------------------------------
-- 1. READ RECEIPTS
-- ---------------------------------------------------------------------------------------------------------------
create table if not exists public.message_reads (
  message_id uuid not null references public.fixture_messages(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists message_reads_user_idx on public.message_reads (user_id);

-- Where each person has read up to, per thread, so marking read never rescans a whole history.
create table if not exists public.thread_read_cursors (
  thread_key uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_at timestamptz not null,
  updated_at timestamptz not null default now(),
  primary key (thread_key, user_id)
);

-- Neither table is readable or writable by any API role: the two functions below are the only doors.
alter table public.message_reads enable row level security;
alter table public.thread_read_cursors enable row level security;
revoke all on public.message_reads from public, anon, authenticated;
revoke all on public.thread_read_cursors from public, anon, authenticated;

/**
 * I have read this conversation up to and including this message. Marks every earlier message from somebody else
 * in the same thread as read by me, once. Refused for a message I cannot read; a no-op if I had already read it.
 */
create or replace function public.mark_thread_read(p_message_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_message public.fixture_messages;
  v_key uuid;
  v_from timestamptz;
  v_marked integer := 0;
begin
  perform internal.require_live_session();
  if v_uid is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  select * into v_message from public.fixture_messages where id = p_message_id;
  if v_message.id is null or not internal.can_read_attached_message(p_message_id) then
    raise exception 'That message isn''t available.' using errcode = '42501';
  end if;

  -- A fixture, club or direct thread is keyed by its conversation; a request thread by the request itself.
  v_key := coalesce(v_message.conversation_id, v_message.fixture_request_id);
  if v_key is null then
    return 0;
  end if;

  select last_read_at into v_from from public.thread_read_cursors where thread_key = v_key and user_id = v_uid;
  if v_from is not null and v_from >= v_message.created_at then
    return 0;
  end if;

  insert into public.message_reads (message_id, user_id, read_at)
  select m.id, v_uid, now()
    from public.fixture_messages m
   where (case when v_message.conversation_id is not null
               then m.conversation_id = v_message.conversation_id
               else m.conversation_id is null and m.fixture_request_id = v_message.fixture_request_id end)
     and m.created_at <= v_message.created_at
     and (v_from is null or m.created_at > v_from)
     and m.sender_user_id <> v_uid
     and m.kind = 'message'
     and m.deleted_at is null
  on conflict (message_id, user_id) do nothing;
  get diagnostics v_marked = row_count;

  insert into public.thread_read_cursors (thread_key, user_id, last_read_at)
  values (v_key, v_uid, v_message.created_at)
  on conflict (thread_key, user_id) do update
    set last_read_at = greatest(public.thread_read_cursors.last_read_at, excluded.last_read_at), updated_at = now();

  -- The sender's screen hears that something was read and asks again through `message_receipts`. No content.
  if v_marked > 0 then
    perform realtime.send(jsonb_build_object('kind', 'read'), 'message_read', internal.message_realtime_topic(v_message), true);
  end if;
  return v_marked;
end;
$function$;

revoke all on function public.mark_thread_read(uuid) from public, anon;
grant execute on function public.mark_thread_read(uuid) to authenticated;

/**
 * Receipts for MY OWN messages, among the ids given: how many other people have read each, and when it was first
 * read. A direct conversation answers nothing while either person blocks the other.
 */
create or replace function public.message_receipts(p_message_ids uuid[])
 returns table(message_id uuid, read_count integer, first_read_at timestamptz, is_direct boolean)
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
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  return query
  select m.id,
         count(r.user_id)::integer,
         min(r.read_at),
         m.direct_conversation_id is not null
    from public.fixture_messages m
    left join public.message_reads r on r.message_id = m.id and r.user_id <> v_uid
   where m.id = any((coalesce(p_message_ids, '{}'::uuid[]))[1:200])
     and m.sender_user_id = v_uid
     and m.kind = 'message'
     and m.deleted_at is null
     and internal.can_read_attached_message(m.id)
     and (m.direct_conversation_id is null or not exists (
           select 1 from public.direct_conversations d
            where d.id = m.direct_conversation_id
              and (internal.is_personally_blocked(d.user_a, d.user_b) or internal.is_personally_blocked(d.user_b, d.user_a))))
   group by m.id;
end;
$function$;

revoke all on function public.message_receipts(uuid[]) from public, anon;
grant execute on function public.message_receipts(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------
-- 2. VOICE NOTES
-- ---------------------------------------------------------------------------------------------------------------
alter table public.fixture_messages drop constraint if exists fixture_messages_content_type_check;
alter table public.fixture_messages add constraint fixture_messages_content_type_check
  check (content_type = any (array['text', 'image', 'audio', 'system_event']));
-- A voice note, like a photo, is complete without words.
alter table public.fixture_messages drop constraint if exists fixture_messages_content_present;
alter table public.fixture_messages add constraint fixture_messages_content_present
  check (content_type in ('image', 'audio') or (body is not null and btrim(body) <> ''));

alter table public.fixture_message_attachments add column if not exists duration_ms integer;
alter table public.fixture_message_attachments drop constraint if exists fixture_message_attachments_mime_type_check;
alter table public.fixture_message_attachments add constraint fixture_message_attachments_mime_type_check
  check (mime_type = any (array['application/pdf', 'image/jpeg', 'image/png', 'image/webp', 'audio/mp4']));
alter table public.fixture_message_attachments drop constraint if exists fixture_message_attachments_audio_duration;
alter table public.fixture_message_attachments add constraint fixture_message_attachments_audio_duration
  check ((mime_type = 'audio/mp4') = (duration_ms is not null) and (duration_ms is null or duration_ms between 500 and 120000));

update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'audio/mp4')
 where id = 'fixture-attachments' and not ('audio/mp4' = any (coalesce(allowed_mime_types, '{}')));

/**
 * Send a recorded voice note that has already been uploaded to this conversation's own folder. Exactly the
 * authority of any attachment; idempotent by the caller's send reference.
 */
create or replace function public.create_voice_message(
  p_target_type public.message_target_type,
  p_target_id uuid,
  p_storage_path text,
  p_size_bytes integer,
  p_duration_ms integer,
  p_client_message_id uuid
)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  v_uid uuid := auth.uid();
  v_message_id uuid;
  v_policy record;
  v_expected text := internal.message_target_storage_prefix(p_target_type) || '/' || p_target_id::text || '/';
begin
  perform internal.require_live_session();
  if v_uid is null then
    raise exception 'You must be signed in to send a message.' using errcode = '42501';
  end if;
  if p_client_message_id is null then
    raise exception 'A send reference is required.' using errcode = '22023';
  end if;

  select id into v_message_id from public.fixture_messages where sender_user_id = v_uid and client_message_id = p_client_message_id;
  if v_message_id is not null then
    return v_message_id;
  end if;

  if not internal.can_post_to_message_target(p_target_type, p_target_id) then
    raise exception 'You are not authorized to post in this conversation.' using errcode = '42501';
  end if;
  if p_storage_path is null or position(v_expected in p_storage_path) <> 1 or p_storage_path !~ '\.m4a$' then
    raise exception 'That voice note does not belong to this conversation.' using errcode = '42501';
  end if;
  if p_size_bytes is null or p_size_bytes <= 0 or p_size_bytes > 2097152 then
    raise exception 'Voice notes must be 2MB or smaller.' using errcode = '22023';
  end if;
  if p_duration_ms is null or p_duration_ms < 500 or p_duration_ms > 120000 then
    raise exception 'Voice notes can be up to two minutes long.' using errcode = '22023';
  end if;

  select * into v_policy
  from public.get_effective_message_policy(internal.resolve_my_message_policy_club(p_target_type, p_target_id));
  if not coalesce(v_policy.allow_direct_attachments, true) then
    raise exception 'Attachments are turned off.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (
    fixture_id, fixture_request_id, direct_conversation_id, sender_user_id, body, kind, content_type, client_message_id)
  values (
    case when p_target_type = 'fixture' then p_target_id end,
    case when p_target_type = 'fixture_request' then p_target_id end,
    case when p_target_type = 'direct' then p_target_id end,
    v_uid, null, 'message', 'audio', p_client_message_id
  )
  on conflict (sender_user_id, client_message_id) where client_message_id is not null do nothing
  returning id into v_message_id;

  if v_message_id is null then
    select id into v_message_id from public.fixture_messages where sender_user_id = v_uid and client_message_id = p_client_message_id;
    return v_message_id;
  end if;

  insert into public.fixture_message_attachments
    (message_id, storage_path, original_filename, mime_type, size_bytes, uploaded_by, duration_ms)
  values (v_message_id, p_storage_path, 'Voice note.m4a', 'audio/mp4', p_size_bytes, v_uid, p_duration_ms);

  return v_message_id;
end;
$function$;

revoke all on function public.create_voice_message(public.message_target_type, uuid, text, integer, integer, uuid) from public, anon;
grant execute on function public.create_voice_message(public.message_target_type, uuid, text, integer, integer, uuid) to authenticated;

-- What a voice note is called where a conversation is summarised or announced.
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
      when l.content_type = 'audio' then 'Voice note'
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

CREATE OR REPLACE FUNCTION internal.notify_direct_message_recipient()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_other uuid;
  v_sender_name text;
begin
  if new.direct_conversation_id is null then
    return new;
  end if;

  select case when d.user_a = new.sender_user_id then d.user_b else d.user_a end
  into v_other
  from public.direct_conversations d where d.id = new.direct_conversation_id;

  if v_other is null then
    return new;
  end if;

  select nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), '')
  into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  -- A PERSON's name, because a direct message is from a person. Sender
  -- identity is never organisational here -- see the check below.
  insert into public.notifications (user_id, type, title, body, data)
  values (
    v_other,
    'new_direct_message',
    coalesce(v_sender_name, 'Ovalball user'),
    case when new.content_type = 'image' and coalesce(btrim(new.body), '') = '' then 'Sent a photo'
         when new.content_type = 'audio' then 'Sent a voice note'
         else left(coalesce(new.body, ''), 140) end,
    jsonb_build_object(
      'direct_conversation_id', new.direct_conversation_id,
      'message_id', new.id
    )
  );

  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION internal.notify_fixture_message_recipients()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fixture public.fixtures;
  v_req public.fixture_requests;
  v_group public.fixture_request_groups;
  v_cc public.club_conversations;
  v_sender_name text;
  v_snippet text;
begin
  -- A SYSTEM NOTE IS NOT A MESSAGE. The change it records has already sent its own, specific
  -- notification; announcing the note as a "new message" as well told everybody twice.
  if coalesce(new.kind, 'message') = 'system_event' then
    return new;
  end if;

  select coalesce(p.first_name || ' ' || p.surname, 'Someone') into v_sender_name
  from public.profiles p where p.id = new.sender_user_id;

  v_snippet := case
    when coalesce(btrim(new.body), '') = '' and new.content_type = 'image' then 'Sent a photo'
    when new.content_type = 'audio' then 'Sent a voice note'
    when coalesce(btrim(new.body), '') = '' then 'Sent an attachment'
    else '“' || left(btrim(new.body), 140) || case when length(btrim(new.body)) > 140 then '…' else '' end || '”'
  end;

  if new.fixture_id is not null then
    select * into v_fixture from public.fixtures where id = new.fixture_id;

    insert into public.notifications (user_id, type, title, body, data)
    select distinct recipient, 'new_fixture_message', 'New message',
      format(E'%s · %s\n%s', v_sender_name, coalesce(internal.fixture_notice_label(new.fixture_id), 'a fixture'), v_snippet),
      jsonb_build_object('fixture_id', new.fixture_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_fixture.owning_team_id, v_fixture.opponent_team_id)
        and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
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
    select distinct recipient, 'new_fixture_message', 'New message',
      format(E'%s · a fixture request\n%s', v_sender_name, v_snippet),
      jsonb_build_object('fixture_request_id', new.fixture_request_id, 'message_id', new.id)
    from (
      select cm.user_id as recipient
      from internal.team_role_assignments tp
      join public.club_memberships cm on cm.id = tp.membership_id and cm.status = 'active'
      where tp.team_id in (v_req.requesting_team_id, v_req.target_team_id)
        and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
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
$function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 3. A DELETED MESSAGE'S FILE
-- ---------------------------------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION internal.can_access_message_attachment_path(p_object_name text, p_write boolean)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
declare
  v_parts text[];
  v_type public.message_target_type;
  v_id uuid;
begin
  v_parts := storage.foldername(p_object_name);
  if array_length(v_parts, 1) < 2 then
    return false;
  end if;

  v_type := case v_parts[1]
    when 'f' then 'fixture'::public.message_target_type
    when 'r' then 'fixture_request'::public.message_target_type
    when 'd' then 'direct'::public.message_target_type
    else null
  end;
  if v_type is null then
    return false;
  end if;

  v_id := v_parts[2]::uuid;
  -- A DELETED MESSAGE TAKES ITS FILE WITH IT. The tombstone already hides the attachment from every reader;
  -- this makes the stored object itself unreadable too, so a voice note or photo withdrawn by its sender
  -- cannot be fetched by somebody who kept the path. Uploads (no attachment row yet) are unaffected.
  if not p_write and exists (
    select 1 from public.fixture_message_attachments a
    join public.fixture_messages m on m.id = a.message_id
    where a.storage_path = p_object_name and m.deleted_at is not null
  ) then
    return false;
  end if;
  return case when p_write
    then internal.can_post_to_message_target(v_type, v_id)
    else internal.can_read_message_target(v_type, v_id)
  end;
exception when invalid_text_representation then
  -- A folder that is not a uuid is refused rather than raised: a policy that errors tells a prober
  -- something, and a malformed path is simply not a path anybody is entitled to.
  return false;
end $function$;

-- ---------------------------------------------------------------------------------------------------------------
-- 4. PUSH ACTIONS BY CONVERSATION TYPE
-- ---------------------------------------------------------------------------------------------------------------
create or replace function internal.deliver_push_notification()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_messages jsonb;
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
    -- THE ACTIONS FIT THE CONVERSATION. A direct message offers Reply and a 👍 reaction; a fixture or request
    -- thread -- where "are we on?" is the question -- adds the two quick answers; a club thread offers Reply.
    -- The app registers all three categories; the payload's ids are an address, never an authority.
    || case
         when new.type = 'new_direct_message' then jsonb_build_object('categoryId', 'ovalball-direct')
         when new.type = 'new_fixture_message' and (new.data ? 'fixture_id' or new.data ? 'fixture_request_id')
           then jsonb_build_object('categoryId', 'ovalball-fixture')
         when new.type = 'new_fixture_message' then jsonb_build_object('categoryId', 'ovalball-message')
         else '{}'::jsonb
       end
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
