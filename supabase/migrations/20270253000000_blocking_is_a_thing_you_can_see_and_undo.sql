-- =====================================================================
-- BLOCKING IS A THING YOU CAN SEE AND UNDO
--
-- 20270241000000 built the personal-block domain: user_message_blocks,
-- internal.is_personally_blocked, block_user/unblock_user, and the trigger
-- that closes the participant-add bypass. All of it is proven and none of it
-- changes here.
--
-- What it could not do is show a person the blocks they have made. RLS on
-- user_message_blocks exposes the blocker's own rows -- correctly, since
-- reading "blocks against me" would tell somebody they had been blocked --
-- but those rows are ids. public.profiles is readable only by yourself or a
-- Site Admin, so a client-side join is impossible, and it should stay
-- impossible: a person managing their blocks must not be handed a route into
-- the user directory.
--
-- Hence one narrow resolver. It answers exactly one question -- "what are the
-- names of the people I currently block?" -- and it can return nothing else,
-- because the only ids it will resolve are ones the caller's own live block
-- rows name. It enumerates no directory, and it is useless to anybody who
-- has blocked nobody.
--
-- THE SECOND CHANGE IS ASYMMETRIC ON PURPOSE
--
-- list_addable_club_members offers people to add to a fixture conversation.
-- The participant-add trigger already refuses a blocked pairing, so the
-- server is safe -- but the picker still offers the row, the person clicks
-- Add, and the refusal arrives as an error. That is a bad experience in one
-- direction and a privacy leak in the other, and the two directions need
-- opposite treatment:
--
--   I BLOCKED THEM      keep the row, flag it. Telling me about my own
--                       decision reveals nothing I do not already know, and
--                       silently dropping them would look like a bug.
--
--   THEY BLOCKED ME     omit the row entirely. No flag, no disabled state,
--                       no "unavailable" -- any of which would let me work
--                       out what they had done. They simply are not offered,
--                       which is indistinguishable from not being eligible.
--
-- The trigger remains the guarantee. This only stops the UI walking people
-- into it.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. THE PEOPLE I BLOCK, BY NAME
-- ---------------------------------------------------------------------
create or replace function public.my_blocked_users()
returns table (
  user_id uuid,
  display_name text,
  blocked_at timestamptz
)
language sql
stable
security definer
set search_path = public, internal, pg_temp
as $$
  select
    b.blocked_user_id,
    -- Read as stored. internal.normalise_person_name owns how a name is
    -- spelled; this returns what an export and a screen reader would see.
    nullif(btrim(coalesce(p.first_name, '') || ' ' || coalesce(p.surname, '')), ''),
    b.created_at
  from public.user_message_blocks b
  join public.profiles p on p.id = b.blocked_user_id
  where b.blocker_user_id = auth.uid()
    -- ACTIVE blocks only. A lifted block is history and belongs to the audit
    -- record, not to a screen for managing what is currently in force.
    and b.lifted_at is null
  -- A -> Z, en-GB, accent-insensitive, decided here so every surface that
  -- lists blocks gets the same order without remembering to sort.
  order by nullif(btrim(coalesce(p.surname, '')), '') nulls last,
           nullif(btrim(coalesce(p.first_name, '')), '') nulls last,
           b.blocked_user_id;
$$;

comment on function public.my_blocked_users() is
  'The people the caller currently blocks, by name, A-Z. Resolves only ids named by the caller''s own live block rows, so it can never be used to look anybody else up. Lifted blocks are excluded: this is what is in force, not what once was.';

revoke all on function public.my_blocked_users() from public, anon;
grant execute on function public.my_blocked_users() to authenticated;

-- ---------------------------------------------------------------------
-- 2. THE PICKER STOPS WALKING PEOPLE INTO THE TRIGGER
-- ---------------------------------------------------------------------
-- Dropped and recreated because the return type grows by one column. The
-- existing columns keep their names, order and meaning.
drop function if exists public.list_addable_club_members(uuid, uuid);

create function public.list_addable_club_members(
  p_fixture_id uuid,
  p_fixture_request_id uuid
)
returns table (
  user_id uuid,
  name text,
  blocked_by_me boolean
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_owning_team_id uuid;
  v_opponent_team_id uuid;
  v_my_club_id uuid;
begin
  if not internal.can_access_fixture_conversation(p_fixture_id, p_fixture_request_id) then
    return;
  end if;

  if p_fixture_id is not null then
    select f.owning_team_id, f.opponent_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixtures f where f.id = p_fixture_id;
  else
    select r.requesting_team_id, r.recipient_team_id into v_owning_team_id, v_opponent_team_id
    from public.fixture_requests r where r.id = p_fixture_request_id;
  end if;

  select cm.club_id into v_my_club_id
  from public.club_memberships cm
  join public.teams t on t.club_id = cm.club_id
  where cm.user_id = auth.uid() and cm.status = 'active'
    and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
    and t.id in (v_owning_team_id, v_opponent_team_id)
  limit 1;

  if v_my_club_id is null then
    select t.club_id into v_my_club_id
    from public.team_permissions tp
    join public.club_memberships cm on cm.id = tp.membership_id and cm.user_id = auth.uid() and cm.status = 'active'
    join public.teams t on t.id = tp.team_id and t.id in (v_owning_team_id, v_opponent_team_id)
    limit 1;
  end if;

  if v_my_club_id is null then
    return;
  end if;

  return query
    select distinct p.id,
           p.first_name || ' ' || p.surname,
           -- MY OWN DECISION, safe to show me.
           exists (
             select 1 from public.user_message_blocks b
             where b.blocker_user_id = auth.uid()
               and b.blocked_user_id = p.id
               and b.lifted_at is null
           )
    from public.club_memberships cm
    join public.profiles p on p.id = cm.user_id
    where cm.club_id = v_my_club_id and cm.status = 'active'
      and (
        cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
        or exists (
          select 1 from public.team_permissions tp
          where tp.membership_id = cm.id
            and tp.permission in ('team_admin', 'coach', 'manager')
            and tp.team_id in (v_owning_team_id, v_opponent_team_id)
        )
      )
      -- THEIR DECISION, never shown to me. Omitted rather than disabled:
      -- a disabled row with any reason at all is still an answer.
      and not exists (
        select 1 from public.user_message_blocks b
        where b.blocker_user_id = p.id
          and b.blocked_user_id = auth.uid()
          and b.lifted_at is null
      )
    order by 2;
end;
$$;

comment on function public.list_addable_club_members(uuid, uuid) is
  'Own-club operational contacts who may be added to this fixture conversation. Someone the caller has blocked is returned flagged; someone who has blocked the caller is omitted entirely, because a disabled row would itself disclose their decision.';

revoke all on function public.list_addable_club_members(uuid, uuid) from public, anon;
grant execute on function public.list_addable_club_members(uuid, uuid) to authenticated;
