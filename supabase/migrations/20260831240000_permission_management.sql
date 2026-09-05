-- Permission Management (Phase B). Deliberately NOT a new enforcement
-- layer: real authorization stays exactly where it already lives --
-- club_memberships.role (BASIC_USER/CLUB_ADMIN/FIXTURE_SECRETARY),
-- team_permissions.permission (view_only/coach/manager/team_admin), and
-- site_admins. Rewriting every RLS policy in this project to check a new
-- dynamic capability system would be a whole-application rearchitecture
-- this migration deliberately does not attempt (see the accompanying
-- report for the full reasoning).
--
-- What this migration adds is a real, database-backed CONFIGURATION and
-- DOCUMENTATION layer over that existing model:
--
-- - `capabilities`: a fixed, code-seeded registry of what the product can
--   actually do (matches real, already-implemented RLS boundaries -- an
--   admin can never add a row here through the UI, only combine existing
--   ones into groups; new capabilities require code + an RLS policy,
--   exactly like every other capability already does).
-- - `permission_groups`: named, described bundles Site Admin can create/
--   edit/deactivate. Each group still resolves to one of the small set of
--   real, already-implemented enforcement values (`maps_to_role` for
--   club-scope groups, `maps_to_team_permission` for team-scope groups) --
--   its capability list is accurate, human-readable documentation of what
--   that real value actually grants, not a second enforcement path.
-- - `permission_group_capabilities`: which capabilities a group is
--   documented to include.
--
-- User Management's "Change access" already writes to club_memberships.
-- role/team_permissions.permission directly (changeAccessProfile,
-- 20260831210000); this migration lets that UI select a *named group*
-- instead of a hard-coded profile list, while the underlying write is
-- unchanged.

create table public.capabilities (
  key text primary key,
  label text not null,
  description text,
  category text not null check (category in ('club', 'people', 'team', 'fixture', 'calendar', 'messaging', 'permissions'))
);

comment on table public.capabilities is
  'Fixed registry of what the product can actually do -- seeded once below, never admin-creatable. Each key corresponds to a real, already-implemented RLS/authorization boundary; adding a genuinely new capability requires code + a policy, not a database insert.';

insert into public.capabilities (key, label, description, category) values
  ('club.view', 'View club information', 'See club profile, directory details, and public page content.', 'club'),
  ('club.edit_profile', 'Edit club profile', 'Change bio, website, crest, and public-visibility settings.', 'club'),
  ('people.view', 'View people', 'See who is connected to the club and their roles.', 'people'),
  ('people.manage', 'Manage people', 'Invite members, correct roles, and revoke club access.', 'people'),
  ('team.view', 'View teams', 'See the club''s teams and who is assigned to them.', 'team'),
  ('team.manage', 'Manage a team', 'Edit a specific team''s details and roster (scoped to assigned teams for Team Admin).', 'team'),
  ('fixture.view', 'View fixtures', 'See the club''s fixtures and results.', 'fixture'),
  ('fixture.create', 'Create fixtures', 'Add a new fixture for a team (requires team-level authority, or Club Admin club-wide).', 'fixture'),
  ('fixture.edit', 'Edit fixtures', 'Change details of an existing fixture (same scope as fixture.create).', 'fixture'),
  ('fixture.cancel', 'Cancel fixtures', 'Mark a fixture cancelled (same scope as fixture.create).', 'fixture'),
  ('fixture.manage_requests', 'Manage fixture requests', 'Send/receive club-wide fixture requests to partner clubs.', 'fixture'),
  ('calendar.view', 'View shared calendars', 'See availability shared by partner clubs.', 'calendar'),
  ('calendar.manage', 'Manage calendar sharing', 'Request, approve, or revoke calendar-sharing partnerships.', 'calendar'),
  ('partner.manage', 'Manage partner clubs', 'Same authority as calendar.manage -- partnerships are the calendar-sharing relationship itself.', 'calendar'),
  ('messages.fixture_send', 'Send fixture messages', 'Message about a specific fixture or fixture request you have a relationship with.', 'messaging'),
  ('permissions.club_manage', 'Manage club-wide access', 'Change other members'' Ovalball access and real-world role (Club Admin only).', 'permissions');

create table public.permission_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  scope_type text not null check (scope_type in ('global', 'club', 'team')),
  is_system boolean not null default false,
  is_active boolean not null default true,
  -- Club-scope groups resolve to a real club_memberships.role value;
  -- team-scope groups resolve to a real team_permissions.permission value.
  -- A group can never be created or edited into mapping onto anything
  -- other than one of these already-implemented, already-audited values
  -- -- that boundary is what keeps this a configuration layer rather than
  -- a second authorization system.
  maps_to_role text check (maps_to_role in ('BASIC_USER', 'CLUB_ADMIN', 'FIXTURE_SECRETARY')),
  maps_to_team_permission text check (maps_to_team_permission in ('view_only', 'coach', 'manager', 'team_admin')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint permission_groups_scope_mapping check (
    (scope_type = 'club' and maps_to_role is not null and maps_to_team_permission is null)
    or (scope_type = 'team' and maps_to_team_permission is not null and maps_to_role is null)
    or (scope_type = 'global' and maps_to_role is null and maps_to_team_permission is null)
  )
);

