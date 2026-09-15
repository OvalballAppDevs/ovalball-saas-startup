-- Canonical club memberships and role assignments.
--
-- Identity/Auth Slice 2 (Phase 2 design M.1, M.2, I, Y.5, Y.6 part, Y.7, AF).
--
-- Before this migration a person's relationship to a club was one row with
-- a single `role` (BASIC_USER / CLUB_ADMIN / FIXTURE_SECRETARY), a two-value
-- `status` (active / revoked) that could be flipped back, and team authority
-- in a separate `team_permissions` row per team. There was no record of how
-- a membership came to exist, who approved it, who suspended or removed it,
-- or why.
--
-- After it:
--
--   * `club_memberships.state` is canonical: PENDING, ACTIVE, SUSPENDED,
--     REVOKED, DECLINED, EXPIRED. REVOKED, DECLINED and EXPIRED are terminal;
--     re-admission always creates a new row, so a removed membership can never
--     be switched back on. Every row records its source and the people and
--     reasons behind each transition.
--   * `role_assignments` holds each club or team role a person holds, with its
--     own state (ACTIVE, SUSPENDED, REVOKED) and provenance. A person may hold
--     several roles. Roles are named in `role_definitions`.
--   * The legacy columns every existing policy and function reads
--     (`club_memberships.role`, `status`, `authority_suspended`) are
--     maintained from the canonical state, and `team_permissions` becomes a
--     read-only compatibility view over team role assignments. Legacy
--     helpers keep working unchanged until the domain migrations (Slice 4).
--   * Existing data is backfilled without inventing anything: every legacy
--     role maps to exactly one assignment, provenance is recorded only where
--     it can be proven (otherwise LEGACY_BACKFILL), and the migration aborts
--     unless the derived legacy columns equal the pre-migration values for
--     every membership.
--
-- Transition RPCs arrive in a following migration.

-- ---------------------------------------------------------------------
-- 1. Role definitions
-- ---------------------------------------------------------------------

create table public.role_definitions (
  role_key text primary key check (role_key ~ '^[A-Z_]+$'),
  -- CLUB_OR_TEAM: Volunteer, which is club-wide or scoped to teams (AN-17).
  scope text not null check (scope in ('CLUB', 'TEAM', 'CLUB_OR_TEAM')),
  label text not null,
  -- The capability bundle this role confers. The bundle catalogue arrives in
  -- Slice 3, which adds the foreign key.
  bundle_key text not null,
  visible boolean not null default true,
  requires_base_role text[],
  minor_prohibited boolean not null default false,
  assignable_by text[] not null check (assignable_by <@ array['SITE', 'CLUB', 'TEAM_ADMIN', 'SYSTEM']::text[])
);

comment on table public.role_definitions is
  'Club and team roles (Phase 2 I). A role is a named bundle, never an authority check on its own. Changed only by migration.';

insert into public.role_definitions (role_key, scope, label, bundle_key, visible, requires_base_role, minor_prohibited, assignable_by) values
  ('CLUB_ADMIN',           'CLUB',         'Club Admin',           'CA', true,  null,                              true,  array['SITE', 'CLUB']),
  ('SAFEGUARDING_OFFICER', 'CLUB',         'Safeguarding Officer', 'SO', true,  null,                              true,  array['SITE']),
  ('FIXTURES_SECRETARY',   'CLUB',         'Fixtures Secretary',   'FS', true,  null,                              true,  array['SITE', 'CLUB']),
  ('VOLUNTEER',            'CLUB_OR_TEAM', 'Volunteer',            'VO', true,  null,                              true,  array['SITE', 'CLUB']),
  ('MEMBER',               'CLUB',         'Member',               'MB', true,  null,                              false, array['SITE', 'CLUB', 'SYSTEM']),
  ('COACH',                'TEAM',         'Coach',                'CO', true,  null,                              true,  array['SITE', 'CLUB', 'TEAM_ADMIN']),
  ('TEAM_MANAGER',         'TEAM',         'Team Manager',         'TM', true,  null,                              true,  array['SITE', 'CLUB', 'TEAM_ADMIN']),
  ('TEAM_ADMINISTRATION',  'TEAM',         'Team Administration',  'TA', false, array['COACH', 'TEAM_MANAGER'],    true,  array['SITE', 'CLUB']);

-- ---------------------------------------------------------------------
-- 2. club_memberships: state and provenance
-- ---------------------------------------------------------------------

alter table public.club_memberships
  add column state text,
  add column source text,
  add column granted_by uuid,
  add column granted_at timestamptz,
  add column approved_by uuid,
  add column approved_at timestamptz,
  add column reason text,
  add column suspended_level text,
  add column suspended_by uuid,
  add column suspended_at timestamptz,
  add column revoked_by uuid,
  add column revoked_at timestamptz,
  add column revocation_reason text,
  add column source_invitation_id uuid,
  add column source_request_id uuid,
  add column governance_title text;

comment on column public.club_memberships.state is
  'Canonical membership state (Phase 2 M.1). status, role and authority_suspended are legacy columns maintained from state and role_assignments.';
comment on column public.club_memberships.governance_title is
  'Title only (Chair, Secretary, ...), never authority. Kept in step with the legacy club_role_title column until Slice 10.';

-- ---------------------------------------------------------------------
-- 3. role_assignments
-- ---------------------------------------------------------------------

create table public.role_assignments (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  club_id uuid not null references public.clubs (id),
  team_id uuid references public.teams (id) on delete cascade,
  membership_id uuid not null references public.club_memberships (id) on delete cascade,
  role_key text not null references public.role_definitions (role_key),
  base_assignment_id uuid references public.role_assignments (id) on delete cascade,
  state text not null check (state in ('ACTIVE', 'SUSPENDED', 'REVOKED')),
  source text not null check (source in (
    'INVITATION', 'JOIN_REQUEST', 'TEAM_CODE', 'CLAIM_APPROVAL', 'SITE_ADMIN_ASSIGNMENT',
    'CLUB_ADMIN_ASSIGNMENT', 'TEAM_ADMIN_ASSIGNMENT', 'SAFEGUARDING_APPOINTMENT', 'LEGACY_BACKFILL'
  )),
  -- Provenance actors are plain ids: history outlives the identities it names.
  granted_by uuid,
  granted_at timestamptz not null default now(),
  reason text,
  attributes jsonb not null default '{}'::jsonb check (jsonb_typeof(attributes) = 'object'),
  suspended_level text check (suspended_level in ('CLUB', 'SITE')),
  suspended_by uuid,
  suspended_at timestamptz,
  revoked_by uuid,
  revoked_at timestamptz,
  revocation_reason text,
  confirmation_state text check (confirmation_state in ('PENDING_CONFIRMATION', 'CONFIRMED')),
  confirmed_by uuid,
  confirmed_at timestamptz,
  source_invitation_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint role_assignments_suspension_shape check ((state = 'SUSPENDED') = (suspended_level is not null)),
  constraint role_assignments_revocation_shape check ((state = 'REVOKED') = (revoked_at is not null)),
  constraint role_assignments_so_confirmation check ((role_key = 'SAFEGUARDING_OFFICER') = (confirmation_state is not null))
);

