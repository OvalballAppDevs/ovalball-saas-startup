-- =====================================================================================================
-- A CLUB THAT IS IN THE TOURNAMENT MAY SEE THE TOURNAMENT.
--
-- THE DEFECT, PRECISELY. `internal.tournament_visible_row` already had the two branches that matter --
-- "anybody with an active role at a club that entered a team" and "a player in an entered team, or the
-- adult responsible for one". They were correct in intent and wrong in source: both read
-- `tournament_team_entries`, which has only ever contained THE HOST CLUB'S OWN teams. Before
-- 20270605000000 it was a table whose writer refused other clubs; after it, a view filtered to host-club
-- participants. Either way:
--
--   a visiting club's coach, team manager, member, parent and player all saw nothing
--
-- even though their side was entered, because the row they would have matched on does not exist in that
-- source. The rule said "a club that entered a team" and the data said "the host".
--
-- THE CORRECTION IS THE SOURCE, NOT THE RULE. Both branches now read `tournament_participants`, which
-- since 20270605000000 is the one canonical table of sides -- the host's and everybody else's alike. The
-- host keeps exactly the visibility it had, because its sides are participant rows now; the visiting
-- clubs gain the visibility the rule already promised them.
--
-- NO NEW PERMISSION IS INVENTED, AND NONE IS TAKEN AWAY. Two branches are added alongside, using
-- `tournament.tournament.view` -- a capability that already exists and is already granted (CA, FS, MB,
-- SO, VO at club scope; CO and TM at team scope) and was simply never consulted here. It is additive:
-- the club_memberships branch is kept as it was, so no role that can see a tournament today stops
-- seeing one. The team-scope branch is what reaches a coach or team manager who holds their authority
-- at the team rather than the club.
--
-- FAMILY VISIBILITY KEEPS THE EVENTS SHAPE. `internal.club_event_visible_row` answers "may this parent
-- or player see an activity their team is involved in" through `player_team_memberships` plus
-- `internal.is_own_linked_player` / `internal.is_active_player_guardian`. That is the shape already used
-- here and it is unchanged -- only the table supplying the entered team is corrected.
--
-- READ IS NOT MANAGE. This function is reached only from SELECT policies (tournaments,
-- tournament_participants, tournament_age_groups, tournament_games, tournament_pitches,
-- tournament_entry_opponents) and from the read paths `internal.can_view_tournament` and
-- `get_tournament_centre`. Every tournament WRITE checks `tournament.tournament.manage` separately, so
-- widening this cannot widen write authority.
--
-- PRIVATE STAYS PRIVATE. Public discovery is untouched. Being entered into a private tournament confers
-- sight of that tournament and nothing else.
--
-- AN UNCLAIMED DIRECTORY CLUB HAS NOBODY TO SHOW IT TO, and no branch invents anyone: its participant
-- rows carry `club_id = null` and `team_id = null`, so no membership, capability or family join matches.
-- =====================================================================================================

