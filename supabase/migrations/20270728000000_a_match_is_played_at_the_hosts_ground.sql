-- =====================================================================================================
-- MATCH CENTRE FACILITIES, PUBLIC TEAM CONTACT AND SQUAD DETAILS
--
-- The match's ground, pitch and changing rooms are the HOST club's: the home side's. For a club that
-- manages itself on Ovalball they are its canonical records (venues -> club_pitches ->
-- venue_changing_rooms, each owned by the club), referenced by id and never copied. For a club that is
-- only a Club Directory entry they are fixture-scoped and PROVISIONAL -- a typed ground and pitch, and
-- numbered changing rooms -- never dressed up as that club's records. Home or away decides the host, so
-- changing it moves the whole facility context, on both rows of a mirrored pair.
--
-- Also here: the public team page's settings (Club Default -> Team Override) for showing the profile,
-- overview, cover and staff, and for letting the opposition's staff message and call; the opposition's
-- contact actions themselves; squad numbers and positions on a player's place in a team; and a photo
-- being shared on the public page as its own decision.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. PROVISIONAL CHANGING ROOMS, AND "NO CHANGING ROOMS" AS A REAL STATE
--
-- The ground and pitch of a club not on Ovalball already have fixture-scoped homes (`venue_address`,
-- `pitch_allocation`). Rooms did not: a numbered room 1-20 per side, and a ground with none at all,
-- which is a different fact from "not set yet".
-- -----------------------------------------------------------------------------------------------------
alter table public.fixtures add column if not exists home_changing_room_number smallint;
alter table public.fixtures add column if not exists away_changing_room_number smallint;
alter table public.fixtures add column if not exists no_changing_rooms boolean not null default false;
alter table public.fixtures drop constraint if exists fixtures_changing_room_numbers_range;
alter table public.fixtures add constraint fixtures_changing_room_numbers_range
  check ((home_changing_room_number is null or home_changing_room_number between 1 and 20)
     and (away_changing_room_number is null or away_changing_room_number between 1 and 20));
alter table public.fixtures drop constraint if exists fixtures_no_changing_rooms_means_none;
alter table public.fixtures add constraint fixtures_no_changing_rooms_means_none
  check (not no_changing_rooms
         or (home_changing_room_id is null and away_changing_room_id is null
             and home_changing_room_number is null and away_changing_room_number is null));
comment on column public.fixtures.home_changing_room_number is
  'Provisional: the home side''s numbered room at a ground whose club is not on Ovalball. Null where the host is canonical.';
comment on column public.fixtures.no_changing_rooms is
  'The ground has no changing rooms for this match -- a stated fact, distinct from rooms not yet allocated.';

-- -----------------------------------------------------------------------------------------------------
-- 2. WHO IS HOSTING
--
-- The home side hosts. Its club is CANONICAL when it is an active Ovalball club (by its team, or by the
-- Club Directory entry the fixture names when the opposition's team is not resolved), PROVISIONAL when
-- it is only a Directory entry or a typed name, and UNDECIDED while home or away is not settled.
-- `_of` takes the values directly so the guard below can ask about a row before it is written.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.fixture_host_of(
  p_home_away text, p_owning_team_id uuid, p_opponent_team_id uuid, p_opponent_directory_id uuid
)
returns table(host_is_owning boolean, host_team_id uuid, host_club_id uuid, host_directory_id uuid, mode text)
language sql
stable security definer
set search_path to ''
as $function$
  with h as (
    select
      case p_home_away when 'Home' then true when 'Away' then false end as is_owning,
      case p_home_away when 'Home' then p_owning_team_id when 'Away' then p_opponent_team_id end as team_id,
      case p_home_away
        when 'Home' then (select c.id from public.teams t join public.clubs c on c.id = t.club_id
                           where t.id = p_owning_team_id and c.status = 'active')
        when 'Away' then coalesce(
          (select c.id from public.teams t join public.clubs c on c.id = t.club_id
            where t.id = p_opponent_team_id and c.status = 'active'),
          (select c.id from public.clubs c
            where p_opponent_directory_id is not null and c.directory_id = p_opponent_directory_id and c.status = 'active'
            order by c.created_at limit 1))
      end as club_id,
      case p_home_away
        when 'Home' then (select c.directory_id from public.teams t join public.clubs c on c.id = t.club_id where t.id = p_owning_team_id)
        when 'Away' then coalesce(
          (select c.directory_id from public.teams t join public.clubs c on c.id = t.club_id where t.id = p_opponent_team_id),
          p_opponent_directory_id)
      end as directory_id
  )
  select h.is_owning, h.team_id, h.club_id, h.directory_id,
         case when h.is_owning is null then 'UNDECIDED'
              when h.club_id is not null then 'CANONICAL'
              else 'PROVISIONAL' end
    from h;
$function$;

create or replace function internal.fixture_host(p_fixture_id uuid, p_home_away text default null)
returns table(host_is_owning boolean, host_team_id uuid, host_club_id uuid, host_directory_id uuid, mode text)
language sql
stable security definer
set search_path to ''
as $function$
  select h.*
    from public.fixtures f
    cross join lateral internal.fixture_host_of(coalesce(p_home_away, f.home_away), f.owning_team_id,
                                                f.opponent_team_id, f.opponent_directory_id) h
   where f.id = p_fixture_id;
$function$;

-- The ground a host plays at by default: its marked home ground, else its only active ground.
create or replace function internal.host_default_venue(p_club_id uuid)
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select v.id from public.venues v where v.club_id = p_club_id and v.active and v.is_default_home
      order by v.created_at limit 1),
    (select min(v.id::text)::uuid from public.venues v where v.club_id = p_club_id and v.active
      having count(*) = 1));
$function$;

-- A Directory club's own record of where it plays, used as the provisional ground.
create or replace function internal.directory_ground_label(p_directory_id uuid)
returns text
language sql
stable security definer
set search_path to ''
as $function$
  select nullif(btrim(d.home_ground), '') from public.club_directory d where d.id = p_directory_id;
$function$;

revoke all on function internal.fixture_host_of(text, uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function internal.fixture_host(uuid, text) from public, anon, authenticated;
revoke all on function internal.host_default_venue(uuid) from public, anon, authenticated;
revoke all on function internal.directory_ground_label(uuid) from public, anon, authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 3. THE GUARD: FACILITIES FOLLOW THE HOST, AND ONLY THE HOST'S FACILITIES FIT
--
-- Whatever writes a fixture -- the editor, a swap, an import, a mirror -- this decides on the row as it
-- will be stored:
--   * when the host changes (home or away, or who the opposition is), every facility choice made for
--     the old host is cleared, the new host's default ground is chosen for a canonical host (or its
--     Directory ground written as text for a provisional one), and pitch and rooms wait to be chosen;
--   * a canonical venue, pitch or room must be the host club's, a pitch must be at the chosen ground,
--     and a room must be at the chosen ground; provisional numbered rooms belong only to a host that is
--     not on Ovalball.
-- No stale id survives, and no Club A ground meets a Club B pitch.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.fixture_facilities_follow_host()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
declare
  h_new record;
  h_old record;
  v_pitch_club uuid;
  v_pitch_venue uuid;