comment on table public.role_assignments is
  'Each club or team role a person holds (Phase 2 Y.7). Written only by trusted database functions; team_permissions is a compatibility view over it.';

create unique index role_assignments_open_unique
  on public.role_assignments (user_id, club_id, coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid), role_key)
  where state in ('ACTIVE', 'SUSPENDED');
create index role_assignments_user_state_idx on public.role_assignments (user_id, state);
create index role_assignments_club_role_state_idx on public.role_assignments (club_id, role_key, state);
create index role_assignments_team_state_idx on public.role_assignments (team_id, state) where team_id is not null;
create index role_assignments_membership_idx on public.role_assignments (membership_id);

-- ---------------------------------------------------------------------
-- 4. Access review queue (created by backfill and compatibility paths)
-- ---------------------------------------------------------------------

create table public.access_review_items (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('POSSIBLE_VOLUNTEER', 'VIEW_ONLY_UNRESOLVED', 'SO_LEGACY_CONFIRMATION', 'MINOR_WITH_STAFF_ROLE')),
  user_id uuid not null,
  club_id uuid,
  team_id uuid,
  membership_id uuid,
  assignment_id uuid,
  -- Identifiers and codes only; never personal details.
  detail jsonb not null default '{}'::jsonb check (jsonb_typeof(detail) = 'object'),
  state text not null default 'OPEN' check (state in ('OPEN', 'RESOLVED')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid,
  resolution text
);

comment on table public.access_review_items is
  'Site Admin review queue (Phase 2 AF "Needs Review"): legacy access that could not be mapped with certainty. Read by Full Site Admins; resolved through Users & Access (Slice 7).';

create unique index access_review_items_open_unique
  on public.access_review_items (kind, user_id,
    coalesce(club_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(team_id, '00000000-0000-0000-0000-000000000000'::uuid),
    coalesce(assignment_id, '00000000-0000-0000-0000-000000000000'::uuid))
  where state = 'OPEN';

-- ---------------------------------------------------------------------
-- 5. Helpers shared by the backfill, the compatibility layer and the RPCs
-- ---------------------------------------------------------------------

-- Legacy club role for a membership, from its assignments. Roles suspended
-- by a Site Admin's club-authority suspension (club deactivation) still count
-- here, exactly as the legacy row kept `role` and set `authority_suspended`;
-- any other suspension removes the role from the legacy view.
create or replace function internal.legacy_club_role(p_membership_id uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((
    select case ra.role_key when 'CLUB_ADMIN' then 'CLUB_ADMIN' when 'FIXTURES_SECRETARY' then 'FIXTURE_SECRETARY' end
    from public.role_assignments ra
    where ra.membership_id = p_membership_id
      and ra.team_id is null
      and ra.role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY')
      and (ra.state = 'ACTIVE' or (ra.state = 'SUSPENDED' and ra.suspended_level = 'SITE' and ra.attributes ->> 'suspension_cause' = 'CLUB_AUTHORITY'))
    order by case ra.role_key when 'CLUB_ADMIN' then 1 else 2 end
    limit 1
  ), 'BASIC_USER');
$$;

create or replace function internal.legacy_authority_suspended(p_membership_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.role_assignments ra
    where ra.membership_id = p_membership_id and ra.state = 'SUSPENDED' and ra.suspended_level = 'SITE'
      and ra.attributes ->> 'suspension_cause' = 'CLUB_AUTHORITY'
  );
$$;

-- Age at today's date from the person's own DOB (profile) or their adult
-- player record. Unknown DOB is not treated as a minor.
create or replace function internal.person_is_minor(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    coalesce(
      (select p.date_of_birth from public.profiles p where p.id = p_user_id),
      (select max(pl.date_of_birth) from public.players pl where pl.user_id = p_user_id)
    ) > (current_date - interval '18 years')::date,
    false);
$$;

revoke all on function internal.legacy_club_role(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.legacy_authority_suspended(uuid) from public, anon, authenticated, service_role;
revoke all on function internal.person_is_minor(uuid) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------
-- 6. Backfill
-- ---------------------------------------------------------------------

create temp table slice2_legacy_membership_snapshot on commit drop as
select id, role, status, authority_suspended from public.club_memberships;

create temp table slice2_legacy_team_permissions_snapshot on commit drop as
select id, membership_id, team_id, permission, created_by, created_at, assigned_group_id from public.team_permissions;

-- The backfill records provenance; it does not change when a membership was
-- last edited.
alter table public.club_memberships disable trigger set_updated_at;

-- 6a. Membership state, provenance and titles.
update public.club_memberships cm
set state = case cm.status when 'active' then 'ACTIVE' else 'REVOKED' end,
    granted_by = cm.created_by,
    granted_at = cm.created_at,
    governance_title = cm.club_role_title;

-- Provenance only where a record proves it; otherwise LEGACY_BACKFILL.
with evidence as (
  select cm.id,
    (select i.id from public.invitations i where i.club_id = cm.club_id and i.accepted_by = cm.user_id and i.status = 'accepted' order by i.accepted_at desc nulls last limit 1) as invitation_id,
    (select j.id from public.club_join_requests j where j.club_id = cm.club_id and j.requesting_user_id = cm.user_id and j.status = 'approved' order by j.decided_at desc nulls last limit 1) as request_id,
    exists (select 1 from public.club_claims cc join public.clubs c on c.directory_id = cc.directory_id
            where c.id = cm.club_id and cc.claimant_user_id = cm.user_id and cc.status = 'verified') as claim_approved,
    exists (select 1 from public.club_safeguarding_officer_invitations si
            where si.club_id = cm.club_id and si.accepted_by = cm.user_id and si.status = 'accepted') as so_appointed
  from public.club_memberships cm
)
update public.club_memberships cm
set source = case
      when e.claim_approved then 'CLAIM_APPROVAL'
      when e.invitation_id is not null then 'INVITATION'
      when e.request_id is not null then 'JOIN_REQUEST'
      when e.so_appointed then 'SAFEGUARDING_APPOINTMENT'
      else 'LEGACY_BACKFILL'
    end,
    source_invitation_id = case when not e.claim_approved then e.invitation_id end,
    source_request_id = case when not e.claim_approved and e.invitation_id is null then e.request_id end
from evidence e
where e.id = cm.id;

-- Revocation time from the audit history when it was recorded; otherwise
-- the migration time, marked as legacy.
update public.club_memberships cm
set revoked_at = coalesce((
      select max(a.changed_at) from public.audit_log a
      where a.table_name = 'club_memberships' and a.record_id = cm.id and a.action = 'update'
        and a.after ->> 'status' = 'revoked' and coalesce(a.before ->> 'status', '') <> 'revoked'
    ), now()),
    revoked_by = (
      select a.changed_by from public.audit_log a
      where a.table_name = 'club_memberships' and a.record_id = cm.id and a.action = 'update'
        and a.after ->> 'status' = 'revoked' and coalesce(a.before ->> 'status', '') <> 'revoked'
      order by a.changed_at desc limit 1
    ),
    revocation_reason = 'legacy'
where cm.state = 'REVOKED';

-- 6b. Club-level role for every membership (revoked memberships keep their
-- role as REVOKED history).
insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, source, granted_by, granted_at, revoked_at, revoked_by, revocation_reason, attributes)
select cm.user_id, cm.club_id, cm.id,
  case cm.role when 'CLUB_ADMIN' then 'CLUB_ADMIN' when 'FIXTURE_SECRETARY' then 'FIXTURES_SECRETARY' else 'MEMBER' end,
  case cm.state when 'ACTIVE' then 'ACTIVE' else 'REVOKED' end,
  'LEGACY_BACKFILL', cm.created_by, cm.created_at,
  case when cm.state = 'REVOKED' then cm.revoked_at end,
  case when cm.state = 'REVOKED' then cm.revoked_by end,
  case when cm.state = 'REVOKED' then 'legacy' end,
  case when cm.assigned_group_id is not null then jsonb_build_object('assigned_group_id', cm.assigned_group_id) else '{}'::jsonb end
from public.club_memberships cm;

-- 6c. Team permissions. team_admin → Team Manager + Team Administration;
-- manager → Team Manager; coach → Coach; view_only → no team role.
insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, source, granted_by, granted_at, revoked_at, revoked_by, revocation_reason, attributes)
select cm.user_id, cm.club_id, tp.team_id, cm.id,
  case tp.permission when 'coach' then 'COACH' else 'TEAM_MANAGER' end,
  case cm.state when 'ACTIVE' then 'ACTIVE' else 'REVOKED' end,
  'LEGACY_BACKFILL', tp.created_by, tp.created_at,
  case when cm.state = 'REVOKED' then cm.revoked_at end,
  case when cm.state = 'REVOKED' then cm.revoked_by end,
  case when cm.state = 'REVOKED' then 'legacy' end,
  jsonb_build_object('legacy_team_permission_id', tp.id)
    || case when tp.assigned_group_id is not null then jsonb_build_object('assigned_group_id', tp.assigned_group_id) else '{}'::jsonb end
from public.team_permissions tp
join public.club_memberships cm on cm.id = tp.membership_id
join public.teams t on t.id = tp.team_id and t.club_id = cm.club_id
where tp.permission in ('team_admin', 'manager', 'coach');

insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, base_assignment_id, state, source, granted_by, granted_at, revoked_at, revoked_by, revocation_reason, attributes)
select base.user_id, base.club_id, base.team_id, base.membership_id, 'TEAM_ADMINISTRATION', base.id,
  base.state, 'LEGACY_BACKFILL', base.granted_by, base.granted_at, base.revoked_at, base.revoked_by, base.revocation_reason,
  base.attributes
