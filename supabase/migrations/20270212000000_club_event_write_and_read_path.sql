-- =====================================================================
-- THE ONE WAY IN, AND THE ONE WAY OUT
--
-- club_events, club_event_teams and club_event_pitches carry SELECT policies
-- and no write policies at all. That is deliberate: an event is not a row a
-- client assembles, it is a set of related rows that must land together or not
-- at all -- the event, its teams, its pitches -- and the authority to write it
-- depends on the very team list being written.
--
-- So the writers live here, SECURITY DEFINER, gating on the capability engine
-- and validating every foreign id against the club that owns the event. A
-- forged team id, a forged pitch id or another club's venue is rejected on the
-- server, not hidden in the browser.
-- =====================================================================

-- ---------------------------------------------------------------------
-- CREATE / UPDATE.
--
-- One function for both, because the validation is identical and two copies
-- of it would drift. `p_event_id` null creates; supplied, updates.
--
-- Teams and pitches are passed as full sets and REPLACE what is stored, which
-- is what "edit the event" means -- there is no partial team patch to get
-- wrong, and removing the last team is expressible.
-- ---------------------------------------------------------------------
create or replace function public.save_club_event(
  p_club_id uuid,
  p_name text,
  p_starts_on date,
  p_ends_on date,
  p_event_id uuid default null,
  p_description text default null,
  p_start_time time default null,
  p_end_time time default null,
  p_is_club_wide boolean default false,
  p_team_ids uuid[] default '{}',
  p_pitch_ids uuid[] default '{}',
  p_venue_id uuid default null,
  p_external_location_name text default null,
  p_external_address_line_1 text default null,
  p_external_address_line_2 text default null,
  p_external_town text default null,
  p_external_county text default null,
  p_external_postcode text default null,
  p_external_country text default null,
  p_external_latitude numeric default null,
  p_external_longitude numeric default null,
  p_external_address_provider_ref text default null,
  p_season_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := p_event_id;
  v_name text := btrim(coalesce(p_name, ''));
  v_season_id uuid := p_season_id;
  v_bad uuid;
begin
  if auth.uid() is null then
    raise exception 'Not signed in.' using errcode = '42501';
  end if;

  -- AUTHORITY.
  --
  -- Creating is club-scoped, or team-scoped when the event is confined to a
  -- team the caller manages. Editing re-checks against the event as it stands
  -- AND against the team set being written, so an event cannot be widened out
  -- of the caller's own authority by the same call that edits it.
  if v_event_id is null then
    if not (
      internal.is_site_admin()
      or internal.has_capability('calendar.manage', 'club', p_club_id, null)
      or (
        not coalesce(p_is_club_wide, false)
        and array_length(p_team_ids, 1) is not null
        and not exists (
          select 1 from unnest(p_team_ids) t(id)
          where not internal.has_capability('calendar.manage', 'team', p_club_id, t.id)
        )
      )
    ) then
      raise exception 'You do not have permission to create events for this club.' using errcode = '42501';
    end if;
  else
    if not internal.can_manage_club_event(v_event_id) then
      raise exception 'You do not have permission to manage this event.' using errcode = '42501';
    end if;
    -- The edit must also be within authority for the teams it will now name.
    if not (
      internal.is_site_admin()
      or internal.has_capability('calendar.manage', 'club', p_club_id, null)
    ) then
      if coalesce(p_is_club_wide, false) then
        raise exception 'Only club administration can make an event club-wide.' using errcode = '42501';
      end if;
      if exists (
        select 1 from unnest(p_team_ids) t(id)
        where not internal.has_capability('calendar.manage', 'team', p_club_id, t.id)
      ) then
        raise exception 'You do not have permission to include one of those teams.' using errcode = '42501';
      end if;
    end if;
  end if;

  -- SHAPE.
  if length(v_name) = 0 or length(v_name) > 160 then
    raise exception 'An event needs a name of 160 characters or fewer.' using errcode = '22023';
  end if;
  if p_starts_on is null or p_ends_on is null then
    raise exception 'An event needs a start date and an end date.' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'An event cannot end before it starts.' using errcode = '22023';
  end if;
  if p_ends_on = p_starts_on and p_start_time is not null and p_end_time is not null and p_end_time < p_start_time then
    raise exception 'An event cannot finish before it begins.' using errcode = '22023';
  end if;

  -- LOCATION: exactly one model, and a venue must belong to this club.
  if (p_venue_id is not null) = (btrim(coalesce(p_external_location_name, '')) <> '') then
    raise exception 'An event needs either a club venue or an external location, not both.' using errcode = '22023';
  end if;
  if p_venue_id is not null and not exists (
    select 1 from public.venues v where v.id = p_venue_id and v.club_id = p_club_id
  ) then
    raise exception 'That venue does not belong to this club.' using errcode = '42501';
  end if;

  -- SCOPE: club-wide carries no team rows; a scoped event needs at least one.
  if coalesce(p_is_club_wide, false) then
    if array_length(p_team_ids, 1) is not null and array_length(p_team_ids, 1) > 0 then
      raise exception 'A club-wide event covers every team and does not list them individually.' using errcode = '22023';
    end if;
  elsif array_length(p_team_ids, 1) is null or array_length(p_team_ids, 1) = 0 then
    raise exception 'Choose at least one team, or make this a club-wide event.' using errcode = '22023';
  end if;

  -- EVERY TEAM AND PITCH MUST BELONG TO THIS CLUB. This is the forged-id
  -- boundary: ids arrive from a browser and are checked against ownership
  -- here, never trusted because a form offered them.
  select t.id into v_bad
  from unnest(p_team_ids) t(id)
  where not exists (select 1 from public.teams tm where tm.id = t.id and tm.club_id = p_club_id)
  limit 1;
  if v_bad is not null then
    raise exception 'One of those teams does not belong to this club.' using errcode = '42501';
  end if;

  select p.id into v_bad
  from unnest(p_pitch_ids) p(id)
  where not exists (select 1 from public.club_pitches cp where cp.id = p.id and cp.club_id = p_club_id)
  limit 1;
  if v_bad is not null then
    raise exception 'One of those pitches does not belong to this club.' using errcode = '42501';
  end if;

  -- SEASON comes from the canonical register. Resolved from the start date
  -- only when the caller did not state one, and by ASKING the register which
  -- season contains the date rather than computing a year from it.
  if v_season_id is null then
    select s.id into v_season_id
    from public.seasons s
    join public.clubs c on c.id = p_club_id
    join public.club_directory d on d.id = c.directory_id
    where s.rugby_code = d.rugby_code
      and p_starts_on between s.starts_on and s.ends_on
    order by s.starts_on desc
    limit 1;
  end if;

  if v_event_id is null then
    insert into public.club_events (
      club_id, season_id, name, description,
      starts_on, start_time, ends_on, end_time,
      is_club_wide, venue_id,
      external_location_name, external_address_line_1, external_address_line_2,
      external_town, external_county, external_postcode, external_country,
      external_latitude, external_longitude, external_address_provider_ref,
      created_by, updated_by
    ) values (
      p_club_id, v_season_id, v_name, nullif(btrim(coalesce(p_description, '')), ''),
      p_starts_on, p_start_time, p_ends_on, p_end_time,
      coalesce(p_is_club_wide, false), p_venue_id,
      nullif(btrim(coalesce(p_external_location_name, '')), ''), p_external_address_line_1, p_external_address_line_2,
      p_external_town, p_external_county, p_external_postcode, p_external_country,
      p_external_latitude, p_external_longitude, p_external_address_provider_ref,
      auth.uid(), auth.uid()
    )
    returning id into v_event_id;
  else
    update public.club_events set
      season_id = v_season_id,
      name = v_name,
      description = nullif(btrim(coalesce(p_description, '')), ''),
      starts_on = p_starts_on,
      start_time = p_start_time,
      ends_on = p_ends_on,
      end_time = p_end_time,
      is_club_wide = coalesce(p_is_club_wide, false),
      venue_id = p_venue_id,
      external_location_name = nullif(btrim(coalesce(p_external_location_name, '')), ''),
      external_address_line_1 = p_external_address_line_1,
      external_address_line_2 = p_external_address_line_2,
      external_town = p_external_town,
      external_county = p_external_county,
      external_postcode = p_external_postcode,
      external_country = p_external_country,
      external_latitude = p_external_latitude,
      external_longitude = p_external_longitude,
      external_address_provider_ref = p_external_address_provider_ref,
      updated_by = auth.uid(),
      updated_at = now()
    where id = v_event_id;
  end if;

  -- Teams and pitches are replaced as sets. Attendance rows are keyed on the
  -- EVENT, not on the team list, so a player who answered and whose team is
  -- still involved keeps their answer through an edit.
  delete from public.club_event_teams where event_id = v_event_id;
  if array_length(p_team_ids, 1) is not null then
    insert into public.club_event_teams (event_id, team_id)
    select v_event_id, t.id from unnest(p_team_ids) t(id)
    on conflict do nothing;
  end if;

  delete from public.club_event_pitches where event_id = v_event_id;
  if array_length(p_pitch_ids, 1) is not null then
    insert into public.club_event_pitches (event_id, pitch_id)
    select v_event_id, p.id from unnest(p_pitch_ids) p(id)
    on conflict do nothing;
  end if;

  return v_event_id;
end;
$$;

revoke all on function public.save_club_event(uuid, text, date, date, uuid, text, time, time, boolean, uuid[], uuid[], uuid, text, text, text, text, text, text, text, numeric, numeric, text, uuid) from public, anon;
grant execute on function public.save_club_event(uuid, text, date, date, uuid, text, time, time, boolean, uuid[], uuid[], uuid, text, text, text, text, text, text, text, numeric, numeric, text, uuid) to authenticated;

-- ---------------------------------------------------------------------
-- CANCEL.
--
-- Cancelling, never deleting: people have already answered, and the event
-- having been called off is itself information the calendar should carry.
-- ---------------------------------------------------------------------
create or replace function public.cancel_club_event(p_event_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not internal.can_manage_club_event(p_event_id) then
    raise exception 'You do not have permission to manage this event.' using errcode = '42501';
  end if;
  update public.club_events
  set status = 'CANCELLED',
      cancelled_at = now(),
      cancelled_by = auth.uid(),
      cancellation_reason = nullif(btrim(coalesce(p_reason, '')), ''),
      updated_by = auth.uid(),
      updated_at = now()
  where id = p_event_id;
end;
$$;

revoke all on function public.cancel_club_event(uuid, text) from public, anon;
grant execute on function public.cancel_club_event(uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- RESPOND.
--
-- Delegates the WHOLE authority question to the canonical safeguarding
-- resolver that fixtures and training already use --
-- internal.resolve_attendance_response_source -- so under-16 stays with a
-- guardian, 16-17 follows the recorded consent, and 18+ answers for
-- themselves. This is not a fourth implementation of that rule; it is a third
-- caller of the one implementation.
-- ---------------------------------------------------------------------
create or replace function public.respond_to_event_attendance(
  p_event_id uuid,
  p_player_id uuid,
  p_status text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_source text;
  v_event public.club_events;
begin
  if p_status not in ('ATTENDING', 'CANNOT_ATTEND', 'UNSURE') then
    raise exception 'Unknown response.' using errcode = '22023';
  end if;

  select * into v_event from public.club_events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found.' using errcode = 'P0002';
  end if;

  -- The player must actually be involved in this event, or the response is
  -- about a relationship that does not exist.
  if not exists (
    select 1
    from public.player_team_memberships ptm
    join public.teams t on t.id = ptm.team_id
    where ptm.player_id = p_player_id
      and ptm.status = 'active'
      and t.club_id = v_event.club_id
      and (
        v_event.is_club_wide
        or exists (select 1 from public.club_event_teams cet where cet.event_id = p_event_id and cet.team_id = ptm.team_id)
      )
  ) then
    raise exception 'That player is not involved in this event.' using errcode = '42501';
  end if;

  v_source := internal.resolve_attendance_response_source(p_player_id);
  if v_source is null then
    raise exception 'You cannot respond for this player.' using errcode = '42501';
  end if;

  insert into public.player_fixture_attendance (event_id, player_id, status, responded_by_user_id, response_source)
  values (p_event_id, p_player_id, p_status, auth.uid(), v_source)
  on conflict (event_id, player_id) where event_id is not null
  do update set
    status = excluded.status,
    responded_by_user_id = excluded.responded_by_user_id,
    response_source = excluded.response_source,
    updated_at = now();
end;
$$;

revoke all on function public.respond_to_event_attendance(uuid, uuid, text) from public, anon;
grant execute on function public.respond_to_event_attendance(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------
-- THE EVENT CENTRE CARD.
--
-- One bounded read for the whole surface, gated on the same visibility rule
-- the RLS policy uses. Returns the viewer's capabilities alongside the data so
-- Event Centre can be ONE role-aware surface rather than several: the same
-- component tree renders for everyone, and these flags decide which parts of
-- it have anything to show.
-- ---------------------------------------------------------------------
create or replace function public.get_club_event_card(p_event_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v jsonb;
  e public.club_events;
begin
  select * into e from public.club_events where id = p_event_id;
  if e.id is null then
    return null;
  end if;
  -- FAILS CLOSED. A forged or foreign event id returns nothing at all, not a
  -- redacted shell that confirms the event exists.
  if not internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide) then
    return null;
  end if;

  select jsonb_build_object(
    'id', e.id,
    'club_id', e.club_id,
    'season_id', e.season_id,
    'name', e.name,
    'description', e.description,
    'starts_on', e.starts_on,
    'start_time', e.start_time,
    'ends_on', e.ends_on,
    'end_time', e.end_time,
    'is_club_wide', e.is_club_wide,
    'status', e.status,
    'cancelled_at', e.cancelled_at,
    'cancellation_reason', e.cancellation_reason,
    'club_name', (select d.name from public.clubs c join public.club_directory d on d.id = c.directory_id where c.id = e.club_id),
    'club_logo_path', (select c.logo_storage_path from public.clubs c where c.id = e.club_id),
    'venue', case when e.venue_id is null then null else (
      -- geocode_status travels with the coordinates. Match Centre withholds
      -- the map unless it reads 'success', because a plausible wrong pin is
      -- worse than no pin -- somebody drives to it. Event Centre inherits that
      -- judgement by passing the same field through.
      select jsonb_build_object('id', v.id, 'name', v.name, 'address', v.address, 'postcode', v.postcode,
                                'latitude', v.latitude, 'longitude', v.longitude, 'directions', v.directions,
                                'geocode_status', v.geocode_status)
      from public.venues v where v.id = e.venue_id
    ) end,
    'external_location', case when e.external_location_name is null then null else jsonb_build_object(
      'name', e.external_location_name,
      'address_line_1', e.external_address_line_1,
      'address_line_2', e.external_address_line_2,
      'town', e.external_town,
      'county', e.external_county,
      'postcode', e.external_postcode,
      'country', e.external_country,
      'latitude', e.external_latitude,
      'longitude', e.external_longitude
    ) end,
    'teams', coalesce((
      select jsonb_agg(jsonb_build_object('id', t.id, 'display_name', t.display_name, 'category', t.category,
                                          'age_group', t.age_group, 'gender', t.gender,
                                          'squad_designation', t.squad_designation, 'rugby_code', t.rugby_code)
                       order by t.display_name)
      from public.club_event_teams cet join public.teams t on t.id = cet.team_id
      where cet.event_id = e.id
    ), '[]'::jsonb),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object('id', cp.id, 'display_name', cp.display_name) order by cp.sort_order, cp.display_name)
      from public.club_event_pitches cep join public.club_pitches cp on cp.id = cep.pitch_id
      where cep.event_id = e.id
    ), '[]'::jsonb),
    'can_manage', internal.can_manage_club_event(e.id),
    -- The register is offered only where the viewer holds attendance-view on a
    -- team actually involved -- which is what keeps one team's staff out of
    -- another team's list on a shared event.
    'can_view_register', (
      internal.is_site_admin()
      or internal.has_capability('team.attendance.view', 'club', e.club_id, null)
      or exists (
        select 1 from public.teams t
        where t.club_id = e.club_id
          and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = t.id))
          and internal.has_capability('team.attendance.view', 'team', t.club_id, t.id)
      )
    )
  ) into v;

  return v;
