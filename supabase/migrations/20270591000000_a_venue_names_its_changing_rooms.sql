-- CHANGING ROOMS -- no canonical entity existed before this (the only prior "changing_room" anywhere
-- is `fixtures.changing_room`, a free-text per-fixture note, unrelated to a venue's own facilities).
-- `venue_changing_rooms` is the smallest correct extension: the same shape `club_pitches` already
-- established (display_name, active, sort_order, cover_image_path/cover_stock_key, club_id + venue_id,
-- can_manage_venue authority), because a changing room is exactly that kind of thing -- a venue
-- facility with a name, a type and a photo -- not a new kind of architecture.
--
-- QUANTITY is never a decorative integer sitting on one row: the wizard's own draft holds one
-- definition ("Home Changing Room", full_size, quantity 2), and `create_venue_with_pitches` (extended
-- below) expands that into REAL, individually addressable rows -- "Home Changing Room 1" / "Home
-- Changing Room 2" -- so a future feature can reference one specific physical room rather than reading
-- a count off a single row and having nothing to point at.

create table public.venue_changing_rooms (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id),
  venue_id uuid not null references public.venues(id),
  display_name text not null,
  room_type text not null default 'full_size',
  active boolean not null default true,
  sort_order integer not null default 0,
  cover_image_path text,
  cover_stock_key text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint venue_changing_rooms_room_type_check check (room_type in ('full_size', 'smaller', 'match_officials')),
  constraint venue_changing_rooms_cover_exclusive check (cover_image_path is null or cover_stock_key is null)
);

create index venue_changing_rooms_club_id_idx on public.venue_changing_rooms (club_id);
create index venue_changing_rooms_venue_id_idx on public.venue_changing_rooms (venue_id);
create unique index venue_changing_rooms_club_id_display_name_key on public.venue_changing_rooms (club_id, lower(display_name));

comment on table public.venue_changing_rooms is 'A venue''s own changing rooms -- canonically belongs to exactly one venue (Venues & Pitches wizard, Changing Rooms step). room_type is one of three canonical user-facing kinds; quantity from the wizard is expanded into this many individual rows at creation time, never stored as a count.';
comment on column public.venue_changing_rooms.room_type is 'full_size (''Full size changing room''), smaller (''Smaller changing room''), match_officials (''Match officials changing'') -- the three canonical kinds the Add Venue wizard offers.';

alter table public.venue_changing_rooms enable row level security;

create policy venue_changing_rooms_select on public.venue_changing_rooms
  for select using (true);
create policy venue_changing_rooms_insert on public.venue_changing_rooms
  for insert with check (internal.can_manage_venue(club_id));
create policy venue_changing_rooms_update on public.venue_changing_rooms
  for update using (internal.can_manage_venue(club_id));
create policy session_ok_required on public.venue_changing_rooms
  as restrictive for all
  using ((select internal.session_ok()))
  with check ((select internal.session_ok()));

create trigger set_updated_at before update on public.venue_changing_rooms
  for each row execute function public.set_updated_at();
create trigger audit_row_change after insert or update on public.venue_changing_rooms
  for each row execute function internal.audit_row_change();

grant select on public.venue_changing_rooms to authenticated, anon;
grant insert, update on public.venue_changing_rooms to authenticated;

