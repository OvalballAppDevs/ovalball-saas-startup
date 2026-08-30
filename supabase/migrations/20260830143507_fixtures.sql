-- Fixtures, their idempotent-import source references, and the review queue
-- for club/team names ingestion cannot confidently resolve.

create table public.fixtures (
  id uuid primary key default gen_random_uuid(),
  -- The Ovalball team this fixture belongs to. Never confused with the
  -- opponent (below).
  owning_team_id uuid not null references public.teams(id),
  competition_edition_id uuid references public.competition_editions(id),
  venue_id uuid references public.venues(id),
  season_label text,
  kickoff_date date not null,
  kickoff_time time,
  home_away text not null check (home_away in ('Home', 'Away', 'TBD', 'Not Applicable')),
  -- Values confirmed from fixturelistdata.csv's real Status column, plus
  -- Cancelled/Completed for once results start being recorded (not present
  -- in the source export, which is a fixture list, not a results log).
  status text not null default 'Planned' check (status in ('Planned', 'Booked', 'To Be Determined', 'Annual Holiday', 'Festival', 'Lancashire Cup', 'Cancelled', 'Completed')),
  -- Opponent resolution: raw text is always preserved; the other three are
  -- populated only as far as ingestion can confidently resolve them. Real
  -- data proves this is required, not hypothetical — observed Opposition
  -- values include "Centenary Festival", "Christmas Break", "Vacant Fixture".
  raw_opposition_text text not null,
  opponent_directory_id uuid references public.club_directory(id),
  opponent_team_id uuid references public.teams(id),
  event_type text check (event_type in ('holiday', 'festival', 'vacant')),
  home_score integer,
  away_score integer,
  venue_address text,
  pitch_allocation text,
  changing_room text,
  stage_one_confirmation boolean not null default false,
  final_confirmation boolean not null default false,
  notes text,
  -- Preserves fixturelistdata.csv's "Fixture ID" (e.g. BRU-FIX-1). Never
  -- assumed to be, or used as, the primary key.
  legacy_fixture_ref text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.fixtures is
  'One fixture for one owning Ovalball team. Opposition may be a resolved club/team, an unresolved name, or a non-club event (festival, holiday, vacant slot).';

create index fixtures_owning_team_id_idx on public.fixtures (owning_team_id, kickoff_date);
create index fixtures_competition_edition_id_idx on public.fixtures (competition_edition_id);
create index fixtures_opponent_directory_id_idx on public.fixtures (opponent_directory_id);

-- The real dedup anchor for repeated imports: upsert by (source_system,
-- source_id) first. Stable even if kickoff_date is later corrected, unlike a
-- natural-key tuple alone.
create table public.fixture_source_refs (
  id uuid primary key default gen_random_uuid(),
  fixture_id uuid not null references public.fixtures(id) on delete cascade,
  source_system text not null,
  source_id text not null,
  created_at timestamptz not null default now(),
  unique (source_system, source_id)
);

create index fixture_source_refs_fixture_id_idx on public.fixture_source_refs (fixture_id);

-- The review queue ingestion writes to instead of guessing. Generic across
-- club/team so it serves both club_directory resolution (this migration
-- set) and future team-level resolution.
create table public.unresolved_names (
  id uuid primary key default gen_random_uuid(),
  raw_value text not null,
  normalized_key text not null,
  entity_type text not null check (entity_type in ('club', 'team')),
  source text,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'ignored')),
  resolved_directory_id uuid references public.club_directory(id),
  resolved_by uuid references auth.users(id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.unresolved_names is
  'Names ingestion could not confidently match. Never silently discarded or auto-resolved — reviewed here (Site Admin "Import / Data Quality" section) and resolved explicitly.';

create index unresolved_names_status_idx on public.unresolved_names (status);
create index unresolved_names_normalized_key_idx on public.unresolved_names (normalized_key);
