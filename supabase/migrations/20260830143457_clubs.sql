-- Activated/claimed Ovalball clubs. Every row references exactly one
-- club_directory row (Import Rules: "clubs.directory_id -> club_directory.id",
-- no ovalball_club_id field recreated).

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  directory_id uuid not null unique references public.club_directory(id),
  slug text not null unique,
  bio text,
  website text,
  facebook_url text,
  established_year integer,
  -- Supabase Storage object key, never the binary itself.
  logo_storage_path text,
  legacy_logo_path text,
  -- teamdirectoryexample.csv's "Club Address" is a structured
  -- {DisplayName, LocationUri, Address, Coordinates{Latitude,Longitude}}
  -- object, not a flat string — evidence the previous product used a
  -- location-picker component. address_display mirrors "Address Plain";
  -- latitude/longitude are nullable since they were null in the source data
  -- but the field existed.
  address_display text,
  latitude numeric,
  longitude numeric,
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.clubs is
  'Activated Ovalball club profile. One row per claimed club_directory entry. Historical fixtures/memberships reference this row, so it is deactivated (status), never deleted.';

create index clubs_directory_id_idx on public.clubs (directory_id);
