-- Club-level contact people, and a club's private notes about opponent
-- clubs it arranges fixtures against.

create table public.club_contacts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  role text not null check (role in ('fixture_secretary', 'minis_secretary', 'general')),
  name text not null,
  phone text,
  email text,
  is_public boolean not null default false,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.club_contacts is
  'Club-level named contacts (Fixture Secretary, Minis Secretary, ...). is_public gates what the public club page may show; official_email on clubs/club_directory remains the only always-public contact.';

create index club_contacts_club_id_idx on public.club_contacts (club_id);

-- teamdirectoryexample.csv is Burnley RUFC's own private directory of nearby
-- opponent clubs (Distance from Burnley, Fixture Priority Level, admin
-- notes) — not a fact about those clubs generally, so it does not belong on
-- clubs or club_directory. Never public.
create table public.club_opponent_notes (
  id uuid primary key default gen_random_uuid(),
  owning_club_id uuid not null references public.clubs(id) on delete cascade,
  directory_id uuid not null references public.club_directory(id),
  distance_miles numeric,
  distance_minutes integer,
  priority_level text,
  notes text,
  -- Preserves teamdirectoryexample.csv's "Club Reference" (e.g. BRU-CR-1).
  legacy_ref text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owning_club_id, directory_id)
);

comment on table public.club_opponent_notes is
  'One owning club''s private fixture-arranging notes about another club. Never exposed on any public page.';
