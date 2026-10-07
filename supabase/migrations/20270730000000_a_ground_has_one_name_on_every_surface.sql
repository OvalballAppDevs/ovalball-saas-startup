-- =====================================================================================================
-- ONE ANSWER TO "WHERE IS IT", FOR EVERY SCHEDULE SURFACE
--
-- Match Centre names a match's ground through the server (`get_match_centre_viewer.ground`), because a
-- visiting family cannot read the host club's venue rows. Every list read `venues` under the caller's
-- own row rules instead -- the Fixtures agenda, the Calendar, the web agenda -- so the same Saturday was
-- "Lightfoot Green" in Match Centre and "Venue TBC" one tap back on the list that opened it. The same
-- was true of a tournament at another club's ground, and of an event a guest outside the club was
-- invited to.
--
-- The ground was never private. The Club Directory publishes a club's ground, and Match Centre already
-- tells anybody allowed to see the match where it is. This puts the rule in one place:
--
--   1. internal.fixture_ground_id -- the venue chosen for the fixture; else, where the fixture records
--      no place of its own, the default ground of a host that manages itself on Ovalball. A provisional
--      host's typed ground stays on the fixture (`venue_address`), as the host model already writes it.
--   2. get_match_centre_viewer -- now asks (1) instead of carrying its own copy of the rule.
--   3. public.schedule_grounds -- a list asks for the ground NAMES of the fixtures, tournaments and events
--      it is about to draw, and is told only about the ones its caller can already see.
-- =====================================================================================================

-- -----------------------------------------------------------------------------------------------------
-- 1. THE GROUND OF A FIXTURE
--
-- The order is the one `resolveFixtureVenue` documents for every surface: the explicit venue, then the
-- fixture's own typed place, then the home side's ground. An unsettled orientation has no host and so no
-- default ground -- a festival is not played at anybody's.
-- -----------------------------------------------------------------------------------------------------
create or replace function internal.fixture_ground_id(p_fixture_id uuid)
returns uuid
language sql
stable security definer
set search_path to ''
as $function$
  select case
           when f.venue_id is not null then f.venue_id
           when nullif(btrim(f.venue_address), '') is not null then null
           when h.mode = 'CANONICAL' then internal.host_default_venue(h.host_club_id)
         end
    from public.fixtures f
    left join lateral internal.fixture_host(f.id) h on true
   where f.id = p_fixture_id;
$function$;
revoke all on function internal.fixture_ground_id(uuid) from public, anon, authenticated;
comment on function internal.fixture_ground_id(uuid) is
  'The canonical venue a fixture is played at: its chosen venue, else (with no typed place) a canonical host''s default ground.';

-- -----------------------------------------------------------------------------------------------------
-- 2. MATCH CENTRE ASKS THE SAME QUESTION
--
-- Unchanged except for the ground, which is now `internal.fixture_ground_id` rather than a second copy
-- of the rule that also had to agree with the lists.
-- -----------------------------------------------------------------------------------------------------
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
    -- WHERE IT IS, FOR BOTH SIDES. A club's ground is public (the Club Directory publishes it); this is the
    -- fixture's canonical ground (internal.fixture_ground_id), for somebody already allowed to see the match.
    'ground', (
      select jsonb_build_object(
               'name', v.name,
               'address', coalesce(nullif(concat_ws(', ', nullif(btrim(v.address_line_1), ''), nullif(btrim(v.address_line_2), ''),
                                                    nullif(btrim(v.town), ''), nullif(btrim(v.county), '')), ''), nullif(btrim(v.address), '')),
               'postcode', v.postcode,
               'latitude', v.latitude,
               'longitude', v.longitude,
               -- Coordinates carry their provenance, so a forecast is asked only about a ground geocoded from its
               -- own postcode (`forecastLocation`) -- never about a number somebody typed.
               'geocodeStatus', v.geocode_status,
               'source', case when v.id = f.venue_id then 'fixture_venue' else 'home_ground' end,
               'id', v.id,
               'coverImagePath', v.cover_image_path,
               'coverStockKey', v.cover_stock_key,
               'directions', nullif(btrim(v.directions), ''),
               'cateringAvailable', v.catering_available,
               'changingRoomsAvailable', v.changing_rooms_available)
        from public.venues v
       where v.id = internal.fixture_ground_id(f.id)));
end;
$function$;
revoke all on function public.get_match_centre_viewer(uuid) from public, anon;
grant execute on function public.get_match_centre_viewer(uuid) to authenticated;

-- -----------------------------------------------------------------------------------------------------
-- 3. A LIST ASKS FOR THE GROUNDS OF WHAT IT IS ABOUT TO DRAW
--
-- Names only -- the ground and, where one is allocated, the pitch: a list says where, and the canonical
-- object it opens says the rest. Each subject is
-- answered only where the caller can already see it by that object's own rule, so this tells nobody
-- about a fixture, tournament or event they could not already open. Unknown and invisible ids are simply
-- absent from the answer, never an error that would confirm they exist.
-- -----------------------------------------------------------------------------------------------------
create or replace function public.schedule_grounds(
  p_fixture_ids uuid[] default '{}',
  p_tournament_ids uuid[] default '{}',
  p_event_ids uuid[] default '{}'
)
returns table(subject_id uuid, venue_id uuid, name text, pitch_name text)
language plpgsql
stable security definer
set search_path to ''
as $function$
begin
  perform internal.require_live_session();
  if coalesce(cardinality(p_fixture_ids), 0) + coalesce(cardinality(p_tournament_ids), 0)
     + coalesce(cardinality(p_event_ids), 0) > 1000 then
    raise exception 'Ask for at most 1000 grounds at once.' using errcode = '22023';
  end if;
  return query
    select f.id, v.id, v.name, p.display_name
      from public.fixtures f
      left join public.venues v on v.id = internal.fixture_ground_id(f.id)
      left join public.club_pitches p on p.id = f.pitch_id
     where f.id = any(coalesce(p_fixture_ids, '{}'::uuid[]))
       and (v.id is not null or p.id is not null)
       and internal.fixture_visible_to_caller(f.id)
    union all
    select t.id, v.id, v.name, p.display_name
      from public.tournaments t
      left join public.venues v on v.id = t.venue_id
      left join public.club_pitches p on p.id = t.pitch_id
     where t.id = any(coalesce(p_tournament_ids, '{}'::uuid[]))
       and (v.id is not null or p.id is not null)
       and internal.can_view_tournament(t.id)
    union all
    select e.id, v.id, v.name, null::text
      from public.club_events e
      join public.venues v on v.id = e.venue_id
     where e.id = any(coalesce(p_event_ids, '{}'::uuid[]))
       and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide);
end;
$function$;
revoke all on function public.schedule_grounds(uuid[], uuid[], uuid[]) from public, anon;
grant execute on function public.schedule_grounds(uuid[], uuid[], uuid[]) to authenticated;
comment on function public.schedule_grounds(uuid[], uuid[], uuid[]) is
  'Ground and pitch names for the fixtures, tournaments and events a schedule list is drawing, answered only for those the caller can see.';
