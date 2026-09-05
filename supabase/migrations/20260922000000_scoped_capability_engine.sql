-- Canonical Scoped Capability Engine (Master Architecture Pass, before
-- Access & Teams). One question, one answer, everywhere:
--
--   CAN THIS ACTOR PERFORM THIS CAPABILITY ON THIS RESOURCE IN THIS SCOPE?
--
-- ============================================================
-- AUDIT: what already existed, and why it's NOT reused as the enforcement
-- source (see docs/architecture/capability-model.md §1-2 for the full
-- account)
-- ============================================================
-- `capabilities` / `permission_groups` / `permission_group_capabilities`
-- (20260831240000_permission_management.sql) are a DOCUMENTATION/taxonomy
-- layer over the real enforcement (club_memberships.role /
-- team_permissions.permission / site_admins flags) -- confirmed no RLS
-- policy anywhere references them. Critically, they are also demonstrably
-- STALE relative to real behavior: permission_group_capabilities lists
-- "Team Admin -> team.manage", but teams_update_admin has only ever
-- authorized Site Admin or that club's Club Admin -- a Team Admin has
-- zero real write authority on teams, confirmed live across two prior
-- passes. Wiring the new engine's default-bundle resolution to this table
-- would therefore SILENTLY EXPAND Team Admin's real authority, which
-- Section 25 of this pass's own brief explicitly forbids. `capabilities`
-- (the flat catalogue) is genuinely reusable -- its existing keys
-- (club.edit_profile, team.manage, team.view, club.view, people.manage,
-- people.view, fixture.*, calendar.*, partner.manage,
-- permissions.club_manage) are kept and extended below, never duplicated.
-- `permission_groups`/`permission_group_capabilities` are left untouched
-- as documentation; a future pass may reconcile or retire them once every
-- real enforcement path has an accurate capability-based description.

-- ============================================================
-- 1. Capability catalogue: extend, don't duplicate.
-- ============================================================
alter table public.capabilities drop constraint capabilities_category_check;
alter table public.capabilities add constraint capabilities_category_check
  check (category = any (array['club','people','team','fixture','calendar','messaging','permissions','site']));

insert into public.capabilities (key, label, description, category) values
  ('club.logo.manage', 'Manage club logo', 'Upload, replace, or remove this club''s crest.', 'club'),
  ('club.venues.manage', 'Manage venues', 'Add, edit, or deactivate this club''s venues.', 'club'),
  ('club.pitches.manage', 'Manage pitches', 'Add, edit, or deactivate this club''s pitches.', 'club'),
  ('club.teams.manage', 'Manage teams', 'Create teams and edit their canonical category, age group, gender, and squad designation.', 'team'),
  ('club.team_lifecycle.manage', 'Fold or reactivate teams', 'Fold a team (cancelling its future fixtures) or reactivate a folded team.', 'team'),
  ('club.roster.manage', 'Manage team roster (club-wide)', 'Assign or remove people from any team in this club.', 'team'),
  ('team.roster.manage', 'Manage team roster (this team)', 'Assign or remove people from this one team. Not currently granted to any role by default -- engine-ready for a future Access & Teams product decision only.', 'team'),
  ('site.permissions.manage', 'Manage permission grants', 'Grant, deny, or revoke functional capabilities for other users, and manage permission-group documentation.', 'site'),
  ('site.lookups.manage', 'Manage global lookups (parent view)', 'Add, edit, or deactivate any club''s venues and pitches from the Site Admin parent view.', 'site'),
  ('site.team_catalogue.manage', 'Manage the Team Directory', 'Write to the canonical Team Directory catalogue.', 'site'),
  ('site.competitions.manage', 'Manage competitions', 'Write to the global Competition Directory.', 'site'),
  ('site.fixture_support.manage', 'Fixture support access', 'Read and post into any fixture''s conversation.', 'site'),
  ('site.diagnostic.access', 'Diagnostic club access', 'View any club as a diagnostic session.', 'site')
