-- Individual playing/age-group sides. Each real side (Men's 1st, U15 B,
-- Senior Colts, ...) is its own stable row per the explicit Team Model
-- requirement — never a temporary label on a fixture row.
--
-- Placed before memberships_permissions (deviating from the example
-- ordering list) because team_permissions.team_id references teams.id.

create table public.teams (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  rugby_code text not null check (rugby_code in ('union', 'league')),
  -- 'senior' covers Men's 1st/2nd/3rd and Senior Colts (an established
  -- rugby label, not forced into a numeric age); 'youth' covers age-graded
  -- sides. Per instruction, not every team is forced into every
  -- classification below.
  category text not null check (category in ('senior', 'youth')),
  age_group text check (age_group in ('U7','U8','U9','U10','U11','U12','U13','U14','U15','U16','U17','U18')),
  team_number integer,
  squad_designation text,
  gender text check (gender in ('mens', 'womens', 'mixed')),
  display_name text not null,
  slug text not null,
  -- Generated (not app-populated) so the uniqueness key can never drift from
  -- the structured fields it's derived from. Deliberately excludes club_id —
  -- the (club_id, identity_key) unique constraint below handles per-club
  -- scoping — so "U15 B" normalizes to the same key regardless of how it was
  -- typed ("Under 15 B", "U15s B"), preventing accidental duplicate teams,
  -- while U15 A / U15 B / U15 C and Men's 1st / 2nd / 3rd stay distinct.
  identity_key text generated always as (
    coalesce(rugby_code, '') || ':' ||
    category || ':' ||
    coalesce(age_group, '') || ':' ||
    coalesce(team_number::text, '') || ':' ||
    coalesce(squad_designation, '')
  ) stored,
  active boolean not null default true,
  -- Preserves clubcontactsexample.csv's "Team Ref" (e.g. BRU-CC-TEAM-3) for
  -- audit. Never used as, or assumed to be, the primary key.
  legacy_team_ref text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (club_id, slug),
  unique (club_id, identity_key)
);

comment on table public.teams is
  'One row per real playing side. Age-group Yes/No/TBC columns in the legacy team directory export are evidence for which rows should exist here, not booleans on this table.';

create index teams_club_id_idx on public.teams (club_id);
create index teams_rugby_code_idx on public.teams (rugby_code);
create index teams_active_idx on public.teams (active) where active = true;

-- Explicit column, not inherited-only: a check constraint alone can't verify
-- cross-table agreement with clubs/club_directory.rugby_code, so that
-- integrity check is implemented as a trigger in the final RLS/triggers
-- migration once every table involved exists.
comment on column public.teams.rugby_code is
  'Must agree with clubs -> club_directory.rugby_code. Enforced by a trigger in 20260830143512_rls_policies_and_triggers.sql, not just this column''s check constraint.';

-- Team-level contact/role people. Explicitly required by the approved
-- TEAM CONTACTS / ROLES instruction ("preserve these as people/contact-role
-- relationships"); exact columns weren't restated in the later file-grounded
-- schema pass, so this table's shape is new execution of an already-approved
-- requirement, not a new requirement. Role values match
-- clubcontactsexample.csv's columns exactly. Multiple people in one legacy
-- CSV cell (e.g. "Adam Spencer;Dan Norris" under Additional Coach) become
-- multiple rows here, one per person, naturally.
create table public.team_contacts (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.teams(id) on delete cascade,
  role text not null check (role in ('head_coach', 'secondary_coach', 'additional_coach', 'team_manager', 'first_aider', 'safeguarding_lead')),
  name text not null,
  phone text,
  email text,
  is_public boolean not null default false,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.team_contacts is
  'Person/role records for a team (Head Coach, Team Manager, Safeguarding Lead, ...). Private by default; is_public controls what the public team page may show.';

create index team_contacts_team_id_idx on public.team_contacts (team_id);
