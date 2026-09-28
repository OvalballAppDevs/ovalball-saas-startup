-- SET TEAM DESCRIPTION -- the canonical, governed write for "About This Team" (Team Profiles Section
-- 1B). `teams.description` already exists (20270567000000); this is the one server-side mutation that
-- writes it, so the mobile editor never performs an ungoverned direct client update merely because RLS
-- on `teams` happens to permit one.
--
-- THE SAME AUTHORITY THE PROFILE SCREEN ALREADY COMPUTES AND SHOWS THE EDITOR ON -- `team.team.manage`
-- at team scope (the same key `teams_update_admin`'s own RLS policy checks, and the same key
-- `TeamProfile.canEditCover` already reads via `authority.teamManage`) OR `club.profile.edit` at club
-- scope (the other half of `canEditCover`, and the club-level "may edit this club's own presentation"
-- capability). A site-level fallback is included explicitly, matching `set_team_alias`/
-- `clear_team_alias`'s own precedent for a team-detail write, since a plain capability check at team
-- scope is not guaranteed to imply Site Admin's own override the way each of those RPCs already assumes
-- it does not.
create or replace function public.set_team_description(p_team_id uuid, p_description text)
returns void
language plpgsql
security definer
set search_path = 'public'
as $$
declare
  v_club_id uuid;
  v_trimmed text := nullif(trim(coalesce(p_description, '')), '');
begin
  select club_id into v_club_id from public.teams where id = p_team_id;
  if v_club_id is null then
    raise exception 'Team not found.';
  end if;

  if not (
    internal.has_capability('team.team.manage', 'team', v_club_id, p_team_id)
    or internal.has_capability('club.profile.edit', 'club', v_club_id, null)
    or internal.has_capability('site.team_catalogue.manage', 'site')
  ) then
    raise exception 'Not authorized to change this team''s description.' using errcode = '42501';
  end if;

  -- WHITESPACE-ONLY IS NO DESCRIPTION. Canonical NULL, never a stored empty/blank string -- "About
  -- This Team" already treats null as "nothing written yet" and must not have a second, indistinguishable
  -- empty-string shape to also handle.
  update public.teams set description = v_trimmed where id = p_team_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, after)
  values ('teams', p_team_id, 'update', auth.uid(), jsonb_build_object('description', v_trimmed));
end;
$$;

grant execute on function public.set_team_description(uuid, text) to authenticated;
