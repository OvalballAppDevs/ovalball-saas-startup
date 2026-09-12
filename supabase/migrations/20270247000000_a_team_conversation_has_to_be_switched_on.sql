-- =====================================================================
-- A TEAM CONVERSATION HAS TO BE SWITCHED ON
--
-- team_conversations has existed since the community work: one row per team,
-- an `active` flag defaulting to FALSE, RLS that already understands
-- guardians, adult players and the guardian permissions
-- 'view_team_conversation' and 'send_team_messages'. It is correct, and it
-- has no rows, because nothing has ever been able to create one.
--
-- This activates it. Two things were missing.
--
-- FIRST, a way to turn it on. The write policy on the table names the
-- capability, but a client cannot insert a row it cannot construct, and
-- "switch on the team conversation" is a decision with a date and a person
-- attached, not a checkbox. Hence an RPC that records both.
--
-- SECOND -- and this is a defect, not a gap -- can_send_team_conversation
-- returns TRUE for staff BEFORE it checks whether the conversation is
-- active:
--
--     if is_site_admin() or can_manage_team() or can_manage_club_fixtures()
--       then return true;               <-- here
--     select active ... if not active then return false;
--
-- So a coach could post into a team conversation that had never been
-- switched on. The messages would be stored, and the families -- who fail
-- the same `active` check on the way in -- would never see them. A coach
-- telling a team something and it reaching nobody is worse than the feature
-- being absent, because it looks like it worked.
--
-- Both predicates are rewritten below to establish the conversation is
-- available BEFORE asking who the caller is. Staff authority decides whether
-- you may speak in a conversation; it does not conjure one into existence.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. SWITCHING IT ON, AND OFF
-- ---------------------------------------------------------------------
create or replace function public.set_team_conversation_active(
  p_team_id uuid,
  p_active boolean
)
returns void
language plpgsql
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_club_id uuid;
  v_policy record;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.' using errcode = '42501';
  end if;

  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  -- The SAME capability the table's own write policy names. Not a new
  -- authority, and not a wider one.
  if not (internal.has_capability('team.community.manage', 'team', v_club_id, p_team_id)
          or internal.has_capability('team.community.manage', 'club', v_club_id, null)
          or internal.is_full_site_admin()) then
    raise exception 'You are not authorised to manage this team''s conversation.' using errcode = '42501';
  end if;

  -- Turning it ON is subject to the feature policy; turning it OFF never is.
  -- A club that has switched team conversations off must still be able to
  -- close one that is already running.
  if p_active then
    select * into v_policy from public.get_effective_message_policy(v_club_id);
    if not coalesce(v_policy.allow_team_conversations, true) then
      raise exception 'Team conversations are turned off.' using errcode = '42501';
    end if;
  end if;

  insert into public.team_conversations (team_id, active, enabled_by, enabled_at)
  values (p_team_id, p_active,
          case when p_active then auth.uid() end,
          case when p_active then now() end)
  on conflict (team_id) do update set
    active = excluded.active,
    enabled_by  = case when p_active then auth.uid() else public.team_conversations.enabled_by end,
    enabled_at  = case when p_active then now()      else public.team_conversations.enabled_at end,
    disabled_by = case when p_active then null       else auth.uid() end,
    disabled_at = case when p_active then null       else now() end,
    updated_at = now();
end;
$$;

comment on function public.set_team_conversation_active(uuid, boolean) is
  'Switches a team''s standing conversation on or off, recording who decided and when. Turning it on respects the club''s messaging policy; turning it off always works, so a club can always close a conversation it has already opened.';

