-- =====================================================================================================
-- WHAT A PARTICIPANT SEES OF A TOURNAMENT.
--
-- The organiser's read (`get_tournament_centre`, `readTournamentDetail`) answers an organiser's
-- questions: every side, every application, who has asked to come. A club that is simply GOING to the
-- festival needs a different set of facts and must not be given the organiser's -- and one of those
-- differences is a privacy boundary rather than a matter of layout.
--
-- THE BOUNDARY. Another club's attendance is reduced to a single number, ATTENDING, and that reduction
-- happens HERE, in the database, not in React. How many of Burnley's players cannot attend, how many
-- are unsure, how many have not answered and which children they are, are Burnley's business. The host
-- organising pitches needs to know roughly how many are coming; nobody outside the club needs the rest.
--
-- A UI THAT MERELY DIDN'T DRAW THOSE NUMBERS WOULD STILL HAVE SENT THEM, which is the thing the Match
-- Centre rule already states for fixtures: "privacy is filtered BEFORE render; the same UI does not
-- mean the same payload". So `unsure`, `cannot_attend`, `awaiting` and the roster size come back NULL
-- for a side the viewer is not part of, and the named register is never in this payload at all.
--
-- ONE TOURNAMENT, SEVERAL COMPETITION CONTEXTS. A club with a U12 and a U16 side at one festival is at
-- ONE festival in TWO competitions, and those competitions do not mix: the U12 field is who the U12s
-- are playing against. So the payload is organised as one tournament carrying a list of CONTEXTS, each
-- an age group the viewer is genuinely connected to. There is no second tournament record, no second
-- Centre and no duplicated identity -- a context is a lens on one tournament.
--
-- WHICH CONTEXTS A VIEWER GETS is decided by the same connections `internal.tournament_visible_row`
-- already uses, and by nothing else: a club's own people through `tournament.tournament.view` at club
-- scope, an entered team's staff through the same capability at team scope, and the family of a player
-- in an entered team through the Events precedent. Seeing a public tournament exists is a different
-- thing from being in it, and only the second produces a context.
--
-- THE AGENDA IS A PROJECTION, NEVER A SECOND SCHEDULE. `games` is read straight from
-- `tournament_games`, which is what the organiser's planning writes. An empty list means no plan has
-- been published, which the screen says in words; nothing here invents a placeholder fixture.
--
-- IT ALSO ANSWERS "SHOULD THIS PERSON BE HERE AT ALL". `canManage` is returned so the client can send
-- a host with management authority to the management surface that already exists, rather than a second
-- organiser dashboard being built behind this one.
-- =====================================================================================================

