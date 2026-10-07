-- VENUES & PITCHES WIZARD (Arena) -- the owner's two named facility facts, and one atomic creation
-- path for a venue plus its pitches. Every existing single-entity RPC (create_venue, set_venue_address,
-- set_venue_cover, create_club_pitch, set_club_pitch_configuration, set_pitch_cover) is REUSED here
-- rather than reimplemented -- this is one function CALLING those, so the whole wizard submission is
-- one Postgres transaction: if any pitch fails to validate, the venue itself is never left half-created.

alter table public.venues
  add column if not exists catering_available boolean not null default true,
  add column if not exists changing_rooms_available boolean not null default true;

comment on column public.venues.catering_available is 'Whether this ground has catering available. Defaults to true (Section per owner brief) -- a venue is assumed to offer it until somebody says otherwise, never assumed absent.';
comment on column public.venues.changing_rooms_available is 'Whether this ground has changing rooms available. Same true-by-default reasoning as catering_available.';

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
  p_pitches jsonb default null
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
begin
  -- No authorization check of its own: every operation below is its own SECURITY DEFINER function
  -- that already checks internal.can_manage_venue/can_manage_pitch, so this stays the single source
  -- of that authority rather than a second, possibly-drifting copy of it.
  v_venue_id := public.create_venue(p_club_id, p_name, p_directions, coalesce(p_set_default, false));

  perform public.set_venue_address(v_venue_id, p_line1, p_line2, p_town, p_county, p_postcode, p_country, null, null, null);

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

  return v_venue_id;
end;
$function$;

revoke all on function public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb) from public;
grant execute on function public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb) to authenticated;

comment on function public.create_venue_with_pitches is 'Add Venue wizard''s one atomic submission: creates the venue (address, facilities, cover) and every pitch drafted for it in one transaction, entirely by calling the existing canonical single-entity RPCs -- never a parallel write path. A pitch validation failure rolls back the whole call, so a venue is never left standing with only some of its intended pitches.';
