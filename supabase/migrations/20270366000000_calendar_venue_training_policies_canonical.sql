-- Slice 4E -- part 3 of 3: the row policies and the retirement of the calendar legacy adapter
-- (Phase 2 AA.3 row 4e, design J.9 lines 496-507).
--
-- CONTRACT STEP in the release-ordering sense, and this one really is. It does two things the
-- currently deployed build cannot survive, which the compatibility matrix measured rather than
-- guessed:
--
--   * it revokes anon's column grant on public.venues, and the old /competitions/[slug] resolves a
--     venue name by embedding venues(name) directly;
--   * it deletes the calendar.manage adapter row, and the old club-events page gates its controls
--     on hasCapability('calendar.manage'), which then reads FALSE.
--
-- Neither is a problem once the new build is live: it reads public.public_venues (added in
-- 20270365000000) and asks calendar.event.manage. So this migration lands LAST, after the
-- deployment, and the release report records the three stages and the evidence for their order.

-- 1. Venues ------------------------------------------------------------------------------------
-- venues_select was `true`. Anon's exposure was already narrowed by Slice 1 to two columns, but
-- every SIGNED-IN person could read every club's venues in full -- addresses, notes, contact
-- details. J.9 line 499 closes that with venue.venue.view, which every club-member bundle holds at
-- its own club.
--
-- This is safe for AWAY fixtures, which is the obvious thing it could have broken, and that was
-- measured rather than hoped: public.update_fixture_venue refuses outright unless the fixture is a
-- HOME fixture and the venue belongs to that fixture's own club. A visiting club therefore never
-- resolves another club's venue row -- an away fixture carries free-text venue_address instead.
drop policy if exists venues_select on public.venues;
create policy venues_select on public.venues
for select using (internal.can_view_venue(club_id));

drop policy if exists venues_insert on public.venues;
create policy venues_insert on public.venues
for insert with check (club_id is not null and internal.can_manage_venue(club_id));

drop policy if exists venues_update on public.venues;
create policy venues_update on public.venues
for update using (club_id is not null and internal.can_manage_venue(club_id));

comment on policy venues_select on public.venues is
  'Slice 4E: venue.venue.view at the owning club. Anonymous readers use public.public_venues.';

-- 2. Pitches -----------------------------------------------------------------------------------
-- The write policies move onto venue.pitch.manage, matching the RPCs rewritten in 20270364000000.
-- club_pitches_select stays `true` DELIBERATELY: J.9 defines venue.pitch.manage and
-- venue.pitch_allocation.view/manage but NO pitch-view key, and anon already holds no grant on the
-- table. Narrowing a read the design does not scope would be inventing product surface inside a
-- migration, so it is recorded as an observation for whichever slice owns it instead.
drop policy if exists club_pitches_insert on public.club_pitches;
create policy club_pitches_insert on public.club_pitches
for insert with check (internal.can_manage_pitch(club_id));

drop policy if exists club_pitches_update on public.club_pitches;
create policy club_pitches_update on public.club_pitches
for update using (internal.can_manage_pitch(club_id));

-- 3. Training ----------------------------------------------------------------------------------
-- training_plans_select and training_plan_schedule_rules_select were `true`. Anon was already
-- closed at the privilege layer by Slice 1 (the "public training plans" half of AA.3 row 4e), and
-- this closes the signed-in half: a training plan is a standing record of when a named team's
-- children are at a named ground, so it is read by the people J.9 line 504 names and not by every
-- account on the platform.
-- The reads are HOISTED: the club and team sets are computed once per statement as InitPlans, and
-- only the family branch stays a per-row function call. Measured on one club's 800 sessions:
-- 46.7 ms before this slice, 106.9 ms with the canonical gate called per row, and back under the
-- pre-slice figure once hoisted. The numbers are in the release report.
drop policy if exists training_plans_select on public.training_plans;
create policy training_plans_select on public.training_plans
for select using (
  club_id in (select unnest(internal.training_visible_clubs()))
  or team_id in (select unnest(internal.training_visible_teams()))
  or internal.has_site_capability('site.support.view_club')
  or internal.training_family_visible_row(team_id, null)
);