comment on table public.permission_groups is
  'Site Admin-managed, named bundles of capabilities. Each non-global group still resolves to one of the small set of real club_memberships.role / team_permissions.permission values (maps_to_role / maps_to_team_permission) -- the actual RLS enforcement this project already has, never a second permission system. System groups (is_system) mirror the four roles the product already implements (View Only, Club Admin, Fixtures Admin, Team Admin) and cannot be deleted or remapped; a Site Admin may still rename/redescribe them and adjust their documented capability list. Custom groups may be created but must still choose one of the existing real mapping values -- a genuinely new authorization level requires a code change and a new migration, not a database row, matching this project''s explicit "capabilities are configured, not invented" boundary.';

create index permission_groups_scope_type_idx on public.permission_groups (scope_type) where is_active;

create table public.permission_group_capabilities (
  group_id uuid not null references public.permission_groups(id) on delete cascade,
  capability_key text not null references public.capabilities(key),
  primary key (group_id, capability_key)
);

-- Seed the four system groups, mapped to the real, already-verified
-- enforcement values and their real (not aspirational) capability sets.
-- Fixtures Admin's list is deliberately narrower than "create/edit
-- fixtures" -- FIXTURE_SECRETARY alone (can_manage_club_fixtures) does
-- NOT satisfy fixtures_insert_scoped's can_manage_team check, verified
-- directly against RLS this session (see supabase/tests/
-- admin_user_management.sql scenario 14).
do $$
declare
  v_view_only uuid;
  v_member uuid;
  v_club_admin uuid;
  v_fixtures_admin uuid;
  v_team_admin uuid;
  v_coach uuid;
  v_manager uuid;
begin
  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_team_permission)
    values ('View Only', 'Read-only access to club and team information they already have access to. No administration.', 'team', true, 'view_only')
    returning id into v_view_only;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_view_only, k from unnest(array['club.view','people.view','team.view','fixture.view','calendar.view']) k;

  -- The club-scope counterpart to View Only -- "a club-wide member with no
  -- club-wide administrative authority", i.e. the BASIC_USER mapping
  -- itself. Every membership resolves to some club-scope group; without
  -- this one, a membership with no club-wide admin role (the common case
  -- for anyone whose only real authority is team-scoped) had nothing to
  -- select in Change Access, which silently blocked assigning team-scope
  -- access at all -- found via live verification of the User Management
  -- integration.
  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_role)
    values ('Member', 'Club-wide membership with no club-wide administrative authority. Team-scoped access (Team Admin, Coach, etc.) is assigned separately, per team.', 'club', true, 'BASIC_USER')
    returning id into v_member;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_member, k from unnest(array['club.view','people.view','team.view','fixture.view','calendar.view']) k;

  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_role)
    values ('Club Admin', 'Full administration for their own club: profile, people, teams, fixtures, and calendar sharing. Never global Site Admin authority.', 'club', true, 'CLUB_ADMIN')
    returning id into v_club_admin;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_club_admin, k from unnest(array['club.view','club.edit_profile','people.view','people.manage','team.view','team.manage','fixture.view','fixture.create','fixture.edit','fixture.cancel','fixture.manage_requests','calendar.view','calendar.manage','partner.manage','messages.fixture_send','permissions.club_manage']) k;

  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_role)
    values ('Fixtures Admin', 'Club-wide fixture requests and calendar-sharing partnerships. Cannot directly create/edit a fixture for a team without separate team-level access, and cannot manage people or the club profile.', 'club', true, 'FIXTURE_SECRETARY')
    returning id into v_fixtures_admin;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_fixtures_admin, k from unnest(array['club.view','people.view','team.view','fixture.view','fixture.manage_requests','calendar.view','calendar.manage','partner.manage','messages.fixture_send']) k;

  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_team_permission)
    values ('Team Admin', 'Administration limited to the specific team(s) assigned -- create/edit fixtures for those teams only. No club-wide authority.', 'team', true, 'team_admin')
    returning id into v_team_admin;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_team_admin, k from unnest(array['club.view','people.view','team.view','team.manage','fixture.view','fixture.create','fixture.edit','fixture.cancel','messages.fixture_send']) k;

  -- Coach and Manager both already existed as real team_permissions.
  -- permission values (can_manage_team treats them identically to
  -- team_admin today -- see that function's own comment), but had no
  -- corresponding permission_groups row -- found via live verification:
  -- a real Coach's Change Access team-scope dropdown had nothing to
  -- select, which would have silently stripped their access if a Site
  -- Admin applied it without noticing the empty selection.
  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_team_permission)
    values ('Coach', 'Team-scoped coaching access -- create/edit fixtures for the assigned team(s). Same underlying authority as Team Admin today; kept as a distinct, real-world-accurate label.', 'team', true, 'coach')
    returning id into v_coach;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_coach, k from unnest(array['club.view','people.view','team.view','fixture.view','fixture.create','fixture.edit','fixture.cancel','messages.fixture_send']) k;

  insert into public.permission_groups (name, description, scope_type, is_system, maps_to_team_permission)
    values ('Manager', 'Team-scoped management access -- create/edit fixtures for the assigned team(s). Same underlying authority as Team Admin today; kept as a distinct, real-world-accurate label.', 'team', true, 'manager')
    returning id into v_manager;
  insert into public.permission_group_capabilities (group_id, capability_key)
    select v_manager, k from unnest(array['club.view','people.view','team.view','fixture.view','fixture.create','fixture.edit','fixture.cancel','messages.fixture_send']) k;
