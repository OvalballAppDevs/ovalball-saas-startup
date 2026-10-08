-- =====================================================================================================================
-- A CONVERSATION IS BETWEEN ITS OWN SIDES (release readiness, 8 Oct 2026)
--
-- THE DEFECT. A fixture message was authorised through its FIXTURE: the fixture's current conversation, and the teams
-- of the fixtures in it now. When a fixture's opponent changed -- a fixture edit, a request accepted against a
-- different side, a directory club joining Ovalball, a competition sync, a claimed external result -- whoever was the
-- opponent NOW passed that check for every message written before, with the previous opponent. That existed before
-- 20270757000000 for every fixture, and 757 made it worse for a fixture alone in its thread by keeping the thread.
-- 757 now gives a changed opponent a conversation of its own; this migration makes every READ of a fixture message
-- answer for the conversation the message was written in.
--
-- THE MODEL. `internal.fixture_conversation_parties` records the teams a fixture conversation has been between. A
-- conversation is only ever shared by fixtures with the same opposing pair (757), so its parties are that pair; when
-- a fixture leaves for a new opponent its old conversation keeps its parties and gains nobody. A message in its
-- fixture's CURRENT conversation keeps exactly the check it always had. A message in an EARLIER conversation of its
-- fixture is readable by that conversation's parties (team or club participation authority) and moderators -- the
-- people it was written between, the previous opponent included -- and by nobody newly assigned; it is read-only
-- (no reactions or replies into a thread the fixture has left). Nothing is deleted and nobody gains access.
--
-- THE READ PATHS, all of them: the table's select policy; `can_access_message` (reports); `can_read_attached_message`
-- (receipts, read marking, attachment rows); `can_post_to_message` (reactions, replies); and the storage policy for
-- the files themselves, whose path names the fixture rather than the conversation.
--
-- A CONVERSATION IS SERVER-OWNED. A side's manager could write `fixtures.conversation_id` -- or `mirror_fixture_id`,
-- which copies another fixture's conversation -- directly through the table, and so join any conversation whose id
-- or fixture id they knew. No client writes either column; both are now refused to a browser session.
-- =====================================================================================================================

-- THE MODEL'S PRECONDITIONS, checked before anything is recorded. Every fixture message knows its conversation (a
-- NULL one would fall back to the fixture's current sides), and no conversation is shared by fixtures with different
-- opposing pairs (its parties would be a mixed audience). Both hold in production today (read-only check, 8 Oct
-- 2026: 0 and 0); if either ever does not, the migration stops rather than guessing.
do $$
declare v_n int;
begin
  select count(*) into v_n from public.fixture_messages where fixture_id is not null and conversation_id is null;
  if v_n > 0 then
    raise exception '% fixture message(s) have no conversation; resolve them before recording conversation parties.', v_n;
  end if;
  select count(*) into v_n from (
    select conversation_id from public.fixtures where conversation_id is not null
     group by conversation_id
    having count(distinct internal.fixture_opponent_key(owning_team_id, opponent_team_id, opponent_directory_id,
                                                        opponent_team_display_name_snapshot, raw_opposition_text)) > 1
  ) x;
  if v_n > 0 then
    raise exception '% conversation(s) are shared by fixtures with different opposing sides; resolve them first.', v_n;
  end if;
end $$;

create table if not exists internal.fixture_conversation_parties (
  conversation_id uuid not null,
  team_id uuid not null references public.teams(id) on delete cascade,
  recorded_at timestamptz not null default now(),
  primary key (conversation_id, team_id)
);
alter table internal.fixture_conversation_parties enable row level security;
revoke all on internal.fixture_conversation_parties from public, anon, authenticated;

insert into internal.fixture_conversation_parties (conversation_id, team_id)
select distinct x.conversation_id, x.team_id
  from (
    select f.conversation_id, f.owning_team_id as team_id from public.fixtures f
    union all
    select f.conversation_id, f.opponent_team_id from public.fixtures f
  ) x
 where x.conversation_id is not null and x.team_id is not null
on conflict do nothing;

create or replace function internal.record_fixture_conversation_parties()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if new.conversation_id is not null then
    insert into internal.fixture_conversation_parties (conversation_id, team_id)
    select new.conversation_id, t.team_id
      from (values (new.owning_team_id), (new.opponent_team_id)) as t(team_id)
     where t.team_id is not null
    on conflict do nothing;
  end if;
  return new;
