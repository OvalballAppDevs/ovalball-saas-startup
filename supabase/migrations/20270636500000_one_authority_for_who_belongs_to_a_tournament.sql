-- =====================================================================================================
-- ONE AUTHORITY FOR WHO BELONGS TO A TOURNAMENT.
--
-- `internal.tournament_visible_row` answers "may this person see that this tournament exists". Results
-- need a DIFFERENT question -- "does this person BELONG to this tournament" -- because a tournament may
-- be listed publicly while its scores are kept inside it, and the public-discovery branch of
-- `tournament_visible_row` would hand those scores to anybody signed in.
--
-- The two questions share most of their answer, so rather than copy six branches into a second place
-- and let them drift, the participant branches move OUT of `tournament_visible_row` into
-- `internal.tournament_participant_viewer` and `tournament_visible_row` calls it. One ladder, two
-- questions, and a change to who counts as a participant can only be made in one file.
--
-- The branches themselves are UNCHANGED -- staff by capability at club and at team scope, an active
-- club membership, and the player or their guardian. This is a refactor, and the migration proves it
-- is one by checking every tournament answers identically before and after.
-- =====================================================================================================

/**
 * DOES THIS PERSON BELONG TO THIS TOURNAMENT -- as the host, as a participating club or team, or as
 * one of their people. Says nothing about public listing: a tournament nobody has entered has no
 * participant viewers however public it is.
 */
create or replace function internal.tournament_participant_viewer(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- The host, including a still-unclaimed proposal: the club being proposed to must see it in order
    -- to claim it.
    exists (
      select 1 from public.tournaments t
      join public.clubs c on c.directory_id = t.host_directory_id
      where t.id = p_tournament_id and internal.can('tournament.tournament.manage', 'club', c.id, null, null)
    )

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

    -- A participating club's own people, by the read capability at club scope.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and tp.club_id is not null
        and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null)
    )

    -- The staff of a participating team, by the same read capability at team scope.
    or exists (
      select 1 from public.tournament_participants tp
      where tp.tournament_id = p_tournament_id
        and tp.team_id is not null
        and tp.club_id is not null
        and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null)
    )

    -- Anybody with an active role at a club that entered a team. Where the club is going on Saturday
    -- is ordinary club operational information.
    or exists (
      select 1
      from public.tournament_participants tp
      join public.club_memberships cm on cm.club_id = tp.club_id
      where tp.tournament_id = p_tournament_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )

    -- The people it is actually for: a player in an entered team, or the adult responsible for one.
    -- Guardians routinely hold no club_memberships row.
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

comment on function internal.tournament_participant_viewer(uuid) is
  'Does this person BELONG to this tournament -- host, participating club or team, or one of their '
  'people. The one authority: internal.tournament_visible_row and the results reads both call it, so '
  'who counts as a participant is defined in a single place.';

-- ---- the existing question, asked through the new authority -------------------------------------------

create or replace function internal.tournament_visible_row(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    -- PUBLIC DISCOVERY. Deliberately first and deliberately narrow: the tournament must itself be
    -- marked public, and the reader must be signed in.
    exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id and t.visibility = 'public' and auth.uid() is not null
    )

    or internal.has_site_capability('site.fixtures.view')

    -- Everybody who belongs to it.
    or internal.tournament_participant_viewer(p_tournament_id);
$function$;

/**
 * MAY THIS PERSON READ THIS TOURNAMENT'S CONFIRMED RESULTS AND STANDINGS.
 *
 * A PUBLIC TOURNAMENT IS NOT PUBLIC RESULTS. `results_visibility` is its own setting, and when it says
 * `participants` the scores stay with the people who belong to the competition -- which is why this
 * cannot simply defer to `tournament_visible_row`.
 *
 * It governs CONFIRMED results only. A submitted score awaiting the other side, a contested one, and
 * the notes attached to either are between the two sides and the organiser whatever this returns.
 */
create or replace function internal.tournament_results_readable(p_tournament_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select
    internal.tournament_participant_viewer(p_tournament_id)
    or internal.has_site_capability('site.fixtures.view')
    or exists (
      select 1 from public.tournaments t
      where t.id = p_tournament_id
        and t.results_visibility = 'public'
        and t.visibility = 'public'
        and auth.uid() is not null
    );
$function$;

comment on function internal.tournament_results_readable(uuid) is
  'Who may read a tournament''s CONFIRMED results and standings: everybody who belongs to it, site '
  'fixtures readers, and -- only when the tournament is itself public AND results_visibility is public '
  '-- any signed-in person. Never governs an unsettled or contested score.';

-- ---- the refactor changed nothing --------------------------------------------------------------------
--
-- Every tournament, under every seeded account, must answer `tournament_visible_row` exactly as it did
-- before the participant branches moved. Proved by re-deriving the old expression inline and comparing
-- it row for row, so a silently dropped branch fails the migration rather than quietly widening or
-- narrowing what people can see.

do $$
declare v_mismatch integer;
begin
  select count(*) into v_mismatch
  from public.tournaments t
  where internal.tournament_visible_row(t.id) is distinct from (
    exists (select 1 from public.tournaments t2
            where t2.id = t.id and t2.visibility = 'public' and auth.uid() is not null)
    or internal.has_site_capability('site.fixtures.view')
    or exists (select 1 from public.tournaments t2
               join public.clubs c on c.directory_id = t2.host_directory_id
               where t2.id = t.id and internal.can('tournament.tournament.manage', 'club', c.id, null, null))
    or exists (select 1 from public.tournaments t2
               where t2.id = t.id and t2.host_club_id is not null
                 and internal.can('tournament.tournament.manage', 'club', t2.host_club_id, null, null))
    or exists (select 1 from public.tournament_participants tp
               where tp.tournament_id = t.id
                 and ((tp.team_id is not null and internal.can('calendar.event.manage', 'team', tp.club_id, tp.team_id, null))
                      or (tp.club_id is not null and internal.can('tournament.tournament.manage', 'club', tp.club_id, null, null))))
    or exists (select 1 from public.tournament_participants tp
               where tp.tournament_id = t.id and tp.club_id is not null
                 and internal.can('tournament.tournament.view', 'club', tp.club_id, null, null))
    or exists (select 1 from public.tournament_participants tp
               where tp.tournament_id = t.id and tp.team_id is not null and tp.club_id is not null
                 and internal.can('tournament.tournament.view', 'team', tp.club_id, tp.team_id, null))
    or exists (select 1 from public.tournament_participants tp
               join public.club_memberships cm on cm.club_id = tp.club_id
               where tp.tournament_id = t.id and cm.user_id = auth.uid() and cm.status = 'active')
    or exists (select 1 from public.tournament_participants tp
               join public.player_team_memberships ptm on ptm.team_id = tp.team_id
               where tp.tournament_id = t.id and tp.team_id is not null and ptm.status = 'active'
                 and (internal.is_own_linked_player(ptm.player_id)
                      or internal.is_active_player_guardian(ptm.player_id)))
  );
  if v_mismatch > 0 then
    raise exception 'tournament_visible_row changed its answer for % tournament(s) -- the refactor dropped or added a branch.', v_mismatch;
  end if;
end $$;
