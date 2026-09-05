-- Cached map coordinates for canonical club_directory records -- never
-- geocoded on every page load. A real geocoding provider (postcodes.io,
-- called server-side, no API key needed) fills these in as a batch
-- backfill/admin-triggered process; the map reads only these cached
-- columns. Write access mirrors club_directory's own admin-only update
-- policy -- ordinary club users can never move another club's canonical
-- pin, and cannot move their own club's canonical pin either (that stays
-- a Site Admin-reviewed action, matching the brief).

alter table public.club_directory add column latitude numeric(9, 6);
alter table public.club_directory add column longitude numeric(9, 6);
alter table public.club_directory add column geocoded_at timestamptz;
alter table public.club_directory add column geocode_status text not null default 'pending'
  check (geocode_status in ('pending', 'success', 'no_postcode', 'failed'));
alter table public.club_directory add column geocode_source text;

comment on column public.club_directory.geocode_status is
  'pending = never attempted; no_postcode = nothing to geocode from; failed = a real postcode that the geocoder could not resolve; success = latitude/longitude are trustworthy. The map renders a pin only for success -- every other status stays search/list-only, never an invented location.';

create index club_directory_geocode_status_idx on public.club_directory (geocode_status) where active = true;

-- A postcode edit invalidates any cached coordinates for that row -- reset
-- to 'pending' so the next backfill run picks it back up, rather than
-- leaving a stale pin at the OLD postcode's location indefinitely.
create function internal.reset_geocode_on_postcode_change()
returns trigger
language plpgsql
as $$
begin
  if new.postcode is distinct from old.postcode then
    new.latitude := null;
    new.longitude := null;
    new.geocoded_at := null;
    new.geocode_status := 'pending';
    new.geocode_source := null;
  end if;
  return new;
end;
$$;

create trigger reset_geocode_on_postcode_change
  before update of postcode on public.club_directory
  for each row execute function internal.reset_geocode_on_postcode_change();
