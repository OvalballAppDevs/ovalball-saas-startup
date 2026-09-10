-- =====================================================================
-- A TRAINING SESSION IS NOT PUBLIC
--
-- Found by auditing the training domain before building Training Centre,
-- exactly as the brief required, and it is the ONE genuine gap the audit
-- turned up. Everything else in this domain is in good order: attendance is
-- already one canonical row per (session, player), the safeguarding rule is
-- already shared with fixtures, and the register is already capability-gated.
--
-- Reading a session was not.
--
--   * public.training_sessions carried exactly one policy --
--     `training_sessions_select ... USING (true)` -- granted to PUBLIC.
--   * public.get_training_session_card is SECURITY DEFINER and looked the
--     session up by id with NO visibility check at all. It computed
--     can_manage / can_view_register for the ACTIONS and then returned the
--     session itself to whoever asked.
--
-- So today, pasting any training_session_id into the URL returns another
-- club's session: its team, date, venue, pitch and coach's agenda notes.
-- Training Centre is the surface that would have made that reachable in one
-- click, so it is fixed here, before the surface exists, rather than after.
--
-- THE RULE LIVES IN ONE PLACE. `internal.training_session_visible_row` is the
-- rule; the RLS policy and the RPC gate are two doors onto it, so they cannot
-- drift into two different answers to "may this person see this session".
-- =====================================================================

