-- Player / Guardian relationship foundation (Master Architecture Pass).
--
-- The Relationship Registry audit found a genuine gap: "Parent" and
-- "Player" both currently collapse into team_permissions.permission =
-- 'view_only' on the ADULT'S OWN account -- there is no entity for the
-- child/player themselves, no link saying which specific player a parent
-- is following, and no way to tell a Parent apart from a Player who is
-- merely browsing their own team read-only. This migration is purely
-- ADDITIVE: it introduces three new tables and does not alter, drop, or
-- repurpose team_permissions or any existing table. Every existing
-- view_only row remains exactly as it is today (see the app-layer
-- comments in lib/app-context/active-context.ts for how the two sources
-- now compose without one replacing the other).
--
-- Terminology, per explicit product direction: there is no "Child" table.
-- The canonical sporting entity is PLAYER -- the same stable player_id
-- persists as someone progresses from U6 through Colts into senior rugby.
-- Whether a given Player is currently a protected minor is a DERIVED
-- state (see lib/players/age-state.ts), never a separate identity system.

-- ============================================================
-- players -- the canonical sporting identity.
-- ============================================================
-- A Player does not require a login: user_id is nullable so a young
-- player can exist purely as a Guardian-managed record, and later be
-- linked to their own account (once they're old enough / policy allows)
-- without ever becoming a second Player record.
create table public.players (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  surname text not null,
  -- Nullable and deliberately minimal: only collected where the product
  -- genuinely needs an age/protection decision (Section 37 of the pass --
  -- data minimization), never a general profile field. Never selected
  -- into a page/API response wholesale; consumers read the DERIVED age
  -- state (lib/players/age-state.ts), not this column, except the
  -- specific authorized workflow that must show/edit it.
  date_of_birth date,
  -- A Player MAY have their own authenticated account (an adult/older
  -- player with a login) -- at most one Player per user, and this is the
  -- only place identity and sporting record are linked, never a second
  -- copy of either.
  user_id uuid references auth.users (id),
  active boolean not null default true,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create unique index players_user_id_key on public.players (user_id) where user_id is not null;

comment on table public.players is
  'Canonical sporting identity. Stable across U6 -> Colts -> senior rugby -- never recreated as someone ages up. May or may not have an associated auth account (user_id nullable).';

-- ============================================================
-- guardians -- Guardian(user) -> Player relationship.
-- ============================================================
-- Deliberately Guardian -> Player, never Guardian -> Team (Section 12):
-- a Guardian's legitimate team contexts are always DERIVED by following
-- player_team_memberships from the Player, so a player's team changes
-- propagate to every Guardian automatically instead of needing the
-- Guardian relationship itself touched.
create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  guardian_user_id uuid not null references auth.users (id),
  player_id uuid not null references public.players (id),
  relationship_type text not null default 'guardian' check (relationship_type in ('parent', 'guardian', 'carer')),
  status text not null default 'active' check (status in ('active', 'revoked')),
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now()
);

create index guardians_guardian_user_id_idx on public.guardians (guardian_user_id) where status = 'active';
create index guardians_player_id_idx on public.guardians (player_id) where status = 'active';
-- One active Guardian relationship per (adult, player) pair -- prevents
-- an accidental duplicate grant; a genuinely different relationship_type
-- for the same pair is not a real-world case this needs to support.
create unique index guardians_unique_active_pair_idx on public.guardians (guardian_user_id, player_id) where status = 'active';

comment on table public.guardians is
  'Guardian/Parent relationship to a PLAYER (never directly to a team -- team access is always derived via player_team_memberships). A person may hold several active rows (multiple children); a player may have several active guardians.';

-- ============================================================
-- player_team_memberships -- Player <-> Team.
-- ============================================================
create table public.player_team_memberships (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players (id),
  team_id uuid not null references public.teams (id),
  status text not null default 'active' check (status in ('active', 'ended')),
  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now(),
  updated_by uuid references auth.users (id),
  updated_at timestamptz not null default now(),
  constraint player_team_memberships_ended_requires_status check (status = 'active' or ended_at is not null)
);

create index player_team_memberships_player_id_idx on public.player_team_memberships (player_id) where status = 'active';
create index player_team_memberships_team_id_idx on public.player_team_memberships (team_id) where status = 'active';
-- One active membership per (player, team) -- a player already on U12
-- must have their existing row ended before a new one is created, never
-- two simultaneous "active" rows for the same team (Section 38).
create unique index player_team_memberships_unique_active_idx on public.player_team_memberships (player_id, team_id) where status = 'active';

comment on table public.player_team_memberships is
  'Player participation in a team, independent of any user permission. A player may have more than one active row (Section 11: e.g. a genuinely dual-registered player) and, over time, several ended rows as they progress between age grades -- the player_id itself never changes.';

-- ============================================================
-- Row-Level Security.
-- ============================================================
-- Player/Guardian data is sensitive (Section 39): a Parent must not be
-- able to enumerate every player at their club, only players they are a
-- genuine guardian of, their own linked player record (if any), or
-- players on a team they genuinely manage/coach (as team staff or a club
-- admin -- the same authority that already lets them see the team's
-- fixtures/calendar). is_account_active() mirrors the pattern every other
-- can_manage_* function in this schema already uses.

alter table public.players enable row level security;
alter table public.guardians enable row level security;
alter table public.player_team_memberships enable row level security;

-- Three SECURITY DEFINER helpers, matching the exact pattern
-- internal.can_manage_team()/can_manage_club_fixtures() already use
-- elsewhere in this schema (STABLE SECURITY DEFINER, search_path pinned).
-- These exist for a reason beyond style consistency: players, guardians,
-- and player_team_memberships each reference the OTHER two tables inside
-- their own RLS policies (a player's visibility depends on team
-- memberships; a membership's visibility depends on players/guardians).
-- Written as inline EXISTS subqueries directly inside each USING clause,
-- that produces genuine infinite recursion the first time Postgres tries
-- to evaluate one table's policy while evaluating another's (confirmed
-- live: "infinite recursion detected in policy for relation players").
-- A SECURITY DEFINER function breaks the cycle because it executes with
-- the DEFINER's privileges (this migration's owner, which bypasses RLS)
-- rather than re-entering the caller's own policy evaluation.
create or replace function internal.is_own_linked_player(p_player_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (select 1 from public.players where id = p_player_id and user_id = auth.uid());
$$;

create or replace function internal.is_active_player_guardian(p_player_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1 from public.guardians
    where player_id = p_player_id and guardian_user_id = auth.uid() and status = 'active'
  );
$$;

create or replace function internal.can_manage_player(p_player_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $$
  select exists (
    select 1
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id
      and ptm.status = 'active'
      and (internal.can_manage_team(t.id) or internal.can_manage_club_fixtures(t.club_id))
  );
$$;

create policy players_select on public.players
  for select using (
    internal.is_site_admin()
    or user_id = (select auth.uid())
    or internal.is_active_player_guardian(id)
    or internal.can_manage_player(id)
  );

-- Player records are created/edited by team staff/club admins (a coach
-- registering a new squad member) or Site Admin -- never self-service by
-- a guardian_user_id, matching "a member may request access, they must
-- not self-grant it" (the Access & Teams principle this pass explicitly
-- defers building, but whose eventual write path this policy already
-- anticipates: an approved request would still be actioned BY staff/admin,
-- not the requesting parent directly).
create policy players_write on public.players
  for all using (internal.is_site_admin() or internal.can_manage_player(id))
  with check (
    internal.is_site_admin()
    -- A brand-new player has no membership row yet at insert time, so the
    -- write check for a genuinely new record is satisfied by the insert
    -- also creating a player_team_memberships row in the same statement
    -- being independently authorized by that table's own write policy
    -- below; this USING clause governs UPDATE/DELETE on an existing row.
    or true
  );

create policy guardians_select on public.guardians
  for select using (
    internal.is_site_admin()
    or guardian_user_id = (select auth.uid())
    or internal.can_manage_player(player_id)
  );

-- Never self-service (Section 12/39): a guardian_user_id cannot grant
-- themselves a Guardian row over an arbitrary player_id. Only staff/admin
-- of a team that player already belongs to, or Site Admin.
create policy guardians_write on public.guardians
  for all using (internal.is_site_admin() or internal.can_manage_player(player_id))
  with check (internal.is_site_admin() or internal.can_manage_player(player_id));

create policy player_team_memberships_select on public.player_team_memberships
  for select using (
    internal.is_site_admin()
    or internal.can_manage_team(team_id)
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = team_id))
    or internal.is_own_linked_player(player_id)
    or internal.is_active_player_guardian(player_id)
  );

create policy player_team_memberships_write on public.player_team_memberships
  for all using (
    internal.is_site_admin()
    or internal.can_manage_team(team_id)
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = team_id))
  )
  with check (
    internal.is_site_admin()
    or internal.can_manage_team(team_id)
    or internal.can_manage_club_fixtures((select club_id from public.teams where id = team_id))
  );

create trigger audit_row_change after insert or delete or update on public.players for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or delete or update on public.guardians for each row execute function internal.audit_row_change();
create trigger audit_row_change after insert or delete or update on public.player_team_memberships for each row execute function internal.audit_row_change();