from public.role_assignments base
join public.team_permissions tp on tp.id = (base.attributes ->> 'legacy_team_permission_id')::uuid
where tp.permission = 'team_admin' and base.role_key = 'TEAM_MANAGER';

-- Cross-club team permissions never conferred authority (legacy helpers
-- join on the team's club); they are not carried over. Count must be zero.
do $$
declare v_count integer;
begin
  select count(*) into v_count
  from public.team_permissions tp
  join public.club_memberships cm on cm.id = tp.membership_id
  join public.teams t on t.id = tp.team_id
  where t.club_id <> cm.club_id;
  if v_count <> 0 then
    raise exception 'Slice 2 backfill: % team permission(s) point at a team outside the membership''s club; resolve before migrating.', v_count;
  end if;
end $$;

-- Review: a Coach whose own request or title said Volunteer.
insert into public.access_review_items (kind, user_id, club_id, team_id, membership_id, assignment_id, detail)
select 'POSSIBLE_VOLUNTEER', ra.user_id, ra.club_id, ra.team_id, ra.membership_id, ra.id, jsonb_build_object('legacy_permission', 'coach')
from public.role_assignments ra
join public.club_memberships cm on cm.id = ra.membership_id
where ra.role_key = 'COACH' and ra.state = 'ACTIVE'
  and (coalesce(cm.club_role_title, '') ~* 'volunteer'
       or exists (select 1 from public.club_join_requests j where j.club_id = ra.club_id and j.requesting_user_id = ra.user_id and j.requested_role ~* 'volunteer')
       or exists (select 1 from public.club_claims cc join public.clubs c on c.directory_id = cc.directory_id
                  where c.id = ra.club_id and cc.claimant_user_id = ra.user_id and cc.claimed_role ~* 'volunteer'))
on conflict do nothing;

-- Review: view_only that is not explained by the person being a player or
-- guardian on that team. Their club-level Member role already exists.
insert into public.access_review_items (kind, user_id, club_id, team_id, membership_id, detail)
select 'VIEW_ONLY_UNRESOLVED', cm.user_id, cm.club_id, tp.team_id, cm.id, jsonb_build_object('legacy_team_permission_id', tp.id)
from public.team_permissions tp
join public.club_memberships cm on cm.id = tp.membership_id and cm.state = 'ACTIVE'
where tp.permission = 'view_only'
  and not exists (
    select 1 from public.player_team_memberships ptm
    join public.players pl on pl.id = ptm.player_id
    where ptm.team_id = tp.team_id and ptm.status = 'active'
      and (pl.user_id = cm.user_id
           or exists (select 1 from public.guardians g where g.player_id = pl.id and g.guardian_user_id = cm.user_id and g.status = 'active'))
  )
on conflict do nothing;

-- 6d. Club authority suspended by a Site Admin (club deactivation): every
-- open assignment of that membership is SUSPENDED at SITE level.
update public.role_assignments ra
set state = 'SUSPENDED', suspended_level = 'SITE', suspended_at = coalesce(cm.authority_suspended_at, now()),
    attributes = ra.attributes || jsonb_build_object('suspension_cause', 'CLUB_AUTHORITY')
from public.club_memberships cm
where cm.id = ra.membership_id and cm.authority_suspended and ra.state = 'ACTIVE';

-- 6e. Active Safeguarding Officers with an account. Legacy acceptance is
-- treated as confirmed, with a Site Admin review task.
do $$
declare v_unmapped integer;
begin
  select count(*) into v_unmapped
  from public.club_safeguarding_officers o
  where o.status = 'active' and o.user_id is not null
    and not exists (select 1 from public.club_memberships cm where cm.club_id = o.club_id and cm.user_id = o.user_id and cm.state = 'ACTIVE');
  if v_unmapped <> 0 then
    raise exception 'Slice 2 backfill: % active Safeguarding Officer(s) have no active membership of their club; resolve before migrating.', v_unmapped;
  end if;
end $$;

insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, suspended_level, suspended_at, source, granted_by, granted_at, attributes, confirmation_state, confirmed_at)
select o.user_id, o.club_id, cm.id, 'SAFEGUARDING_OFFICER',
  case when cm.authority_suspended then 'SUSPENDED' else 'ACTIVE' end,
  case when cm.authority_suspended then 'SITE' end,
  case when cm.authority_suspended then coalesce(cm.authority_suspended_at, now()) end,
  'SAFEGUARDING_APPOINTMENT', o.created_by, coalesce(o.activated_at, o.created_at),
  jsonb_build_object('officer_type', o.officer_type, 'safeguarding_officer_id', o.id)
    || case when cm.authority_suspended then jsonb_build_object('suspension_cause', 'CLUB_AUTHORITY') else '{}'::jsonb end,
  'CONFIRMED', o.activated_at
