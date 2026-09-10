-- ===========================================================================
-- A TEAM ADMIN CAN MODERATE THEIR OWN FIXTURE'S CONVERSATION
-- ===========================================================================
--
-- Fixture messages already carry everything moderation needs: reported_at /
-- reported_by / report_reason / report_status, and deleted_at / deleted_by /
-- deleted_by_role. public.report_fixture_message and
-- public.soft_delete_own_message already exist and are unchanged here.
--
-- What did not exist is the club's own authority over its own conversation.
-- public.moderator_delete_message is Full Site Admin or Message Moderator
-- only, which is correct for a platform-wide safety review and useless to the
-- coach standing on the touchline when something is posted in their fixture
-- thread at nine on a Saturday morning. Escalating every such message to
-- Anthropic-side moderation is not a safeguarding policy, it is a delay.
--
-- Two additions, both scoped to the fixture the actor already manages:
--
--   1. delete a message in a fixture they hold fixture-management capability
--      on. SOFT delete, exactly like every other delete path here -- the row
--      stays, with who removed it and in what role, because a deleted message
--      is often the evidence in the thing it was deleted for.
--
--   2. block a person from POSTING in that club's fixture conversations.
--
-- WHY BLOCKING IS CLUB-SCOPED AND NOT FIXTURE-SCOPED. A block confined to one
-- fixture is not a block: the same person posts in next Saturday's thread
-- instead, and a coach has to do it again every week. It is also not
-- platform-wide, because one club's judgement about one person is not
-- Ovalball's judgement about them -- they may play for another club entirely,
-- and a club cannot silence somebody outside its own conversations.
--
-- WHAT A BLOCK DOES NOT DO. It does not hide the person, remove them from a
-- squad, revoke their attendance response, stop them RECEIVING messages, or
-- affect safeguarding conversations, which exist precisely so a concern can
-- still be raised. It stops them posting into fixture threads at that club.
-- A block that silently cut somebody off from raising a concern would be a
-- safeguarding failure wearing a moderation label.
-- ===========================================================================

create table if not exists public.club_message_blocks (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_by uuid not null references auth.users(id),
  reason text,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id),
  constraint club_message_blocks_reason_length check (reason is null or char_length(reason) <= 500)
);

-- One ACTIVE block per person per club. A lifted block stays as history, so a
-- club can see that somebody was blocked before and by whom.
create unique index if not exists club_message_blocks_active_uniq
  on public.club_message_blocks (club_id, blocked_user_id)
  where lifted_at is null;

comment on table public.club_message_blocks is
  'People a club has stopped from POSTING in its fixture conversations. Scoped to one club: a block is that club''s judgement about its own threads, never a platform-wide silencing, and never applied to safeguarding conversations, which must stay open so a concern can still be raised.';

alter table public.club_message_blocks enable row level security;

-- ---------------------------------------------------------------------------
-- Is this person blocked from posting for this club?
-- ---------------------------------------------------------------------------
create or replace function internal.is_message_blocked(p_user_id uuid, p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1 from public.club_message_blocks b
    where b.blocked_user_id = p_user_id
      and b.club_id = p_club_id
      and b.lifted_at is null
  );
$$;

revoke all on function internal.is_message_blocked(uuid, uuid) from public;
grant execute on function internal.is_message_blocked(uuid, uuid) to authenticated;

-- Both clubs involved in a fixture. A block by EITHER side stops the person
-- posting in that fixture's thread, because the thread is shared and a club
-- cannot be made to host a message it has barred.
create or replace function internal.fixture_club_ids(p_fixture_id uuid)
returns table (club_id uuid)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select distinct t.club_id
  from public.fixtures f
  join public.teams t on t.id in (f.owning_team_id, f.opponent_team_id)
  where f.id = p_fixture_id and t.club_id is not null;
$$;

revoke all on function internal.fixture_club_ids(uuid) from public;

