-- =====================================================================
-- A REPLY IS A MESSAGE, IN THE SAME STORE
--
-- An announcement can invite two kinds of answer, and neither of them is a
-- new kind of object:
--
--   PRIVATE_REPLY     the recipient answers, and ONLY the sending side sees
--                     it. Not the other recipients, and not each other.
--   GROUP_DISCUSSION  everyone the announcement reached can talk, and can
--                     see each other -- which is why 20270242000000 confines
--                     it to team and explicitly-selected audiences.
--
-- Both are messages. So both are fixture_messages rows, in the one canonical
-- store, subject to the moderation, reporting, soft-delete and attachment
-- machinery that already exists there. Giving replies their own table would
-- mean re-implementing all of it -- and the copy that gets forgotten is the
-- one that lets a deleted message stay visible.
--
-- fixture_messages already discriminates its container with a CHECK that
-- exactly one conversation column is set. This adds a sixth and keeps that
-- rule intact, so "which conversation is this in" still has exactly one
-- answer for every row that has ever existed.
--
-- THE PRIVACY LINE, AND WHERE IT IS DRAWN
--
-- Under PRIVATE_REPLY the audience must stay invisible, exactly as it is in
-- the delivery table. A recipient reading their own reply thread must not be
-- able to see that anyone else replied, or that anyone else exists. That is
-- enforced in the RLS predicate below -- "my own replies, or I am the
-- sending side" -- and not by the UI choosing what to render, because a
-- payload that contains what the screen hides is a leak with extra steps.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE SIXTH CONTAINER
-- ---------------------------------------------------------------------
alter table public.fixture_messages
  add column if not exists announcement_id uuid references public.messenger_announcements(id) on delete cascade;

alter table public.fixture_messages drop constraint if exists fixture_messages_check;
alter table public.fixture_messages
  add constraint fixture_messages_check check (
    num_nonnulls(
      fixture_request_id, fixture_id, club_conversation_id,
      team_conversation_id, safeguarding_conversation_id, announcement_id
    ) = 1
  );

comment on column public.fixture_messages.announcement_id is
  'The announcement this message replies to. One of the six mutually exclusive conversation containers -- a reply is an ordinary message, moderated and deleted by the same machinery as any other.';

create index if not exists fixture_messages_announcement_idx
  on public.fixture_messages (announcement_id, created_at desc)
  where announcement_id is not null;