on conflict (key) do nothing;

-- ============================================================
-- 2. Site Admin governance: permission management is itself a capability,
-- not blanket is_site_admin() (Section 12). Mirrors manage_global_lookups
-- exactly -- narrow, explicit, per-person, off by default even for Full.
-- ============================================================
alter table public.site_admins add column manage_permissions boolean not null default false;
comment on column public.site_admins.manage_permissions is
  'Narrow, explicit, per-person grant (off by default even for Full) -- lets this Site Admin grant/deny/revoke capability_overrides and edit permission_groups documentation. Mirrors manage_global_lookups exactly.';

create or replace function internal.can_manage_permissions()
returns boolean
language sql stable security definer set search_path = public as $$
  select internal.is_full_site_admin() or coalesce((select manage_permissions from public.site_admins where user_id = auth.uid() and status = 'active'), false);
$$;

create or replace function public.set_site_admin_permissions_capability(p_user_id uuid, p_enabled boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not internal.is_full_site_admin() then
    raise exception 'Only a Full Site Admin can grant or revoke permission-management access.' using errcode = '42501';
  end if;
  update public.site_admins set manage_permissions = p_enabled where user_id = p_user_id;
  if not found then raise exception 'Site Admin not found.'; end if;
end;
$$;
revoke execute on function public.set_site_admin_permissions_capability(uuid, boolean) from public;
grant execute on function public.set_site_admin_permissions_capability(uuid, boolean) to authenticated;

-- Tighten the pre-existing permission_groups/permission_group_capabilities
-- write policies: previously blanket is_site_admin() (ANY active Site
-- Admin, including read_only, could edit permission documentation) --
-- now requires the same narrow capability as everything else here.
drop policy if exists permission_groups_write_admin on public.permission_groups;
create policy permission_groups_write_admin on public.permission_groups for insert
  with check (internal.can_manage_permissions());
drop policy if exists permission_groups_update_admin on public.permission_groups;
create policy permission_groups_update_admin on public.permission_groups for update
  using (internal.can_manage_permissions());
drop policy if exists permission_groups_delete_admin on public.permission_groups;
create policy permission_groups_delete_admin on public.permission_groups for delete
  using (internal.can_manage_permissions());

drop policy if exists permission_group_capabilities_write_admin on public.permission_group_capabilities;
create policy permission_group_capabilities_write_admin on public.permission_group_capabilities for insert
  with check (internal.can_manage_permissions());
drop policy if exists permission_group_capabilities_delete_admin on public.permission_group_capabilities;
create policy permission_group_capabilities_delete_admin on public.permission_group_capabilities for delete
  using (internal.can_manage_permissions());

-- ============================================================
-- 3. capability_overrides: the ONE grant/deny mechanism (Sections 9/10).
-- Append-only history (revoking supersedes, never deletes) -- doubles as
-- its own audit trail alongside audit_row_change below.
-- ============================================================
create table public.capability_overrides (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  capability_key text not null references public.capabilities(key),
  scope_type text not null check (scope_type in ('site','club','team')),
  club_id uuid references public.clubs(id),
  team_id uuid references public.teams(id),
  effect text not null check (effect in ('grant','deny')),
  reason text,
  granted_by uuid not null references auth.users(id),
  granted_at timestamptz not null default now(),
  revoked_by uuid references auth.users(id),
  revoked_at timestamptz,
  status text not null default 'active' check (status in ('active','revoked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint capability_overrides_scope_shape check (
    (scope_type = 'site' and club_id is null and team_id is null) or
    (scope_type = 'club' and club_id is not null and team_id is null) or
    (scope_type = 'team' and club_id is not null and team_id is not null)
  )
);

create index capability_overrides_lookup_idx on public.capability_overrides (user_id, capability_key, scope_type, status);
create index capability_overrides_club_idx on public.capability_overrides (club_id) where club_id is not null;
create index capability_overrides_team_idx on public.capability_overrides (team_id) where team_id is not null;

-- Section 14/34: a team-scoped override must belong to the SAME club it
-- names -- the exact relational-integrity gap the team_permissions fix
-- (20260921000000) closed for roster grants. Enforced at the schema level
-- via trigger (a CHECK constraint cannot do cross-table lookups), on top
-- of the same validation set_capability_override() below performs before
-- ever reaching this trigger -- belt and braces, matching this
-- codebase's established pattern.
create or replace function internal.enforce_capability_override_scope()
returns trigger
language plpgsql set search_path = public as $$
declare v_team_club uuid;
begin
  if new.scope_type = 'team' then
    select club_id into v_team_club from public.teams where id = new.team_id;
    if v_team_club is null or v_team_club <> new.club_id then
      raise exception 'capability_overrides: team % does not belong to club %', new.team_id, new.club_id using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
create trigger enforce_capability_override_scope
  before insert or update on public.capability_overrides
  for each row execute function internal.enforce_capability_override_scope();

create trigger set_updated_at before update on public.capability_overrides
  for each row execute function set_updated_at();
create trigger audit_row_change after insert or update or delete on public.capability_overrides
  for each row execute function internal.audit_row_change();

alter table public.capability_overrides enable row level security;

-- Read: the subject themselves (so a UI can show "you have an explicit
-- grant/deny here"), or a Site Admin with the permission-management
-- capability. No broader read -- this is who-can-do-what data, not public.
create policy capability_overrides_select_scoped on public.capability_overrides for select
  using (user_id = auth.uid() or internal.can_manage_permissions());

-- Deliberately NO insert/update/delete policies. Every write goes through
-- set_capability_override()/revoke_capability_override() below (Section
-- 17: no generic SECURITY DEFINER escape hatch, but also no direct client
-- table write at all for this specific table -- the RPCs are the sole,
-- narrow, validated path, and RLS backstops even a hypothetical future
-- direct-write attempt by simply having no policy to allow it).

-- ============================================================
-- 4. Grant / deny / revoke RPCs. Section 13 (self-escalation): nobody may
-- write a row naming themselves as the subject, full stop, regardless of
-- how privileged the caller is. Section 14 (cross-club/cross-team
-- malformed grants): validated explicitly here, in addition to the
-- trigger above.
-- ============================================================
create or replace function public.set_capability_override(
  p_user_id uuid, p_capability_key text, p_scope_type text, p_club_id uuid, p_team_id uuid, p_effect text, p_reason text default null
)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_team_club uuid;
  v_has_relationship boolean;
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
  if not exists (select 1 from public.capabilities where key = p_capability_key) then
    raise exception 'Unknown capability.';
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
revoke execute on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text) from public;
grant execute on function public.set_capability_override(uuid, text, text, uuid, uuid, text, text) to authenticated;

create or replace function public.revoke_capability_override(p_override_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_row public.capability_overrides;
begin
  if not internal.can_manage_permissions() then
    raise exception 'Only a Full Site Admin, or a Site Admin with the Permission Management capability, can revoke capability grants.' using errcode = '42501';
  end if;
  select * into v_row from public.capability_overrides where id = p_override_id and status = 'active' for update;
  if not found then raise exception 'Override not found or already revoked.'; end if;
  if v_row.user_id = auth.uid() then
    raise exception 'You cannot modify your own capability grants.' using errcode = '42501';
  end if;
  update public.capability_overrides set status = 'revoked', revoked_by = auth.uid(), revoked_at = now(), updated_at = now() where id = p_override_id;
end;
$$;
revoke execute on function public.revoke_capability_override(uuid) from public;
grant execute on function public.revoke_capability_override(uuid) to authenticated;

-- ============================================================
-- 5. Role-derived DEFAULT bundles -- hardcoded and audited against real
-- RLS behavior (never sourced from permission_group_capabilities; see the
-- header note). This is the one place "what does each role really get"
-- is decided; every RLS policy this pass rewires (Section 19) reads it
-- indirectly through has_capability(), never re-derives its own copy.
-- ============================================================
create or replace function internal.has_club_role_capability(p_club_id uuid, p_capability_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'CLUB_ADMIN'
    ) then p_capability_key in (
      'club.edit_profile', 'club.logo.manage', 'club.venues.manage', 'club.pitches.manage',
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage',
      'people.manage', 'people.view', 'club.view', 'team.view',
      'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.manage_requests', 'fixture.view',
      'calendar.manage', 'calendar.view', 'partner.manage', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false and cm.role = 'FIXTURE_SECRETARY'
    ) then p_capability_key in (
      -- Deliberately NOT club.edit_profile / club.logo.manage / club.venues.manage /
      -- club.teams.manage / club.team_lifecycle.manage / club.roster.manage --
      -- Venues stays Club-Admin-only (confirmed live, deliberate asymmetry vs Pitches).
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

create or replace function internal.has_team_role_capability(p_team_id uuid, p_club_id uuid, p_capability_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when internal.is_club_admin(p_club_id) then p_capability_key in (
      'club.teams.manage', 'club.team_lifecycle.manage', 'club.roster.manage', 'team.roster.manage',
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
        and tp.permission in ('team_admin', 'coach', 'manager')
    ) then p_capability_key in (
      -- Deliberately NOT club.teams.manage / club.team_lifecycle.manage /
      -- club.roster.manage / team.roster.manage -- preserves the standing
      -- "no new Team Admin write capability granted" decision. A
      -- team_admin/coach/manager receives only their existing real
      -- authority (their own team's fixtures, and read access).
      'team.view', 'fixture.create', 'fixture.edit', 'fixture.cancel', 'fixture.view', 'calendar.view', 'messages.fixture_send'
    )
    when exists (
      select 1 from public.team_permissions tp join public.club_memberships cm on cm.id = tp.membership_id
      where tp.team_id = p_team_id and cm.user_id = auth.uid() and cm.status = 'active' and cm.authority_suspended = false
    ) then p_capability_key in ('team.view', 'fixture.view', 'calendar.view')
    else false
  end;
$$;

create or replace function internal.has_site_role_capability(p_capability_key text)
returns boolean
language sql stable security definer set search_path = public as $$
  select case
    when internal.is_full_site_admin() then true
    when p_capability_key = 'site.permissions.manage' then coalesce((select manage_permissions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.lookups.manage' then coalesce((select manage_global_lookups from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.team_catalogue.manage' then coalesce((select manage_team_catalogue from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.competitions.manage' then coalesce((select manage_competitions from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.fixture_support.manage' then coalesce((select manage_fixture_support from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    when p_capability_key = 'site.diagnostic.access' then coalesce((select diagnostic_club_access from public.site_admins where user_id = auth.uid() and status = 'active'), false)
    else internal.is_site_admin()
  end;
$$;

-- ============================================================
-- 6. The canonical primitive (Section 15).
-- Precedence (Section 10, deterministic, documented):
--   1. An active DENY override for this exact (user, capability, scope) -> false, full stop.
--   2. Site Admin master bypass for club/team scope (Section 18 -- KEEP, existing convention).
--   3. An active GRANT override for this exact (user, capability, scope) -> true.
--   4. The role-derived default bundle for this scope -> true/false.
-- Scope match is EXACT -- a club-scope override never cascades to a
-- team-scope check for a team inside that club, and vice versa. This is
-- deliberate: implicit cascading is exactly the kind of "silently
-- re-granted by another broad path" Section 10 forbids.
-- ============================================================
create or replace function internal.has_capability(
  p_capability_key text, p_scope_type text, p_club_id uuid default null, p_team_id uuid default null
)
returns boolean
language plpgsql stable security definer set search_path = public as $$
declare
  v_team_club uuid;
begin
  if not internal.is_account_active(auth.uid()) then
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

-- ============================================================
-- 7. Club Settings Integration (Section 19): rewire the 6 tables' write
-- policies to the canonical primitive. Each rewrite is constructed to
-- produce IDENTICAL allow/deny results to the policy it replaces for
-- every existing role assignment -- re-verified by the full regression
-- suite after this migration, not assumed.
-- ============================================================
drop policy if exists clubs_update_admin on public.clubs;
create policy clubs_update_admin on public.clubs for update
  using (internal.has_capability('club.edit_profile', 'club', id, null));

drop policy if exists teams_update_admin on public.teams;
create policy teams_update_admin on public.teams for update
  using (
    internal.has_capability('club.teams.manage', 'club', club_id, null)
    or internal.has_capability('club.team_lifecycle.manage', 'club', club_id, null)
  );

drop policy if exists venues_insert on public.venues;
create policy venues_insert on public.venues for insert
  with check (club_id is not null and internal.has_capability('club.venues.manage', 'club', club_id, null));
drop policy if exists venues_update on public.venues;
create policy venues_update on public.venues for update
  using (club_id is not null and internal.has_capability('club.venues.manage', 'club', club_id, null));

drop policy if exists club_pitches_insert on public.club_pitches;
create policy club_pitches_insert on public.club_pitches for insert
  with check (internal.has_capability('site.lookups.manage', 'site', null, null) or internal.has_capability('club.pitches.manage', 'club', club_id, null));
drop policy if exists club_pitches_update on public.club_pitches;
create policy club_pitches_update on public.club_pitches for update
  using (internal.has_capability('site.lookups.manage', 'site', null, null) or internal.has_capability('club.pitches.manage', 'club', club_id, null));

-- Roster: kept the explicit same-club equality check inline (belt and
-- braces on top of has_capability()'s own internal validation) so the
-- vulnerability fixed in 20260921000000 stays defended even if
-- has_capability() itself ever regresses.
drop policy if exists team_permissions_insert_scoped on public.team_permissions;
create policy team_permissions_insert_scoped on public.team_permissions for insert
  with check (
    (select cm.club_id from public.club_memberships cm where cm.id = membership_id) = (select t.club_id from public.teams t where t.id = team_id)
    and internal.has_capability('club.roster.manage', 'team', (select cm.club_id from public.club_memberships cm where cm.id = membership_id), team_id)
  );
drop policy if exists team_permissions_update_scoped on public.team_permissions;
create policy team_permissions_update_scoped on public.team_permissions for update
  using (
    (select cm.club_id from public.club_memberships cm where cm.id = membership_id) = (select t.club_id from public.teams t where t.id = team_id)
    and internal.has_capability('club.roster.manage', 'team', (select cm.club_id from public.club_memberships cm where cm.id = membership_id), team_id)
  );
drop policy if exists team_permissions_delete_scoped on public.team_permissions;
create policy team_permissions_delete_scoped on public.team_permissions for delete
  using (
    (select cm.club_id from public.club_memberships cm where cm.id = membership_id) = (select t.club_id from public.teams t where t.id = team_id)
    and internal.has_capability('club.roster.manage', 'team', (select cm.club_id from public.club_memberships cm where cm.id = membership_id), team_id)
  );

drop policy if exists club_logos_insert_club_admin on storage.objects;
create policy club_logos_insert_club_admin on storage.objects for insert
  with check (bucket_id = 'club-logos' and internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid, null));
drop policy if exists club_logos_update_club_admin on storage.objects;
create policy club_logos_update_club_admin on storage.objects for update
  using (bucket_id = 'club-logos' and internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid, null));
drop policy if exists club_logos_delete_club_admin on storage.objects;
create policy club_logos_delete_club_admin on storage.objects for delete
  using (bucket_id = 'club-logos' and internal.has_capability('club.logo.manage', 'club', ((storage.foldername(name))[1])::uuid, null));
