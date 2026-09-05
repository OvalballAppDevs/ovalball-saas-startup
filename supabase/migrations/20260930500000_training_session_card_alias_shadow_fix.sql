-- Second bug fix, same root cause class as the previous migration, caught
-- by the same live smoke-test run: the RETURN QUERY's own FROM-clause
-- alias (`from public.training_sessions s`) was given the SAME name as
-- the outer PL/pgSQL row-type variable declared at the top of the
-- function (`s public.training_sessions`). Postgres's ambiguity checker
-- does not cleanly prefer the inner query alias over the outer plpgsql
-- variable when they share a name and both expose a `team_id`-shaped
-- field/column -- it errors rather than guessing. Fixed by renaming the
-- query's own alias to `sess`, leaving the outer `s` variable (used only
-- in plain PL/pgSQL expressions, never inside embedded SQL) untouched.
create or replace function public.get_training_session_card(p_training_session_id uuid)
returns table (
  id uuid, club_id uuid, team_id uuid, team_label text, scheduling_group_id uuid, season_id uuid,
  training_plan_id uuid, session_date date, start_time time, end_time time, duration_minutes integer,
  venue_id uuid, venue_name text, pitch_id uuid, pitch_name text,
  status text, source text, agenda text, further_notes text, notes text,
  cancelled_at timestamptz, cancellation_reason text, cancelled_by_name text,
  my_attendance_status text, can_manage boolean, can_view_register boolean
)
language plpgsql
security definer
stable
set search_path to 'public'
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