end;
$$;

revoke all on function public.get_club_event_card(uuid) from public, anon;
grant execute on function public.get_club_event_card(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- THE REGISTER.
--
-- Returns only the players whose attendance this viewer may legitimately see.
-- A club-scoped viewer sees every involved team; a team-scoped viewer sees
-- ONLY the teams they hold the capability on, which is the leak this function
-- exists to prevent on a multi-team event.
-- ---------------------------------------------------------------------
create or replace function public.get_club_event_register(p_event_id uuid)
returns table (
  player_id uuid,
  player_name text,
  team_id uuid,
  team_display_name text,
  status text,
  response_source text,
  responded_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with e as (
    select * from public.club_events ev
    where ev.id = p_event_id
      and internal.club_event_visible_row(ev.id, ev.club_id, ev.is_club_wide)
  ),
  visible_teams as (
    select t.id, t.display_name, t.club_id
    from public.teams t, e
    where t.club_id = e.club_id
      and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = t.id))
      and (
        internal.is_site_admin()
        or internal.has_capability('team.attendance.view', 'club', t.club_id, null)
        or internal.has_capability('team.attendance.view', 'team', t.club_id, t.id)
      )
  )
  select
    p.id,
    (p.first_name || ' ' || p.surname),
    vt.id,
    vt.display_name,
    pfa.status,
    pfa.response_source,
    pfa.updated_at
  from visible_teams vt
  join public.player_team_memberships ptm on ptm.team_id = vt.id and ptm.status = 'active'
  join public.players p on p.id = ptm.player_id
  left join public.player_fixture_attendance pfa on pfa.event_id = p_event_id and pfa.player_id = p.id
  order by vt.display_name, p.surname, p.first_name;
