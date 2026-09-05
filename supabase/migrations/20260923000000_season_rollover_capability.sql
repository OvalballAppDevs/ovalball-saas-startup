-- Master Architecture Pass addendum, "Season Rollover Permission": Season
-- Rollover is a real mutation (advances a club's active teams/scheduling
-- groups into a new season) and must be grantable/revocable, club-scoped,
-- and server-authorized under the canonical capability engine -- never a
-- second bespoke check, and never a Burnley grant implying Rossendale
-- rollover authority (the engine's own scope validation already prevents
-- that structurally, same as every other club-scoped capability).

insert into public.capabilities (key, label, description, category) values
  ('club.season_rollover.manage', 'Run Season Rollover', 'Advance this club into a new season -- carries teams and scheduling groups forward.', 'club')
on conflict (key) do nothing;

-- ============================================================
-- Capability applicable-scope closure (Section 17 of the addendum): a
-- capability must be structurally restricted to its legitimate scope(s)
-- -- "site season capability -> SITE, club rollover capability -> CLUB,
-- team roster capability -> TEAM" -- never left to caller convention
-- alone. `applicable_scopes` names every scope_type a capability may
-- validly be checked/granted at; has_capability() and
-- set_capability_override() (below) both reject a mismatched scope_type
-- outright, in addition to (not instead of) the existing per-scope
-- relational validation (team-belongs-to-club, etc.).
--
-- Every capability introduced THIS pass (club.*.manage, team.roster.manage,
-- site.*) gets its real, narrow, audited scope. Capabilities that predate
-- this engine (club.edit_profile aside -- audited and narrowed) and are
-- shared across both club-wide and team-scoped default bundles
-- (team.manage/team.view/club.view/people.*/fixture.*/calendar.*/
-- partner.manage/permissions.club_manage) are deliberately left
-- permissive ({'site','club','team'}) rather than guessed at -- narrowing
-- them incorrectly risks breaking a legitimate existing call pattern this
-- pass did not have time to fully re-audit; this is disclosed as a known
-- remaining gap rather than silently resolved.
alter table public.capabilities add column applicable_scopes text[] not null default array['site','club','team'];
alter table public.capabilities add constraint capabilities_applicable_scopes_valid check (
  array_length(applicable_scopes, 1) > 0
  and applicable_scopes <@ array['site','club','team']
);

update public.capabilities set applicable_scopes = array['club'] where key in (
  'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
  'club.teams.manage', 'club.team_lifecycle.manage', 'club.season_rollover.manage'
);
update public.capabilities set applicable_scopes = array['club', 'team'] where key = 'club.roster.manage';
update public.capabilities set applicable_scopes = array['team'] where key = 'team.roster.manage';
update public.capabilities set applicable_scopes = array['site'] where key in (
  'site.permissions.manage', 'site.lookups.manage', 'site.team_catalogue.manage',
  'site.competitions.manage', 'site.fixture_support.manage', 'site.diagnostic.access'
);

-- internal.has_capability(): now also rejects a scope_type not in the
-- capability's own applicable_scopes, before any override/role-bundle
-- logic runs -- a structural rejection, not caller convention.
create or replace function internal.has_capability(
  p_capability_key text, p_scope_type text, p_club_id uuid default null, p_team_id uuid default null
)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_team_club uuid;
  v_allowed_scopes text[];
begin
  if not internal.is_account_active(auth.uid()) then
    return false;
  end if;

  select applicable_scopes into v_allowed_scopes from public.capabilities where key = p_capability_key;
  if v_allowed_scopes is null or not (p_scope_type = any(v_allowed_scopes)) then
    return false;
  end if;

  if p_scope_type = 'team' then
    if p_team_id is null or p_club_id is null then return false; end if;
    select club_id into v_team_club from public.teams where id = p_team_id;
    if v_team_club is null or v_team_club <> p_club_id then
      return false; -- never trust a caller-supplied club_id + team_id pairing
    end if;
  elsif p_scope_type = 'club' then
    if p_club_id is null or p_team_id is not null then return false; end if;
  elsif p_scope_type = 'site' then
    if p_club_id is not null or p_team_id is not null then return false; end if;
  else
    return false;
  end if;

  if exists (
    select 1 from public.capability_overrides co
    where co.user_id = auth.uid() and co.capability_key = p_capability_key and co.status = 'active'
      and co.effect = 'deny' and co.scope_type = p_scope_type
      and co.club_id is not distinct from p_club_id and co.team_id is not distinct from p_team_id
  ) then
    return false;
  end if;

  if p_scope_type in ('club', 'team') and internal.is_site_admin() then
    return true;
  end if;

  if exists (
    select 1 from public.capability_overrides co
    where co.user_id = auth.uid() and co.capability_key = p_capability_key and co.status = 'active'
      and co.effect = 'grant' and co.scope_type = p_scope_type
      and co.club_id is not distinct from p_club_id and co.team_id is not distinct from p_team_id
  ) then
    return true;
  end if;

  if p_scope_type = 'club' then
    return internal.has_club_role_capability(p_club_id, p_capability_key);
  elsif p_scope_type = 'team' then
    return internal.has_team_role_capability(p_team_id, p_club_id, p_capability_key);
  else
    return internal.has_site_role_capability(p_capability_key);
  end if;
