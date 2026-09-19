-- =====================================================================================================
-- CONVERGENCE STEP 6 (6/n) -- a postcode change must not discard coordinates supplied in the same
-- statement.
--
-- HOW THIS SURFACED. Step 6 took the address parameters off create_venue, so a venue is now created
-- named and then addressed by set_venue_address. `structured_venue_address` immediately failed its
-- coordinate assertion, and the cause was not the change -- it was a latent interaction the change made
-- reachable.
--
-- internal.reset_venue_geocode_on_postcode_change is a BEFORE trigger that clears the pin whenever the
-- postcode moves, which is right: a pin derived from the old postcode is wrong for the new one.
--
-- But set_venue_address writes the postcode AND the provider's coordinates in ONE update. So when the
-- postcode moves in that statement -- which is every first address entry, and every postcode correction
-- made from a provider result -- the trigger nulled the latitude and longitude the very same statement
-- was setting. The venue was left unpinned with `geocode_status = 'pending'`, and the provider's own
-- coordinates were thrown away.
--
-- It was invisible before because create_venue used to store the postcode first, so by the time
-- set_venue_address ran the postcode was unchanged and the trigger never fired. The defect was always
-- there; it was hidden behind a two-step write.
--
-- THE RULE, stated precisely: a postcode change invalidates a pin that was DERIVED from the old
-- postcode. It does not invalidate coordinates the writer is supplying alongside the new postcode,
-- because those are about the new postcode by construction -- they came from the same provider result.
-- =====================================================================================================

create or replace function internal.reset_venue_geocode_on_postcode_change()
returns trigger language plpgsql as $function$
begin
  if new.postcode is distinct from old.postcode
     -- ...and the statement is not itself supplying a pin for the new postcode.
     and new.latitude is not distinct from old.latitude
     and new.longitude is not distinct from old.longitude then
    new.latitude := null;
    new.longitude := null;
    new.geocoded_at := null;
    new.geocode_status := 'pending';
    new.geocode_source := null;
  end if;
  return new;
end;
$function$;

do $$
declare
  v_dir uuid; v_club uuid; v_venue uuid;
  v_lat numeric; v_lon numeric; v_status text;
begin
  -- Proved against real rows rather than asserted from the body, because the whole defect was an
  -- interaction between a function and a trigger that each looked correct alone.
  insert into public.club_directory (name, normalized_key, source, rugby_code, country, nation, verification_status, active)
  values ('Step 6 Pin Probe', 'step-6-pin-probe', 'MANUAL', 'union', 'England', 'England', 'unverified', true)
  returning id into v_dir;
  insert into public.clubs (directory_id, slug) values (v_dir, 'step-6-pin-probe') returning id into v_club;
  insert into public.venues (club_id, name, slug, active) values (v_club, 'Pin Probe Ground', 'step-6-pin-probe-ground', true)
  returning id into v_venue;

  -- A first address entry carrying the provider's own pin: postcode moves NULL -> set.
  update public.venues
  set postcode = 'BB11 3JA', latitude = 53.7856, longitude = -2.2280, geocode_status = 'success'
  where id = v_venue;
  select latitude, longitude, geocode_status into v_lat, v_lon, v_status from public.venues where id = v_venue;
  if v_lat is null or v_lon is null then
    raise exception 'STEP 6: a postcode change still discards coordinates supplied with it';
  end if;

  -- A postcode correction with NO new pin still invalidates the old one.
  update public.venues set postcode = 'BB12 0AA' where id = v_venue;
  select latitude, longitude, geocode_status into v_lat, v_lon, v_status from public.venues where id = v_venue;
  if v_lat is not null or v_lon is not null or v_status <> 'pending' then
    raise exception 'STEP 6: a postcode change without a new pin must still invalidate the old one (lat %, status %)', v_lat, v_status;
  end if;

  delete from public.venues where id = v_venue;
  delete from public.clubs where id = v_club;
  delete from public.club_directory where id = v_dir;

  raise notice 'Step 6: a postcode change invalidates a derived pin, and keeps one supplied with it';
end $$;