create or replace function internal.tournament_visible_row(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select
    -- PUBLIC DISCOVERY. Deliberately first and deliberately narrow: the tournament must itself be
    -- marked public, and the reader must be signed in.
    exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id and t.visibility = 'public' and auth.uid() is not null
    )

    or internal.has_site_capability('site.fixtures.view')

    -- The host, including a still-unclaimed proposal: the club being proposed to must see it in
    -- order to claim it.
    or exists (
      select 1 from public.tournaments t
      join public.clubs c on c.directory_id = t.host_directory_id
      where t.id = p_tournament_id and internal.can('tournament.tournament.manage', 'club', c.id, null, null)
    )

    -- The host club by its own id. The branch above only ever matched through the directory, so a
    -- tournament created with `host_club_id` and no directory row was invisible to the club that owns
    -- it -- found while tracing why Tournaments Home was empty.
    or exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id
        and t.host_club_id is not null
        and internal.can('tournament.tournament.manage', 'club', t.host_club_id, null, null)
    )

    -- An invited club's own management.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and ((tp.team_id is not null and internal.can('calendar.event.manage', 'team', tp.club_id, tp.team_id, null))
             or (tp.club_id is not null and internal.can('tournament.tournament.manage', 'club', tp.club_id, null, null)))
    )

    -- A PARTICIPATING CLUB'S OWN PEOPLE, by the read capability at club scope. `tournament.tournament.view`
    -- is held by CA, FS, MB, SO and VO and had never been consulted anywhere.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and tp.club_id is not null
        and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null)
    )

    -- THE STAFF OF A PARTICIPATING TEAM, by the same read capability at team scope -- a coach or team
    -- manager holds their authority at the team, not the club. Scoped to the ENTERED team, so a coach
    -- of a side that is not in the tournament gains nothing from it.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and tp.club_id is not null
        and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null)
    )

    -- Anybody with an active role at a club that entered a team. Where the club is going on Saturday
    -- is ordinary club operational information. KEPT EXACTLY AS IT WAS, except that it now reads the
    -- canonical participants table instead of the host-only entries view -- which is what makes it
    -- finally true of the clubs it always claimed to describe.
    or exists (
      select 1
      from public.tournament_participants tp
      join public.club_memberships cm on cm.club_id = tp.club_id
      where tp.tournament_id = p_tournament_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )

    -- The people it is actually for: a player in an entered team, or the adult responsible for one.
    -- Guardians routinely hold no club_memberships row, so without this a parent loses their own
    -- child's tournament.
    or exists (
      select 1
      from public.tournament_participants tp
      join public.player_team_memberships ptm on ptm.team_id = tp.team_id
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and ptm.status = 'active'
        and (internal.is_own_linked_player(ptm.player_id)
             or internal.is_active_player_guardian(ptm.player_id))
    );
$function$;

comment on function internal.tournament_visible_row(uuid) is
  'Who may READ a tournament. Public discovery, the site capability, the host, an invited club''s '
  'management, a participating club''s people by tournament.tournament.view, a participating team''s '
  'staff by the same capability at team scope, any active member of a participating club, and the '
  'family of a player in a participating team. Reads tournament_participants, so it is true of every '
  'side and not only the host''s. Never grants management: every tournament write checks '
  'tournament.tournament.manage separately.';

-- -----------------------------------------------------------------------------------------------------
-- The last writer that still wrote through the compatibility view.
--
-- `set_tournament_age_groups` deleted the host's entries when a grade was dropped from the tournament,
-- in a second statement joined through `teams` to find the grade. That statement is now DEAD, not
-- merely indirect: the statement immediately above it already deletes every `tournament_participants`
-- row at a dropped grade, and since 20270605000000 the host's sides ARE participant rows carrying that
-- same grade in their own column. Rewriting it to read the participants table would delete the same
-- rows a second time; it is removed instead, which leaves exactly one statement responsible for
-- "a dropped age group takes its sides with it".
-- -----------------------------------------------------------------------------------------------------

do $$
declare
  v_def text;
  v_dead text;
begin
  select pg_get_functiondef(oid) into v_def from pg_proc where proname = 'set_tournament_age_groups';
  if v_def is null then
    raise exception 'set_tournament_age_groups is missing.';
  end if;

  v_dead := '    delete from public.tournament_team_entries e' || chr(10) ||
            '    using public.teams t' || chr(10) ||
            '    where e.team_id = t.id' || chr(10) ||
            '      and e.tournament_id = p_tournament_id' || chr(10) ||
            '      and t.age_group = any(v_dropped);' || chr(10) || chr(10);

  if position(v_dead in v_def) > 0 then
    execute replace(v_def, v_dead, '');
  elsif position('tournament_team_entries' in v_def) > 0 then
    -- The statement is there in some other shape; refuse rather than guess at it.
    raise exception 'set_tournament_age_groups still references tournament_team_entries in an unrecognised form.';
  end if;
end $$;

-- A permanent assertion that the correction cannot silently come undone: the visibility rule must not
-- go back to reading the host-only view.
do $$
begin
  if position('tournament_team_entries' in
      (select pg_get_functiondef(oid) from pg_proc
       where proname = 'tournament_visible_row' and pronamespace = 'internal'::regnamespace)) > 0 then
    raise exception 'tournament_visible_row still reads the host-only entries view.';
  end if;
end $$;