$$;

revoke all on function public.get_club_event_register(uuid) from public, anon;
grant execute on function public.get_club_event_register(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- WHICH OF MY PLAYERS THIS EVENT IS FOR, and whether I may answer for them.
--
-- Same shape as the training equivalent, and it reuses the same authority
-- resolver, so a guardian sees exactly the children they may answer for.
-- ---------------------------------------------------------------------
create or replace function public.get_my_players_for_club_event(p_event_id uuid)
returns table (
  player_id uuid,
  player_name text,
  team_display_name text,
  status text,
  can_respond boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (p.id)
    p.id,
    (p.first_name || ' ' || p.surname),
    t.display_name,
    pfa.status,
    internal.resolve_attendance_response_source(p.id) is not null
  from public.club_events e
  join public.player_team_memberships ptm on ptm.status = 'active'
  join public.teams t on t.id = ptm.team_id and t.club_id = e.club_id
  join public.players p on p.id = ptm.player_id
  left join public.player_fixture_attendance pfa on pfa.event_id = e.id and pfa.player_id = p.id
  where e.id = p_event_id
    and internal.club_event_visible_row(e.id, e.club_id, e.is_club_wide)
    and (e.is_club_wide or exists (select 1 from public.club_event_teams cet where cet.event_id = e.id and cet.team_id = t.id))
    and (internal.is_own_linked_player(p.id) or internal.is_active_player_guardian(p.id))
  order by p.id, t.display_name;
$$;

revoke all on function public.get_my_players_for_club_event(uuid) from public, anon;
grant execute on function public.get_my_players_for_club_event(uuid) to authenticated;
