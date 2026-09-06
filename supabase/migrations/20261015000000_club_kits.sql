-- Club Kit -- canonical playing-kit identity.
--
-- Foundation for the future Matchday invitation, built now so that screen
-- consumes canonical data rather than inventing its own. The Matchday Hub
-- itself is NOT built here.
--
-- WHAT A KIT IS, AND IS NOT
--
--   CLUB LOGO  is an uploaded brand asset (storage: club-logos).
--   CLUB KIT   is structured configuration a renderer draws from.
--
-- They are separate on purpose: Matchday shows both, side by side, and a
-- club that changes its shirt has not changed its badge. Nothing here stores
-- an image -- a generated shirt PNG per club would be a second asset to keep
-- in sync with the colours that produced it, and could not be re-rendered at
-- a different size or for a different surface.
--
-- Kit is CLUB-level. Teams do not carry their own colours: a club plays in
-- the club's kit, and the fixture card shows the club's kit beside the
-- team's identity. If team-specific kits are ever evidenced, they extend
-- through an explicit override rather than by duplicating colours onto every
-- team row.
--
-- KIT IS NEVER IDENTITY. A club is identified by clubs.id / directory_id.
-- Colours are presentation, and two clubs may legitimately share them.
--
-- HISTORY -- a deliberate non-decision.
--   A club may change kit next season, and a 2024 fixture arguably ought to
--   render the 2024 shirt. Two models could deliver that: effective-dated
--   kit rows, or a per-fixture visual snapshot. This migration implements
--   NEITHER, because there is no evidence yet for which Matchday needs, and
--   a kit-history subsystem built on speculation is the expensive kind of
--   wrong.
--
--   What it does do is avoid foreclosing either. Kit lives in its own table,
--   one row per (club, variant), so effective_from/effective_to can be added
--   and the unique index relaxed without touching clubs. And Main already
--   has the snapshot precedent for fixture presentation
--   (fixtures.owning_team_display_name_snapshot), so the snapshot route
--   stays open too. Documented in docs/CLUB_KIT_AND_MATCHDAY.md.

-- ---------------------------------------------------------------------
-- 1. The table
-- ---------------------------------------------------------------------

create table if not exists public.club_kits (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,

  -- PRIMARY is the club's home shirt and the only one first-run setup
  -- requires. ALTERNATE exists because supporting it costs one column value
  -- rather than a second table, and a fixture card will eventually need to
  -- choose. Clash detection is deliberately NOT built.
  variant text not null default 'primary',

  -- A controlled vocabulary, never free text: the renderer must be able to
  -- draw every value, and a club typing "stripey" would produce a shirt
  -- nobody can draw. The key is stable and separate from its display label,
  -- which lives in TypeScript so it can be reworded without a migration.
  pattern text not null,

  primary_colour text not null,
  secondary_colour text,
  accent_colour text,

  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint club_kits_variant_check check (variant in ('primary', 'alternate')),

  constraint club_kits_pattern_check check (pattern in (
    'SOLID',
    'HOOPS',              -- many narrow horizontal bands
    'HORIZONTAL_BANDS',   -- few wide horizontal bands
    'VERTICAL_STRIPES',
    'HALVES',
    'QUARTERS',
    'SASH',
    'CHEST_BAND',
    'CONTRAST_SLEEVES'
  )),

  -- Server-side colour validation. A hex string is the only accepted form:
  -- named CSS colours vary between renderers and cannot be interpolated,
  -- and this must not depend on a browser input type nobody can trust.
  constraint club_kits_primary_colour_check check (primary_colour ~* '^#[0-9a-f]{6}$'),
  constraint club_kits_secondary_colour_check check (secondary_colour is null or secondary_colour ~* '^#[0-9a-f]{6}$'),
  constraint club_kits_accent_colour_check check (accent_colour is null or accent_colour ~* '^#[0-9a-f]{6}$'),

  -- Every pattern except SOLID is defined by the relationship between two
  -- colours; enforcing it here means a renderer never has to invent one.
  constraint club_kits_two_tone_needs_secondary check (
    pattern = 'SOLID' or secondary_colour is not null
  )
);

-- One kit per variant per club. This is also the idempotency key: a
-- double-submitted setup form updates the same row rather than creating a
-- second primary kit.
create unique index if not exists club_kits_club_variant_idx
  on public.club_kits (club_id, variant);

comment on table public.club_kits is
  'Structured playing-kit configuration per club, one row per variant. Presentation data a renderer draws from -- never an uploaded image, never club identity, and never duplicated onto teams. Consumed by Club Settings today and by the future Matchday invitation.';

alter table public.club_kits enable row level security;

-- Kit is public-facing presentation: a fixture card shows the opposition's
-- shirt, so readability cannot be scoped to the owning club.
drop policy if exists club_kits_select on public.club_kits;
create policy club_kits_select on public.club_kits for select using (true);

-- Writes go through the RPC below; no direct client mutation.

drop trigger if exists set_updated_at on public.club_kits;
create trigger set_updated_at
  before update on public.club_kits
  for each row execute function set_updated_at();

drop trigger if exists audit_row_change on public.club_kits;
create trigger audit_row_change
  after insert or update or delete on public.club_kits
  for each row execute function internal.audit_row_change();

-- ---------------------------------------------------------------------
-- 2. Writing a kit
-- ---------------------------------------------------------------------

-- Idempotent by the unique index: retrying a save updates in place, so a
-- double-clicked Save cannot produce two primary kits.
--
-- Authorization reuses `club.edit_profile` -- the capability that already
-- governs the club's own profile. Kit is part of that profile, so it needs
-- no capability of its own, and inventing one would be a second thing to
-- grant and forget.
create or replace function public.upsert_club_kit(
  p_club_id uuid,
  p_pattern text,
  p_primary_colour text,
  p_secondary_colour text default null,
  p_accent_colour text default null,
  p_variant text default 'primary'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not (internal.has_capability('club.edit_profile', 'club', p_club_id) or internal.is_site_admin()) then
    raise exception 'Not authorized to change this club''s kit.' using errcode = '42501';
  end if;

  -- Normalised to lower case so '#AABBCC' and '#aabbcc' are one value and
  -- a comparison never turns on letter case.
  insert into public.club_kits (
    club_id, variant, pattern, primary_colour, secondary_colour, accent_colour, created_by, updated_by
  )
  values (
    p_club_id, p_variant, p_pattern,
    lower(p_primary_colour), lower(p_secondary_colour), lower(p_accent_colour),
    auth.uid(), auth.uid()
  )
  on conflict (club_id, variant) do update
  set pattern = excluded.pattern,
      primary_colour = excluded.primary_colour,
      secondary_colour = excluded.secondary_colour,
      accent_colour = excluded.accent_colour,
      updated_by = auth.uid()
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.upsert_club_kit(uuid, text, text, text, text, text) from public, anon;
grant execute on function public.upsert_club_kit(uuid, text, text, text, text, text) to authenticated;

comment on function public.upsert_club_kit is
  'Creates or updates one club kit variant. Idempotent -- a retried save updates the same row rather than creating a second kit. Requires club.edit_profile on that club, or Site Admin. Colours are validated by CHECK constraints, not by the browser.';