end;
$$;

-- set_capability_override(): a grant/deny for a scope_type not in the
-- capability's own applicable_scopes is rejected outright (e.g. someone
-- attempting to grant a SITE-only capability at CLUB scope).
create or replace function public.set_capability_override(
  p_user_id uuid, p_capability_key text, p_scope_type text, p_club_id uuid, p_team_id uuid, p_effect text, p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_team_club uuid;
  v_has_relationship boolean;
  v_allowed_scopes text[];
begin
  if not internal.can_manage_permissions() then
    raise exception 'Only a Full Site Admin, or a Site Admin with the Permission Management capability, can grant or deny capabilities.' using errcode = '42501';
  end if;
  if p_user_id = auth.uid() then
    raise exception 'You cannot grant or deny your own capabilities.' using errcode = '42501';
  end if;
  if p_effect not in ('grant', 'deny') then
    raise exception 'Invalid effect.';
  end if;

  select applicable_scopes into v_allowed_scopes from public.capabilities where key = p_capability_key;
  if v_allowed_scopes is null then
    raise exception 'Unknown capability.';
  end if;
  if not (p_scope_type = any(v_allowed_scopes)) then
    raise exception 'Capability % cannot be granted at % scope -- it is only valid at: %', p_capability_key, p_scope_type, array_to_string(v_allowed_scopes, ', ') using errcode = '23514';
  end if;

  if p_scope_type = 'team' then
    if p_club_id is null or p_team_id is null then
      raise exception 'A team-scoped grant needs both a club and a team.';
    end if;
    select club_id into v_team_club from public.teams where id = p_team_id;
    if v_team_club is null or v_team_club <> p_club_id then
      raise exception 'That team does not belong to the specified club.' using errcode = '23514';
    end if;
    select exists (
      select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.status = 'active'
      union all
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = p_user_id and cm.status = 'active'
    ) into v_has_relationship;
  elsif p_scope_type = 'club' then
    if p_club_id is null or p_team_id is not null then
      raise exception 'A club-scoped grant needs exactly a club, no team.';
    end if;
    select exists (select 1 from public.club_memberships cm where cm.club_id = p_club_id and cm.user_id = p_user_id and cm.status = 'active') into v_has_relationship;
  elsif p_scope_type = 'site' then
    if p_club_id is not null or p_team_id is not null then
      raise exception 'A site-scoped grant must not name a club or team.';
    end if;
    select exists (select 1 from public.site_admins where user_id = p_user_id and status = 'active') into v_has_relationship;
  else
    raise exception 'Invalid scope type.';
  end if;

  if not v_has_relationship then
    raise exception 'This person has no existing relationship at that scope -- a capability override narrows or extends real authority, it does not invent a relationship.' using errcode = '23514';
  end if;

  update public.capability_overrides
  set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), updated_at = now()
  where user_id = p_user_id and capability_key = p_capability_key and scope_type = p_scope_type
    and club_id is not distinct from p_club_id and team_id is not distinct from p_team_id
    and status = 'active';

  insert into public.capability_overrides (user_id, capability_key, scope_type, club_id, team_id, effect, reason, granted_by)
  values (p_user_id, p_capability_key, p_scope_type, p_club_id, p_team_id, p_effect, p_reason, auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

-- Default bundle: Club-Admin-only, matching the page's existing (and
-- unchanged) real authorization boundary -- confirmed live before this
-- migration, never expanded by it.
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'club.season_rollover.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      'club.pitches.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('club.view', 'team.view', 'people.view', 'calendar.view', 'fixture.view')
    else false
  end;
$$;
