-- Master lookup directory of all recognised rugby clubs, and their known
-- alternate names. Columns match the "Club Directory" and "Data Dictionary"
-- sheets of clubdatalist.xlsx verbatim.

create table public.club_directory (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  rugby_code text not null check (rugby_code in ('union', 'league')),
  country text not null,
  nation text not null check (nation in ('England', 'Scotland', 'Wales', 'Northern Ireland')),
  region text,
  county text,
  town text,
  home_ground text,
  address text,
  postcode text,
  website text,
  official_email text,
  source text not null,
  external_id text,
  source_url text not null,
  source_updated_at timestamptz,
  active boolean not null default true,
  verification_status text not null,
  notes text,
  constituent_body text,
  -- Lowercased / punctuation-stripped / common-suffix-stripped form of
  -- `name`, populated by ingestion code (the exact normalization algorithm
  -- is still an open question for the Alias/lookup architecture stage, so
  -- this stays a plain column, not a generated one, until that's decided).
  normalized_key text not null,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Dedup rule #1 per Import Rules: source + external_id. NULLs (rows with
  -- no external_id) are each treated as distinct by Postgres, which is
  -- correct here — those rows fall through to normalized-name dedup instead.
  unique (source, external_id)
);

comment on table public.club_directory is
  'Master lookup of all recognised rugby clubs from governing-body sources. Not all rows are activated in Ovalball — see clubs.directory_id.';

-- Deliberately NOT unique: per Import Rules, a normalized-name collision is a
-- candidate for manual review, not an automatic block — two distinct real
-- clubs can occasionally share a near-identical normalized name.
create index club_directory_normalized_key_idx on public.club_directory (normalized_key);
create index club_directory_active_idx on public.club_directory (active) where active = true;

-- Known alternate/historic/source-specific names for a directory club.
-- References club_directory (not clubs) because opponent-name resolution in
-- fixtures must work against ANY recognised club, not only activated ones —
-- confirmed necessary by real data: fixturelistdata.csv's "Bolton Rugby
-- Union Club" does not match clubdatalist.xlsx's canonical "Bolton RUFC"
-- spelling.
create table public.club_aliases (
  id uuid primary key default gen_random_uuid(),
  directory_id uuid not null references public.club_directory(id) on delete cascade,
  alias text not null,
  normalized_key text not null,
  source text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

comment on table public.club_aliases is
  'Append-only alternate names for a club_directory row. Never rewrites the canonical name; ingestion/admin only adds rows here.';

create index club_aliases_directory_id_idx on public.club_aliases (directory_id);
create index club_aliases_normalized_key_idx on public.club_aliases (normalized_key);