-- FOR ALL, so the USING clause is OR'd into every SELECT as well: it is hoisted for exactly the
-- reason the read policy is. The WITH CHECK stays a direct gate call -- it runs once for the row
-- being written, where a per-statement set buys nothing.
drop policy if exists training_plans_write_scoped on public.training_plans;
create policy training_plans_write_scoped on public.training_plans
for all using (
  club_id in (select unnest(internal.training_manageable_clubs()))
  or team_id in (select unnest(internal.training_manageable_teams()))
  or internal.has_site_capability('site.support.act_in_club')
)
with check (internal.can_manage_training(club_id, team_id));

drop policy if exists training_plan_schedule_rules_select on public.training_plan_schedule_rules;
create policy training_plan_schedule_rules_select on public.training_plan_schedule_rules
for select using (
  exists (
    select 1 from public.training_plans tp
    where tp.id = training_plan_schedule_rules.training_plan_id
      and (tp.club_id in (select unnest(internal.training_visible_clubs()))
           or tp.team_id in (select unnest(internal.training_visible_teams()))
           or internal.has_site_capability('site.support.view_club')
           or internal.training_family_visible_row(tp.team_id, null))
  )
);

drop policy if exists training_plan_schedule_rules_write_scoped on public.training_plan_schedule_rules;
create policy training_plan_schedule_rules_write_scoped on public.training_plan_schedule_rules
for all using (
  exists (select 1 from public.training_plans tp
          where tp.id = training_plan_schedule_rules.training_plan_id
            and (tp.club_id in (select unnest(internal.training_manageable_clubs()))
                 or tp.team_id in (select unnest(internal.training_manageable_teams()))
                 or internal.has_site_capability('site.support.act_in_club')))
) with check (
  exists (select 1 from public.training_plans tp
          where tp.id = training_plan_schedule_rules.training_plan_id
            and internal.can_manage_training(tp.club_id, tp.team_id))
);

drop policy if exists training_sessions_select on public.training_sessions;
create policy training_sessions_select on public.training_sessions
for select using (
  club_id in (select unnest(internal.training_visible_clubs()))
  or team_id in (select unnest(internal.training_visible_teams()))
  or internal.has_site_capability('site.support.view_club')
  or internal.training_family_visible_row(team_id, scheduling_group_id)
);

comment on policy training_sessions_select on public.training_sessions is
  'Slice 4E: training.session.view, with the caller-dependent sets hoisted into the policy as '
  'InitPlans and only the Slice 4A family branch evaluated per row.';

