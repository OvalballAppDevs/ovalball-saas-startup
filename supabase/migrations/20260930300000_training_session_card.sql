-- SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION: ONE canonical card read
-- (Section 26-27, 46, 66, 79, 98) -- every consumer (Calendar, Dashboard
-- Upcoming Events, Training Management, Team Admin, Parent/Player) calls
-- this SAME function for the SAME training_session_id, batched (team,
-- venue, pitch, cancellation actor, caller's own attendance, and the
-- caller's own effective authority all resolved in one round trip -- no
-- per-field follow-up query, Section 66's "no N+1").
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
  select * into s from public.training_sessions where id = p_training_session_id;
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

comment on function public.get_training_session_card is 'Section 98 (one source of truth): the single read every Calendar/Dashboard/Training Management/Team Admin/Parent surface uses for a given training_session_id. cancelled_by_name is a resolved display name, never the raw auth.users id (Section 12). my_attendance_status is the caller''s own linked-player-or-guardian response only -- never another player''s, and never an aggregate count (Section 77-78: counts/register stay behind can_view_register, matching this codebase''s existing fixture-attendance visibility posture rather than inventing broader parent/player visibility).';

revoke all on function public.get_training_session_card(uuid) from public, anon;
grant execute on function public.get_training_session_card(uuid) to authenticated;