revoke all on function public.set_team_conversation_active(uuid, boolean) from public, anon;
grant execute on function public.set_team_conversation_active(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------
-- 2. THE ORDER OF THE QUESTIONS
-- ---------------------------------------------------------------------
-- Availability first, identity second. Everything below the first block is
-- the existing logic, unchanged.
create or replace function internal.can_send_team_conversation(p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_club_id uuid;
  v_enabled boolean;
  v_linked_player_id uuid;
  v_policy record;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;

  -- IS THERE A CONVERSATION TO SPEAK IN? Asked before who is asking,
  -- because a message nobody can read is not a message.
  select active into v_enabled from public.team_conversations where team_id = p_team_id;
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  select * into v_policy from public.get_effective_message_policy(v_club_id);
  if not coalesce(v_policy.allow_team_conversations, true) then
    return false;
  end if;

  if internal.is_site_admin() or internal.can_manage_team(p_team_id)
     or internal.can_manage_club_fixtures(v_club_id) then
    return true;
  end if;

  if exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = p_team_id and ptm.status = 'active'
      and internal.is_active_player_guardian(ptm.player_id)
  ) then
    return true;
  end if;

  select ptm.player_id into v_linked_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = p_team_id and ptm.status = 'active' and p.user_id = auth.uid()
  limit 1;

  if v_linked_player_id is null then
    return false;
  end if;

  if coalesce(internal.player_effective_age(v_linked_player_id), -1) >= 18 then
    return true;
  end if;

  -- The canonical guardian permission, unchanged. A young player speaks in
  -- their team's conversation only where their guardian has said they may.
  return internal.guardian_permission_effective(v_linked_player_id, 'send_team_messages');
end;
$$;

comment on function internal.can_send_team_conversation(uuid) is
  'May the caller post in this team''s conversation? Establishes the conversation is switched on and permitted by policy BEFORE considering who is asking -- staff authority governs speaking in a conversation, it does not create one.';

-- Viewing is deliberately NOT given the same policy gate. Switching the
-- feature off stops new messages; it does not retrospectively hide what a
-- team has already said from the staff who are accountable for it.
create or replace function internal.can_view_team_conversation(p_team_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_club_id uuid;
  v_enabled boolean;
  v_linked_player_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;

  -- Staff read the history whether or not the conversation is currently
  -- running, because moderation and accountability outlive the switch.
  if internal.is_site_admin() or internal.can_manage_team(p_team_id)
     or internal.can_manage_club_fixtures(v_club_id) then
    return true;
  end if;

  select active into v_enabled from public.team_conversations where team_id = p_team_id;
  if not coalesce(v_enabled, false) then
    return false;
  end if;

  if exists (
    select 1 from public.player_team_memberships ptm
    where ptm.team_id = p_team_id and ptm.status = 'active'
      and internal.is_active_player_guardian(ptm.player_id)
  ) then
    return true;
  end if;

  select ptm.player_id into v_linked_player_id
  from public.player_team_memberships ptm
  join public.players p on p.id = ptm.player_id
  where ptm.team_id = p_team_id and ptm.status = 'active' and p.user_id = auth.uid()
  limit 1;

  if v_linked_player_id is null then
    return false;
  end if;

  if coalesce(internal.player_effective_age(v_linked_player_id), -1) >= 18 then
    return true;
  end if;

  return internal.guardian_permission_effective(v_linked_player_id, 'view_team_conversation');
end;
$$;

-- ---------------------------------------------------------------------
-- 3. IS IT ON?
-- ---------------------------------------------------------------------
-- One read for the UI, so a screen never has to assemble "switched on AND
-- permitted AND I may speak" from three separate answers and get it wrong.
create or replace function public.team_conversation_state(p_team_id uuid)
returns table (
  active boolean,
  allowed_by_policy boolean,
  may_manage boolean,
  may_send boolean,
  enabled_at timestamptz
)
language plpgsql
stable
security definer
set search_path = public, internal, pg_temp
as $$
declare
  v_club_id uuid;
  v_policy record;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  select * into v_policy from public.get_effective_message_policy(v_club_id);

  return query
  select
    coalesce(tc.active, false),
    coalesce(v_policy.allow_team_conversations, true),
    internal.has_capability('team.community.manage', 'team', v_club_id, p_team_id)
      or internal.has_capability('team.community.manage', 'club', v_club_id, null)
      or internal.is_full_site_admin(),
    internal.can_send_team_conversation(p_team_id),
    tc.enabled_at
  from (select p_team_id as team_id) t
  left join public.team_conversations tc on tc.team_id = t.team_id;
end;
$$;

revoke all on function public.team_conversation_state(uuid) from public, anon;
grant execute on function public.team_conversation_state(uuid) to authenticated;