begin
  select * into h_new from internal.fixture_host_of(new.home_away, new.owning_team_id, new.opponent_team_id, new.opponent_directory_id);

  if tg_op = 'UPDATE'
     and (new.home_away is distinct from old.home_away
          or new.owning_team_id is distinct from old.owning_team_id
          or new.opponent_team_id is distinct from old.opponent_team_id
          or new.opponent_directory_id is distinct from old.opponent_directory_id) then
    select * into h_old from internal.fixture_host_of(old.home_away, old.owning_team_id, old.opponent_team_id, old.opponent_directory_id);
    if h_old.mode is distinct from h_new.mode
       or h_old.host_club_id is distinct from h_new.host_club_id
       or h_old.host_directory_id is distinct from h_new.host_directory_id then
      new.venue_id := case when h_new.mode = 'CANONICAL' then internal.host_default_venue(h_new.host_club_id) end;
      new.venue_address := case when h_new.mode = 'PROVISIONAL' then internal.directory_ground_label(h_new.host_directory_id) end;
      new.pitch_id := null;
      new.pitch_allocation := null;
      new.home_changing_room_id := null;
      new.away_changing_room_id := null;
      new.home_changing_room_number := null;
      new.away_changing_room_number := null;
      new.no_changing_rooms := false;
    end if;
  end if;

  if tg_op = 'INSERT'
     or new.venue_id is distinct from old.venue_id or new.pitch_id is distinct from old.pitch_id
     or new.home_changing_room_id is distinct from old.home_changing_room_id
     or new.away_changing_room_id is distinct from old.away_changing_room_id
     or new.home_changing_room_number is distinct from old.home_changing_room_number
     or new.away_changing_room_number is distinct from old.away_changing_room_number
     or new.home_away is distinct from old.home_away then

    if new.venue_id is not null and not exists (
         select 1 from public.venues v where v.id = new.venue_id and v.club_id = h_new.host_club_id) then
      raise exception 'That ground is not the host club''s.' using errcode = '23514';
    end if;

    if new.pitch_id is not null then
      select p.club_id, p.venue_id into v_pitch_club, v_pitch_venue from public.club_pitches p where p.id = new.pitch_id;
      if v_pitch_club is distinct from h_new.host_club_id then
        raise exception 'That pitch is not the host club''s.' using errcode = '23514';
      end if;
      if new.venue_id is not null and v_pitch_venue is not null and v_pitch_venue is distinct from new.venue_id then
        raise exception 'That pitch is not at the chosen ground.' using errcode = '23514';
      end if;
    end if;

    if (new.home_changing_room_id is not null or new.away_changing_room_id is not null)
       and exists (select 1 from public.venue_changing_rooms r
                    where r.id in (new.home_changing_room_id, new.away_changing_room_id)
                      and (r.venue_id is distinct from new.venue_id or r.club_id is distinct from h_new.host_club_id)) then
      raise exception 'That changing room is not at the chosen ground.' using errcode = '23514';
    end if;

    if (new.home_changing_room_number is not null or new.away_changing_room_number is not null)
       and h_new.mode is distinct from 'PROVISIONAL' then
      raise exception 'Numbered changing rooms are only for a ground whose club is not on Ovalball.' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$function$;
revoke all on function internal.fixture_facilities_follow_host() from public, anon, authenticated;

drop trigger if exists fixtures_facilities_follow_host on public.fixtures;
create trigger fixtures_facilities_follow_host
  before insert or update on public.fixtures
  for each row execute function internal.fixture_facilities_follow_host();

-- -----------------------------------------------------------------------------------------------------
-- 4. WHAT MAY BE CHOSEN, FOR THE HOST AS IT IS OR AS IT WOULD BE
--
-- `p_home_away` lets the editor show the right club's grounds the moment somebody flips home or away,
-- before saving. A canonical host's grounds, pitches and rooms are READ here for the fixture's own staff
-- of either side -- the opposition picks from the host's catalogue; it never writes to it (the catalogue's
-- own writes stay the owning club's, through can_manage_venue).
-- -----------------------------------------------------------------------------------------------------
create or replace function public.get_fixture_facility_options(p_fixture_id uuid, p_home_away text default null)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  h record;
  v_out jsonb;
begin
  perform internal.require_live_session();
  if not internal.can_edit_fixture_schedule(p_fixture_id) then
    raise exception 'You are not authorised to arrange this fixture.' using errcode = '42501';
  end if;
  if p_home_away is not null and p_home_away not in ('Home', 'Away', 'TBD', 'Not Applicable') then
    raise exception 'Home, Away, TBD or Not Applicable.' using errcode = '22023';
  end if;
  select * into h from internal.fixture_host(p_fixture_id, p_home_away);

  v_out := jsonb_build_object(
    'mode', h.mode,
    'hostIsOwning', h.host_is_owning,
    'hostClubName', coalesce(
      (select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = h.host_club_id),
      (select d.name from public.club_directory d where d.id = h.host_directory_id),
      -- An opposition known only by a typed name hosts under that name.
      (select nullif(btrim(f.raw_opposition_text), '') from public.fixtures f where f.id = p_fixture_id and h.host_is_owning = false)),
    'defaultVenueId', case when h.mode = 'CANONICAL' then internal.host_default_venue(h.host_club_id) end,
    'provisionalGround', case when h.mode = 'PROVISIONAL' then (
      select jsonb_build_object('name', nullif(btrim(d.home_ground), ''), 'address', nullif(btrim(d.address), ''),
                                'postcode', nullif(btrim(d.postcode), ''))
        from public.club_directory d where d.id = h.host_directory_id) end,
    'venues', case when h.mode = 'CANONICAL' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', v.id, 'name', v.name,
               'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.town), '')), ''), nullif(btrim(v.address), '')),
               'postcode', v.postcode, 'isDefault', v.is_default_home,
               'coverImagePath', v.cover_image_path, 'coverStockKey', v.cover_stock_key,
               'changingRoomsAvailable', v.changing_rooms_available, 'cateringAvailable', v.catering_available)
             order by v.is_default_home desc, v.name)
        from public.venues v where v.club_id = h.host_club_id and v.active), '[]') else '[]' end,
    'pitches', case when h.mode = 'CANONICAL' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', p.id, 'venueId', p.venue_id, 'name', p.display_name, 'description', p.description,
               'size', p.physical_size_category, 'coverImagePath', p.cover_image_path, 'coverStockKey', p.cover_stock_key)
             order by p.sort_order, p.display_name)
        from public.club_pitches p where p.club_id = h.host_club_id and p.active), '[]') else '[]' end,
    'rooms', case when h.mode = 'CANONICAL' then coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'venueId', r.venue_id, 'name', r.display_name, 'roomType', r.room_type,
               'coverImagePath', r.cover_image_path, 'coverStockKey', r.cover_stock_key)
             order by r.sort_order, r.display_name)
        from public.venue_changing_rooms r where r.club_id = h.host_club_id and r.active), '[]') else '[]' end);
  return v_out;
