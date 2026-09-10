-- ===========================================================================
-- A VENUE'S PIN AGREES WITH ITS ADDRESS
-- ===========================================================================
--
-- FOUND IN UAT, ON REAL DATA. The Match Centre's venue map dropped its pin on
-- Turf Moor -- Burnley Football Club -- for a fixture at a venue whose own
-- address row reads "Belvedere Road, Burnley, BB10 2LS", which is Burnley
-- Rugby Union Football Club, about three kilometres away.
--
-- The map was faithful. The row was wrong: latitude/longitude said 53.7890,
-- -2.2300 while the postcode on the SAME ROW geocodes to 53.8194, -2.2350.
-- Nothing in the product had ever compared the two, because public.venues
-- carries bare latitude/longitude columns that anybody may type into, with no
-- provenance, no status and no relationship to the address beside them.
--
-- club_directory has not had this problem, because it was given exactly that
-- provenance in 20260901100000: a geocode status, a source, a timestamp, and a
-- trigger that invalidates the coordinates the moment the postcode changes. A
-- venue is a place on a map for the same reasons a club is, and gets the same
-- treatment here rather than a second, weaker one.
--
-- WHAT THIS DOES NOT DO. It does not invent a coordinate for anything. The
-- only new source of coordinates is postcodes.io through the geocoder Main
-- already uses (lib/geocoding/postcodes-io.ts) applied to the venue's OWN
-- canonical postcode, so a pin can only ever be where the address says it is.
-- A venue with no postcode is marked 'no_postcode' and keeps no pin at all;
-- the Match Centre already renders address and Directions without a map, so
-- an unpinned venue loses decoration rather than information.
--
-- EXISTING COORDINATES ARE NOT SILENTLY TRUSTED. Every venue that currently
-- holds hand-entered coordinates is marked 'pending' so the backfill re-derives
-- them from its own postcode. That is the whole point: the numbers that were
-- there are precisely the ones that were wrong.
-- ===========================================================================

alter table public.venues
  add column if not exists geocoded_at timestamptz,
  add column if not exists geocode_status text not null default 'pending',
  add column if not exists geocode_source text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'venues_geocode_status_check') then
    alter table public.venues
      add constraint venues_geocode_status_check
      check (geocode_status = any (array['pending','success','no_postcode','failed']));
  end if;
end $$;

comment on column public.venues.geocode_status is
  'How this venue''s coordinates were arrived at: pending (never derived, or invalidated by a postcode edit), success (derived from this row''s own postcode), no_postcode (nothing to derive from), failed (the postcode did not resolve). A venue whose status is not ''success'' has no trustworthy pin, and the Match Centre map is omitted rather than pointing somewhere plausible.';

comment on column public.venues.geocode_source is
  'The authority that produced these coordinates -- postcodes.io. Recorded so a wrong pin can be traced to a source rather than to a person typing numbers into a form.';

create index if not exists venues_geocode_status_idx on public.venues (geocode_status);

-- A postcode edit invalidates any cached coordinates for that row -- reset to
-- 'pending' so the next backfill picks it up, rather than leaving a stale pin
-- at the OLD postcode's location indefinitely. Identical in shape and reason
-- to club_directory's, deliberately: one behaviour, two tables.
create or replace function internal.reset_venue_geocode_on_postcode_change()
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

drop trigger if exists reset_venue_geocode_on_postcode_change on public.venues;
create trigger reset_venue_geocode_on_postcode_change
  before update of postcode on public.venues
  for each row execute function internal.reset_venue_geocode_on_postcode_change();

-- Every venue that already holds coordinates from before this migration is
-- marked pending. Those coordinates have no provenance, and the one case that
-- was actually inspected pointed at the wrong club's ground.
update public.venues
set geocode_status = case when postcode is null or btrim(postcode) = '' then 'no_postcode' else 'pending' end
where geocode_status = 'pending';