-- 4. A Slice 4D remnant, closed here because it blocks 4E ---------------------------------------
-- These four decide TOURNAMENT authority, which is AA.3 row 4d, not 4e. 4D migrated the tournament
-- GATES but not these four RPCs, because its retirement assertion checked the function list 4D
-- declared and these were not on it -- a test that measured what it was told to measure rather than
-- what the contract said.
--
-- They are closed here, and the reason is specific rather than opportunistic: they are the last
-- consumers of the deprecated `calendar.manage` key, so 4E cannot complete its own J.9 RENAME while
-- they hold it. The behaviour is not a new decision -- J.8 line 490 already defined it, and 4D's
-- shadow comparison already established what tournament.tournament.manage means. save_tournament
-- also carried a bare is_site_admin() bypass, which the standing invariants forbid.
--
-- Nothing else of 4D's is touched.
CREATE OR REPLACE FUNCTION public.save_tournament(p_club_id uuid, p_name text, p_starts_on date, p_ends_on date, p_rugby_code text, p_tournament_id uuid DEFAULT NULL::uuid, p_season_id uuid DEFAULT NULL::uuid, p_host_directory_id uuid DEFAULT NULL::uuid, p_venue_id uuid DEFAULT NULL::uuid, p_venue_notes text DEFAULT NULL::text, p_notes text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_id uuid;
  v_club_directory uuid;
  v_host_directory uuid;
  v_host_club uuid;
  v_season uuid;
  v_club_code text;
begin
  if p_tournament_id is null then
    -- CREATING. Authority is the club's, because entering a club into a
    -- tournament commits that club's teams, pitches and Saturday.
    if not (internal.has_site_capability('site.support.act_in_club') or internal.can('tournament.tournament.manage', 'club', p_club_id, null, null)) then
      raise exception 'You do not have permission to create a tournament for this club.' using errcode = '42501';
    end if;
  else
    if not internal.can_manage_tournament(p_tournament_id) then
      raise exception 'You do not have permission to change this tournament.' using errcode = '42501';
    end if;
    if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
      raise exception 'This tournament has been cancelled and can no longer be changed.' using errcode = '42501';
    end if;
  end if;

  if length(btrim(coalesce(p_name, ''))) = 0 then
    raise exception 'A tournament needs a name.' using errcode = '22023';
  end if;
  if p_ends_on < p_starts_on then
    raise exception 'A tournament cannot finish before it starts.' using errcode = '22023';
  end if;
  if p_rugby_code not in ('union', 'league') then
    raise exception 'A tournament must be Rugby Union or Rugby League.' using errcode = '22023';
  end if;

  select c.directory_id into v_club_directory from public.clubs c where c.id = p_club_id;
  if v_club_directory is null then
    raise exception 'That club does not exist.' using errcode = '23503';
  end if;

  select cd.rugby_code into v_club_code from public.club_directory cd where cd.id = v_club_directory;
  if v_club_code is not null and v_club_code <> p_rugby_code then
    raise exception 'This club plays % -- it cannot run a % tournament.', v_club_code, p_rugby_code using errcode = '23514';
  end if;

  v_host_directory := coalesce(p_host_directory_id, v_club_directory);
  select c.id into v_host_club from public.clubs c where c.directory_id = v_host_directory;

  v_season := p_season_id;
  if v_season is null then
    select s.id into v_season from public.seasons s
    where s.rugby_code = p_rugby_code and p_starts_on between s.starts_on and s.ends_on
    order by s.starts_on desc limit 1;
  end if;

  if p_tournament_id is null then
    insert into public.tournaments (
      name, host_directory_id, host_club_id, rugby_code, season_id,
      event_date, ends_on, venue_id, venue_notes, notes, status, created_by, updated_by
    ) values (
      btrim(p_name), v_host_directory, v_host_club, p_rugby_code, v_season,
      p_starts_on, p_ends_on, p_venue_id, p_venue_notes, p_notes, 'confirmed', auth.uid(), auth.uid()
    ) returning id into v_id;
  else
    update public.tournaments set
      name = btrim(p_name),
      host_directory_id = v_host_directory,
      host_club_id = v_host_club,
      rugby_code = p_rugby_code,
      season_id = v_season,
      event_date = p_starts_on,
      ends_on = p_ends_on,
      venue_id = p_venue_id,
      venue_notes = p_venue_notes,
      notes = p_notes,
      updated_by = auth.uid(),
      updated_at = now()
    where id = p_tournament_id
    returning id into v_id;
  end if;

  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.add_tournament_team_entry(p_tournament_id uuid, p_team_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club uuid;
  v_id uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'That team does not exist.' using errcode = '23503';
  end if;
  -- ENTERING A TEAM IS THAT TEAM'S DECISION. Club-scope authority enters any
  -- of the club's teams; team-scope authority enters exactly its own. This is
  -- what stops a U12 manager entering U13.
  if not (
    internal.is_site_admin()
    or internal.can('tournament.tournament.manage', 'club', v_club, null, null)
    or internal.can('calendar.event.manage', 'team', v_club, p_team_id, null)
  ) then
    raise exception 'You do not have permission to enter that team into a tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;

  insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by, updated_by)
  values (p_tournament_id, p_team_id, v_club, auth.uid(), auth.uid())
  on conflict (tournament_id, team_id) do update set updated_at = now(), updated_by = auth.uid()
  returning id into v_id;
  return v_id;
end $function$;

CREATE OR REPLACE FUNCTION public.get_tournament_centre(p_tournament_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v jsonb;
  v_can_manage boolean;
begin
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;
  v_can_manage := internal.can_manage_tournament(p_tournament_id);

  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'rugbyCode', t.rugby_code,
    'startsOn', t.event_date,
    'endsOn', t.ends_on,
    'status', t.status,
    'cancelledAt', t.cancelled_at,
    'cancellationReason', t.cancellation_reason,
    'notes', t.notes,
    'venueNotes', t.venue_notes,
    'seasonName', (select s.name from public.seasons s where s.id = t.season_id),
    'hostName', (select cd.name from public.club_directory cd where cd.id = t.host_directory_id),
    'hostClubId', t.host_club_id,
    'venue', (
      select jsonb_build_object('id', ve.id, 'name', ve.name, 'address', ve.address, 'postcode', ve.postcode)
      from public.venues ve where ve.id = t.venue_id
    ),
    'canManageTournament', v_can_manage,

    'invitations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'participantId', tp.id,
        'clubName', icd.name,
        'teamTypeLabel', ictt.label,
        'status', tp.status
      ) order by icd.name)
      from public.tournament_participants tp
      join public.club_directory icd on icd.id = tp.club_directory_id
      join public.canonical_team_types ictt on ictt.id = tp.canonical_team_type_id
      where tp.tournament_id = t.id
        and tp.status = 'pending'
        and ((tp.team_id is not null and internal.can_manage_team(tp.team_id))
             or (tp.club_id is not null and internal.can_manage_club_fixtures(tp.club_id)))
    ), '[]'::jsonb),

    'entries', coalesce((
      select jsonb_agg(entry order by entry->>'teamName')
      from (
        select jsonb_build_object(
          'id', e.id,
          'teamId', e.team_id,
          'clubId', e.club_id,
          'teamName', tm.display_name,
          'ageGroup', tm.age_group,
          'clubName', cd.name,
          'clubLogoPath', c.logo_storage_path,
          'directoryLogoPath', cd.logo_storage_path,
          'canManageEntry', internal.can_manage_tournament_entry(e.id),
          -- WHOSE TEAM THIS IS, from the viewer's point of view. Presentation
          -- only: it chooses the tab that opens, and hides nothing.
          'isMine', (
            internal.can('calendar.event.manage', 'team', e.club_id, e.team_id, null)
            or exists (
              select 1 from public.player_team_memberships ptm
              where ptm.team_id = e.team_id
                and ptm.status = 'active'
                and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
            )
          ),
          'opponents', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', o.id,
              'participantId', tp.id,
              'clubName', ocd.name,
              'clubLogoPath', (select oc.logo_storage_path from public.clubs oc where oc.id = tp.club_id),
              'directoryLogoPath', ocd.logo_storage_path,
              'teamTypeLabel', ctt.label,
              'status', tp.status
            ) order by o.sort_order, ocd.name)
            from public.tournament_entry_opponents o
            join public.tournament_participants tp on tp.id = o.participant_id
            join public.club_directory ocd on ocd.id = tp.club_directory_id
            join public.canonical_team_types ctt on ctt.id = tp.canonical_team_type_id
            where o.entry_id = e.id
          ), '[]'::jsonb),
          'games', coalesce((
            select jsonb_agg(jsonb_build_object(
              'id', g.id,
              'opponentId', g.opponent_id,
              'opponentClubName', gcd.name,
              'gameDate', g.game_date,
              'startTime', g.start_time,
              'durationMinutes', g.duration_minutes,
              'pitchId', g.pitch_id,
              'pitchName', gp.display_name,
              'status', g.status,
              'ourScore', g.our_score,
              'opponentScore', g.opponent_score
            ) order by g.game_date, g.start_time nulls last, g.sort_order)
            from public.tournament_games g
            join public.tournament_entry_opponents go on go.id = g.opponent_id
            join public.tournament_participants gtp on gtp.id = go.participant_id
            join public.club_directory gcd on gcd.id = gtp.club_directory_id
            left join public.club_pitches gp on gp.id = g.pitch_id
            where g.entry_id = e.id
          ), '[]'::jsonb)
        ) as entry
        from public.tournament_team_entries e
        join public.teams tm on tm.id = e.team_id
        join public.clubs c on c.id = e.club_id
        join public.club_directory cd on cd.id = c.directory_id
        where e.tournament_id = t.id
      ) entries
    ), '[]'::jsonb),
    'pitches', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', tp.id,
        'pitchId', tp.pitch_id,
        'pitchName', cp.display_name,
        'reservedOn', tp.reserved_on,
        'startTime', tp.start_time,
        'endTime', tp.end_time
      ) order by tp.reserved_on, tp.start_time, cp.display_name)
      from public.tournament_pitches tp
      join public.club_pitches cp on cp.id = tp.pitch_id
      where tp.tournament_id = t.id
    ), '[]'::jsonb)
  ) into v
  from public.tournaments t
  where t.id = p_tournament_id;

  return v;