end $$;

-- ============================================================
-- RLS: Site Admin manages everything here; everyone else may only read
-- active groups (needed so the app can show a person's assigned group's
-- name/description) and the fixed capability registry (documentation,
-- not sensitive). No INSERT/UPDATE/DELETE path exists for anyone but
-- Site Admin, and system groups additionally cannot be deleted or have
-- their mapping changed at the application layer (enforced in the server
-- action, since a blanket "is_system" DB constraint can't distinguish
-- "rename" from "remap").
-- ============================================================

alter table public.capabilities enable row level security;
alter table public.permission_groups enable row level security;
alter table public.permission_group_capabilities enable row level security;

create policy capabilities_select_all on public.capabilities for select to anon, authenticated using (true);

create policy permission_groups_select_active on public.permission_groups for select
  to anon, authenticated using (is_active = true or internal.is_site_admin());
create policy permission_groups_write_admin on public.permission_groups for insert
  with check (internal.is_site_admin());
create policy permission_groups_update_admin on public.permission_groups for update
  using (internal.is_site_admin());
create policy permission_groups_delete_admin on public.permission_groups for delete
  using (internal.is_site_admin());

create policy permission_group_capabilities_select_all on public.permission_group_capabilities for select
  to anon, authenticated using (true);
create policy permission_group_capabilities_write_admin on public.permission_group_capabilities for insert
  with check (internal.is_site_admin());
create policy permission_group_capabilities_delete_admin on public.permission_group_capabilities for delete
  using (internal.is_site_admin());

create trigger set_updated_at before update on public.permission_groups for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update or delete on public.permission_groups for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.permission_group_capabilities for each row execute function internal.audit_row_change();

-- ============================================================
-- delete_permission_group: the only path that may permanently remove a
-- group. Blocks on any assigned user (club_memberships.assigned_group_id
-- / team_permissions.assigned_group_id, added below) and on is_system,
-- matching the club_directory hard-delete's own dependency-check pattern.
-- ============================================================

create function public.delete_permission_group(p_group_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.permission_groups;
  v_assigned_count int;
begin
  if not internal.is_site_admin() then
    raise exception 'Only a Site Admin may delete a permission group.' using errcode = '42501';
  end if;

  select * into v_group from public.permission_groups where id = p_group_id for update;
  if not found then
    raise exception 'Permission group not found.';
  end if;
  if v_group.is_system then
    raise exception 'System permission groups cannot be deleted.';
  end if;

  select coalesce(sum(c), 0) into v_assigned_count from (
    select count(*) as c from public.club_memberships where assigned_group_id = p_group_id
    union all
    select count(*) as c from public.team_permissions where assigned_group_id = p_group_id
  ) counts;

  if v_assigned_count > 0 then
    raise exception 'This permission group is assigned to % user(s). Reassign or deactivate it first.', v_assigned_count;
  end if;

  delete from public.permission_groups where id = p_group_id;
end;
$$;

comment on function public.delete_permission_group(uuid) is
  'The only path that may permanently remove a permission_groups row. Blocks on is_system and on any club_memberships/team_permissions row still pointing at it -- reassignment or deactivation is required first, matching the club-directory hard-delete''s own dependency-check pattern.';

revoke execute on function public.delete_permission_group(uuid) from public;
grant execute on function public.delete_permission_group(uuid) to authenticated;

-- ============================================================
-- Track which group a membership/team_permission was assigned through --
-- documentation/traceability only (the real authority is still
-- club_memberships.role / team_permissions.permission themselves; this
-- column never gates anything on its own). Nullable: memberships created
-- before this migration, or created outside the group-based UI (claim
-- approval, invitations), have no group on record.
-- ============================================================

alter table public.club_memberships add column assigned_group_id uuid references public.permission_groups(id);
alter table public.team_permissions add column assigned_group_id uuid references public.permission_groups(id);

comment on column public.club_memberships.assigned_group_id is
  'Which permission_groups row this membership''s role was last set through, if any -- traceability only. club_memberships.role remains the actual authorization value; this can be null (e.g. created by claim approval, not through Change Access) without affecting authority.';
comment on column public.team_permissions.assigned_group_id is
  'Which permission_groups row this team_permissions row was last set through, if any -- traceability only, same reasoning as club_memberships.assigned_group_id.';
