-- Safeguarding Officer Foundation, part 3: "Message Safeguarding Officer"
-- (spec section 14) -- reuses the canonical fixture_messages storage
-- exactly as instructed ("do not create a separate safeguarding message
-- store"), following this table's own established, repeated pattern for
-- adding a new conversation kind: a new nullable thread-id column, a
-- widened num_nonnulls CHECK, and (matching the MOST RECENT precedent --
-- team_conversation_id's own addition, not the older club_conversation_id
-- one) a dedicated pair of internal.can_view_*/can_send_* predicates
-- layered into the existing RLS policies as an additional OR-branch,
-- rather than growing internal.can_access_any_conversation's own
-- parameter list yet again.
--
-- club_safeguarding_officer_conversations is a genuine 1:1 (spec section
-- 17's privacy requirement: "must not automatically become visible to...
-- all Club Admins... unless they are legitimate participants") --
-- deliberately NOT club_conversations' own club-wide-role-scoped shape,
-- since that would let every current or future CLUB_ADMIN/FIXTURE_
-- SECRETARY at the club see the officer's messages, not just the specific
-- person who started the conversation.

create table public.club_safeguarding_officer_conversations (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  requester_user_id uuid not null references auth.users(id),
  officer_user_id uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  check (requester_user_id <> officer_user_id)
);

comment on table public.club_safeguarding_officer_conversations is
  'A genuine 1:1 conversation between one specific person and one specific accepted Safeguarding Officer at one club -- never club-wide-role-scoped like club_conversations. Only these two specific people (plus Site Admin) can ever see it (spec section 17).';

-- One conversation per (requester, officer) pair -- reopening "Message
-- Safeguarding Officer" against the same officer finds the existing
-- thread rather than creating a new one each time.
create unique index club_safeguarding_officer_conversations_unique_pair_idx
  on public.club_safeguarding_officer_conversations (requester_user_id, officer_user_id, club_id);

alter table public.club_safeguarding_officer_conversations enable row level security;

create policy club_safeguarding_officer_conversations_select on public.club_safeguarding_officer_conversations
  for select using (internal.is_site_admin() or requester_user_id = auth.uid() or officer_user_id = auth.uid());

create trigger audit_row_change after insert or update or delete on public.club_safeguarding_officer_conversations
  for each row execute function internal.audit_row_change();

-- ============================================================
-- fixture_messages: new thread column + narrowly-scoped access
-- predicates, mirroring team_conversation_id's own precedent exactly.
-- ============================================================
alter table public.fixture_messages add column if not exists safeguarding_conversation_id uuid references public.club_safeguarding_officer_conversations(id);

alter table public.fixture_messages drop constraint if exists fixture_messages_check;
alter table public.fixture_messages add constraint fixture_messages_check
  check (num_nonnulls(fixture_request_id, fixture_id, club_conversation_id, team_conversation_id, safeguarding_conversation_id) = 1);

comment on column public.fixture_messages.safeguarding_conversation_id is
  'Safeguarding Officer 1:1 scope -- reuses the existing message/report/moderation/tombstone columns on this same table rather than a parallel messaging system (spec section 14).';

create or replace function internal.can_view_safeguarding_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select internal.is_site_admin() or exists (
    select 1 from public.club_safeguarding_officer_conversations c
    where c.id = p_conversation_id and (c.requester_user_id = auth.uid() or c.officer_user_id = auth.uid())
  );
$$;

-- Sending requires the same 1:1 participancy AND (for the requester side)
-- that they still legitimately hold club.safeguarding.message at that
-- club -- a revoked Club Admin cannot keep messaging through a stale
-- conversation row. The officer's own side never needs a capability
-- check to REPLY in a conversation they are already a real participant
-- of -- exactly mirroring can_send_team_conversation's own reasoning
-- (participancy, not a capability, gates ordinary sending once a
-- conversation legitimately exists).
create or replace function internal.can_send_safeguarding_conversation(p_conversation_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.club_safeguarding_officer_conversations c
    where c.id = p_conversation_id
      and (
        (c.officer_user_id = auth.uid())
        or (c.requester_user_id = auth.uid() and internal.has_capability('club.safeguarding.message', 'club', c.club_id))
      )
  );
$$;

revoke all on function internal.can_view_safeguarding_conversation(uuid) from public, anon;
revoke all on function internal.can_send_safeguarding_conversation(uuid) from public, anon;
grant execute on function internal.can_view_safeguarding_conversation(uuid) to authenticated;
grant execute on function internal.can_send_safeguarding_conversation(uuid) to authenticated;

drop policy if exists fixture_messages_select_scoped on public.fixture_messages;
create policy fixture_messages_select_scoped on public.fixture_messages
  for select using (
    internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
    or (team_conversation_id is not null and internal.can_view_team_conversation(team_conversation_id))
    or (safeguarding_conversation_id is not null and internal.can_view_safeguarding_conversation(safeguarding_conversation_id))
  );

drop policy if exists fixture_messages_insert_scoped on public.fixture_messages;
create policy fixture_messages_insert_scoped on public.fixture_messages
  for insert with check (
    sender_user_id = auth.uid()
    and (
      (team_conversation_id is not null and internal.can_send_team_conversation(team_conversation_id))
      or (safeguarding_conversation_id is not null and internal.can_send_safeguarding_conversation(safeguarding_conversation_id))
      or (
        team_conversation_id is null and safeguarding_conversation_id is null
        and internal.can_access_any_conversation(fixture_id, fixture_request_id, club_conversation_id)
        and (club_conversation_id is null or (select status from public.club_conversations where id = fixture_messages.club_conversation_id) = 'accepted')
      )
    )
  );

-- ============================================================
-- start_or_get_safeguarding_officer_conversation -- the one entry point
-- (spec section 14): finds or creates the 1:1 conversation and inserts
-- the first message. Requires club.safeguarding.message at the named
-- club, and that the target really is that club's currently ACTIVE
-- officer (never an arbitrary user id).
-- ============================================================
create or replace function public.start_or_get_safeguarding_officer_conversation(
  p_club_id uuid, p_officer_id uuid, p_first_message text
)
returns table (conversation_id uuid, is_new boolean)
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_officer_user_id uuid;
  v_conversation_id uuid;
  v_is_new boolean := false;
begin
  if not internal.has_capability('club.safeguarding.message', 'club', p_club_id) then
    raise exception 'Not authorized to message this club''s Safeguarding Officer.' using errcode = '42501';
  end if;
  if coalesce(trim(p_first_message), '') = '' then
    raise exception 'A message is required.';
  end if;

  select user_id into v_officer_user_id
  from public.club_safeguarding_officers
  where id = p_officer_id and club_id = p_club_id and status = 'active';

  if v_officer_user_id is null then
    raise exception 'This club has no active, registered Safeguarding Officer to message on Ovalball -- use the email fallback instead.' using errcode = '22023';
  end if;
  if v_officer_user_id = auth.uid() then
    raise exception 'You cannot message yourself.';
  end if;

  select id into v_conversation_id
  from public.club_safeguarding_officer_conversations
  where requester_user_id = auth.uid() and officer_user_id = v_officer_user_id and club_id = p_club_id;

  if v_conversation_id is null then
    insert into public.club_safeguarding_officer_conversations (club_id, requester_user_id, officer_user_id)
    values (p_club_id, auth.uid(), v_officer_user_id)
    returning id into v_conversation_id;
    v_is_new := true;
  end if;

  insert into public.fixture_messages (safeguarding_conversation_id, sender_user_id, body)
  values (v_conversation_id, auth.uid(), trim(p_first_message));

  return query select v_conversation_id, v_is_new;
end;
$$;

revoke all on function public.start_or_get_safeguarding_officer_conversation(uuid, uuid, text) from public, anon;
grant execute on function public.start_or_get_safeguarding_officer_conversation(uuid, uuid, text) to authenticated;

-- ============================================================
-- send_safeguarding_officer_message -- reply into an existing thread
-- (either side). RLS (fixture_messages_insert_scoped, via
-- can_send_safeguarding_conversation above) is the real boundary; this
-- RPC exists only to give a clean, explicit call site symmetrical with
-- start_or_get_* rather than requiring the client to know fixture_
-- messages' own multi-kind shape.
-- ============================================================
create or replace function public.send_safeguarding_officer_message(p_conversation_id uuid, p_body text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not internal.can_send_safeguarding_conversation(p_conversation_id) then
    raise exception 'Not authorized to send into this conversation.' using errcode = '42501';
  end if;
  if coalesce(trim(p_body), '') = '' then
    raise exception 'A message is required.';
  end if;

  insert into public.fixture_messages (safeguarding_conversation_id, sender_user_id, body)
  values (p_conversation_id, auth.uid(), trim(p_body))
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.send_safeguarding_officer_message(uuid, text) from public, anon;
grant execute on function public.send_safeguarding_officer_message(uuid, text) to authenticated;