create or replace function public.get_tournament_participant_centre(p_tournament_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_t public.tournaments;
  v_can_manage boolean;
  v_contexts jsonb;
  v_mine uuid[];
  v_grades text[];
begin
  if not internal.session_ok() then
    raise exception 'Your session is not able to read this. Sign in again.' using errcode = '42501';
  end if;

  select * into v_t from public.tournaments where id = p_tournament_id;
  if v_t.id is null then
    return null;
  end if;

  -- The same rule every other tournament read uses. A viewer who cannot see the tournament gets
  -- nothing -- deliberately the same answer as one that does not exist, because the difference is not
  -- ours to reveal.
  if not internal.tournament_visible_row(p_tournament_id) then
    return null;
  end if;

  v_can_manage := internal.can('tournament.tournament.manage', 'club', v_t.host_club_id, null, null);

  -- ---- THE SIDES THIS VIEWER IS PART OF ------------------------------------------------------------
  --
  -- "Part of" is the connection, not the tournament. It is what decides which age-group contexts
  -- appear, and which sides may show their full attendance breakdown.
  select coalesce(array_agg(distinct tp.id), '{}') into v_mine
  from public.tournament_participants tp
  where tp.tournament_id = p_tournament_id
    and (
      -- the viewer's own club
      (tp.club_id is not null and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null))
      -- the entered team's own staff
      or (tp.team_id is not null and tp.club_id is not null
          and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null))
      -- the family of a player in the entered team
      or (tp.team_id is not null and exists (
            select 1 from public.player_team_memberships ptm
            where ptm.team_id = tp.team_id and ptm.status = 'active'
              and (internal.is_own_linked_player(ptm.player_id) or internal.is_active_player_guardian(ptm.player_id))
          ))
    );

  -- The grades those sides play in, in the tournament's own order. A host with management authority
  -- gets every grade the tournament runs, because the whole field is legitimately theirs.
  if v_can_manage then
    select coalesce(array_agg(g.age_group order by g.age_group), '{}') into v_grades
    from public.tournament_age_groups g where g.tournament_id = p_tournament_id;
  else
    select coalesce(array_agg(distinct tp.age_group), '{}') into v_grades
    from public.tournament_participants tp
    where tp.tournament_id = p_tournament_id and tp.id = any(v_mine);
  end if;

  -- ---- ONE CONTEXT PER AGE GROUP -------------------------------------------------------------------
  select coalesce(jsonb_agg(ctx order by ctx->>'ageGroup'), '[]'::jsonb) into v_contexts
  from (
    select jsonb_build_object(
      'ageGroup', grade,

      -- EVERY SIDE IN THIS COMPETITION, and only this competition. A U12 context never lists the U16
      -- field: telling a U12 parent which clubs are in the U16 competition is describing a different
      -- day's rugby.
      'sides', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participantId', tp.id,
          'teamId', tp.team_id,
          'clubName', cd.name,
          'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
          -- A real team is its canonical derived name; a club recorded by name is its competition plus
          -- its alias. Never a label invented for this screen.
          'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
          'isHost', (tp.club_id is not null and tp.club_id = v_t.host_club_id),
          'isMine', (tp.id = any(v_mine)),
          'onOvalball', (tp.status <> 'external_recorded')
        ) order by (tp.club_id is not null and tp.club_id = v_t.host_club_id) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- ATTENDANCE, FILTERED BEFORE IT IS SENT ------------------------------------------------
      --
      -- `attending` for everybody, because that is the number the day is organised around. Everything
      -- else only for a side this viewer is part of. A side with no Ovalball team behind it has no
      -- roster to count and reports nothing rather than zero -- "0 attending" would read as a club
      -- that answered, when the truth is that there is nobody here to ask.
      'attendance', coalesce((
        select jsonb_agg(jsonb_build_object(
          'participantId', tp.id,
          'clubName', cd.name,
          'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = tp.club_id), cd.logo_storage_path),
          'label', coalesce(tm.display_name, case when tp.squad_label is not null then tp.age_group || ' ' || tp.squad_label else tp.age_group end),
          'isMine', (tp.id = any(v_mine)),
          'attending', case when tp.team_id is null then null else (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'ATTENDING') end,
          'unsure', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'UNSURE') end,
          'cannotAttend', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_fixture_attendance a
            join public.player_team_memberships m on m.player_id = a.player_id and m.team_id = tp.team_id and m.status = 'active'
            where a.tournament_id = p_tournament_id and a.status = 'CANNOT_ATTEND') end,
          'awaiting', case when tp.id = any(v_mine) and tp.team_id is not null then (
            select count(*) from public.player_team_memberships m
            where m.team_id = tp.team_id and m.status = 'active'
              and not exists (select 1 from public.player_fixture_attendance a
                              where a.tournament_id = p_tournament_id and a.player_id = m.player_id)) end
        ) order by (tp.id = any(v_mine)) desc, cd.name, tp.id)
        from public.tournament_participants tp
        join public.club_directory cd on cd.id = tp.club_directory_id
        left join public.teams tm on tm.id = tp.team_id
        where tp.tournament_id = p_tournament_id and tp.age_group = grade
      ), '[]'::jsonb),

      -- ---- THE PUBLISHED PROGRAMME ---------------------------------------------------------------
      --
      -- Read straight from what planning writes. An empty array means nothing has been published, and
      -- the screen says so in words rather than drawing an empty table or inventing a game.
      'games', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', g.id,
          'gameDate', g.game_date,
          'startTime', g.start_time,
          'durationMinutes', g.duration_minutes,
          'pitchName', cp.display_name,
          'status', g.status,
          'sideA', jsonb_build_object('participantId', a.id, 'clubName', acd.name, 'label', coalesce(atm.display_name, a.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = a.club_id), acd.logo_storage_path),
                                      'score', g.side_a_score, 'isMine', (a.id = any(v_mine))),
          'sideB', jsonb_build_object('participantId', b.id, 'clubName', bcd.name, 'label', coalesce(btm.display_name, b.age_group),
                                      'crestPath', coalesce((select c.logo_storage_path from public.clubs c where c.id = b.club_id), bcd.logo_storage_path),
                                      'score', g.side_b_score, 'isMine', (b.id = any(v_mine)))
        ) order by g.game_date, g.start_time nulls last, g.sort_order)
        from public.tournament_games g
        join public.tournament_participants a on a.id = g.side_a_id
        join public.tournament_participants b on b.id = g.side_b_id
        join public.club_directory acd on acd.id = a.club_directory_id
        join public.club_directory bcd on bcd.id = b.club_directory_id
        left join public.teams atm on atm.id = a.team_id
        left join public.teams btm on btm.id = b.team_id
        left join public.club_pitches cp on cp.id = g.pitch_id
        where g.tournament_id = p_tournament_id and g.age_group = grade
      ), '[]'::jsonb)
    ) as ctx
    from unnest(v_grades) as grade
  ) contexts;

  return jsonb_build_object(
    'id', v_t.id,
    'name', v_t.name,
    'startsOn', v_t.event_date,
    'endsOn', v_t.ends_on,
    'kickoffTime', v_t.kickoff_time,
    'endsAt', v_t.ends_at,
    'format', v_t.format,
    'swissRounds', v_t.swiss_rounds,
    'visibility', v_t.visibility,
    'status', v_t.status,
    'cancelled', (v_t.cancelled_at is not null),
    'coverImagePath', v_t.cover_image_path,
    'coverStockKey', v_t.cover_stock_key,
    'notes', v_t.notes,
    'venueName', (select v.name from public.venues v where v.id = v_t.venue_id),
    'venueAddress', (select nullif(concat_ws(', ', v.address_line_1, v.town, v.postcode), '') from public.venues v where v.id = v_t.venue_id),
    'hostClubName', (select cd.name from public.club_directory cd where cd.id = v_t.host_directory_id),
    'hostCrestPath', coalesce(
      (select c.logo_storage_path from public.clubs c where c.id = v_t.host_club_id),
      (select cd.logo_storage_path from public.club_directory cd where cd.id = v_t.host_directory_id)),
    'hostTown', (select nullif(concat_ws(', ', cd.town, cd.county), '') from public.club_directory cd where cd.id = v_t.host_directory_id),
    -- The client routes a manager to the management surface that already exists rather than drawing a
    -- second organiser dashboard behind this one.
    'canManage', v_can_manage,
    'contexts', v_contexts,

    -- ---- WHO THIS VIEWER MAY ANSWER FOR ---------------------------------------------------------
    --
    -- Resolved by the ONE canonical authority, and never by a role. `resolve_attendance_response_source`
    -- raises for a 16-17 year old without recorded consent and for anybody under 16, so it is called
    -- defensively here: this list decides whether a CONTROL is drawn, and the write refuses
    -- independently whether or not one was.
    'myPlayers', coalesce((
      select jsonb_agg(jsonb_build_object(
        'playerId', pl.id,
        'firstName', pl.first_name,
        -- Whether this is the viewer THEMSELVES rather than a child they answer for. The question and
        -- the confirmation both change person on it -- "Can you make the tournament?" against "Can
        -- Harry make the tournament?" -- so it is a fact the server states rather than one the client
        -- infers from whether a name happens to match.
        'isSelf', internal.is_own_linked_player(pl.id),
        'teamId', ptm.team_id,
        'ageGroup', tp.age_group,
        'status', (select a.status from public.player_fixture_attendance a
                   where a.tournament_id = p_tournament_id and a.player_id = pl.id),
        'canRespond', (select internal.resolve_attendance_response_source(pl.id) is not null)
      ) order by pl.first_name)
      from public.tournament_participants tp
      join public.player_team_memberships ptm on ptm.team_id = tp.team_id and ptm.status = 'active'
      join public.players pl on pl.id = ptm.player_id
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and (internal.is_own_linked_player(pl.id) or internal.is_active_player_guardian(pl.id))
    ), '[]'::jsonb)
  );
exception
  -- `resolve_attendance_response_source` raises rather than returning null for a refusal, and a
  -- refusal is an ordinary answer here: it means "no control for this player", not "the page failed".
  when sqlstate '42501' then
    raise;
end;
$function$;

comment on function public.get_tournament_participant_centre(uuid) is
  'One tournament as somebody GOING to it sees it: the day''s facts, one context per age group they '
  'are connected to, who is in that competition, attendance reduced to ATTENDING for every club but '
  'their own, the published programme, and the players they may answer for. The privacy reduction is '
  'done here rather than in the client, so the payload itself never carries another club''s breakdown.';

revoke all on function public.get_tournament_participant_centre(uuid) from public, anon;
grant execute on function public.get_tournament_participant_centre(uuid) to authenticated;
grant execute on function public.get_tournament_participant_centre(uuid) to service_role;
