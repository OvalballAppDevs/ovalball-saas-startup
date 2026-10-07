-- SITEWIDE CANONICAL ADDRESS LOOKUP -- the write side.
--
-- `set_venue_address` already accepted p_latitude/p_longitude/p_provider_ref (added ahead of a
-- caller that could supply them), and `reset_venue_geocode_on_postcode_change` already knows not to
-- discard a pin the SAME statement is supplying alongside a new postcode. What was missing: neither
-- `save_club_venue` nor `create_venue_with_pitches` -- the two entry points every venue write actually
-- goes through -- ever passed those three arguments onward; both hardcoded null, null, null, so a
-- precise address-search pin was always thrown away in favour of the async postcodes.io postcode-
-- centroid geocode. This closes that gap rather than reaching around it.
--
-- `set_venue_address` is also extended to mark geocode_status = 'success' (source 'getaddress.io')
-- when a real pin is supplied directly, so the UI's own "only show the map once geocode_status =
-- success" rule (venueMapsQuery) does not withhold the map from a venue that already has a precise,
-- provider-supplied coordinate and simply hasn't been round-tripped through the async postcode
-- geocoder yet.

create or replace function public.set_venue_address(
  p_venue_id uuid,
  p_line1 text,
  p_line2 text,
  p_town text,
  p_county text,
  p_postcode text,
  p_country text default 'United Kingdom',
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_provider_ref text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club uuid;
begin
  select club_id into v_club from public.venues where id = p_venue_id;
  if v_club is null then
    raise exception 'No such venue.';
  end if;

  if not (internal.can_manage_venue(v_club)) then
    raise exception 'Not authorized to change this venue.' using errcode = '42501';
  end if;

  update public.venues
  set address_line_1 = nullif(btrim(p_line1), ''),
      address_line_2 = nullif(btrim(p_line2), ''),
      town = nullif(btrim(p_town), ''),
      county = nullif(btrim(p_county), ''),
      postcode = nullif(btrim(p_postcode), ''),
      country = coalesce(nullif(btrim(p_country), ''), 'United Kingdom'),
      latitude = coalesce(p_latitude, latitude),
      longitude = coalesce(p_longitude, longitude),
      address_provider_ref = coalesce(nullif(btrim(p_provider_ref), ''), address_provider_ref),
      -- A statement that supplies its own precise pin is authoritative about it -- it is exactly the
      -- case `reset_venue_geocode_on_postcode_change` already carves out ("...and the statement is
      -- not itself supplying a pin for the new postcode"), so completing that contract here means the
      -- map never sits withheld behind a stale 'pending' status while a perfectly good coordinate is
      -- already on the row.
      geocode_status = case when p_latitude is not null and p_longitude is not null then 'success' else geocode_status end,
      geocode_source = case when p_latitude is not null and p_longitude is not null then 'getaddress.io' else geocode_source end,
      geocoded_at = case when p_latitude is not null and p_longitude is not null then now() else geocoded_at end,
      -- The display line is regenerated from the structured parts, so the
      -- legacy column stays truthful rather than becoming stale.
      address = nullif(concat_ws(', ',
        nullif(btrim(p_line1), ''), nullif(btrim(p_line2), ''),
        nullif(btrim(p_town), ''), nullif(btrim(p_county), '')), ''),
      updated_by = auth.uid()
  where id = p_venue_id;
end;
$function$;

revoke all on function public.set_venue_address(uuid, text, text, text, text, text, text, numeric, numeric, text) from public;
grant execute on function public.set_venue_address(uuid, text, text, text, text, text, text, numeric, numeric, text) to authenticated;

drop function if exists public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean);

create or replace function public.save_club_venue(
  p_club_id uuid,
  p_venue_id uuid default null,
  p_name text default null,
  p_directions text default null,
  p_line1 text default null,
  p_line2 text default null,
  p_town text default null,
  p_county text default null,
  p_postcode text default null,
  p_country text default null,
  p_set_default boolean default false,
  p_catering_available boolean default null,
  p_changing_rooms_available boolean default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_provider_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_club uuid;
  v_was_changing_rooms_available boolean;
begin
  if p_club_id is null then
    raise exception 'Club not found.' using errcode = 'P0002';
  end if;
  if not internal.session_ok() then
    raise exception 'Your session is not able to make this change. Sign in again.' using errcode = '42501';
  end if;
  if not internal.can_manage_venue(p_club_id) then
    raise exception 'You do not have permission to manage this club''s venues.' using errcode = '42501';
  end if;

  if p_venue_id is null then
    v_id := public.create_venue(p_club_id, p_name, p_directions, coalesce(p_set_default, false));
  else
    select v.club_id, v.changing_rooms_available into v_club, v_was_changing_rooms_available from public.venues v where v.id = p_venue_id;
    if v_club is null or v_club <> p_club_id then
      raise exception 'Venue not found.' using errcode = 'P0002';
    end if;
    perform public.update_venue(p_venue_id, p_name, p_directions);
    v_id := p_venue_id;
    if coalesce(p_set_default, false) then
      perform public.set_default_venue(p_venue_id);
    end if;
  end if;

  -- Coalesced against the venue's OWN current value, not a hard true: a caller that genuinely has no
  -- opinion on these two flags (web's venue form has no facilities UI yet) must never silently flip a
  -- Club Admin's deliberate "changing rooms off" back on just because it omitted the parameter. A
  -- freshly-created venue's "current value" is the column's own `default true`, so new venues are
  -- unaffected -- this only changes behaviour for editing an existing one.
  update public.venues
  set catering_available = coalesce(p_catering_available, catering_available),
      changing_rooms_available = coalesce(p_changing_rooms_available, changing_rooms_available)
  where id = v_id;

  if coalesce(v_was_changing_rooms_available, true) and not coalesce(p_changing_rooms_available, true) then
    update public.venue_changing_rooms set active = false, updated_by = auth.uid() where venue_id = v_id and active;
  end if;

  perform public.set_venue_address(v_id, p_line1, p_line2, p_town, p_county, p_postcode, p_country, p_latitude, p_longitude, p_provider_ref);
  return v_id;
end;
$function$;

revoke all on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, numeric, numeric, text) from public;
grant execute on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, numeric, numeric, text) to authenticated;

drop function if exists public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb, jsonb);