end $function$;


-- save_club_event creates an event, so it cannot ask can_manage_club_event -- there is no event
-- yet. It carried its own copy of the same authority twice over, plus a bare is_site_admin().
-- It now asks the canonical key at both scopes, and the pre-delete assertion below is what
-- caught it: the first run of this migration refused to retire the adapter because
-- public.save_club_event still held it.

CREATE OR REPLACE FUNCTION public.save_club_event(p_club_id uuid, p_name text, p_starts_on date, p_ends_on date, p_event_id uuid DEFAULT NULL::uuid, p_description text DEFAULT NULL::text, p_start_time time without time zone DEFAULT NULL::time without time zone, p_end_time time without time zone DEFAULT NULL::time without time zone, p_is_club_wide boolean DEFAULT false, p_team_ids uuid[] DEFAULT '{}'::uuid[], p_pitch_ids uuid[] DEFAULT '{}'::uuid[], p_venue_id uuid DEFAULT NULL::uuid, p_external_location_name text DEFAULT NULL::text, p_external_address_line_1 text DEFAULT NULL::text, p_external_address_line_2 text DEFAULT NULL::text, p_external_town text DEFAULT NULL::text, p_external_county text DEFAULT NULL::text, p_external_postcode text DEFAULT NULL::text, p_external_country text DEFAULT NULL::text, p_external_latitude numeric DEFAULT NULL::numeric, p_external_longitude numeric DEFAULT NULL::numeric, p_external_address_provider_ref text DEFAULT NULL::text, p_season_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      internal.has_site_capability('site.support.act_in_club')
      or internal.can('calendar.event.manage', 'club', p_club_id, null, null)
      or (
        not coalesce(p_is_club_wide, false)
        and array_length(p_team_ids, 1) is not null
        and not exists (
          select 1 from unnest(p_team_ids) t(id)
          where not internal.can('calendar.event.manage', 'team', p_club_id, t.id, null)
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
      internal.has_site_capability('site.support.act_in_club')
      or internal.can('calendar.event.manage', 'club', p_club_id, null, null)
    ) then
      if coalesce(p_is_club_wide, false) then
        raise exception 'Only club administration can make an event club-wide.' using errcode = '42501';
      end if;
      if exists (
        select 1 from unnest(p_team_ids) t(id)
        where not internal.can('calendar.event.manage', 'team', p_club_id, t.id, null)
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
$function$;

CREATE OR REPLACE FUNCTION public.update_tournament_venue(p_tournament_id uuid, p_venue_id uuid DEFAULT NULL::uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_t public.tournaments;
  v_venue_name text;
begin
  select * into v_t from public.tournaments where id = p_tournament_id for update;
  if not found then raise exception 'Tournament not found.'; end if;

  if not (internal.has_site_capability('site.support.act_in_club')
    or (v_t.host_club_id is not null and internal.can('tournament.tournament.manage', 'club', v_t.host_club_id, null, null))) then
    raise exception 'Only the host club may change this tournament''s venue.' using errcode = '42501';
  end if;

  if p_venue_id is not null and not exists (select 1 from public.venues where id = p_venue_id and club_id = v_t.host_club_id and active) then
    raise exception 'That venue does not belong to this tournament''s host club, or is not active.' using errcode = '23514';
  end if;

  update public.tournaments set venue_id = p_venue_id, updated_by = auth.uid(), updated_at = now() where id = p_tournament_id;

  select name into v_venue_name from public.venues where id = p_venue_id;

  insert into public.audit_log (table_name, record_id, action, changed_by, before, after)
  values ('tournaments', p_tournament_id, 'update', auth.uid(),
    jsonb_build_object('venue_id', v_t.venue_id), jsonb_build_object('venue_id', p_venue_id));

  insert into public.notifications (user_id, type, title, body, data)
  select cm.user_id, 'tournament_venue_changed', 'Tournament venue changed',
    format('The venue for the tournament on %s has changed%s.', to_char(v_t.event_date, 'DD Mon YYYY'),
      case when v_venue_name is not null then format(' to %s', v_venue_name) else '' end),
    jsonb_build_object('tournament_id', p_tournament_id, 'venue_id', p_venue_id)
  from public.tournament_participants tp
  join public.club_memberships cm on cm.club_id = tp.club_id and cm.status = 'active' and cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')
  where tp.tournament_id = p_tournament_id and tp.status = 'accepted' and tp.club_id is not null;
end;
$function$;

-- update_tournament_venue also contains `cm.role in ('CLUB_ADMIN', 'FIXTURE_SECRETARY')`, and that
-- one is DELIBERATELY left alone. It selects who receives a notification; it decides no authority.
-- AA.3 row 4e retires role-string checks that decide who may act, and turning a recipient list into
-- a capability query is a different piece of work with a different owner.

-- add_tournament_team_entry kept a bare internal.is_site_admin() alongside the key it now asks.
-- Leaving it would mean this gate had two answers, one canonical and one a role bypass.
--
-- NOT touched, and named so it is not mistaken for an oversight: get_tournament_centre also
-- filters which PENDING INVITATIONS to display using internal.can_manage_team and
-- internal.can_manage_club_fixtures. That is a display filter rather than an authority gate, it
-- does not hold the calendar key, and it therefore does not block this slice. It belongs to
-- whichever slice owns tournament participation, and is recorded in the ledger as carried.

CREATE OR REPLACE FUNCTION public.add_tournament_team_entry(p_tournament_id uuid, p_team_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_club uuid;
  v_id uuid;
begin
  select t.club_id into v_club from public.teams t where t.id = p_team_id;
  if v_club is null then
    raise exception 'That team does not exist.' using errcode = '23503';
  end if;
  -- ENTERING A TEAM IS THAT TEAM'S DECISION. Club-scope authority enters any
  -- of the club's teams; team-scope authority enters exactly its own. This is
  -- what stops a U12 manager entering U13.
  if not (
    internal.has_site_capability('site.support.act_in_club')
    or internal.can('tournament.tournament.manage', 'club', v_club, null, null)
    or internal.can('calendar.event.manage', 'team', v_club, p_team_id, null)
  ) then
    raise exception 'You do not have permission to enter that team into a tournament.' using errcode = '42501';
  end if;
  if exists (select 1 from public.tournaments t where t.id = p_tournament_id and t.cancelled_at is not null) then
    raise exception 'This tournament has been cancelled.' using errcode = '42501';
  end if;

  insert into public.tournament_team_entries (tournament_id, team_id, club_id, created_by, updated_by)
  values (p_tournament_id, p_team_id, v_club, auth.uid(), auth.uid())
  on conflict (tournament_id, team_id) do update set updated_at = now(), updated_by = auth.uid()
  returning id into v_id;
  return v_id;
end $function$;

-- 5. Retire the calendar legacy adapter ----------------------------------------------------------
-- calendar.manage and calendar.view were the legacy keys J.9 lines 496-497 rename. With every
-- consumer migrated above, the adapter rows have no remaining caller, and a zero-caller legacy
-- adapter is the same hazard as a zero-caller helper: the next person needing calendar authority
-- would find the deprecated answer before the canonical one. Slice 4B retired its `team.view`
-- adapter row for the same reason.
--
-- The assertion runs BEFORE the delete, so a missed consumer stops the migration rather than
-- silently losing its authority.
do $$
declare v_bad text[];
begin
  select coalesce(array_agg(x order by x), '{}') into v_bad from (
    select n.nspname || '.' || p.proname as x
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'internal')
      and p.proname not in ('capability_decision', 'has_capability')
      and (p.prosrc like '%''calendar.manage''%' or p.prosrc like '%''calendar.view''%')
    union all
    select 'policy ' || tablename || '.' || policyname
    from pg_policies
    where (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ '''calendar\.(manage|view)'''
  ) q;
  if cardinality(v_bad) > 0 then
    raise exception 'calendar.manage/calendar.view still has consumers: %', array_to_string(v_bad, ', ');
  end if;
end $$;

-- Retiring an adapter means removing the MAPPING, exactly as Slice 4B did for team.view. The
-- capability row itself stays and stays DEPRECATED -- the catalogue permits only ACTIVE or
-- DEPRECATED, and keeping the row is what lets a later reader see that the key existed and where it
-- went, rather than finding a dangling reference with no explanation.
delete from public.capability_key_map where legacy_key in ('calendar.manage', 'calendar.view');

do $$
begin
  if exists (select 1 from public.capability_key_map where legacy_key in ('calendar.manage', 'calendar.view')) then
    raise exception 'the calendar legacy adapter rows survived.';
  end if;
  if not exists (select 1 from public.capabilities where key = 'calendar.event.manage' and status = 'ACTIVE')
     or not exists (select 1 from public.capabilities where key = 'calendar.event.view' and status = 'ACTIVE') then
    raise exception 'the canonical calendar keys are missing; the rename has nowhere to land.';
  end if;
end $$;