-- ---------------------------------------------------------------------
-- 2. WHO MAY SEE A REPLY
-- ---------------------------------------------------------------------
-- SECURITY DEFINER for the same reason as the announcement predicates: it
-- has to read the deliveries table, whose own RLS would otherwise re-enter.
-- It answers one boolean about the caller and never returns a row.
create or replace function internal.can_view_announcement_reply(
  p_announcement_id uuid,
  p_sender_user_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare a public.messenger_announcements;
begin
  if auth.uid() is null then
    return false;
  end if;

  select * into a from public.messenger_announcements where id = p_announcement_id;
  if not found then
    return false;
  end if;

  -- The sending side sees every reply. That is the point of inviting them.
  if a.actor_user_id = auth.uid()
     or internal.may_send_as(a.sender_identity_type, a.sender_identity_id) then
    return true;
  end if;

  -- A recipient sees a reply only if they received the announcement.
  if not internal.is_announcement_recipient(p_announcement_id) then
    return false;
  end if;

  -- GROUP_DISCUSSION: a bounded audience that can see each other. Bounded
  -- is enforced at the announcement, not here.
  if a.reply_mode = 'GROUP_DISCUSSION' then
    return true;
  end if;

  -- PRIVATE_REPLY: your own words only. Somebody else replying is not
  -- something you are entitled to learn -- knowing WHO ELSE replied is
  -- knowing who else is in the audience.
  if a.reply_mode = 'PRIVATE_REPLY' then
    return p_sender_user_id = auth.uid();
  end if;

  -- NO_REPLY: there is nothing to read.
  return false;
end;
$$;

comment on function internal.can_view_announcement_reply(uuid, uuid) is
  'May the caller read this reply? The sending side reads all of them; a recipient reads everyone''s under GROUP_DISCUSSION and only their own under PRIVATE_REPLY, because under a private reply mode the other repliers ARE the audience.';

revoke all on function internal.can_view_announcement_reply(uuid, uuid) from public, anon;
grant execute on function internal.can_view_announcement_reply(uuid, uuid) to authenticated;

-- The existing policy is extended, not replaced by a second one: two SELECT
-- policies on one table are OR-ed, and a reader working out which of them
-- let a row through is exactly the confusion that hides a mistake.
drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages
  for select using (
    internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
    or (team_conversation_id is not null and internal.can_view_team_conversation(team_conversation_id))
    or (safeguarding_conversation_id is not null and internal.can_view_safeguarding_conversation(safeguarding_conversation_id))
    or (announcement_id is not null and internal.can_view_announcement_reply(announcement_id, sender_user_id))
  );

-- The INSERT policy needs the same treatment, and for a subtler reason. Its
-- final branch reads "no team conversation and no safeguarding conversation,
-- and you can access this fixture conversation" -- which an announcement
-- reply row also satisfies structurally, since it sets neither. It is
-- refused today only because can_access_any_conversation(null, null, null)
-- happens to return false. That is a coincidence, not a rule, and a future
-- change to that function would silently open a direct-insert path around
-- reply_to_announcement and its reply-mode checks. So the branch is made
-- explicit: replies are written through the RPC, and by nothing else.
drop policy if exists fixture_messages_insert_scoped on public.fixture_messages;
create policy fixture_messages_insert_scoped on public.fixture_messages
  for insert with check (
    sender_user_id = auth.uid()
    and (
      (team_conversation_id is not null and internal.can_send_team_conversation(team_conversation_id))
      or (safeguarding_conversation_id is not null and internal.can_send_safeguarding_conversation(safeguarding_conversation_id))
      or (
        team_conversation_id is null
        and safeguarding_conversation_id is null
        and announcement_id is null
        and internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
        and (
          club_conversation_id is null
          or (select cc.status from public.club_conversations cc
              where cc.id = fixture_messages.club_conversation_id) = 'accepted'
        )
      )
    )
  );

-- ---------------------------------------------------------------------
-- 3. REPLYING
-- ---------------------------------------------------------------------
create or replace function public.reply_to_announcement(
  p_announcement_id uuid,
  p_body text
)
returns uuid
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  a public.messenger_announcements;
  v_policy record;
  v_club_id uuid;
  v_id uuid;
  v_is_sender boolean;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if nullif(btrim(coalesce(p_body, '')), '') is null then
    raise exception 'A reply needs some words.';
  end if;

  select * into a from public.messenger_announcements where id = p_announcement_id;
  if not found then
    raise exception 'Announcement not found.';
  end if;
  if a.status = 'withdrawn' then
    raise exception 'This announcement has been withdrawn.';
  end if;
  if a.reply_mode = 'NO_REPLY' then
    raise exception 'This announcement does not take replies.' using errcode = '42501';
  end if;

  v_is_sender := a.actor_user_id = auth.uid()
    or internal.may_send_as(a.sender_identity_type, a.sender_identity_id);

  if not (v_is_sender or internal.is_announcement_recipient(p_announcement_id)) then
    raise exception 'You are not part of this conversation.' using errcode = '42501';
  end if;

  -- The same feature policy that governed sending governs answering, read
  -- against the same club, so a club that switched discussion off does not
  -- discover it switched off only for its own staff.
  v_club_id := case a.sender_identity_type
    when 'club' then a.sender_identity_id
    when 'team' then (select t.club_id from public.teams t where t.id = a.sender_identity_id)
    else null
  end;
  select * into v_policy from public.get_effective_message_policy(v_club_id);

  if a.reply_mode = 'GROUP_DISCUSSION' and not coalesce(v_policy.allow_group_discussion, true) then
    raise exception 'Group discussion is turned off.' using errcode = '42501';
  end if;
  if a.reply_mode = 'PRIVATE_REPLY' and not coalesce(v_policy.allow_private_replies, true) then
    raise exception 'Private replies are turned off.' using errcode = '42501';
  end if;

  insert into public.fixture_messages (announcement_id, sender_user_id, body, kind, content_type)
  values (p_announcement_id, auth.uid(), btrim(p_body), 'message', 'text')
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.reply_to_announcement(uuid, text) is
  'Answers an announcement that invited answers. The reply is an ordinary fixture_messages row, so moderation, reporting and deletion apply to it unchanged.';

revoke all on function public.reply_to_announcement(uuid, text) from public, anon;
grant execute on function public.reply_to_announcement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- 4. READING A THREAD
-- ---------------------------------------------------------------------
-- Goes through the table, so RLS above is what decides -- this function
-- adds no visibility of its own. Tombstoning matches the rest of Messenger:
-- a deleted message keeps its place and loses its words.
create or replace function public.announcement_replies(p_announcement_id uuid)
returns table (
  message_id uuid,
  sender_user_id uuid,
  body text,
  deleted boolean,
  created_at timestamptz
)
language sql
stable
set search_path = public, internal, pg_temp
as $$
  select
    m.id,
    m.sender_user_id,
    case when m.deleted_at is not null then 'This message was deleted.' else m.body end,
    m.deleted_at is not null,
    m.created_at
  from public.fixture_messages m
  where m.announcement_id = p_announcement_id
  order by m.created_at;
$$;

comment on function public.announcement_replies(uuid) is
  'The replies on an announcement that the CALLER may read. Deliberately not SECURITY DEFINER: the row-level policy on fixture_messages is the only thing deciding, so this cannot drift from it.';

revoke all on function public.announcement_replies(uuid) from public, anon;
grant execute on function public.announcement_replies(uuid) to authenticated;