-- ---------------------------------------------------------------------
-- The rule, expressed over the session's own columns.
--
-- Taking the columns rather than the id is deliberate: the RLS policy already
-- HAS the row, and making it re-select the session by id would be a second
-- lookup per row on every calendar scan.
-- ---------------------------------------------------------------------
create or replace function internal.training_session_visible_row(
  p_club_id uuid,
  p_team_id uuid,
  p_scheduling_group_id uuid
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Platform authority.
    internal.is_site_admin()

    -- ANYBODY WITH A ROLE AT THE CLUB THAT RUNS IT. A club's training
    -- calendar is a club-wide artefact -- the Calendar, the pitch allocation
    -- board and Training Management all read it club-wide today, and every
    -- one of those viewers holds a membership row. This keeps that working
    -- while removing the part that was never intended: other clubs.
    or exists (
      select 1 from public.club_memberships cm
      where cm.club_id = p_club_id
        and cm.user_id = auth.uid()
        and cm.status = 'active'
    )

    -- THE PEOPLE IT IS ACTUALLY FOR. A player on the team training, or the
    -- adult responsible for one. Guardians and linked players frequently hold
    -- no club_memberships row at all -- that is the normal shape of a parent
    -- account -- so they would otherwise lose their own child's training.
    --
    -- A scheduling group (Mini-Rugby) resolves through its MEMBER TEAMS,
    -- which is how the rest of this domain already reads participation:
    -- get_training_register, get_my_players_for_training_session and
    -- respond_to_training_attendance all use exactly this shape.
    or exists (
      select 1
      from public.player_team_memberships ptm
      where ptm.status = 'active'
        and (
          (p_team_id is not null and ptm.team_id = p_team_id)
          or (
            p_scheduling_group_id is not null
            and ptm.team_id in (
              select sgm.team_id from public.scheduling_group_members sgm
              where sgm.group_id = p_scheduling_group_id
            )
          )
        )
        and (
          internal.is_own_linked_player(ptm.player_id)
          or internal.is_active_player_guardian(ptm.player_id)
        )
    );
$$;

comment on function internal.training_session_visible_row(uuid, uuid, uuid) is
  'THE visibility rule for a training session. Site admin, a role at the owning club, or a participant/their guardian. Both the RLS policy and get_training_session_card resolve through this, so there is one answer rather than two.';

-- The by-id form, for callers that hold an id rather than a row.
create or replace function internal.can_view_training_session(p_session_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.training_sessions s
    where s.id = p_session_id
      and internal.training_session_visible_row(s.club_id, s.team_id, s.scheduling_group_id)
  );
$$;

comment on function internal.can_view_training_session(uuid) is
  'May the caller open this training session? Thin wrapper over internal.training_session_visible_row for callers holding an id.';

-- ---------------------------------------------------------------------
-- Door one: the table.
-- ---------------------------------------------------------------------
drop policy if exists training_sessions_select on public.training_sessions;

create policy training_sessions_select on public.training_sessions
  for select
  using (internal.training_session_visible_row(club_id, team_id, scheduling_group_id));

-- ---------------------------------------------------------------------
-- Door two: the RPC Training Centre reads.
--
-- Recreated in full rather than patched, because a CREATE OR REPLACE of a
-- function whose body is the authority should show the whole body. The ONLY
-- change from the existing definition is the visibility gate below the
-- not-found check; everything after it is the current function verbatim.
--
-- The order matters. "Not found" is raised before the gate so a session that
-- does not exist and one the caller may not see are told apart HERE -- but
-- both surface to the browser as the same thing, because the page turns an
-- unauthorised read into a 404. A caller learns nothing either way.
-- ---------------------------------------------------------------------
create or replace function public.get_training_session_card(p_training_session_id uuid)
returns table(
  id uuid, club_id uuid, team_id uuid, team_label text, scheduling_group_id uuid,
  season_id uuid, training_plan_id uuid, session_date date,
  start_time time without time zone, end_time time without time zone, duration_minutes integer,
  venue_id uuid, venue_name text, pitch_id uuid, pitch_name text,
  status text, source text, agenda text, further_notes text, notes text,
  cancelled_at timestamp with time zone, cancellation_reason text, cancelled_by_name text,
  my_attendance_status text, can_manage boolean, can_view_register boolean
)
language plpgsql
stable
security definer
set search_path = public
as $function$
declare
  s public.training_sessions;
  v_can_manage boolean;
  v_can_view_register boolean;
begin
  select ts.* into s from public.training_sessions ts where ts.id = p_training_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;

  -- THE GATE. Without it this SECURITY DEFINER function handed any session to
  -- anyone holding its id, whatever the table's policy said.
  if not internal.training_session_visible_row(s.club_id, s.team_id, s.scheduling_group_id) then
    raise exception 'You are not authorized to view this training session.' using errcode = '42501';
  end if;

  v_can_manage := internal.can_manage_training(s.club_id, s.team_id) or internal.has_capability('club.training.manage', 'club', s.club_id, null);
  v_can_view_register := v_can_manage
    or internal.has_capability('team.attendance.view', 'team', s.club_id, s.team_id)
    or internal.has_capability('team.attendance.view', 'club', s.club_id, null);

  return query
  select
    sess.id, sess.club_id, sess.team_id,
    coalesce(t.display_name, sg.display_tag, 'Team'),
    sess.scheduling_group_id, sess.season_id, sess.training_plan_id,
    sess.session_date, sess.start_time, sess.end_time, sess.duration_minutes,
    sess.venue_id, v.name, sess.pitch_id, cp.display_name,
    sess.status, sess.source, sess.agenda, sess.further_notes, sess.notes,
    sess.cancelled_at, sess.cancellation_reason,
    case when sess.cancelled_by is not null then trim(coalesce(prof.first_name, '') || ' ' || coalesce(prof.surname, '')) else null end,
    (
      select a.status from public.player_fixture_attendance a
      join public.players p on p.id = a.player_id
      where a.training_session_id = sess.id
        and (internal.is_own_linked_player(p.id) or internal.is_active_player_guardian(p.id))
      order by a.updated_at desc limit 1
    ),
    v_can_manage, v_can_view_register
  from public.training_sessions sess
  left join public.teams t on t.id = sess.team_id
  left join public.scheduling_groups sg on sg.id = sess.scheduling_group_id
  left join public.venues v on v.id = sess.venue_id
  left join public.club_pitches cp on cp.id = sess.pitch_id
  left join public.profiles prof on prof.id = sess.cancelled_by
  where sess.id = p_training_session_id;
end;
$function$;

-- ---------------------------------------------------------------------
-- NO SECOND VENUE READ, deliberately.
--
-- Training Centre needs the venue's canonical coordinates for the SAME
-- weather provider Match Centre uses. `venues` and `club_pitches` already
-- select as `true` -- a ground is a public place, and Match Centre reads them
-- straight from the tables -- so Training Centre reads exactly the same two
-- tables in exactly the same way. Adding a training-flavoured location RPC
-- here would have been a second venue model, which is the thing the brief
-- rules out, and it would have had to be kept in step with the first one.
-- ---------------------------------------------------------------------