from public.club_safeguarding_officers o
join public.club_memberships cm on cm.club_id = o.club_id and cm.user_id = o.user_id and cm.state = 'ACTIVE'
where o.status = 'active' and o.user_id is not null;

insert into public.access_review_items (kind, user_id, club_id, assignment_id, detail)
select 'SO_LEGACY_CONFIRMATION', ra.user_id, ra.club_id, ra.id, jsonb_build_object('officer_type', ra.attributes ->> 'officer_type')
from public.role_assignments ra
where ra.role_key = 'SAFEGUARDING_OFFICER' and ra.source = 'SAFEGUARDING_APPOINTMENT'
on conflict do nothing;

-- 6f. Minors holding a staff role: suspended, not revoked, pending a decision.
insert into public.access_review_items (kind, user_id, club_id, team_id, membership_id, assignment_id, detail)
select 'MINOR_WITH_STAFF_ROLE', ra.user_id, ra.club_id, ra.team_id, ra.membership_id, ra.id, jsonb_build_object('role_key', ra.role_key)
from public.role_assignments ra
join public.role_definitions rd on rd.role_key = ra.role_key and rd.minor_prohibited
where ra.state = 'ACTIVE' and internal.person_is_minor(ra.user_id)
on conflict do nothing;

update public.role_assignments ra
set state = 'SUSPENDED', suspended_level = 'SITE', suspended_at = now(),
    attributes = ra.attributes || jsonb_build_object('suspension_cause', 'MINOR_PROHIBITION')
where ra.state = 'ACTIVE'
  and exists (select 1 from public.access_review_items ri where ri.kind = 'MINOR_WITH_STAFF_ROLE' and ri.assignment_id = ra.id and ri.state = 'OPEN');

alter table public.club_memberships enable trigger set_updated_at;

-- 6g. Finish membership columns.
alter table public.club_memberships alter column state set not null;
alter table public.club_memberships alter column source set not null;
alter table public.club_memberships alter column granted_at set default now();
alter table public.club_memberships alter column state set default 'ACTIVE';

alter table public.club_memberships drop constraint club_memberships_status_check;
alter table public.club_memberships add constraint club_memberships_status_check
  check (status in ('active', 'revoked', 'pending', 'suspended', 'declined', 'expired')) not valid;
alter table public.club_memberships add constraint club_memberships_state_check
  check (state in ('PENDING', 'ACTIVE', 'SUSPENDED', 'REVOKED', 'DECLINED', 'EXPIRED')) not valid;
alter table public.club_memberships add constraint club_memberships_source_check
  check (source in ('INVITATION', 'JOIN_REQUEST', 'TEAM_CODE', 'CLAIM_APPROVAL', 'SITE_ADMIN_ASSIGNMENT', 'SAFEGUARDING_APPOINTMENT', 'LEGACY_BACKFILL')) not valid;
alter table public.club_memberships add constraint club_memberships_suspension_shape
  check ((state = 'SUSPENDED') = (suspended_level is not null)) not valid;
alter table public.club_memberships add constraint club_memberships_suspended_level_check
  check (suspended_level is null or suspended_level in ('CLUB', 'SITE')) not valid;
alter table public.club_memberships add constraint club_memberships_revocation_shape
  check ((state = 'REVOKED') = (revoked_at is not null)) not valid;
alter table public.club_memberships add constraint club_memberships_status_matches_state
  check (status = lower(state)) not valid;
alter table public.club_memberships validate constraint club_memberships_status_check;
alter table public.club_memberships validate constraint club_memberships_state_check;
alter table public.club_memberships validate constraint club_memberships_source_check;
alter table public.club_memberships validate constraint club_memberships_suspension_shape;
alter table public.club_memberships validate constraint club_memberships_suspended_level_check;
alter table public.club_memberships validate constraint club_memberships_revocation_shape;
alter table public.club_memberships validate constraint club_memberships_status_matches_state;

-- A removed membership is history: only one open membership per person and
-- club, and re-admission is a new row.
alter table public.club_memberships drop constraint club_memberships_club_id_user_id_key;
create unique index club_memberships_open_unique on public.club_memberships (club_id, user_id)
  where state in ('PENDING', 'ACTIVE', 'SUSPENDED');
create index club_memberships_user_state_idx on public.club_memberships (user_id, state);
create index club_memberships_club_state_idx on public.club_memberships (club_id, state);

-- ---------------------------------------------------------------------
-- 7. Parity: the derived legacy columns equal what they were
-- ---------------------------------------------------------------------

do $$
declare
  v_role_diff integer;
  v_suspended_diff integer;
begin
  select count(*) into v_role_diff
  from slice2_legacy_membership_snapshot s
  where s.status = 'active' and s.role is distinct from internal.legacy_club_role(s.id)
    and not exists (select 1 from public.access_review_items ri where ri.kind = 'MINOR_WITH_STAFF_ROLE' and ri.membership_id = s.id);
  select count(*) into v_suspended_diff
  from slice2_legacy_membership_snapshot s
  where s.status = 'active' and s.authority_suspended is distinct from internal.legacy_authority_suspended(s.id)
    and not exists (select 1 from public.access_review_items ri where ri.kind = 'MINOR_WITH_STAFF_ROLE' and ri.membership_id = s.id);
  if v_role_diff <> 0 or v_suspended_diff <> 0 then
    raise exception 'Slice 2 backfill parity failed: % role and % authority_suspended difference(s).', v_role_diff, v_suspended_diff;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 8. team_permissions becomes a compatibility view
-- ---------------------------------------------------------------------

alter table public.team_permissions rename to team_permissions_legacy;
drop policy if exists team_permissions_select_scoped on public.team_permissions_legacy;
drop policy if exists team_permissions_insert_scoped on public.team_permissions_legacy;
drop policy if exists team_permissions_update_scoped on public.team_permissions_legacy;
drop policy if exists team_permissions_delete_scoped on public.team_permissions_legacy;
drop trigger if exists audit_row_change on public.team_permissions_legacy;
revoke all on public.team_permissions_legacy from public, anon, authenticated, service_role;
comment on table public.team_permissions_legacy is
  'Archive of team permissions as they stood before Slice 2 (backfilled into role_assignments). No API access; dropped in Slice 10.';

create view public.team_permissions
with (security_invoker = true)
as
select distinct on (ra.membership_id, ra.team_id)
  ra.id,
  ra.membership_id,
  ra.team_id,
  case ra.role_key when 'TEAM_ADMINISTRATION' then 'team_admin' when 'TEAM_MANAGER' then 'manager' else 'coach' end as permission,
  ra.granted_by as created_by,
  ra.granted_at as created_at,
  nullif(ra.attributes ->> 'assigned_group_id', '')::uuid as assigned_group_id
from public.role_assignments ra
where ra.team_id is not null
  and ra.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH')
  and (ra.state = 'ACTIVE' or (ra.state = 'SUSPENDED' and ra.suspended_level = 'SITE' and ra.attributes ->> 'suspension_cause' = 'CLUB_AUTHORITY'))
order by ra.membership_id, ra.team_id,
  case ra.role_key when 'TEAM_ADMINISTRATION' then 1 when 'TEAM_MANAGER' then 2 else 3 end,
  ra.granted_at, ra.id;