-- THE SINGLE-ENTITY PRIMITIVE, the same shape as `create_club_pitch` -- reusable later by a standalone
-- Venue Detail changing-room management screen (not built in this pass), and used internally below.
create or replace function public.create_venue_changing_room(
  p_club_id uuid,
  p_venue_id uuid,
  p_display_name text,
  p_room_type text default 'full_size',
  p_cover_stock_key text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_id uuid;
  v_next_sort integer;
begin
  if not internal.can_manage_venue(p_club_id) then
    raise exception 'Not authorized to manage this club''s venues.' using errcode = '42501';
  end if;
  if coalesce(trim(p_display_name), '') = '' then
    raise exception 'A changing room name is required.';
  end if;
  if p_room_type not in ('full_size', 'smaller', 'match_officials') then
    raise exception 'Invalid changing room type.';
  end if;
  if not exists (select 1 from public.venues v where v.id = p_venue_id and v.club_id = p_club_id and v.active) then
    raise exception 'That venue does not belong to this club, or is not active.' using errcode = 'P0001';
  end if;
  if p_cover_stock_key is not null and not (p_cover_stock_key = any(array[
    'changing-modern-home-01', 'changing-modern-away-01', 'changing-traditional-01', 'changing-basic-01',
    'changing-officials-01', 'changing-junior-01', 'changing-older-clubhouse-01', 'changing-tiled-01',
    'changing-bench-hooks-01', 'changing-compact-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), -1) + 1 into v_next_sort from public.venue_changing_rooms where club_id = p_club_id;

  insert into public.venue_changing_rooms (club_id, venue_id, display_name, room_type, cover_stock_key, sort_order, created_by, updated_by)
  values (p_club_id, p_venue_id, trim(p_display_name), p_room_type, p_cover_stock_key, v_next_sort, auth.uid(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$function$;

revoke all on function public.create_venue_changing_room(uuid, uuid, text, text, text) from public;
grant execute on function public.create_venue_changing_room(uuid, uuid, text, text, text) to authenticated;

create or replace function public.set_venue_changing_room_cover(p_changing_room_id uuid, p_storage_path text, p_stock_key text)
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
    raise exception 'Not authorized to change this changing room''s cover photo.' using errcode = '42501';
  end if;
  if p_storage_path is not null and p_stock_key is not null then
    raise exception 'A cover is either an uploaded photo or an Ovalball library image, never both.' using errcode = '23514';
  end if;
  if p_storage_path is not null and p_storage_path !~ ('^' || v_club_id::text || '/changing-room-' || p_changing_room_id::text || '/[0-9a-f-]{36}\.(png|jpg|jpeg|webp)$') then
    raise exception 'That photo was not uploaded for this changing room.' using errcode = '22023';
  end if;
  if p_stock_key is not null and not (p_stock_key = any(array[
    'changing-modern-home-01', 'changing-modern-away-01', 'changing-traditional-01', 'changing-basic-01',
    'changing-officials-01', 'changing-junior-01', 'changing-older-clubhouse-01', 'changing-tiled-01',
    'changing-bench-hooks-01', 'changing-compact-01'
  ]::text[])) then
    raise exception 'Not a recognised Ovalball library image.' using errcode = '22023';
  end if;

  update public.venue_changing_rooms set cover_image_path = p_storage_path, cover_stock_key = p_stock_key where id = p_changing_room_id;
end;
$function$;

revoke all on function public.set_venue_changing_room_cover(uuid, text, text) from public;
grant execute on function public.set_venue_changing_room_cover(uuid, text, text) to authenticated;

-- THE WIZARD'S ATOMIC SUBMISSION, EXTENDED -- a new p_changing_rooms jsonb array, each element
-- {name, room_type, quantity, cover_stock_key}. quantity > 1 becomes that many individual rows named
-- "Name 1".."Name N" (never one row claiming a count); quantity = 1 keeps the exact name typed, with no
-- redundant "1" suffix. Still one transaction with the venue and its pitches: a failure anywhere rolls
-- the whole call back, so a venue is never left with only some of what was drafted.
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
  p_changing_rooms jsonb default null
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

  -- CHANGING ROOMS ARE NEVER CREATED WHEN THE VENUE SAYS IT HAS NONE. `p_changing_rooms_available`
  -- is the same truth the venue's own facilities row carries; a draft that had rooms staged and then
  -- had the toggle turned off must produce a venue with genuinely zero changing rooms, not orphaned
  -- ones the UI simply stopped showing.
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

revoke all on function public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb, jsonb) from public;
grant execute on function public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb, jsonb) to authenticated;

-- Drop the previous 15-arg overload now that the 16-arg version above is the one canonical signature.
drop function if exists public.create_venue_with_pitches(uuid, text, text, text, text, text, text, text, text, boolean, boolean, boolean, text, text, jsonb);

comment on function public.create_venue_with_pitches is 'Add Venue wizard''s one atomic submission: creates the venue (address, facilities, cover), every pitch, and -- only when changing_rooms_available is true -- every changing room drafted for it, expanding each room''s quantity into that many individually addressable rows. One transaction throughout.';
