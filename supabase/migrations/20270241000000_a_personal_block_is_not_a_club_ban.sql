-- =====================================================================
-- A PERSONAL BLOCK IS NOT A CLUB BAN
--
-- Ovalball already has club_message_blocks: a CLUB deciding that a person may
-- not post in its conversations. That is moderation -- an organisation acting
-- on someone -- and it deliberately exempts safeguarding conversations so a
-- banned person can still raise a concern.
--
-- What it is not is a person deciding they do not want to hear from another
-- person. Those are different domains with different authority (the club
-- decides one, the individual decides the other), different scope, and
-- different rules about official communication. Overloading one table with
-- both would mean a club admin could lift somebody's personal block, or a
-- personal block could silence a club. Hence a separate table.
--
-- THE RULE THIS ENCODES
--
-- A personal block stops PEOPLE reaching you. It does not stop ORGANISATIONS
-- reaching you:
--
--   B messages A directly                          blocked
--   B adds A to a conversation to get around it     blocked
--   B sends as the club, to the club's audience      NOT blocked
--   Ovalball announces something to everyone         NOT blocked
--
-- The last two are why sender identity had to exist first. Official
-- communication belongs to the organisation, and a person cannot opt out of
-- their club's safeguarding notice by blocking whoever happens to be the
-- club secretary this season.
--
-- The obvious counter -- an admin using "send as club" to get at somebody
-- personally -- is not solved by the block. It is solved by the fact that
-- sending as an organisation requires real authority, the actor is recorded
-- on every row, and the message remains reportable. Blocking is not a
-- substitute for moderation, and this migration does not pretend it is.
--
-- AND IT IS NOT ANNOUNCED. Nothing here tells the blocked person they were
-- blocked. Discovery of a block is itself a privacy leak: it says something
-- about the blocker's opinion to the one person who should not have it.
-- =====================================================================

create table if not exists public.user_message_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_user_id uuid not null references auth.users(id) on delete cascade,
  blocked_user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Lifted rather than deleted, matching club_message_blocks: "we used to
  -- block this person and stopped" is a different fact from "we never did",
  -- and a moderation investigation may need the difference.
  lifted_at timestamptz,
  lifted_by uuid references auth.users(id),
  constraint user_message_blocks_not_self check (blocker_user_id <> blocked_user_id)
);

-- One live block per pair. A second block while one is already active is the
-- same decision, not a new one.
create unique index if not exists user_message_blocks_active_pair_idx
  on public.user_message_blocks (blocker_user_id, blocked_user_id)
  where lifted_at is null;

create index if not exists user_message_blocks_blocked_idx
  on public.user_message_blocks (blocked_user_id) where lifted_at is null;

comment on table public.user_message_blocks is
  'One person choosing not to be contacted by another. Distinct from club_message_blocks, which is a club moderating someone. Personal blocks stop direct person-to-person contact; they never suppress legitimate organisational communication.';

alter table public.user_message_blocks enable row level security;

-- YOU CAN SEE THE BLOCKS YOU MADE. Deliberately not "blocks against me":
-- being able to read that would tell somebody they had been blocked, which
-- is exactly what must not leak.
drop policy if exists user_message_blocks_select_own on public.user_message_blocks;
create policy user_message_blocks_select_own on public.user_message_blocks
  for select using (blocker_user_id = (select auth.uid()));

drop policy if exists user_message_blocks_insert_own on public.user_message_blocks;
create policy user_message_blocks_insert_own on public.user_message_blocks
  for insert with check (blocker_user_id = (select auth.uid()));

drop policy if exists user_message_blocks_update_own on public.user_message_blocks;
create policy user_message_blocks_update_own on public.user_message_blocks
  for update using (blocker_user_id = (select auth.uid()))
  with check (blocker_user_id = (select auth.uid()));

-- ---------------------------------------------------------------------
-- THE PREDICATE
-- ---------------------------------------------------------------------
-- SECURITY DEFINER because the send path must be able to ask "is the
-- recipient blocking the sender?" -- a question the sender is not allowed to
-- read the answer to directly, and must never be told.
create or replace function internal.is_personally_blocked(
  p_sender_user_id uuid,
  p_recipient_user_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select exists (
    select 1 from public.user_message_blocks b
    where b.blocker_user_id = p_recipient_user_id
      and b.blocked_user_id = p_sender_user_id
      and b.lifted_at is null
  );
$$;

comment on function internal.is_personally_blocked(uuid, uuid) is
  'Is the recipient blocking this sender? Asked by direct/person-to-person send paths only. Organisational communication does not consult it -- see the migration header for why.';

revoke all on function internal.is_personally_blocked(uuid, uuid) from public, anon;

-- ---------------------------------------------------------------------
-- BLOCK AND UNBLOCK
-- ---------------------------------------------------------------------
create or replace function public.block_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot block yourself.';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    -- Deliberately the same message as a real block would produce nothing:
    -- probing this function must not confirm whether an account exists.
    raise exception 'That person could not be blocked.';
  end if;

  insert into public.user_message_blocks (blocker_user_id, blocked_user_id)
  values (auth.uid(), p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function public.unblock_user(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;
  update public.user_message_blocks
  set lifted_at = now(), lifted_by = auth.uid()
  where blocker_user_id = auth.uid() and blocked_user_id = p_user_id and lifted_at is null;
end;
$$;

revoke all on function public.block_user(uuid) from public, anon;
revoke all on function public.unblock_user(uuid) from public, anon;
grant execute on function public.block_user(uuid) to authenticated;
grant execute on function public.unblock_user(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- THE FIRST PLACE IT BITES: PARTICIPANT ADD
-- ---------------------------------------------------------------------
-- §13's "selected-person conversation used solely to circumvent the block".
-- Adding somebody who has blocked you into a conversation with you is the
-- cheapest available bypass, and it is available today, so it is closed
-- today rather than when direct messaging ships.
create or replace function internal.enforce_participant_block()
returns trigger
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
begin
  if internal.is_personally_blocked(auth.uid(), new.user_id) then
    -- Neutral wording. "You have been blocked" would tell the actor
    -- something about the other person's decision.
    raise exception 'That person cannot be added to this conversation.' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists fixture_conversation_participants_block_check on public.fixture_conversation_participants;
create trigger fixture_conversation_participants_block_check
  before insert on public.fixture_conversation_participants
  for each row execute function internal.enforce_participant_block();