create or replace function public.create_venue_with_pitches(
  p_club_id uuid,
  p_name text,
  p_directions text default null,
  p_line1 text default null,
  p_line2 text default null,
  p_town text default null,
  p_county text default null,
  p_postcode text default null,
  p_country text default null,
  p_set_default boolean default false,
  p_catering_available boolean default true,
  p_changing_rooms_available boolean default true,
  p_cover_image_path text default null,
  p_cover_stock_key text default null,
  p_pitches jsonb default null,
  p_changing_rooms jsonb default null,
  p_latitude numeric default null,
  p_longitude numeric default null,
  p_provider_ref text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_venue_id uuid;
  v_pitch jsonb;
  v_pitch_id uuid;
  v_room jsonb;
  v_quantity integer;
  v_room_name text;
  v_i integer;
begin
  v_venue_id := public.create_venue(p_club_id, p_name, p_directions, coalesce(p_set_default, false));

  perform public.set_venue_address(v_venue_id, p_line1, p_line2, p_town, p_county, p_postcode, p_country, p_latitude, p_longitude, p_provider_ref);

  update public.venues
  set catering_available = coalesce(p_catering_available, true),
      changing_rooms_available = coalesce(p_changing_rooms_available, true)
  where id = v_venue_id;

  if p_cover_image_path is not null or p_cover_stock_key is not null then
    perform public.set_venue_cover(v_venue_id, p_cover_image_path, p_cover_stock_key);
  end if;

  if p_pitches is not null then
    for v_pitch in select * from jsonb_array_elements(p_pitches)
    loop
      if coalesce(trim(v_pitch->>'name'), '') = '' then
        raise exception 'Each pitch needs a name.';
      end if;
      v_pitch_id := public.create_club_pitch(p_club_id, v_pitch->>'name', nullif(v_pitch->>'description', ''), v_venue_id);
      perform public.set_club_pitch_configuration(
        v_pitch_id,
        coalesce(v_pitch->>'physical_size_category', 'full'),
        coalesce(v_pitch->>'layout', 'full_only'),
        nullif(v_pitch->>'custom_length_m', '')::numeric,
        nullif(v_pitch->>'custom_width_m', '')::numeric
      );
      if (v_pitch->>'cover_image_path') is not null or (v_pitch->>'cover_stock_key') is not null then
        perform public.set_pitch_cover(v_pitch_id, nullif(v_pitch->>'cover_image_path', ''), nullif(v_pitch->>'cover_stock_key', ''));
      end if;
    end loop;
  end if;

  if coalesce(p_changing_rooms_available, true) and p_changing_rooms is not null then
    for v_room in select * from jsonb_array_elements(p_changing_rooms)
    loop
      if coalesce(trim(v_room->>'name'), '') = '' then
        raise exception 'Each changing room needs a name.';
      end if;
      v_quantity := greatest(coalesce((v_room->>'quantity')::integer, 1), 1);
      for v_i in 1..v_quantity loop
        v_room_name := case when v_quantity = 1 then trim(v_room->>'name') else trim(v_room->>'name') || ' ' || v_i::text end;
        perform public.create_venue_changing_room(
          p_club_id, v_venue_id, v_room_name,
          coalesce(v_room->>'room_type', 'full_size'),
          nullif(v_room->>'cover_stock_key', '')
        );
      end loop;
    end loop;
  end if;

  return v_venue_id;
end;
$function$;

revoke all on function public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb, jsonb, numeric, numeric, text) from public;
grant execute on function public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb, jsonb, numeric, numeric, text) to authenticated;