comment on view public.team_permissions is
  'Compatibility view (Phase 2 Y.7): one legacy permission per membership and team, projected from team role assignments. Legacy writes by trusted backend sessions are routed to role_assignments by an INSTEAD OF trigger; the application writes through RPCs.';

-- Parity with the archived rows (view_only is intentionally not projected).
do $$
declare v_missing integer; v_extra integer;
begin
  select count(*) into v_missing
  from slice2_legacy_team_permissions_snapshot s
  join public.club_memberships cm on cm.id = s.membership_id and cm.state = 'ACTIVE'
  where s.permission <> 'view_only'
    and not exists (select 1 from public.team_permissions v where v.membership_id = s.membership_id and v.team_id = s.team_id and v.permission = s.permission);
  select count(*) into v_extra
  from public.team_permissions v
  where not exists (select 1 from slice2_legacy_team_permissions_snapshot s where s.membership_id = v.membership_id and s.team_id = v.team_id and s.permission = v.permission);
  if v_missing <> 0 or v_extra <> 0 then
    raise exception 'Slice 2 team permission parity failed: % missing, % extra.', v_missing, v_extra;
  end if;
end $$;

-- Objects that referenced the old table by identity now read the view. A
-- request to join is listed under pending requests, not as a membership.
create or replace view public.admin_user_overview
with (security_invoker = true)
as
 SELECT p.id AS user_id,
    p.first_name,
    p.surname,
    p.email,
    p.created_at AS user_created_at,
    (sa.user_id IS NOT NULL) AS is_site_admin,
    COALESCE(memberships.data, '[]'::jsonb) AS memberships,
    COALESCE(pending.data, '[]'::jsonb) AS pending_requests,
    memberships.club_names,
    memberships.team_names,
    COALESCE(memberships.has_active_membership, false) AS has_active_membership,
    COALESCE(memberships.highest_role, 0) AS highest_role,
    COALESCE(memberships.has_club_admin, false) AS has_club_admin,
    COALESCE(memberships.has_fixtures_admin, false) AS has_fixtures_admin,
    COALESCE(memberships.has_team_admin, false) AS has_team_admin,
    (jsonb_array_length(COALESCE(pending.data, '[]'::jsonb)) > 0) AS has_pending_request,
    p.account_status
   FROM (((public.profiles p
     LEFT JOIN public.site_admins sa ON (((sa.user_id = p.id) AND (sa.status = 'active'::text))))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('membershipId', cm.id, 'clubId', c.id, 'directoryId', cd.id, 'clubName', cd.name, 'role', cm.role, 'clubRoleTitle', cm.club_role_title, 'status', cm.status, 'teamRoles', COALESCE(tp.data, '[]'::jsonb)) ORDER BY cm.created_at) AS data,
            string_agg(DISTINCT cd.name, ', '::text) AS club_names,
            string_agg(DISTINCT tp.names, ', '::text) FILTER (WHERE (tp.names IS NOT NULL)) AS team_names,
            bool_or((cm.status = 'active'::text)) AS has_active_membership,
            max(
                CASE cm.role
                    WHEN 'CLUB_ADMIN'::text THEN 3
                    WHEN 'FIXTURE_SECRETARY'::text THEN 2
                    WHEN 'BASIC_USER'::text THEN 1
                    ELSE 0
                END) AS highest_role,
            bool_or(((cm.status = 'active'::text) AND (cm.role = 'CLUB_ADMIN'::text))) AS has_club_admin,
            bool_or(((cm.status = 'active'::text) AND (cm.role = 'FIXTURE_SECRETARY'::text))) AS has_fixtures_admin,
            bool_or(((cm.status = 'active'::text) AND (EXISTS ( SELECT 1
                   FROM public.team_permissions tp3
                  WHERE ((tp3.membership_id = cm.id) AND (tp3.permission = ANY (ARRAY['team_admin'::text, 'coach'::text, 'manager'::text]))))))) AS has_team_admin
           FROM (((public.club_memberships cm
             JOIN public.clubs c ON ((c.id = cm.club_id)))
             JOIN public.club_directory cd ON ((cd.id = c.directory_id)))
             LEFT JOIN LATERAL ( SELECT jsonb_agg(jsonb_build_object('teamId', t.id, 'teamName', t.display_name, 'permission', tp2.permission)) AS data,
                    string_agg(t.display_name, ', '::text) AS names
                   FROM (public.team_permissions tp2
                     JOIN public.teams t ON ((t.id = tp2.team_id)))
                  WHERE (tp2.membership_id = cm.id)) tp ON (true))
          WHERE ((cm.user_id = p.id) AND (cm.state <> ALL (ARRAY['PENDING'::text, 'DECLINED'::text, 'EXPIRED'::text])))) memberships ON (true))
     LEFT JOIN LATERAL ( SELECT jsonb_agg(sub.x) AS data
           FROM ( SELECT jsonb_build_object('type', 'claim', 'clubName', cd2.name, 'role', cc.claimed_role, 'status', cc.status, 'createdAt', cc.created_at) AS x
                   FROM (public.club_claims cc
                     JOIN public.club_directory cd2 ON ((cd2.id = cc.directory_id)))
                  WHERE ((cc.claimant_user_id = p.id) AND (cc.status = 'pending'::text))
                UNION ALL
                 SELECT jsonb_build_object('type', 'join_request', 'clubName', cd3.name, 'role', cjr.requested_role, 'status', cjr.status, 'createdAt', cjr.created_at) AS x
                   FROM ((public.club_join_requests cjr
                     JOIN public.clubs c3 ON ((c3.id = cjr.club_id)))
                     JOIN public.club_directory cd3 ON ((cd3.id = c3.directory_id)))
                  WHERE ((cjr.requesting_user_id = p.id) AND (cjr.status = 'pending'::text))) sub) pending ON (true));

drop policy if exists club_setup_state_select on public.club_setup_state;
create policy club_setup_state_select on public.club_setup_state
  for select
  using (
    internal.is_site_admin()
    or exists (
      select 1 from public.club_memberships cm
      where cm.club_id = club_setup_state.club_id and cm.user_id = auth.uid() and cm.status = 'active'
    )
    or exists (
      select 1 from public.team_permissions tp
      join public.club_memberships cm2 on cm2.id = tp.membership_id
      where cm2.user_id = auth.uid() and cm2.club_id = club_setup_state.club_id
    )
  );

-- ---------------------------------------------------------------------
-- 9. Compatibility layer
-- ---------------------------------------------------------------------

-- The canonical writers and this layer's own derived updates run with
-- ovalball.membership_sync = on, so nothing is routed twice.
create or replace function internal.membership_sync_on()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_previous text := coalesce(current_setting('ovalball.membership_sync', true), '');
begin
  perform pg_catalog.set_config('ovalball.membership_sync', 'on', true);
  return v_previous;
end;
$$;

create or replace function internal.membership_sync_restore(p_previous text)
returns void
language sql
volatile
set search_path = ''
as $$
  select pg_catalog.set_config('ovalball.membership_sync', coalesce(p_previous, ''), true);
$$;

revoke all on function internal.membership_sync_on() from public, anon, authenticated, service_role;
revoke all on function internal.membership_sync_restore(text) from public, anon, authenticated, service_role;

