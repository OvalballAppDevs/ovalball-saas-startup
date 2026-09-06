-- Bug fix, caught live by the smoke test immediately after writing
-- get_training_session_card: `RETURNS TABLE(id uuid, ...)` implicitly
-- declares `id` as an OUT-parameter-like variable visible for the whole
-- function body in PL/pgSQL -- the initial `select * into s from
-- public.training_sessions where id = p_training_session_id` therefore
-- became ambiguous between that implicit variable and the table's own
-- `id` column ("column reference \"id\" is ambiguous"). Every reference
-- inside the function body must be qualified once RETURNS TABLE names a
-- column `id`; the final `return query` block already did this correctly
-- (`s.id`, `t.id`, etc.) -- only this one lookup at the top was missed.
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
    s.id, s.club_id, s.team_id,
    coalesce(t.display_name, sg.display_tag, 'Team'),
    s.scheduling_group_id, s.season_id, s.training_plan_id,
    s.session_date, s.start_time, s.end_time, s.duration_minutes,
    s.venue_id, v.name, s.pitch_id, cp.display_name,
    s.status, s.source, s.agenda, s.further_notes, s.notes,
    s.cancelled_at, s.cancellation_reason,
    case when s.cancelled_by is not null then trim(coalesce(prof.first_name, '') || ' ' || coalesce(prof.surname, '')) else null end,
    (
      select a.status from public.player_fixture_attendance a
      join public.players p on p.id = a.player_id
      where a.training_session_id = s.id
        and (internal.is_own_linked_player(p.id) or internal.is_active_player_guardian(p.id))
      order by a.updated_at desc limit 1
    ),
    v_can_manage, v_can_view_register
  from public.training_sessions s
  left join public.teams t on t.id = s.team_id
  left join public.scheduling_groups sg on sg.id = s.scheduling_group_id
  left join public.venues v on v.id = s.venue_id
  left join public.club_pitches cp on cp.id = s.pitch_id
  left join public.profiles prof on prof.id = s.cancelled_by
  where s.id = p_training_session_id;
end;
$function$;
