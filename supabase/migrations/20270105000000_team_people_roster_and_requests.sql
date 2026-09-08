-- Team People: who is in this team, what their standing is, and who is waiting.
--
-- The team page could assign a club member a permission, and that was all it
-- knew about people. It could not say who the players were, who their parents
-- and guardians were, whether any of them were still active, or who was waiting
-- to be let in -- so a coach opening their own team saw an empty box and an
-- "Assign an existing club member" dropdown, which is an administrator's tool,
-- not a team's roster.
--
-- Three things are added here, all reads and writes that already had a home in
-- the domain and simply had no team-facing entry point.
--
-- 1. internal.team_people_authority -- one answer to "may this person see this
--    team's people, and may they change it", so the page, the actions and the
--    RLS-backed functions cannot drift apart.
-- 2. public.team_people -- the roster: coaches, parents/guardians and players
--    for one team, each with a real status, resolved once rather than
--    assembled differently by each caller.
-- 3. archive/restore for a player's place in a team. A player who has stopped
--    playing is archived, never deleted: their fixtures, attendance and
--    history all reference the membership.

-- ---------------------------------------------------------------------------
-- 1. Who may look, and who may change
-- ---------------------------------------------------------------------------

create or replace function internal.team_people_authority(p_team_id uuid)
returns table(may_view boolean, may_manage boolean)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_club_id uuid;
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    return query select false, false;
    return;
  end if;

  return query
  select
    -- A coach assigned to this team sees it because they are assigned to it,
    -- not because they happen to hold a club-wide role somewhere.
    internal.has_capability('team.view', 'team', v_club_id, p_team_id)
      or internal.has_capability('team.view', 'club', v_club_id, null),
    internal.has_capability('team.manage', 'team', v_club_id, p_team_id)
      or internal.has_capability('club.teams.manage', 'club', v_club_id, null);
end;
$function$;

comment on function internal.team_people_authority(uuid) is
  'The one answer to "may this person see this team''s people, and may they change it". Viewing is granted at TEAM scope as well as club scope, so a coach reaches their own team''s roster without holding a club-wide role.';

-- ---------------------------------------------------------------------------
-- 2. The roster
-- ---------------------------------------------------------------------------

create or replace function public.team_people(p_team_id uuid)
returns table(
  kind text,               -- 'coach' | 'guardian' | 'player'
  row_id uuid,             -- the row this status belongs to, and what an action addresses
  person_id uuid,          -- profiles.id for a coach or guardian, players.id for a player
  name text,
  detail text,             -- a coach's role, or the player a guardian is here for
  status text,             -- 'active' | 'archived' | 'requested'
  requested_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare v_may_view boolean;
begin
  select a.may_view into v_may_view from internal.team_people_authority(p_team_id) a;
  if not coalesce(v_may_view, false) then
    raise exception 'Not authorized to view this team''s people.' using errcode = '42501';
  end if;

  return query
  -- COACHES. Everyone holding a permission on this team, described by the
  -- permission they hold. Their standing is their club membership's: someone
  -- suspended at the club is not an active coach of one of its teams.
  select
    'coach'::text,
    tp.id,
    cm.user_id,
    coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
    case tp.permission
      when 'team_admin' then 'Team Admin'
      when 'coach' then 'Coach'
      when 'manager' then 'Manager'
      else 'Parent or player access'
    end,
    case when cm.status = 'active' then 'active' else 'archived' end,
    null::timestamptz
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id
  left join public.profiles pr on pr.id = cm.user_id
  where tp.team_id = p_team_id

  union all

  -- PLAYERS. Their place in THIS team, not their existence at the club: a
  -- player archived here may be perfectly active in another side.
  select
    'player'::text,
    ptm.id,
    pl.id,
    coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.surname)), ''), 'Unknown'),
    null::text,
    case ptm.status when 'active' then 'active' when 'pending' then 'requested' else 'archived' end,
    case when ptm.status = 'pending' then ptm.created_at end
  from public.player_team_memberships ptm
  join public.players pl on pl.id = ptm.player_id
  where ptm.team_id = p_team_id

  union all

  -- PARENTS AND GUARDIANS. Reached through the players in this team, which is
  -- the only relationship a team has to them, and de-duplicated: one adult
  -- with two children in the same side is one person on this list.
  select * from (
    select distinct on (g.guardian_user_id)
      'guardian'::text,
      g.id,
      g.guardian_user_id,
      coalesce(nullif(trim(concat_ws(' ', pr.first_name, pr.surname)), ''), 'Unknown'),
      'Parent or guardian of ' || coalesce(nullif(trim(concat_ws(' ', pl.first_name, pl.surname)), ''), 'a player'),
      case when g.status = 'active' then 'active' else 'archived' end,
      null::timestamptz
    from public.guardians g
    join public.players pl on pl.id = g.player_id
    join public.player_team_memberships ptm
      on ptm.player_id = g.player_id and ptm.team_id = p_team_id and ptm.status = 'active'
    left join public.profiles pr on pr.id = g.guardian_user_id
    -- DISTINCT ON needs its own ORDER BY, and it cannot live at the end of a
    -- UNION -- the aliases are out of scope there. An active link wins over an
    -- ended one for the same adult.
    order by g.guardian_user_id, g.status
  ) guardians;