end;
$function$;
revoke all on function internal.record_fixture_conversation_parties() from public, anon, authenticated;

drop trigger if exists record_fixture_conversation_parties on public.fixtures;
create trigger record_fixture_conversation_parties
  after insert or update of conversation_id, owning_team_id, opponent_team_id on public.fixtures
  for each row execute function internal.record_fixture_conversation_parties();

-- Runs FIRST among the BEFORE triggers (named to sort ahead of assign_fixture_conversation_by_opponent), so it sees
-- what the CLIENT asked for, before the server's own triggers set the conversation. SECURITY INVOKER on purpose:
-- `current_user` must be the caller's role, so a browser session is refused and the server's own definer
-- functions, which run as the owner, are not.
create or replace function internal.enforce_fixture_conversation_server_owned()
 returns trigger
 language plpgsql
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
begin
  if current_user = 'authenticated' and (new.conversation_id is distinct from old.conversation_id
                                         or new.mirror_fixture_id is distinct from old.mirror_fixture_id) then
    raise exception 'A fixture''s conversation is decided by Ovalball, not set directly.' using errcode = '42501';
  end if;
  return new;
end;
$function$;
revoke all on function internal.enforce_fixture_conversation_server_owned() from public, anon;

drop trigger if exists a_fixture_conversation_is_server_owned on public.fixtures;
create trigger a_fixture_conversation_is_server_owned
  before update on public.fixtures
  for each row execute function internal.enforce_fixture_conversation_server_owned();

