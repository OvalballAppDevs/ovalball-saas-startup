-- VENUE DETAIL / PITCH MANAGEMENT / CHANGING ROOM MANAGEMENT (Venue Detail mock-up).
--
-- The Add Venue wizard's own `create_venue_with_pitches` already writes catering_available and
-- changing_rooms_available at creation time. Editing an EXISTING venue went through `save_club_venue`,
-- which never touched those two columns -- a genuine gap the Venue Detail Settings/Edit screens need
-- closed, not worked around client-side. `save_club_venue` is extended (its own established shape --
-- "one transaction: name, directions, address, default") rather than a second edit path being
-- introduced. When Changing Rooms Available is turned OFF on a venue that already has active changing
-- rooms, those rooms are DEACTIVATED, never deleted -- the same soft-preservation rule the platform
-- already uses everywhere a row can be referenced by fixtures, sessions or history.
--
-- Pitch editing already has rename (`rename_club_pitch`) and configuration
-- (`set_club_pitch_configuration`) and cover (`set_pitch_cover`) but no way to edit its free-text
-- description -- the Edit Pitch screen's own "Additional Notes" field needs one, mirroring
-- `rename_club_pitch`'s exact shape.
--
-- Changing rooms have create (`create_venue_changing_room`) and cover
-- (`set_venue_changing_room_cover`) but no update or active toggle at all -- Edit Changing Room needs
-- both, mirroring `rename_club_pitch` / `set_club_pitch_active` exactly.

create or replace function public.set_club_pitch_description(p_pitch_id uuid, p_description text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.club_pitches where id = p_pitch_id;
  if v_club_id is null then
    raise exception 'Pitch not found.';
  end if;
  if not (internal.can_manage_pitch(v_club_id)) then
    raise exception 'Not authorized to manage this club''s pitches.' using errcode = '42501';
  end if;

  update public.club_pitches set description = nullif(trim(coalesce(p_description, '')), ''), updated_by = auth.uid() where id = p_pitch_id;
end;
$function$;

revoke all on function public.set_club_pitch_description(uuid, text) from public;
grant execute on function public.set_club_pitch_description(uuid, text) to authenticated;

create or replace function public.update_venue_changing_room(p_changing_room_id uuid, p_display_name text, p_room_type text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.venue_changing_rooms where id = p_changing_room_id;
  if v_club_id is null then
    raise exception 'Changing room not found.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_venue(v_club_id) then
    raise exception 'Not authorized to manage this venue''s changing rooms.' using errcode = '42501';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'A changing room name is required.';
  end if;
  if p_room_type not in ('full_size', 'smaller', 'match_officials') then
    raise exception 'Invalid changing room type.';
  end if;

  update public.venue_changing_rooms
  set display_name = trim(p_display_name), room_type = p_room_type, updated_by = auth.uid()
  where id = p_changing_room_id;
end;
$function$;

revoke all on function public.update_venue_changing_room(uuid, text, text) from public;
grant execute on function public.update_venue_changing_room(uuid, text, text) to authenticated;

create or replace function public.set_venue_changing_room_active(p_changing_room_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_club_id uuid;
begin
  select club_id into v_club_id from public.venue_changing_rooms where id = p_changing_room_id;
  if v_club_id is null then
    raise exception 'Changing room not found.' using errcode = 'P0002';
  end if;
  if not internal.can_manage_venue(v_club_id) then
    raise exception 'Not authorized to manage this venue''s changing rooms.' using errcode = '42501';
  end if;

  update public.venue_changing_rooms set active = p_active, updated_by = auth.uid() where id = p_changing_room_id;
end;
$function$;

revoke all on function public.set_venue_changing_room_active(uuid, boolean) from public;
grant execute on function public.set_venue_changing_room_active(uuid, boolean) to authenticated;

-- The old 11-arg signature is a DIFFERENT overload from the 13-arg one below, not the same function
-- with new defaults -- CREATE OR REPLACE only replaces an exact argument-type match. Dropped
-- explicitly so callers resolve to the one function that knows about facilities, never the stale one.
drop function if exists public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean);

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
  p_catering_available boolean default true,
  p_changing_rooms_available boolean default true
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

  update public.venues
  set catering_available = coalesce(p_catering_available, true),
      changing_rooms_available = coalesce(p_changing_rooms_available, true)
  where id = v_id;

  -- Turning Changing Rooms Available OFF on a venue that already has active rooms must never leave
  -- them silently visible or silently deleted: they are deactivated, the same soft-preservation rule
  -- every other referenceable row in the platform already uses.
  if coalesce(v_was_changing_rooms_available, true) and not coalesce(p_changing_rooms_available, true) then
    update public.venue_changing_rooms set active = false, updated_by = auth.uid() where venue_id = v_id and active;
  end if;

  perform public.set_venue_address(v_id, p_line1, p_line2, p_town, p_county, p_postcode, p_country, null, null, null);
  return v_id;
end;
$function$;

revoke all on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean) from public;
grant execute on function public.save_club_venue(uuid, uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean) to authenticated;