end;
$function$;
revoke all on function public.get_fixture_facility_options(uuid, text) from public, anon;
grant execute on function public.get_fixture_facility_options(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 5. ONE WRITE FOR WHERE THE MATCH IS
--
-- Keys present in the patch change; keys absent keep their value. A choice that no longer fits after
-- another change -- a pitch at the old ground, a room at the old ground -- is cleared and reported back
-- rather than kept. Both rows of a mirrored pair are written. Families and both clubs' staff are told
-- ONCE per save, by what changed: the ground or pitch (fixture_pitch_changed, which already reaches
-- both sides' families and staff), otherwise the rooms once attendance is open.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.set_fixture_facilities(p_fixture_id uuid, p_patch jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  h record;
  v_venue uuid; v_venue_text text; v_pitch uuid; v_pitch_text text;
  v_home_room uuid; v_away_room uuid; v_home_no smallint; v_away_no smallint; v_none boolean;
  v_notes text; v_catering boolean;
  v_cleared text[] := '{}';
  v_where_changed boolean; v_rooms_changed boolean;
  v_ground text; v_pitch_label text; v_body text;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found or not internal.can_edit_fixture_schedule(p_fixture_id) then
    raise exception 'You are not authorised to arrange this fixture.' using errcode = '42501';
  end if;
  if f.cancelled_at is not null or f.status = 'Cancelled' then
    raise exception 'This fixture has been cancelled.' using errcode = '22023';
  end if;
  select * into h from internal.fixture_host(p_fixture_id);
  if h.mode = 'UNDECIDED' and (p_patch ?| array['venue_id','venue_text','pitch_id','pitch_text','home_room_id','away_room_id',
                                                 'home_room_number','away_room_number','no_changing_rooms']) then
    raise exception 'Agree home or away first: the ground is the home side''s.' using errcode = '22023';
  end if;

  v_venue := case when p_patch ? 'venue_id' then nullif(p_patch->>'venue_id', '')::uuid else f.venue_id end;
  v_venue_text := case when p_patch ? 'venue_text' then nullif(btrim(coalesce(p_patch->>'venue_text', '')), '') else f.venue_address end;
  v_pitch := case when p_patch ? 'pitch_id' then nullif(p_patch->>'pitch_id', '')::uuid else f.pitch_id end;
  v_pitch_text := case when p_patch ? 'pitch_text' then nullif(btrim(coalesce(p_patch->>'pitch_text', '')), '') else f.pitch_allocation end;
  v_home_room := case when p_patch ? 'home_room_id' then nullif(p_patch->>'home_room_id', '')::uuid else f.home_changing_room_id end;
  v_away_room := case when p_patch ? 'away_room_id' then nullif(p_patch->>'away_room_id', '')::uuid else f.away_changing_room_id end;
  v_home_no := case when p_patch ? 'home_room_number' then nullif(p_patch->>'home_room_number', '')::smallint else f.home_changing_room_number end;
  v_away_no := case when p_patch ? 'away_room_number' then nullif(p_patch->>'away_room_number', '')::smallint else f.away_changing_room_number end;
  v_none := case when p_patch ? 'no_changing_rooms' then coalesce((p_patch->>'no_changing_rooms')::boolean, false) else f.no_changing_rooms end;
  v_notes := case when p_patch ? 'changing_room_notes' then nullif(btrim(coalesce(p_patch->>'changing_room_notes', '')), '') else f.changing_room end;
  v_catering := case when p_patch ? 'catering_required' then coalesce((p_patch->>'catering_required')::boolean, false) else f.catering_required end;

  if v_venue_text is not null and length(v_venue_text) > 200 then
    raise exception 'Keep the ground under 200 characters.' using errcode = '22023';
  end if;
  if v_pitch_text is not null and length(v_pitch_text) > 80 then
    raise exception 'Keep the pitch name under 80 characters.' using errcode = '22023';
  end if;
  if v_notes is not null and length(v_notes) > 500 then
    raise exception 'Keep the arrival notes under 500 characters.' using errcode = '22023';
  end if;
  if (v_home_no is not null and v_home_no not between 1 and 20) or (v_away_no is not null and v_away_no not between 1 and 20) then
    raise exception 'Choose a changing room from 1 to 20.' using errcode = '22023';
  end if;

  if h.mode = 'CANONICAL' then
    -- The host's records, referenced. A typed ground or numbered room has no place beside them.
    if v_venue is not null then v_venue_text := null; end if;
    if p_patch ? 'pitch_text' and not (p_patch ? 'pitch_id') and v_pitch_text is not null then
      raise exception 'Choose one of the host club''s pitches.' using errcode = '22023';
    end if;
    if p_patch ? 'home_room_number' and v_home_no is not null or p_patch ? 'away_room_number' and v_away_no is not null then
      raise exception 'Choose one of the host club''s changing rooms.' using errcode = '22023';
    end if;
    v_home_no := null; v_away_no := null;
    -- A pitch or room that no longer fits the ground is cleared, and said so.
    if v_pitch is not null and v_venue is not null
       and exists (select 1 from public.club_pitches p where p.id = v_pitch and p.venue_id is not null and p.venue_id <> v_venue)
       and not (p_patch ? 'pitch_id') then
      v_pitch := null; v_cleared := array_append(v_cleared, 'pitch');
    end if;
    if v_home_room is not null and not (p_patch ? 'home_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_home_room and r.venue_id = v_venue) then
      v_home_room := null; v_cleared := array_append(v_cleared, 'home_room');
    end if;
    if v_away_room is not null and not (p_patch ? 'away_room_id')
       and not exists (select 1 from public.venue_changing_rooms r where r.id = v_away_room and r.venue_id = v_venue) then
      v_away_room := null; v_cleared := array_append(v_cleared, 'away_room');
    end if;
    v_pitch_text := case when v_pitch is not null then (select p.display_name from public.club_pitches p where p.id = v_pitch) end;
  elsif h.mode = 'PROVISIONAL' then
    if v_venue is not null or v_pitch is not null or v_home_room is not null or v_away_room is not null then
      if p_patch ?| array['venue_id','pitch_id','home_room_id','away_room_id']
         and (nullif(p_patch->>'venue_id','') is not null or nullif(p_patch->>'pitch_id','') is not null
              or nullif(p_patch->>'home_room_id','') is not null or nullif(p_patch->>'away_room_id','') is not null) then
        raise exception 'The host club is not on Ovalball, so its ground, pitch and rooms are written for this match.' using errcode = '22023';
      end if;
      v_venue := null; v_pitch := null; v_home_room := null; v_away_room := null;
    end if;
  end if;

  if v_none then
    v_home_room := null; v_away_room := null; v_home_no := null; v_away_no := null;
  end if;

  v_where_changed := v_venue is distinct from f.venue_id or v_venue_text is distinct from f.venue_address
                  or v_pitch is distinct from f.pitch_id or v_pitch_text is distinct from f.pitch_allocation;
  v_rooms_changed := v_home_room is distinct from f.home_changing_room_id or v_away_room is distinct from f.away_changing_room_id
                  or v_home_no is distinct from f.home_changing_room_number or v_away_no is distinct from f.away_changing_room_number
                  or v_none is distinct from f.no_changing_rooms;

  update public.fixtures
     set venue_id = v_venue, venue_address = v_venue_text,
         pitch_id = v_pitch, pitch_allocation = v_pitch_text,
         home_changing_room_id = v_home_room, away_changing_room_id = v_away_room,
         home_changing_room_number = v_home_no, away_changing_room_number = v_away_no,
         no_changing_rooms = v_none,
         changing_room = v_notes, catering_required = v_catering,
         updated_by = auth.uid(), updated_at = now()
   where id = any (internal.fixture_pair_ids(p_fixture_id));

  if f.kickoff_date >= current_date and auth.uid() is not null then
    v_ground := coalesce((select v.name from public.venues v where v.id = v_venue), v_venue_text);
    v_pitch_label := v_pitch_text;
    if v_where_changed then
      -- ALWAYS THE WHOLE LOCATION. A home-or-away switch has already moved the match to the new host's
      -- ground before this save chooses the pitch, so "the pitch has been set" alone would leave a family
      -- driving to the old ground.
      v_body := case
        when v_pitch_label is null and v_pitch is distinct from f.pitch_id and v_ground is not null
             and v_venue is not distinct from f.venue_id and v_venue_text is not distinct from f.venue_address then
          'The pitch for your fixture has been removed. It is still at ' || v_ground || '.'
        else 'Your fixture is now at ' || coalesce(v_ground, 'a ground still to be confirmed')
               || coalesce(', ' || v_pitch_label, '') || '.' end;
      perform internal.fixture_result_notify(p_fixture_id, auth.uid(), 'fixture_pitch_changed', 'Where the match is', v_body);
    elsif v_rooms_changed and internal.fixture_attendance_is_open(f.id) then
      insert into public.notifications (user_id, type, title, body, data)
      select distinct r.user_id, 'fixture_arrangements_changed',
             case when v_none then 'No changing rooms' else 'Changing rooms allocated' end,
             coalesce(internal.fixture_notice_label(p_fixture_id), 'Your match') || ': '
               || case when v_none then 'there are no changing rooms at the ground for this match. Come changed.'
                       else 'the changing rooms have been set. See Arena Details.' end,
             jsonb_build_object('fixture_id', p_fixture_id)
        from internal.fixture_family_recipients(p_fixture_id) r
       where r.user_id is not null and r.user_id is distinct from auth.uid();
    end if;
  end if;

  return jsonb_build_object('mode', h.mode, 'cleared', to_jsonb(v_cleared));
end;
$function$;
revoke all on function public.set_fixture_facilities(uuid, jsonb) from public, anon;
grant execute on function public.set_fixture_facilities(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- HOME OR AWAY, ON BOTH ROWS OF A MIRRORED PAIR (the facility guard above clears and re-resolves each row)
-- -----------------------------------------------------------------------------------------------------
create or replace function public.update_fixture_details(p_fixture_id uuid, p_patch jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  f public.fixtures;
  v_after public.fixtures;
  v_status text;
  v_home_away text;
  v_game_type text;
  v_swap boolean;
  v_opponent_club uuid;
  v_owning_club_name text;
  v_venue_text text;
begin
  select * into f from public.fixtures where id = p_fixture_id for update;
  if not found then
    raise exception 'Fixture not found.';
  end if;
  if not internal.can_edit_fixture_details(f.id) then
    raise exception 'Only the owning club can change this fixture''s details.' using errcode = '42501';
  end if;

  if p_patch ? 'status' then
    v_status := nullif(p_patch->>'status', '');
    if v_status = 'Cancelled' then
      raise exception 'Cancel a fixture with Cancel Fixture, so the other side and the players are told why.' using errcode = '23514';
    end if;
    if v_status is not null and v_status not in ('Planned', 'Booked', 'To Be Determined', 'Completed') then
      raise exception 'That is not a fixture status that can be set here.' using errcode = '23514';
    end if;
    if f.status = 'Cancelled' and v_status is distinct from 'Cancelled' then
      raise exception 'This fixture is cancelled. Restore it before changing its status.' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'home_away' then
    v_home_away := nullif(p_patch->>'home_away', '');
    if v_home_away not in ('Home', 'Away', 'TBD', 'Not Applicable') then
      raise exception 'Home, Away, TBD or Not Applicable.' using errcode = '23514';
    end if;
    if f.status = 'Cancelled' and v_home_away is distinct from f.home_away then
      raise exception 'This fixture is cancelled.' using errcode = '23514';
    end if;
  end if;

  if p_patch ? 'game_type' then
    v_game_type := nullif(p_patch->>'game_type', '');
    if v_game_type is not null and v_game_type not in ('Friendly', 'League Fixture', 'Cup Fixture', 'Scheduled Match') then
      raise exception 'That is not a fixture type.' using errcode = '23514';
    end if;
  end if;

  -- An away ground at a club that is not on Ovalball has no venue record; its
  -- name is kept as text. Only an away fixture with no venue record takes
  -- one, and only from someone who may change the venue.
  if p_patch ? 'venue_text' then
    v_venue_text := nullif(trim(coalesce(p_patch->>'venue_text', '')), '');
    if not (internal.can_edit_fixture_schedule(f.id)) then
      raise exception 'Only the two clubs'' fixture staff can change the venue.' using errcode = '42501';
    end if;
    if coalesce(v_home_away, f.home_away) <> 'Away' or (f.venue_id is not null and not (p_patch ? 'home_away' and v_home_away is distinct from f.home_away)) then
      raise exception 'A ground name is only recorded for an away fixture without a venue.' using errcode = '23514';
    end if;
  end if;

  v_swap := p_patch ? 'home_away' and f.home_away in ('Home', 'Away') and v_home_away in ('Home', 'Away') and v_home_away <> f.home_away;

  update public.fixtures
  set status = case when p_patch ? 'status' then coalesce(v_status, status) else status end,
      home_away = case when p_patch ? 'home_away' then v_home_away else home_away end,
      game_type = case when p_patch ? 'game_type' then v_game_type else game_type end,
      notes = case when p_patch ? 'notes' then nullif(trim(coalesce(p_patch->>'notes', '')), '') else notes end,
      home_score = case when v_swap then away_score else home_score end,
      away_score = case when v_swap then home_score else away_score end,
      -- The venue and pitch belong to the home club; when the home side
      -- changes they no longer apply.
      venue_id = case when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null else venue_id end,
      pitch_id = case when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null else pitch_id end,
      venue_address = case
        when p_patch ? 'venue_text' then v_venue_text
        when p_patch ? 'home_away' and v_home_away is distinct from f.home_away then null
        else venue_address end,
      updated_by = auth.uid()
  where id = f.id
  returning * into v_after;

  -- ONE MATCH, TWO ROWS. A mirrored pair describes one match from each club's side, so the other row's
  -- home or away is the inverse of this one -- never left saying the opposite (Match Centre facilities,
  -- 20270728). Its facilities follow the new host through the same trigger this row's did.
  if f.mirror_fixture_id is not null and v_after.home_away is distinct from f.home_away then
    update public.fixtures
       set home_away = case v_after.home_away when 'Home' then 'Away' when 'Away' then 'Home' else v_after.home_away end,
           home_score = case when v_swap then away_score else home_score end,
           away_score = case when v_swap then home_score else away_score end,
           updated_by = auth.uid()
     where id = f.mirror_fixture_id
       and home_away is distinct from (case v_after.home_away when 'Home' then 'Away' when 'Away' then 'Home' else v_after.home_away end);
  end if;

  if f.opponent_team_id is not null
     and (v_after.home_away is distinct from f.home_away or v_after.status is distinct from f.status) then
    select club_id into v_opponent_club from public.teams where id = f.opponent_team_id;
    -- The recipient is the opposition: name the club that made the change, not them.
    select d.name into v_owning_club_name from public.teams t join public.clubs c on c.id = t.club_id join public.club_directory d on d.id = c.directory_id where t.id = f.owning_team_id;
    insert into public.notifications (user_id, type, title, body, data)
    select distinct cm.user_id, 'fixture_details_changed', 'Fixture updated',
      format('Your fixture against %s on %s is now %s%s.',
        coalesce(v_owning_club_name, 'the other club'),
        to_char(f.kickoff_date, 'DD Mon YYYY'),
        case when v_after.home_away is distinct from f.home_away
          then case v_after.home_away when 'Home' then 'at their ground' when 'Away' then 'at your ground' else lower(v_after.home_away) end
          else lower(v_after.status) end,
        ''),
      jsonb_build_object('fixture_id', f.id)
    from public.club_memberships cm
    where cm.status = 'active' and cm.user_id is distinct from auth.uid()
      and (
        (cm.club_id = v_opponent_club and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY'))
        or exists (select 1 from internal.team_role_assignments tp where tp.membership_id = cm.id and tp.team_id = f.opponent_team_id and tp.role_key in ('TEAM_ADMINISTRATION', 'TEAM_MANAGER', 'COACH'))
      );
  end if;
end;
$function$;

create or replace function public.swap_fixture_home_away(p_fixture_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_fixture public.fixtures;
  v_new_home_away text;
begin
  select * into v_fixture from public.fixtures where id = p_fixture_id for update;
  if not found then raise exception 'Fixture not found.'; end if;

  if not (internal.has_site_capability('site.fixtures.support') or internal.can_manage_team(v_fixture.owning_team_id)) then
    raise exception 'Not authorised to edit this fixture.' using errcode = '42501';
  end if;
  if v_fixture.opponent_team_id is null then
    raise exception 'Cannot swap home/away -- the opponent side has no resolved team to become the new home/away side. Correct the opposition first.' using errcode = 'P0001';
  end if;

  v_new_home_away := case v_fixture.home_away
    when 'Home' then 'Away'
    when 'Away' then 'Home'
    else v_fixture.home_away -- TBD/Not Applicable: no determined side to swap
  end;

  update public.fixtures
  set home_away = v_new_home_away,
      home_score = v_fixture.away_score,
      away_score = v_fixture.home_score,
      updated_by = auth.uid()
  where id = p_fixture_id;

  -- The mirrored row says the inverse, as in update_fixture_details (20270728).
  if v_fixture.mirror_fixture_id is not null then
    update public.fixtures
       set home_away = case v_new_home_away when 'Home' then 'Away' when 'Away' then 'Home' else v_new_home_away end,
           home_score = away_score, away_score = home_score, updated_by = auth.uid()
     where id = v_fixture.mirror_fixture_id;
  end if;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('fixtures', p_fixture_id, 'update', auth.uid(),
    jsonb_build_object('home_away', v_fixture.home_away, 'home_score', v_fixture.home_score, 'away_score', v_fixture.away_score),
    jsonb_build_object('home_away', v_new_home_away, 'home_score', v_fixture.away_score, 'away_score', v_fixture.home_score));
end;
$function$;

-- =====================================================================================================
-- 6. THE PUBLIC TEAM PAGE'S SETTINGS: CLUB DEFAULT -> TEAM OVERRIDE
--
-- Extends the sharing choices already made in 20270727 rather than starting a second settings system.
-- Defaults (owner brief): the page, its overview, cover and staff ON; the opposition's staff may message
-- and call ON; squad and photos OFF. A club row sets its defaults; a team row overrides any of them, and
-- a null there means "follow the club".
-- =====================================================================================================
alter table public.club_public_sharing add column if not exists profile_public boolean not null default true;
alter table public.club_public_sharing add column if not exists show_overview boolean not null default true;
alter table public.club_public_sharing add column if not exists show_cover boolean not null default true;
alter table public.club_public_sharing add column if not exists show_staff boolean not null default true;
alter table public.club_public_sharing add column if not exists opposition_can_message boolean not null default true;
alter table public.club_public_sharing add column if not exists opposition_can_call boolean not null default true;
alter table public.team_public_sharing add column if not exists profile_public boolean;
alter table public.team_public_sharing add column if not exists show_overview boolean;
alter table public.team_public_sharing add column if not exists show_cover boolean;
alter table public.team_public_sharing add column if not exists show_staff boolean;
alter table public.team_public_sharing add column if not exists opposition_can_message boolean;
alter table public.team_public_sharing add column if not exists opposition_can_call boolean;
-- A team row may now exist to override only some choices; its squad and media then follow the club.
alter table public.team_public_sharing alter column share_squad drop not null;
alter table public.team_public_sharing alter column share_media drop not null;

create or replace function internal.team_shares_publicly(p_team_id uuid, p_what text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(
    (select case p_what
              when 'squad' then s.share_squad when 'media' then s.share_media
              when 'profile' then s.profile_public when 'overview' then s.show_overview
              when 'cover' then s.show_cover when 'staff' then s.show_staff
              when 'message' then s.opposition_can_message when 'call' then s.opposition_can_call end
       from public.team_public_sharing s where s.team_id = p_team_id),
    (select case p_what
              when 'squad' then c.share_squad when 'media' then c.share_media
              when 'profile' then c.profile_public when 'overview' then c.show_overview
              when 'cover' then c.show_cover when 'staff' then c.show_staff
              when 'message' then c.opposition_can_message when 'call' then c.opposition_can_call end
       from public.club_public_sharing c join public.teams t on t.club_id = c.club_id where t.id = p_team_id),
    p_what in ('profile', 'overview', 'cover', 'staff', 'message', 'call'));
$function$;

create or replace function public.set_club_public_profile(p_club_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  perform internal.require_live_session();
  if not (internal.can('club.profile.edit', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.clubs.profile.manage')) then
    raise exception 'You are not authorised to change what this club shares.' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_settings, '{}')) k
              where k not in ('profile_public','show_overview','show_cover','show_staff','opposition_can_message',
                              'opposition_can_call','share_squad','share_media')) then
    raise exception 'Unknown setting.' using errcode = '22023';
  end if;
  insert into public.club_public_sharing (club_id, updated_by, updated_at) values (p_club_id, auth.uid(), now())
  on conflict (club_id) do nothing;
  update public.club_public_sharing c
     set profile_public = coalesce((p_settings->>'profile_public')::boolean, c.profile_public),
         show_overview = coalesce((p_settings->>'show_overview')::boolean, c.show_overview),
         show_cover = coalesce((p_settings->>'show_cover')::boolean, c.show_cover),
         show_staff = coalesce((p_settings->>'show_staff')::boolean, c.show_staff),
         opposition_can_message = coalesce((p_settings->>'opposition_can_message')::boolean, c.opposition_can_message),
         opposition_can_call = coalesce((p_settings->>'opposition_can_call')::boolean, c.opposition_can_call),
         share_squad = coalesce((p_settings->>'share_squad')::boolean, c.share_squad),
         share_media = coalesce((p_settings->>'share_media')::boolean, c.share_media),
         updated_by = auth.uid(), updated_at = now()
   where c.club_id = p_club_id;
end;
$function$;
revoke all on function public.set_club_public_profile(uuid, jsonb) from public, anon;
grant execute on function public.set_club_public_profile(uuid, jsonb) to authenticated;

-- A key present sets the team's own choice; a JSON null hands that choice back to the club.
create or replace function public.set_team_public_profile(p_team_id uuid, p_settings jsonb)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid;
begin
  perform internal.require_live_session();
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if not (internal.can('team.team.manage', 'team', v_club, p_team_id, null)
          or internal.can('club.profile.edit', 'club', v_club, null, null)) then
    raise exception 'You are not authorised to change what this team shares.' using errcode = '42501';
  end if;
  if exists (select 1 from jsonb_object_keys(coalesce(p_settings, '{}')) k
              where k not in ('profile_public','show_overview','show_cover','show_staff','opposition_can_message',
                              'opposition_can_call','share_squad','share_media')) then
    raise exception 'Unknown setting.' using errcode = '22023';
  end if;
  insert into public.team_public_sharing (team_id, updated_by, updated_at) values (p_team_id, auth.uid(), now())
  on conflict (team_id) do nothing;
  update public.team_public_sharing s
     set profile_public = case when p_settings ? 'profile_public' then (p_settings->>'profile_public')::boolean else s.profile_public end,
         show_overview = case when p_settings ? 'show_overview' then (p_settings->>'show_overview')::boolean else s.show_overview end,
         show_cover = case when p_settings ? 'show_cover' then (p_settings->>'show_cover')::boolean else s.show_cover end,
         show_staff = case when p_settings ? 'show_staff' then (p_settings->>'show_staff')::boolean else s.show_staff end,
         opposition_can_message = case when p_settings ? 'opposition_can_message' then (p_settings->>'opposition_can_message')::boolean else s.opposition_can_message end,
         opposition_can_call = case when p_settings ? 'opposition_can_call' then (p_settings->>'opposition_can_call')::boolean else s.opposition_can_call end,
         share_squad = case when p_settings ? 'share_squad' then (p_settings->>'share_squad')::boolean else s.share_squad end,
         share_media = case when p_settings ? 'share_media' then (p_settings->>'share_media')::boolean else s.share_media end,
         updated_by = auth.uid(), updated_at = now()
   where s.team_id = p_team_id;
end;
$function$;
revoke all on function public.set_team_public_profile(uuid, jsonb) from public, anon;
grant execute on function public.set_team_public_profile(uuid, jsonb) to authenticated;

-- The settings screen's reader: the club's defaults, each team's own choices, and what each team gets.
create or replace function public.get_club_public_sharing(p_club_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_keys text[] := array['profile_public','show_overview','show_cover','show_staff','opposition_can_message','opposition_can_call','share_squad','share_media'];
begin
  perform internal.require_live_session();
  if not (internal.can('club.profile.edit', 'club', p_club_id, null, null)
          or internal.can('club.profile.view', 'club', p_club_id, null, null)
          or internal.has_site_capability('site.clubs.view')) then
    raise exception 'You are not authorised to see this.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'shareSquad', coalesce((select s.share_squad from public.club_public_sharing s where s.club_id = p_club_id), false),
    'shareMedia', coalesce((select s.share_media from public.club_public_sharing s where s.club_id = p_club_id), false),
    'club', (select jsonb_build_object(
               'profile_public', coalesce(s.profile_public, true), 'show_overview', coalesce(s.show_overview, true),
               'show_cover', coalesce(s.show_cover, true), 'show_staff', coalesce(s.show_staff, true),
               'opposition_can_message', coalesce(s.opposition_can_message, true), 'opposition_can_call', coalesce(s.opposition_can_call, true),
               'share_squad', coalesce(s.share_squad, false), 'share_media', coalesce(s.share_media, false))
               from (select 1) one left join public.club_public_sharing s on s.club_id = p_club_id),
    'teams', coalesce((select jsonb_agg(jsonb_build_object(
                         'teamId', t.id, 'name', t.display_name,
                         'shareSquad', ts.share_squad, 'shareMedia', ts.share_media,
                         'own', jsonb_build_object(
                           'profile_public', ts.profile_public, 'show_overview', ts.show_overview, 'show_cover', ts.show_cover,
                           'show_staff', ts.show_staff, 'opposition_can_message', ts.opposition_can_message,
                           'opposition_can_call', ts.opposition_can_call, 'share_squad', ts.share_squad, 'share_media', ts.share_media))
                       order by t.display_name)
                         from public.teams t left join public.team_public_sharing ts on ts.team_id = t.id
                        where t.club_id = p_club_id and t.active and t.archived_at is null), '[]'));
end;
$function$;

-- =====================================================================================================
-- 7. SQUAD NUMBERS AND POSITIONS -- on a player's PLACE in a team, never on the person
--
-- A player can wear 9 for the U14s and 21 for the U15s, so the number and position belong to the
-- player_team_memberships row. Positions are the rugby code's own words, plus the general ones a youth
-- or non-standard side uses; numbers run 0-99 rather than assuming a senior XV.
-- =====================================================================================================
create table if not exists public.team_squad_details (
  membership_id uuid primary key references public.player_team_memberships(id) on delete cascade,
  team_id uuid not null references public.teams(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  shirt_number smallint check (shirt_number between 0 and 99),
  position_key text,
  updated_by uuid,
  updated_at timestamptz not null default now()
);
create index if not exists team_squad_details_team_idx on public.team_squad_details (team_id);
alter table public.team_squad_details enable row level security;
drop policy if exists team_squad_details_session_ok on public.team_squad_details;
create policy team_squad_details_session_ok on public.team_squad_details as restrictive for all to authenticated
  using (internal.session_ok()) with check (internal.session_ok());
drop policy if exists team_squad_details_read on public.team_squad_details;
create policy team_squad_details_read on public.team_squad_details for select to authenticated
  using (exists (select 1 from public.teams t where t.id = team_squad_details.team_id
                  and (internal.can('team.roster.view', 'team', t.club_id, t.id, null)
                       or internal.can('team.roster.view', 'club', t.club_id, null, null))));
revoke all on public.team_squad_details from anon, authenticated;
grant select on public.team_squad_details to authenticated;

create or replace function internal.squad_position_keys(p_rugby_code text)
returns text[]
language sql
immutable
set search_path to ''
as $function$
  select case when p_rugby_code = 'league' then
    array['fullback','wing','centre','stand_off','scrum_half','prop','hooker','second_row','loose_forward',
          'interchange','forward','back','utility']
  else
    array['loosehead_prop','hooker','tighthead_prop','lock','blindside_flanker','openside_flanker','number_eight',
          'scrum_half','fly_half','left_wing','inside_centre','outside_centre','right_wing','fullback',
          'prop','flanker','centre','wing','replacement','forward','back','utility']
  end;
$function$;

-- WHO SETS NUMBERS AND POSITIONS: whoever manages the roster, and the coaches who run the side's matches
-- (fixture.fixture.edit at the TEAM). Picking a side's numbers is match-day selection; it grants nothing
-- over who is in the squad, which stays team.roster.manage's alone.
create or replace function internal.may_edit_squad_details(p_team_id uuid)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select coalesce(auth.uid() is not null and exists (
    select 1 from public.teams t
     where t.id = p_team_id
       and (internal.can('team.roster.manage', 'team', t.club_id, t.id, null)
            or internal.can('team.roster.manage', 'club', t.club_id, null, null)
            or internal.can('fixture.fixture.edit', 'team', t.club_id, t.id, null))), false);
$function$;
revoke all on function internal.may_edit_squad_details(uuid) from public, anon, authenticated;

create or replace function public.set_team_squad_detail(p_team_id uuid, p_player_id uuid, p_shirt_number integer, p_position_key text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_club uuid; v_code text; v_membership uuid; v_position text := nullif(btrim(coalesce(p_position_key, '')), '');
begin
  perform internal.require_live_session();
  select t.club_id, t.rugby_code into v_club, v_code from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'Team not found.' using errcode = 'P0002';
  end if;
  if not internal.may_edit_squad_details(p_team_id) then
    raise exception 'You are not authorised to change this squad.' using errcode = '42501';
  end if;
  select m.id into v_membership from public.player_team_memberships m
   where m.team_id = p_team_id and m.player_id = p_player_id and m.state = 'ACTIVE'
   order by m.created_at desc limit 1;
  if v_membership is null then
    raise exception 'That player is not in this squad.' using errcode = '22023';
  end if;
  if p_shirt_number is not null and p_shirt_number not between 0 and 99 then
    raise exception 'A squad number is 0 to 99.' using errcode = '22023';
  end if;
  if v_position is not null and not (v_position = any (internal.squad_position_keys(v_code))) then
    raise exception 'That is not a position in this side''s rugby.' using errcode = '22023';
  end if;
  if p_shirt_number is null and v_position is null then
    delete from public.team_squad_details where membership_id = v_membership;
    return;
  end if;
  insert into public.team_squad_details (membership_id, team_id, player_id, shirt_number, position_key, updated_by, updated_at)
  values (v_membership, p_team_id, p_player_id, p_shirt_number, v_position, auth.uid(), now())
  on conflict (membership_id) do update set shirt_number = excluded.shirt_number, position_key = excluded.position_key,
                                            updated_by = excluded.updated_by, updated_at = now();
end;
$function$;
revoke all on function public.set_team_squad_detail(uuid, uuid, integer, text) from public, anon;
grant execute on function public.set_team_squad_detail(uuid, uuid, integer, text) to authenticated;

-- The squad editor's reader: full names, for the people who manage the squad.
create or replace function public.get_team_squad_details(p_team_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public'
as $function$
declare v_club uuid; v_code text;
begin
  perform internal.require_live_session();
  select t.club_id, t.rugby_code into v_club, v_code from public.teams t where t.id = p_team_id;
  if v_club is null or not internal.may_edit_squad_details(p_team_id) then
    raise exception 'You are not authorised to change this squad.' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'rugbyCode', v_code,
    'positions', to_jsonb(internal.squad_position_keys(v_code)),
    'players', coalesce((select jsonb_agg(jsonb_build_object(
                  'playerId', p.id, 'name', nullif(btrim(concat_ws(' ', p.first_name, p.surname)), ''),
                  'shirtNumber', d.shirt_number, 'positionKey', d.position_key)
                  order by d.shirt_number nulls last, p.first_name, p.surname)
               from public.player_team_memberships m
               join public.players p on p.id = m.player_id
               left join public.team_squad_details d on d.membership_id = m.id
              where m.team_id = p_team_id and m.state = 'ACTIVE'), '[]'));
end;
$function$;
revoke all on function public.get_team_squad_details(uuid) from public, anon;
grant execute on function public.get_team_squad_details(uuid) to authenticated;

-- =====================================================================================================
-- 8. A PHOTO IS SHARED ON THE PUBLIC PAGE AS ITS OWN DECISION
--
-- Turning team photos on publishes only the photos somebody chose to share, never the whole gallery.
-- =====================================================================================================
alter table public.team_media add column if not exists shared_publicly boolean not null default false;

create or replace function public.set_team_media_public(p_media_id uuid, p_shared boolean)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare v_team uuid; v_club uuid;
begin
  perform internal.require_live_session();
  select m.team_id, m.club_id into v_team, v_club from public.team_media m where m.id = p_media_id and m.state = 'ACTIVE';
  if v_team is null then
    raise exception 'Photo not found.' using errcode = 'P0002';
  end if;
  if not ((exists (select 1 from public.teams t where t.id = v_team and t.club_id = v_club)
           and internal.can('team.team.manage', 'team', v_club, v_team, null))
          or internal.can('club.profile.edit', 'club', v_club, null, null)) then
    raise exception 'Not authorized to share this photo.' using errcode = '42501';
  end if;
  update public.team_media set shared_publicly = coalesce(p_shared, false) where id = p_media_id;
end;
$function$;
revoke all on function public.set_team_media_public(uuid, boolean) from public, anon;
grant execute on function public.set_team_media_public(uuid, boolean) to authenticated;

create or replace function internal.team_gallery_media_is_public(p_name text)
returns boolean
language sql
stable security definer
set search_path to ''
as $function$
  select exists (
    select 1 from public.team_media m
     where m.storage_path = p_name and m.state = 'ACTIVE' and m.shared_publicly
       and internal.team_shares_publicly(m.team_id, 'media'));
$function$;

-- =====================================================================================================
-- 9. THE OPPOSITION, AND HOW TO REACH A TEAM'S STAFF
--
-- "Opposition staff" = somebody who runs the OTHER side of a live fixture against this team (the
-- canonical fixture-edit capability, at its team or club), within thirty days either way. Message Staff
-- opens that fixture's existing staff conversation -- the two clubs' channel for the match -- so no new
-- channel and no personal address is needed. Call uses the team's, else the club's, OPERATIONAL contact
-- number (team_contacts / club_contacts), never a person's own profile number.
-- =====================================================================================================
create or replace function internal.opposition_fixture_for_team(p_team_id uuid)
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select f.id
    from public.fixtures f
    join public.teams t on t.id = p_team_id
   where auth.uid() is not null
     and f.cancelled_at is null and f.archived_at is null
     and f.kickoff_date between current_date - 30 and current_date + 365
     and (f.owning_team_id = p_team_id or f.opponent_team_id = p_team_id)
     and internal.caller_fixture_club_id(f.id) is not null
     and internal.caller_fixture_club_id(f.id) is distinct from t.club_id
   -- The NEXT match against them first; only with none ahead, the most recent one played.
   order by (f.kickoff_date < current_date), abs(f.kickoff_date - current_date), f.kickoff_date
   limit 1;
$function$;
revoke all on function internal.opposition_fixture_for_team(uuid) from public, anon, authenticated;

create or replace function internal.team_operational_phone(p_team_id uuid)
returns table(phone text, label text)
language sql
stable security definer
set search_path to ''
as $function$
  -- THE CLUB'S OPERATIONAL NUMBER, never a coach's own. The club's published contacts first -- the
  -- fixture secretary is whom another club calls about a match -- then a team's Team Manager contact.
  -- Coach entries in team_contacts are deliberately never used: that number may be a person's own phone.
  -- Only a contact the club has PUBLISHED: a number it keeps private is never handed to another club.
  select x.phone, x.label from (
    select nullif(btrim(cc.phone), '') as phone,
           case cc.role when 'fixture_secretary' then 'Fixture Secretary' when 'minis_secretary' then 'Minis Secretary' else 'Club' end as label,
           case cc.role when 'fixture_secretary' then 1 when 'general' then 2 else 3 end as rank, cc.created_at
      from public.club_contacts cc join public.teams t on t.club_id = cc.club_id where t.id = p_team_id and cc.is_public
    union all
    select nullif(btrim(tc.phone), ''), 'Team Manager', 4, tc.created_at
      from public.team_contacts tc where tc.team_id = p_team_id and tc.role = 'team_manager' and tc.is_public
  ) x
  where x.phone is not null
  order by x.rank, x.created_at
  limit 1;
$function$;
revoke all on function internal.team_operational_phone(uuid) from public, anon, authenticated;

-- =====================================================================================================
-- 10. THE PUBLIC TEAM PAGE, AS EACH VIEWER MAY SEE IT
--
-- Settings decide what is public; the viewer decides what else is offered. Members of the team always
-- see their own page. The opposition's staff are offered Message Staff and Call where the team allows
-- it, and are sent the operational number only then. Nobody else -- a parent, a player, a member of
-- another club, a signed-out visitor -- is sent any contact detail at all.
-- =====================================================================================================
create or replace function public.get_public_team_profile(p_team_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  t record;
  v_member boolean;
  v_squad jsonb;
  v_media jsonb;
  v_staff jsonb;
  v_opp_fixture uuid;
  v_phone text;
  v_phone_label text;
  v_can_message boolean := false;
  v_can_call boolean := false;
begin
  select tm.id, tm.display_name, tm.description, tm.cover_image_path, tm.cover_stock_key, tm.category, tm.age_group,
         tm.rugby_code, tm.active, tm.archived_at, tm.folded_at, c.id as club_id, c.slug as club_slug, c.status as club_status,
         c.logo_storage_path, c.website, c.show_website, c.show_home_ground, cd.id as directory_id, cd.name as club_name,
         cd.logo_storage_path as directory_logo, cd.home_ground
    into t
    from public.teams tm
    join public.clubs c on c.id = tm.club_id
    join public.club_directory cd on cd.id = c.directory_id
   where tm.id = p_team_id;
  if t.id is null or not t.active or t.archived_at is not null or t.club_status is distinct from 'active' then
    return null;
  end if;

  v_member := coalesce(auth.uid() is not null and (
      internal.can('team.team.view', 'team', t.club_id, t.id, null)
      or exists (select 1 from public.player_team_memberships ptm
                  where ptm.team_id = t.id and ptm.status = 'active'
                    and internal.can_player_as_family('player.profile.view', ptm.player_id))), false);

  -- A team that keeps its page private shows it to its own people only.
  if not v_member and not internal.team_shares_publicly(p_team_id, 'profile') then
    return null;
  end if;

  if internal.team_shares_publicly(p_team_id, 'staff') then
    with roles as (
      select distinct cm.user_id, ra.role_key
        from public.role_assignments ra
        join public.club_memberships cm on cm.id = ra.membership_id and cm.state = 'ACTIVE'
       where ra.team_id = p_team_id and ra.state = 'ACTIVE'
         and ra.role_key in ('COACH', 'TEAM_MANAGER', 'TEAM_ADMINISTRATION', 'TEAM_SAFEGUARDING_LEAD', 'FIRST_AIDER')
    ), labelled as (
      select r.user_id,
             case r.role_key when 'COACH' then 'Coach' when 'TEAM_MANAGER' then 'Team Manager'
                             when 'TEAM_ADMINISTRATION' then 'Team Admin' when 'TEAM_SAFEGUARDING_LEAD' then 'Team Safeguarding Lead'
                             else 'First Aider' end as label,
             case r.role_key when 'COACH' then 1 when 'TEAM_MANAGER' then 2 when 'TEAM_ADMINISTRATION' then 3
                             when 'TEAM_SAFEGUARDING_LEAD' then 4 else 5 end as rank
        from roles r
    ), people as (
      select l.user_id, string_agg(l.label, ' · ' order by l.rank) as roles, min(l.rank) as rank
        from labelled l group by l.user_id
    )
    select coalesce(jsonb_agg(jsonb_build_object(
             'name', nullif(btrim(concat_ws(' ', pr.first_name, pr.surname)), ''),
             'role', pe.roles)
           order by pe.rank, pr.first_name), '[]')
      into v_staff
      from people pe
      join public.profiles pr on pr.id = pe.user_id;
  else
    v_staff := '[]';
  end if;

  -- SQUAD, only where shared: first name and surname initial, and the number and position the team gave.
  if internal.team_shares_publicly(p_team_id, 'squad') then
    select coalesce(jsonb_agg(jsonb_build_object(
             'playerId', p.id,
             'name', btrim(concat_ws(' ', p.first_name, nullif(left(coalesce(p.surname, ''), 1), '') || '.')),
             'shirtNumber', d.shirt_number,
             'positionKey', d.position_key)
           order by d.shirt_number nulls last, p.first_name, p.surname), '[]')
      into v_squad
      from public.player_team_memberships ptm
      join public.players p on p.id = ptm.player_id
      left join public.team_squad_details d on d.membership_id = ptm.id
     where ptm.team_id = p_team_id and ptm.status = 'active';
  end if;

  -- PHOTOS, only where shared, and then only the ones chosen for the public page.
  if internal.team_shares_publicly(p_team_id, 'media') then
    select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'path', m.storage_path, 'caption', m.caption)
                    order by m.created_at desc), '[]')
      into v_media
      from (select * from public.team_media where team_id = p_team_id and state = 'ACTIVE' and shared_publicly
             order by created_at desc limit 60) m;
  end if;

  -- CONTACT, for the opposition's staff only, and only as the team allows.
  if not v_member then
    v_opp_fixture := internal.opposition_fixture_for_team(p_team_id);
  end if;
  if v_opp_fixture is not null then
    v_can_message := internal.team_shares_publicly(p_team_id, 'message');
    if internal.team_shares_publicly(p_team_id, 'call') then
      select o.phone, o.label into v_phone, v_phone_label from internal.team_operational_phone(p_team_id) o;
      v_can_call := v_phone is not null;
    end if;
  end if;

  return jsonb_build_object(
    'teamId', t.id,
    'name', t.display_name,
    'description', case when internal.team_shares_publicly(p_team_id, 'overview') or v_member then t.description end,
    'coverImagePath', case when internal.team_shares_publicly(p_team_id, 'cover') or v_member then t.cover_image_path end,
    'coverStockKey', case when internal.team_shares_publicly(p_team_id, 'cover') or v_member then t.cover_stock_key end,
    'category', t.category,
    'ageGroup', t.age_group,
    'rugbyCode', t.rugby_code,
    'club', jsonb_build_object('clubId', t.club_id, 'directoryId', t.directory_id, 'name', t.club_name, 'slug', t.club_slug,
                               'logoPath', coalesce(t.logo_storage_path, t.directory_logo),
                               'homeGround', case when coalesce(t.show_home_ground, true) then coalesce(
                                  (select v.name from public.venues v where v.club_id = t.club_id and v.active and v.is_default_home limit 1),
                                  nullif(btrim(t.home_ground), '')) end,
                               'website', case when coalesce(t.show_website, true) then nullif(btrim(t.website), '') end),
    'staffShown', internal.team_shares_publicly(p_team_id, 'staff'),
    'staff', v_staff,
    'squadShared', v_squad is not null,
    'squad', v_squad,
    'mediaShared', v_media is not null,
    'media', v_media,
    'viewerIsMember', v_member,
    'canEditSquad', internal.may_edit_squad_details(t.id),
    'contact', case when v_opp_fixture is not null and (v_can_message or v_can_call) then jsonb_build_object(
                 'canMessage', v_can_message,
                 'fixtureId', case when v_can_message then v_opp_fixture end,
                 'canCall', v_can_call,
                 'phone', case when v_can_call then v_phone end,
                 'phoneLabel', case when v_can_call then v_phone_label end) end);
end;
$function$;
revoke all on function public.get_public_team_profile(uuid) from public;
grant execute on function public.get_public_team_profile(uuid) to anon, authenticated;

-- =====================================================================================================
-- 12. THE GROUND, AS THE VISITING SIDE SEES IT
--
-- The away side cannot read the host's venue row, so it was shown an illustration for a ground the host had
-- photographed. The viewer's ground now carries the ground's own picture and arrival notes -- the same
-- public facts the host publishes -- for somebody already allowed to see the match.
-- =====================================================================================================
create or replace function public.get_match_centre_viewer(p_fixture_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'public', 'internal', 'pg_temp'
as $function$
declare
  f public.fixtures;
  v_home text;
  v_away text;
  v_side text;
begin
  perform internal.require_live_session();
  select * into f from public.fixtures where id = p_fixture_id;
  if not found or not internal.fixture_visible_to_caller(p_fixture_id) then
    raise exception 'This fixture is not available.' using errcode = '42501';
  end if;
  v_home := internal.fixture_side_relationship(p_fixture_id, 'home');
  v_away := internal.fixture_side_relationship(p_fixture_id, 'away');
  -- WHERE A PERSON STANDS ON BOTH SIDES -- a club running both teams -- the row's own side is theirs.
  v_side := case
    when v_home is not null and v_away is not null then case when coalesce(f.home_away, 'Home') <> 'Away' then 'home' else 'away' end
    when v_home is not null then 'home'
    when v_away is not null then 'away'
    else null end;
  return jsonb_build_object(
    'side', v_side,
    'home', v_home,
    'away', v_away,
    'canManage', internal.can_manage_fixture_side(f.owning_team_id, f.owning_scheduling_group_id)
                 or (f.opponent_team_id is not null and internal.can_manage_fixture_side(f.opponent_team_id, f.opponent_scheduling_group_id)),
    'kickedOff', internal.fixture_result_eligible(f.id),
    -- WHERE IT IS, FOR BOTH SIDES. The away side cannot read the home club's venue rows, so its families
    -- were told "To be confirmed" for a ground the home side knew. A club's ground is public (the Club
    -- Directory publishes it); this is the fixture's chosen venue, else the home side's default ground,
    -- for somebody already allowed to see the match.
    'ground', (
      select jsonb_build_object(
               'name', v.name,
               'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.address_line_2), ''),
                                                    nullif(btrim(v.town), ''), nullif(btrim(v.county), '')), ''), nullif(btrim(v.address), '')),
               'postcode', v.postcode,
               'latitude', v.latitude,
               'longitude', v.longitude,
               'source', s.source,
               -- 20270728: the ground's own picture and arrival notes, so the visiting side is shown the host's
               -- real cover rather than an illustration it could not tell apart from one.
               'id', v.id,
               'coverImagePath', v.cover_image_path,
               'coverStockKey', v.cover_stock_key,
               'directions', nullif(btrim(v.directions), ''),
               'cateringAvailable', v.catering_available,
               'changingRoomsAvailable', v.changing_rooms_available)
        from (
          select f.venue_id as id, 'fixture_venue'::text as source, 1 as rank where f.venue_id is not null
          union all
          select hv.id, 'home_ground', 2
            from public.venues hv
           where hv.is_default_home and hv.active
             and hv.club_id = (select t.club_id from public.teams t
                                where t.id = case when coalesce(f.home_away, 'Home') = 'Away' then f.opponent_team_id else f.owning_team_id end)
        ) s
        join public.venues v on v.id = s.id
       order by s.rank
       limit 1));
end;
$function$;
revoke all on function public.get_match_centre_viewer(uuid) from public, anon;
grant execute on function public.get_match_centre_viewer(uuid) to authenticated;

-- =====================================================================================================
-- 13. ONE WRITE FOR THE ARRANGEMENTS
--
-- set_fixture_arrangements (20270727) wrote the rooms, notes and catering against the HOST's canonical
-- rooms only, with no numbered rooms, no "no changing rooms" and no host re-resolution. Everything it did
-- set_fixture_facilities does, under the same authority and the same table guard; leaving it callable
-- would be a second, weaker way to write the same facts. Its one caller (the mobile Arrangements editor)
-- moved in this change, so it is retired rather than left for somebody to find.
-- =====================================================================================================
drop function if exists public.set_fixture_arrangements(uuid, uuid, uuid, text, boolean);