end;
$function$;

comment on function public.team_people(uuid) is
  'One team''s coaches, parents/guardians and players with their real standing. A player''s status is their place in THIS team -- archived here says nothing about another side they may still play for.';

revoke all on function public.team_people(uuid) from public;
grant execute on function public.team_people(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. A player who has stopped playing is archived, never deleted
-- ---------------------------------------------------------------------------

create or replace function public.archive_player_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_status text;
  v_may_manage boolean;
begin
  select team_id, status into v_team_id, v_status
  from public.player_team_memberships where id = p_membership_id;
  if v_team_id is null then
    raise exception 'That player is not in this team.';
  end if;

  select a.may_manage into v_may_manage from internal.team_people_authority(v_team_id) a;
  if not coalesce(v_may_manage, false) then
    raise exception 'Not authorized to change this team''s roster.' using errcode = '42501';
  end if;

  if v_status = 'pending' then
    raise exception 'That is a request to join, not a place in the team. Decline it instead.' using errcode = '23514';
  end if;
  if v_status = 'ended' then
    return; -- Already archived. Saying so twice is not an error.
  end if;

  update public.player_team_memberships
  set status = 'ended', ended_at = now(), updated_by = auth.uid(), updated_at = now()
  where id = p_membership_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_team_memberships', p_membership_id, 'update', auth.uid(),
          jsonb_build_object('status', 'ended', 'reason', 'archived_from_team_people'));
end;
$function$;

comment on function public.archive_player_team_membership(uuid) is
  'Ends a player''s place in one team. Never deletes: fixtures, attendance and selection history all reference the membership, and a player who stopped playing in March still played in February.';

create or replace function public.restore_player_team_membership(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_team_id uuid;
  v_player_id uuid;
  v_status text;
  v_may_manage boolean;
begin
  select team_id, player_id, status into v_team_id, v_player_id, v_status
  from public.player_team_memberships where id = p_membership_id;
  if v_team_id is null then
    raise exception 'That player is not in this team.';
  end if;

  select a.may_manage into v_may_manage from internal.team_people_authority(v_team_id) a;
  if not coalesce(v_may_manage, false) then
    raise exception 'Not authorized to change this team''s roster.' using errcode = '42501';
  end if;

  if v_status <> 'ended' then
    return;
  end if;

  -- A player can hold only one active place in a team. If they were archived
  -- and then re-added by another route, that newer row is the real one.
  if exists (
    select 1 from public.player_team_memberships
    where team_id = v_team_id and player_id = v_player_id and status = 'active'
  ) then
    raise exception 'That player is already in this team.' using errcode = '23505';
  end if;

  update public.player_team_memberships
  set status = 'active', ended_at = null, updated_by = auth.uid(), updated_at = now()
  where id = p_membership_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('player_team_memberships', p_membership_id, 'update', auth.uid(),
          jsonb_build_object('status', 'active', 'reason', 'restored_from_team_people'));
end;
$function$;

comment on function public.restore_player_team_membership(uuid) is
  'Puts an archived player back in the team, refusing if they already hold an active place there.';

revoke all on function public.archive_player_team_membership(uuid) from public;
revoke all on function public.restore_player_team_membership(uuid) from public;
grant execute on function public.archive_player_team_membership(uuid) to authenticated;
grant execute on function public.restore_player_team_membership(uuid) to authenticated;