/** Am I a party to this fixture conversation: participation authority for one of the teams it was between. */
create or replace function internal.is_fixture_conversation_party(p_conversation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select p_conversation_id is not null and (
    internal.has_site_capability('site.messages.moderate')
    or exists (
      select 1 from internal.fixture_conversation_parties pt
      join public.teams t on t.id = pt.team_id
      where pt.conversation_id = p_conversation_id
        and (internal.can('messaging.fixture_conversation.participate', 'team', t.club_id, t.id, null)
             or internal.can('messaging.fixture_conversation.participate', 'club', t.club_id, null, null))
    ));
$function$;
revoke all on function internal.is_fixture_conversation_party(uuid) from public, anon;
-- Evaluated inside the message select policy, i.e. as the signed-in reader: it must be executable by them.
grant execute on function internal.is_fixture_conversation_party(uuid) to authenticated;

/** Is this fixture message in its fixture's CURRENT conversation (or not a fixture-thread message at all)? */
create or replace function internal.fixture_message_in_current_thread(p_fixture_id uuid, p_conversation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select p_fixture_id is null
      or p_conversation_id is null
      or p_conversation_id is not distinct from (select f.conversation_id from public.fixtures f where f.id = p_fixture_id);
$function$;
revoke all on function internal.fixture_message_in_current_thread(uuid, uuid) from public, anon;
grant execute on function internal.fixture_message_in_current_thread(uuid, uuid) to authenticated;

/**
 * May this message, from a fixture, request or club thread, be read? In its fixture's current conversation (and for
 * every request or club message) the check it always had. From an EARLIER conversation of its fixture: the people
 * that conversation was between -- its parties -- and moderators, whoever the fixture is played against now.
 */
create or replace function internal.fixture_message_readable(
  p_fixture_id uuid, p_fixture_request_id uuid, p_club_conversation_id uuid, p_conversation_id uuid)
 returns boolean
 language sql
 stable
 security definer
 set search_path to 'public', 'internal', 'pg_temp'
as $function$
  select case
    when p_club_conversation_id is not null or internal.fixture_message_in_current_thread(p_fixture_id, p_conversation_id)
      then internal.can_access_any_conversation(p_fixture_id, p_fixture_request_id, p_club_conversation_id)
    else internal.is_fixture_conversation_party(p_conversation_id)
  end;
$function$;
revoke all on function internal.fixture_message_readable(uuid, uuid, uuid, uuid) from public, anon;
-- Evaluated inside the message select policy, i.e. as the signed-in reader: it must be executable by them.
grant execute on function internal.fixture_message_readable(uuid, uuid, uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------------------------------------------------
-- THE READ PATHS. Each keeps its existing body; a fixture message additionally has to be in reach.
-- ---------------------------------------------------------------------------------------------------------------------
drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages
for select
using (
  ((((fixture_id is not null) or (fixture_request_id is not null) or (club_conversation_id is not null))
     and internal.fixture_message_readable(fixture_id, fixture_request_id, club_conversation_id, conversation_id))
   or ((team_conversation_id is not null) and internal.can_view_team_conversation(team_conversation_id))
   or ((safeguarding_conversation_id is not null) and internal.can_view_safeguarding_conversation(safeguarding_conversation_id))
   or ((announcement_id is not null) and internal.can_view_announcement_reply(announcement_id, sender_user_id))
   or ((direct_conversation_id is not null) and internal.can_view_direct_conversation(direct_conversation_id)))
);

CREATE OR REPLACE FUNCTION internal.can_access_message(p_message fixture_messages)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
begin
  if p_message.club_conversation_id is not null then
    return internal.can_access_any_conversation(null, null, p_message.club_conversation_id);

  elsif p_message.team_conversation_id is not null then
    return internal.can_view_team_conversation(p_message.team_conversation_id);

  elsif p_message.safeguarding_conversation_id is not null then
    return internal.can_view_safeguarding_conversation(p_message.safeguarding_conversation_id);

  -- An announcement reply is visible to the recipient who wrote it and to
  -- the sending side; either may report what they can see.
  elsif p_message.announcement_id is not null then
    return internal.is_announcement_recipient(p_message.announcement_id)
        or internal.is_announcement_sender(p_message.announcement_id);

  elsif p_message.direct_conversation_id is not null then
    return internal.can_view_direct_conversation(p_message.direct_conversation_id);
  end if;

  -- A fixture message is the case with no distinguishing column set, and
  -- keeps the predicate it always had.
  return internal.fixture_message_readable(
    p_message.fixture_id,
    p_message.fixture_request_id,
    null,
    p_message.conversation_id
  );
end;
$function$;

CREATE OR REPLACE FUNCTION internal.can_read_attached_message(p_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
  select exists (
    select 1 from public.fixture_messages m
    where m.id = p_message_id
      and (
        (m.direct_conversation_id is not null and internal.can_view_direct_conversation(m.direct_conversation_id))
        or (m.direct_conversation_id is null
            and internal.fixture_message_readable(m.fixture_id, m.fixture_request_id, m.club_conversation_id, m.conversation_id))
      )
  )
$function$;

CREATE OR REPLACE FUNCTION internal.can_post_to_message(p_message_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'internal', 'pg_temp'
AS $function$
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
            and internal.fixture_message_in_current_thread(m.fixture_id, m.conversation_id)
            and (m.club_conversation_id is null
                 or (select cc.status from public.club_conversations cc where cc.id = m.club_conversation_id) = 'accepted'))
      )
  )
$function$;

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
  v_attached_message uuid;
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
  -- A STORED FILE IS READ AS ITS MESSAGE IS READ. The path names the fixture, and the fixture's current sides are
  -- not necessarily the sides of the conversation the file was sent in; once the file belongs to a message, that
  -- message decides -- in both directions: a newly assigned opponent cannot, and the conversation's own parties
  -- still can. Only a file not yet attached to a message (an upload in progress) falls back to the target.
  if not p_write then
    select a.message_id into v_attached_message from public.fixture_message_attachments a
     where a.storage_path = p_object_name limit 1;
    if v_attached_message is not null then
      return internal.can_read_attached_message(v_attached_message);
    end if;
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

-- A REPLY STAYS IN ITS OWN THREAD. A reply already had to name a parent in the same fixture; it now also has to name
-- one in that fixture's CURRENT conversation, so a message from a thread the fixture has left cannot be quoted into
-- the new one (it would not disclose the old text, but it would tie the two threads together).
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
     or v_parent.direct_conversation_id is distinct from new.direct_conversation_id
     or not internal.fixture_message_in_current_thread(v_parent.fixture_id, v_parent.conversation_id) then
    raise exception 'You can only reply to a message in this conversation.' using errcode = '22023';
  end if;
  return new;
end;
$function$;
