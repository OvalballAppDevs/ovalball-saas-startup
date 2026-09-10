-- =====================================================================
-- TOURNAMENT CENTRE KNOWS WHICH OF THE TEAMS IS YOURS
--
-- A club taking two teams to a festival produces two tabs, and the surface
-- opened on whichever sorted first. For a parent whose child is in the U13
-- side that meant landing on U12's morning and having to work out that it was
-- not theirs -- on a phone, at a ground, looking for a kick-off time.
--
-- So each entry now says whether it is the VIEWER's: a team they have a player
-- in, a team they are responsible for a player in, or a team they manage.
-- Nothing is hidden by it -- every tab remains available, because where the
-- rest of the club is playing is ordinary information at an occasion your own
-- child is attending -- it only decides which tab opens first.
--
-- Resolved server-side, per viewer, exactly like every other capability on
-- this payload. The client never works out whose team is whose.
-- =====================================================================
create or replace function public.get_tournament_centre(p_tournament_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
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
            internal.has_capability('calendar.manage', 'team', e.club_id, e.team_id)
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
end $$;
