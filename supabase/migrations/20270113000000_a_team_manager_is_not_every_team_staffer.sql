-- A Team Manager can accept a player into their own squad. A coach cannot.
--
-- THE DISTINCTION ALREADY EXISTED, AND WAS BEING THROWN AWAY
--
-- team_permissions.permission has four values -- team_admin, coach, manager,
-- view_only -- and internal.has_team_role_capability collapsed the first three
-- into one role key, TEAM_STAFF. So the person who runs the side and the
-- person who takes the warm-up resolved to exactly the same capabilities, and
-- the only way to give a manager roster authority was to give it to every
-- coach, physio and volunteer at the club as well.
--
-- That is why team.roster.manage was granted to nobody: the standing decision
-- recorded in this function's own comment was not "team staff should never
-- manage a roster", it was "we will not hand roster authority to all of
-- them". Both statements are correct, and the way to honour both is to stop
-- flattening the distinction the data already carries.
--
-- WHAT CHANGES
--
--   team_admin, manager  -> TEAM_MANAGER, and gains team.roster.manage
--                           at their OWN team's scope, and nothing else.
--   coach                -> TEAM_STAFF, unchanged in every respect.
--   view_only            -> TEAM_MEMBER, unchanged.
--
-- A Team Manager gains authority over one team's roster. Not another team's,
-- not another club's, not the Team Directory, not payments, not safeguarding
-- records. Every one of those is a different capability at a different scope,
-- and none of them appears below.
--
-- No authorization anywhere reads a display string. TEAM_MANAGER is a role key
-- in the same table every other role key lives in, resolved by the same
-- engine.

-- TEAM_MANAGER has to be admitted to the role catalogue first. The check
-- constraint enumerates the legitimate role keys per scope on purpose -- it is
-- what stops a typo becoming a silent authority -- so a new role is added to
-- it deliberately rather than by loosening it.
alter table public.role_capability_defaults drop constraint role_capability_defaults_role_check;
alter table public.role_capability_defaults add constraint role_capability_defaults_role_check check (
  (scope_type = 'club' and role_key = any (array['CLUB_ADMIN','FIXTURE_SECRETARY','CLUB_MEMBER']))
  or (scope_type = 'team' and role_key = any (array['CLUB_ADMIN','TEAM_MANAGER','TEAM_STAFF','TEAM_MEMBER']))
);

-- A manager is a member of staff who also runs the side, so they hold
-- everything TEAM_STAFF holds. Copying the rows keeps that true without the
-- capability engine having to know about inheritance.
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
select 'team', 'TEAM_MANAGER', d.capability_key
from public.role_capability_defaults d
where d.scope_type = 'team' and d.role_key = 'TEAM_STAFF'
on conflict do nothing;

-- The one thing a manager has that a coach does not.
insert into public.role_capability_defaults (scope_type, role_key, capability_key)
values ('team', 'TEAM_MANAGER', 'team.roster.manage')
on conflict do nothing;

create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when not internal.is_club_active(p_club_id) then false
    when internal.is_club_admin(p_club_id) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'CLUB_ADMIN' and d.capability_key = p_capability_key
    )
    -- TEAM MANAGER. The person who actually runs this side: team_admin or
    -- manager, and only for THIS team. They hold everything TEAM_STAFF holds
    -- plus team.roster.manage, so they can accept a player into their own
    -- squad. Club-level write capabilities -- club.teams.manage,
    -- club.team_lifecycle.manage, club.roster.manage, club.guardians.manage --
    -- are still absent, because running a team is not running a club.
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission in ('team_admin', 'manager')
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'TEAM_MANAGER' and d.capability_key = p_capability_key
    )
    -- TEAM STAFF. A coach, and by extension an assistant coach, physio or
    -- volunteer recorded as one. Deliberately unchanged: no roster write, no
    -- club-level write, exactly as before.
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission = 'coach'
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'TEAM_STAFF' and d.capability_key = p_capability_key
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then exists (
      select 1 from public.role_capability_defaults d
      where d.scope_type = 'team' and d.role_key = 'TEAM_MEMBER' and d.capability_key = p_capability_key
    )
    else false
  end;
$function$;

comment on function internal.has_team_role_capability(uuid, uuid, text) is
  'Resolves a person''s capabilities at ONE team from the permission they hold there. team_admin and manager resolve to TEAM_MANAGER, which holds everything TEAM_STAFF holds plus team.roster.manage for that team alone; coach resolves to TEAM_STAFF, unchanged, so roster authority is never granted to every staff member at a club.';

do $$
declare v_mgr int; v_staff int;
begin
  select count(*) into v_mgr from public.role_capability_defaults
   where scope_type='team' and role_key='TEAM_MANAGER' and capability_key='team.roster.manage';
  select count(*) into v_staff from public.role_capability_defaults
   where scope_type='team' and role_key='TEAM_STAFF' and capability_key='team.roster.manage';
  if v_mgr <> 1 then raise exception 'TEAM_MANAGER should hold team.roster.manage.'; end if;
  if v_staff <> 0 then raise exception 'TEAM_STAFF must NOT hold team.roster.manage -- that is the whole point.'; end if;
  raise notice 'TEAM_MANAGER holds team.roster.manage; TEAM_STAFF does not.';
end $$;