-- ---------------------------------------------------------------------------
-- Posting: blocked people cannot
-- ---------------------------------------------------------------------------
--
-- Enforced by a TRIGGER rather than only in an RPC, because the Match Centre
-- posts by inserting into fixture_messages directly under RLS. A check that
-- only lived in one server action would be bypassed by the next caller that
-- inserts the same row a different way.
create or replace function internal.enforce_message_block()
returns trigger
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  -- Only fixture threads. A safeguarding conversation is deliberately exempt:
  -- somebody a club has blocked must still be able to raise a concern.
  if new.fixture_id is not null and new.safeguarding_conversation_id is null then
    if exists (
      select 1
      from internal.fixture_club_ids(new.fixture_id) c
      where internal.is_message_blocked(new.sender_user_id, c.club_id)
    ) then
      raise exception 'You are not able to post in this conversation.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists enforce_message_block on public.fixture_messages;
create trigger enforce_message_block
  before insert on public.fixture_messages
  for each row execute function internal.enforce_message_block();

-- ---------------------------------------------------------------------------
-- Club-side moderation actions
-- ---------------------------------------------------------------------------

create or replace function public.team_delete_fixture_message(p_message_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  m public.fixture_messages;
begin
  select * into m from public.fixture_messages where id = p_message_id;
  if not found then
    raise exception 'Message not found.';
  end if;
  if m.fixture_id is null then
    raise exception 'This message is not part of a fixture conversation.' using errcode = '42501';
  end if;
  -- The SAME capability that governs everything else a staff member may do to
  -- this fixture. No new authority, and no role-name check.
  if not internal.can_manage_fixture_side(
        (select owning_team_id from public.fixtures where id = m.fixture_id),
        (select owning_scheduling_group_id from public.fixtures where id = m.fixture_id))
     and not internal.can_manage_fixture_side(
        (select opponent_team_id from public.fixtures where id = m.fixture_id),
        (select opponent_scheduling_group_id from public.fixtures where id = m.fixture_id))
     and not internal.is_site_admin() then
    raise exception 'You are not authorised to remove messages in this fixture.' using errcode = '42501';
  end if;

  -- Soft delete. The row and its author survive, because a removed message is
  -- frequently the evidence for the thing it was removed over.
  update public.fixture_messages
  set deleted_at = now(), deleted_by = auth.uid(), deleted_by_role = 'team_admin'
  where id = p_message_id and deleted_at is null;
end;
$$;

revoke all on function public.team_delete_fixture_message(uuid) from public;
grant execute on function public.team_delete_fixture_message(uuid) to authenticated;

comment on function public.team_delete_fixture_message is
  'Removes a message from a fixture conversation the caller holds fixture-management capability on. Soft delete, recorded against the actor with deleted_by_role = team_admin. Deliberately separate from moderator_delete_message, which is the platform-wide Site Admin/Message Moderator path and stays as it is.';

create or replace function public.block_user_from_club_messages(p_club_id uuid, p_user_id uuid, p_reason text default null)
returns uuid
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  -- 'fixture.edit' at CLUB scope is the real, existing fixture-management
  -- authority (CLUB_ADMIN and FIXTURE_SECRETARY hold it). A capability key
  -- that does not exist in role_capability_defaults would make has_capability
  -- return false for everybody -- fail-closed, but permanently broken and
  -- silently so.
  if not (internal.has_capability('fixture.edit', 'club', p_club_id, null) or internal.is_site_admin()) then
    raise exception 'You are not authorised to block someone from this club''s conversations.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot block yourself.';
  end if;
  -- Blocking somebody who could block you back is a moderation fight, not
  -- moderation. Club-level authority is settled by a Club Admin, not in a
  -- message thread.
  if internal.has_capability('fixture.edit', 'club', p_club_id, null) then
    if exists (
      select 1 from public.club_memberships cm
      where cm.user_id = p_user_id and cm.club_id = p_club_id and cm.role = 'CLUB_ADMIN' and cm.status = 'active'
    ) and not internal.is_site_admin() then
      raise exception 'A Club Admin cannot be blocked from their own club''s conversations.' using errcode = '42501';
    end if;
  end if;

  insert into public.club_message_blocks (club_id, blocked_user_id, blocked_by, reason)
  values (p_club_id, p_user_id, auth.uid(), nullif(btrim(coalesce(p_reason, '')), ''))
  on conflict (club_id, blocked_user_id) where lifted_at is null do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from public.club_message_blocks
    where club_id = p_club_id and blocked_user_id = p_user_id and lifted_at is null;
  end if;
  return v_id;
end;
$$;

revoke all on function public.block_user_from_club_messages(uuid, uuid, text) from public;
grant execute on function public.block_user_from_club_messages(uuid, uuid, text) to authenticated;

create or replace function public.lift_club_message_block(p_club_id uuid, p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if not (internal.has_capability('fixture.edit', 'club', p_club_id, null) or internal.is_site_admin()) then
    raise exception 'You are not authorised to change this club''s message blocks.' using errcode = '42501';
  end if;
  update public.club_message_blocks
  set lifted_at = now(), lifted_by = auth.uid()
  where club_id = p_club_id and blocked_user_id = p_user_id and lifted_at is null;
end;
$$;

revoke all on function public.lift_club_message_block(uuid, uuid) from public;
grant execute on function public.lift_club_message_block(uuid, uuid) to authenticated;

-- Staff of the club may read their own club's blocks; nobody else can read
-- them at all. A block list is a list of people a club has had a problem with,
-- and it is not published to the people on it or to anybody else.
drop policy if exists club_message_blocks_select_staff on public.club_message_blocks;
create policy club_message_blocks_select_staff on public.club_message_blocks
  for select to authenticated
  using (internal.has_capability('fixture.edit', 'club', club_id, null) or internal.is_site_admin());

-- ---------------------------------------------------------------------------
-- Which club is the caller acting FOR, on this fixture?
-- ---------------------------------------------------------------------------
--
-- The browser must never send a club id to a blocking action. A club id in
-- that signature is a parameter an attacker can aim at a club they have
-- nothing to do with, leaving the capability check as the only thing between
-- them and it. Resolving it here from the fixture and the caller's own
-- authority means there is nothing to aim: the answer is either the club they
-- genuinely manage on this fixture, or null.
--
-- Where somebody manages BOTH sides -- a Site Admin, or a club playing itself
-- in an internal fixture -- the owning side is chosen, deterministically,
-- rather than whichever row came back first.
create or replace function public.resolve_blocking_club_for_fixture(p_fixture_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  f public.fixtures;
  v_owning_club uuid;
  v_opponent_club uuid;
begin
  if auth.uid() is null then
    return null;
  end if;
  select * into f from public.fixtures where id = p_fixture_id;
  if not found then
    return null;
  end if;

  select club_id into v_owning_club from public.teams where id = f.owning_team_id;
  select club_id into v_opponent_club from public.teams where id = f.opponent_team_id;

  if v_owning_club is not null
     and (internal.has_capability('fixture.edit', 'club', v_owning_club, null) or internal.is_site_admin()) then
    return v_owning_club;
  end if;
  if v_opponent_club is not null
     and (internal.has_capability('fixture.edit', 'club', v_opponent_club, null) or internal.is_site_admin()) then
    return v_opponent_club;
  end if;
  return null;
end;
$$;

revoke all on function public.resolve_blocking_club_for_fixture(uuid) from public;
grant execute on function public.resolve_blocking_club_for_fixture(uuid) to authenticated;

comment on function public.resolve_blocking_club_for_fixture is
  'The club the caller may act for when moderating this fixture''s conversation, or null. Exists so no blocking action takes a club id from the browser.';

-- ---------------------------------------------------------------------------
-- 'team_admin' is a legitimate reason a message was removed
-- ---------------------------------------------------------------------------
--
-- deleted_by_role enumerates WHO removed a message, and it enumerated exactly
-- two answers: the sender removed their own, or platform moderation removed
-- it. A club removing something from its own fixture thread is a third, real
-- answer, and it matters which one it was -- "removed by the club" and
-- "removed by Ovalball" are different facts to anybody reviewing the thread
-- afterwards.
--
-- The constraint is EXTENDED to admit that third value, deliberately, rather
-- than dropped. An enumeration that lists the legitimate values is doing its
-- job; the fix for a missing value is to add the value.
alter table public.fixture_messages drop constraint if exists fixture_messages_deleted_by_role_check;
alter table public.fixture_messages
  add constraint fixture_messages_deleted_by_role_check
  check (deleted_by_role = any (array['sender','moderator','team_admin']));