-- Recompute a membership's legacy role and authority flag from its
-- assignments.
create or replace function internal.refresh_membership_legacy_columns(p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev text := internal.membership_sync_on();
begin
  update public.club_memberships cm
  set role = internal.legacy_club_role(cm.id),
      authority_suspended = internal.legacy_authority_suspended(cm.id)
  where cm.id = p_membership_id
    and (cm.role is distinct from internal.legacy_club_role(cm.id)
         or cm.authority_suspended is distinct from internal.legacy_authority_suspended(cm.id));
  perform internal.membership_sync_restore(v_prev);
end;
$$;

revoke all on function internal.refresh_membership_legacy_columns(uuid) from public, anon, authenticated, service_role;

create or replace function internal.role_assignment_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_scope text;
  v_team_club uuid;
  v_membership public.club_memberships;
begin
  select rd.scope into v_scope from public.role_definitions rd where rd.role_key = new.role_key;
  if v_scope = 'CLUB' and new.team_id is not null then
    raise exception 'The % role is held club-wide, not for a team.', new.role_key using errcode = '23514';
  elsif v_scope = 'TEAM' and new.team_id is null then
    raise exception 'The % role is held for a team.', new.role_key using errcode = '23514';
  end if;
  if new.team_id is not null then
    select t.club_id into v_team_club from public.teams t where t.id = new.team_id;
    if v_team_club is distinct from new.club_id then
      raise exception 'That team is not part of this club.' using errcode = '42501';
    end if;
  end if;
  select * into v_membership from public.club_memberships cm where cm.id = new.membership_id;
  if v_membership.club_id is distinct from new.club_id or v_membership.user_id is distinct from new.user_id then
    raise exception 'A role assignment must belong to that person''s membership of the same club.' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' then
    if old.state = 'REVOKED' and new.state <> 'REVOKED' then
      raise exception 'A revoked role cannot be restored. Assign it again.' using errcode = '23514';
    end if;
    if new.user_id <> old.user_id or new.club_id <> old.club_id or new.team_id is distinct from old.team_id
       or new.role_key <> old.role_key or new.membership_id <> old.membership_id then
      raise exception 'A role assignment''s person, club, team and role never change.' using errcode = '23514';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function internal.role_assignment_facts() from public, anon, authenticated, service_role;

create trigger a_role_assignment_facts
  before insert or update on public.role_assignments
  for each row execute function internal.role_assignment_facts();

create or replace function internal.role_assignment_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    -- Team Administration ends with the Coach or Team Manager it rests on.
    if tg_op = 'UPDATE' and new.state is distinct from old.state and new.role_key in ('COACH', 'TEAM_MANAGER') then
      if new.state = 'REVOKED' then
        update public.role_assignments ta
        set state = 'REVOKED', revoked_at = now(), revoked_by = coalesce(new.revoked_by, auth.uid()),
            revocation_reason = 'Its base role ended', suspended_level = null
        where ta.base_assignment_id = new.id and ta.state <> 'REVOKED';
      end if;
    end if;
    perform internal.refresh_membership_legacy_columns(new.membership_id);
    return null;
  end if;
  perform internal.refresh_membership_legacy_columns(old.membership_id);
  return null;
end;
$$;

revoke all on function internal.role_assignment_after_change() from public, anon, authenticated, service_role;

create trigger role_assignment_after_change
  after insert or update or delete on public.role_assignments
  for each row execute function internal.role_assignment_after_change();

create trigger audit_row_change after insert or update or delete on public.role_assignments
  for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.access_review_items
  for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or update or delete on public.role_definitions
  for each row execute function internal.audit_row_change();

-- Membership rows: state is canonical; the legacy status follows it, and a
-- legacy write of status or role by a backend session is translated.
create or replace function internal.club_membership_facts()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync boolean := coalesce(current_setting('ovalball.membership_sync', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    -- state defaults to ACTIVE, so a legacy insert that names another status
    -- is read from that status.
    if new.state is null or (new.state = 'ACTIVE' and lower(coalesce(new.status, 'active')) <> 'active') then
      new.state := case lower(coalesce(new.status, 'active'))
        when 'active' then 'ACTIVE' when 'revoked' then 'REVOKED' when 'pending' then 'PENDING'
        when 'declined' then 'DECLINED' when 'expired' then 'EXPIRED' when 'suspended' then 'SUSPENDED' else 'ACTIVE' end;
    end if;
    new.source := coalesce(new.source, 'LEGACY_BACKFILL');
    new.granted_by := coalesce(new.granted_by, new.created_by);
    new.granted_at := coalesce(new.granted_at, new.created_at, now());
    if new.state = 'REVOKED' and new.revoked_at is null then new.revoked_at := now(); end if;
    if new.state = 'SUSPENDED' and new.suspended_level is null then new.suspended_level := 'CLUB'; end if;
    new.governance_title := coalesce(new.governance_title, new.club_role_title);
    new.club_role_title := coalesce(new.club_role_title, new.governance_title);
    new.status := lower(new.state);
    return new;
  end if;

  -- UPDATE
  if new.state is distinct from old.state then
    null;
  elsif new.status is distinct from old.status and not v_sync then
    new.state := case lower(new.status)
      when 'active' then 'ACTIVE'
      when 'revoked' then 'REVOKED' when 'pending' then 'PENDING' when 'declined' then 'DECLINED'
      when 'expired' then 'EXPIRED' when 'suspended' then 'SUSPENDED' else old.state end;
  end if;

  if new.state is distinct from old.state then
    if old.state in ('REVOKED', 'DECLINED', 'EXPIRED') then
      raise exception 'A removed membership cannot be switched back on. Re-admit the person as a new membership.' using errcode = '23514';
    end if;
    if old.state = 'PENDING' and new.state not in ('ACTIVE', 'DECLINED', 'EXPIRED') then
      raise exception 'A membership request can only be approved, declined or expire.' using errcode = '23514';
    end if;
    if old.state <> 'PENDING' and new.state in ('PENDING', 'DECLINED', 'EXPIRED') then
      raise exception 'Only a membership request can be declined or expire, and nothing returns to being a request.' using errcode = '23514';
    end if;
    if new.state = 'REVOKED' then
      new.revoked_at := coalesce(new.revoked_at, now());
      new.suspended_level := null;
    elsif new.state = 'SUSPENDED' then
      new.suspended_level := coalesce(new.suspended_level, 'CLUB');
      new.suspended_at := coalesce(new.suspended_at, now());
    elsif new.state = 'ACTIVE' then
      new.suspended_level := null;
    end if;
  end if;

  if new.club_id <> old.club_id or new.user_id <> old.user_id then
    raise exception 'A membership''s person and club never change.' using errcode = '23514';
  end if;

  if new.governance_title is distinct from old.governance_title then
    new.club_role_title := new.governance_title;
  elsif new.club_role_title is distinct from old.club_role_title then
    new.governance_title := new.club_role_title;
  end if;

  new.status := lower(new.state);
  return new;
end;
$$;

revoke all on function internal.club_membership_facts() from public, anon, authenticated, service_role;

create trigger a_club_membership_facts
  before insert or update on public.club_memberships
  for each row execute function internal.club_membership_facts();

-- Consequences of a membership change: cascade to its role assignments, and
-- translate a legacy role or authority write into assignments.
create or replace function internal.club_membership_after_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_sync boolean := coalesce(current_setting('ovalball.membership_sync', true), '') = 'on';
  v_prev text;
  v_role_key text;
  v_actor uuid := auth.uid();
begin
  v_prev := internal.membership_sync_on();

  if tg_op = 'INSERT' then
    -- A legacy insert (backend session) states a role; record it.
    if not v_sync and new.state in ('ACTIVE', 'SUSPENDED') then
      v_role_key := case new.role when 'CLUB_ADMIN' then 'CLUB_ADMIN' when 'FIXTURE_SECRETARY' then 'FIXTURES_SECRETARY' else 'MEMBER' end;
      insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, suspended_level, source, granted_by, granted_at)
      values (new.user_id, new.club_id, new.id, v_role_key,
              case when new.state = 'SUSPENDED' then 'SUSPENDED' else 'ACTIVE' end,
              case when new.state = 'SUSPENDED' then new.suspended_level end,
              'LEGACY_BACKFILL', coalesce(new.created_by, v_actor), new.granted_at);
      if new.authority_suspended then
        update public.role_assignments set state = 'SUSPENDED', suspended_level = 'SITE', suspended_at = now(),
               attributes = attributes || jsonb_build_object('suspension_cause', 'CLUB_AUTHORITY')
        where membership_id = new.id and state = 'ACTIVE';
      end if;
    end if;
    perform internal.refresh_membership_legacy_columns(new.id);
    perform internal.membership_sync_restore(v_prev);
    return null;
  end if;

  -- State cascade (every path).
  if new.state is distinct from old.state then
    if new.state = 'REVOKED' then
      update public.role_assignments
      set state = 'REVOKED', revoked_at = now(), revoked_by = coalesce(new.revoked_by, v_actor),
          revocation_reason = coalesce(new.revocation_reason, 'Membership removed'), suspended_level = null
      where membership_id = new.id and state <> 'REVOKED';
    elsif new.state = 'SUSPENDED' then
      update public.role_assignments
      set state = 'SUSPENDED', suspended_level = new.suspended_level, suspended_at = now(), suspended_by = coalesce(new.suspended_by, v_actor),
          attributes = attributes || jsonb_build_object('suspension_cause', 'MEMBERSHIP')
      where membership_id = new.id and state = 'ACTIVE';
    elsif new.state = 'ACTIVE' and old.state = 'SUSPENDED' then
      update public.role_assignments
      set state = 'ACTIVE', suspended_level = null, suspended_at = null, suspended_by = null,
          attributes = attributes - 'suspension_cause'
      where membership_id = new.id and state = 'SUSPENDED' and attributes ->> 'suspension_cause' = 'MEMBERSHIP';
    end if;
  end if;

  -- Legacy role write by a backend session.
  if not v_sync and new.role is distinct from old.role and new.state in ('ACTIVE', 'SUSPENDED') then
    v_role_key := case new.role when 'CLUB_ADMIN' then 'CLUB_ADMIN' when 'FIXTURE_SECRETARY' then 'FIXTURES_SECRETARY' else 'MEMBER' end;
    update public.role_assignments
    set state = 'REVOKED', revoked_at = now(), revoked_by = v_actor, revocation_reason = 'Changed through the legacy club role', suspended_level = null
    where membership_id = new.id and team_id is null and role_key in ('CLUB_ADMIN', 'FIXTURES_SECRETARY', 'MEMBER')
      and role_key <> v_role_key and state <> 'REVOKED';
    if not exists (select 1 from public.role_assignments where membership_id = new.id and team_id is null and role_key = v_role_key and state in ('ACTIVE', 'SUSPENDED')) then
      insert into public.role_assignments (user_id, club_id, membership_id, role_key, state, suspended_level, source, granted_by)
      values (new.user_id, new.club_id, new.id, v_role_key,
              case when new.state = 'SUSPENDED' then 'SUSPENDED' else 'ACTIVE' end,
              case when new.state = 'SUSPENDED' then new.suspended_level end,
              'LEGACY_BACKFILL', v_actor);
    end if;
  end if;

  -- Legacy authority flag write by a backend session.
  if not v_sync and new.authority_suspended is distinct from old.authority_suspended then
    if new.authority_suspended then
      update public.role_assignments set state = 'SUSPENDED', suspended_level = 'SITE', suspended_at = now(), suspended_by = v_actor,
             attributes = attributes || jsonb_build_object('suspension_cause', 'CLUB_AUTHORITY')
      where membership_id = new.id and state = 'ACTIVE';
    else
      update public.role_assignments set state = 'ACTIVE', suspended_level = null, suspended_at = null, suspended_by = null,
             attributes = attributes - 'suspension_cause'
      where membership_id = new.id and state = 'SUSPENDED' and attributes ->> 'suspension_cause' = 'CLUB_AUTHORITY';
    end if;
  end if;

  if not v_sync and new.assigned_group_id is distinct from old.assigned_group_id then
    update public.role_assignments
    set attributes = case when new.assigned_group_id is null then attributes - 'assigned_group_id'
                          else attributes || jsonb_build_object('assigned_group_id', new.assigned_group_id) end
    where membership_id = new.id and team_id is null and state in ('ACTIVE', 'SUSPENDED');
  end if;

  perform internal.refresh_membership_legacy_columns(new.id);
  perform internal.membership_sync_restore(v_prev);
  return null;
end;
$$;

revoke all on function internal.club_membership_after_change() from public, anon, authenticated, service_role;

create trigger club_membership_after_change
  after insert or update on public.club_memberships
  for each row execute function internal.club_membership_after_change();

-- Legacy writes to the team_permissions view by a backend session.
create or replace function internal.legacy_team_permission_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_membership public.club_memberships;
  v_prev text;
  v_base_role text;
  v_base_id uuid;
  v_ta_id uuid;
  v_state text;
  v_actor uuid := auth.uid();
  v_attributes jsonb;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    v_prev := internal.membership_sync_on();
    update public.role_assignments
    set state = 'REVOKED', revoked_at = now(), revoked_by = v_actor,
        revocation_reason = 'Removed through legacy team access', suspended_level = null
    where membership_id = old.membership_id and team_id = old.team_id
      and role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION') and state <> 'REVOKED';
    perform internal.membership_sync_restore(v_prev);
    if tg_op = 'DELETE' then
      return old;
    end if;
  end if;

  select * into v_membership from public.club_memberships where id = new.membership_id;
  if v_membership.id is null then
    raise exception 'Membership not found.' using errcode = '23503';
  end if;
  if new.permission not in ('team_admin', 'coach', 'manager', 'view_only') then
    raise exception 'Unknown team permission %.', new.permission using errcode = '23514';
  end if;

  v_prev := internal.membership_sync_on();

  if new.permission = 'view_only' then
    insert into public.access_review_items (kind, user_id, club_id, team_id, membership_id, detail)
    values ('VIEW_ONLY_UNRESOLVED', v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, jsonb_build_object('legacy_write', true))
    on conflict do nothing;
    perform internal.membership_sync_restore(v_prev);
    new.id := coalesce(new.id, gen_random_uuid());
    return new;
  end if;

  v_state := case v_membership.state when 'ACTIVE' then 'ACTIVE' when 'SUSPENDED' then 'SUSPENDED' else 'REVOKED' end;
  v_attributes := case when new.assigned_group_id is not null then jsonb_build_object('assigned_group_id', new.assigned_group_id) else '{}'::jsonb end;
  v_base_role := case new.permission when 'coach' then 'COACH' else 'TEAM_MANAGER' end;

  -- A replace, as the legacy upsert was: other team roles for this pair end.
  update public.role_assignments
  set state = 'REVOKED', revoked_at = now(), revoked_by = v_actor,
      revocation_reason = 'Replaced through legacy team access', suspended_level = null
  where membership_id = v_membership.id and team_id = new.team_id and state <> 'REVOKED'
    and (role_key not in (v_base_role, 'TEAM_ADMINISTRATION') or (role_key = 'TEAM_ADMINISTRATION' and new.permission <> 'team_admin'));

  select id into v_base_id from public.role_assignments
  where membership_id = v_membership.id and team_id = new.team_id and role_key = v_base_role and state in ('ACTIVE', 'SUSPENDED');
  if v_base_id is null then
    insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, state, suspended_level, source, granted_by, granted_at, revoked_at, revocation_reason, attributes)
    values (v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, v_base_role, v_state,
            case when v_state = 'SUSPENDED' then v_membership.suspended_level end,
            'LEGACY_BACKFILL', coalesce(new.created_by, v_actor), coalesce(new.created_at, now()),
            case when v_state = 'REVOKED' then now() end,
            case when v_state = 'REVOKED' then 'Membership not active' end,
            v_attributes)
    returning id into v_base_id;
  end if;

  if new.permission = 'team_admin' then
    select id into v_ta_id from public.role_assignments
    where membership_id = v_membership.id and team_id = new.team_id and role_key = 'TEAM_ADMINISTRATION' and state in ('ACTIVE', 'SUSPENDED');
    if v_ta_id is null then
      insert into public.role_assignments (user_id, club_id, team_id, membership_id, role_key, base_assignment_id, state, suspended_level, source, granted_by, granted_at, revoked_at, revocation_reason, attributes)
      values (v_membership.user_id, v_membership.club_id, new.team_id, v_membership.id, 'TEAM_ADMINISTRATION', v_base_id, v_state,
              case when v_state = 'SUSPENDED' then v_membership.suspended_level end,
              'LEGACY_BACKFILL', coalesce(new.created_by, v_actor), coalesce(new.created_at, now()),
              case when v_state = 'REVOKED' then now() end,
              case when v_state = 'REVOKED' then 'Membership not active' end,
              v_attributes)
      returning id into v_ta_id;
    end if;
  end if;

  if v_membership.authority_suspended then
    update public.role_assignments set state = 'SUSPENDED', suspended_level = 'SITE', suspended_at = now(),
           attributes = attributes || jsonb_build_object('suspension_cause', 'CLUB_AUTHORITY')
    where membership_id = v_membership.id and team_id = new.team_id and state = 'ACTIVE';
  end if;

  perform internal.refresh_membership_legacy_columns(v_membership.id);
  perform internal.membership_sync_restore(v_prev);
  new.id := coalesce(v_ta_id, v_base_id);
  return new;
end;
$$;

revoke all on function internal.legacy_team_permission_write() from public, anon, authenticated, service_role;

create trigger legacy_team_permission_write
  instead of insert or update or delete on public.team_permissions
  for each row execute function internal.legacy_team_permission_write();

-- ---------------------------------------------------------------------
-- 10. Row access and grants
-- ---------------------------------------------------------------------

alter table public.role_definitions enable row level security;
alter table public.role_assignments enable row level security;
alter table public.access_review_items enable row level security;

create policy role_definitions_select on public.role_definitions
  for select to authenticated using (true);

-- The person and their club's admins. Site-wide reads use the Full Site
-- Admin stand-in (as security_events does in Slice 1) rather than the legacy
-- internal.is_site_admin() bypass, which gains no new policy here; other Site
-- Admin profiles read team roles again through site capabilities (Slice 7).
create policy role_assignments_select on public.role_assignments
  for select to authenticated
  using (
    user_id = (select auth.uid())
    or (select internal.is_full_site_admin())
    or internal.is_club_admin(club_id)
  );

create policy access_review_items_select on public.access_review_items
  for select to authenticated
  using ((select internal.is_full_site_admin()));

revoke all on public.role_definitions from public, anon, authenticated, service_role;
revoke all on public.role_assignments from public, anon, authenticated, service_role;
revoke all on public.access_review_items from public, anon, authenticated, service_role;
revoke all on public.team_permissions from public, anon, authenticated, service_role;

grant select on public.role_definitions to authenticated, service_role;
grant select on public.role_assignments to authenticated, service_role;
grant select on public.access_review_items to authenticated, service_role;
grant select on public.team_permissions to authenticated, service_role;

-- ---------------------------------------------------------------------
-- 11. Verification (Phase 2 AF): each must be zero
-- ---------------------------------------------------------------------

do $$
declare
  v_null_state integer;
  v_active_without_role integer;
  v_suspended_with_active integer;
  v_team_parity integer;
  v_so_unmapped integer;
  v_status_mismatch integer;
begin
  select count(*) into v_null_state from public.club_memberships where state is null;

  select count(*) into v_active_without_role
  from public.club_memberships cm
  where cm.state = 'ACTIVE' and not exists (
    select 1 from public.role_assignments ra
    where ra.membership_id = cm.id and ra.team_id is null
      and ra.role_key = case cm.role when 'CLUB_ADMIN' then 'CLUB_ADMIN' when 'FIXTURE_SECRETARY' then 'FIXTURES_SECRETARY' else 'MEMBER' end
  );

  select count(*) into v_suspended_with_active
  from public.club_memberships cm
  where cm.authority_suspended and exists (select 1 from public.role_assignments ra where ra.membership_id = cm.id and ra.state = 'ACTIVE');

  select count(*) into v_team_parity
  from public.team_permissions_legacy tp
  join public.club_memberships cm on cm.id = tp.membership_id
  where tp.permission <> 'view_only'
    and not exists (select 1 from public.role_assignments ra where ra.membership_id = tp.membership_id and ra.team_id = tp.team_id);

  select count(*) into v_so_unmapped
  from public.club_safeguarding_officers o
  where o.status = 'active' and o.user_id is not null
    and not exists (select 1 from public.role_assignments ra where ra.user_id = o.user_id and ra.club_id = o.club_id and ra.role_key = 'SAFEGUARDING_OFFICER');

  select count(*) into v_status_mismatch from public.club_memberships where status <> lower(state);

  if v_null_state + v_active_without_role + v_suspended_with_active + v_team_parity + v_so_unmapped + v_status_mismatch <> 0 then
    raise exception 'Slice 2 membership verification failed: null state %, active without role %, suspended with active roles %, team parity %, SO unmapped %, status mismatch %.',
      v_null_state, v_active_without_role, v_suspended_with_active, v_team_parity, v_so_unmapped, v_status_mismatch;
  end if;
end $$;
