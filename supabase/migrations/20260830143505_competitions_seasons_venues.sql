-- Venues, the enduring competition concept, calendar seasons, and one run of
-- one competition in one season (what fixtures actually reference).

create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  club_id uuid references public.clubs(id),
  address text,
  latitude numeric,
  longitude numeric,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.competitions (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  normalized_key text not null unique,
  rugby_code text not null check (rugby_code in ('union', 'league')),
  level text,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.competitions is
  'The enduring competition concept (e.g. "Premiership"), not a per-season instance — see competition_editions.';

create table public.seasons (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  starts_on date not null,
  ends_on date not null,
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_on > starts_on)
);

comment on table public.seasons is
  'A calendar period (e.g. "2026/27"), shared across all competitions — not owned by any one competition.';

create table public.competition_editions (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references public.competitions(id),
  season_id uuid not null references public.seasons(id),
  -- Stored explicitly (not inherited-only) as the second of three rugby_code
  -- integrity checkpoints; enforced by a trigger in the final migration.
  rugby_code text not null check (rugby_code in ('union', 'league')),
  active boolean not null default true,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (competition_id, season_id)
);

comment on table public.competition_editions is
  'One run of one competition in one season. Fixtures reference this, not competitions directly, so a club''s divisional entrants can change every season.';

create index competition_editions_season_id_idx on public.competition_editions (season_id);

create table public.competition_edition_teams (
  id uuid primary key default gen_random_uuid(),
  competition_edition_id uuid not null references public.competition_editions(id) on delete cascade,
  team_id uuid not null references public.teams(id),
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (competition_edition_id, team_id)
);

create index competition_edition_teams_team_id_idx on public.competition_edition_teams (team_id);
