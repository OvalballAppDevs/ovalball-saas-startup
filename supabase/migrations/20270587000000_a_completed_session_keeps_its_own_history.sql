-- A completed training session's SCHEDULE is historical truth. `cancel_training_session`
-- already refuses to cancel a session whose occurrence_date is in the past (Section 83);
-- `override_training_session` had no equivalent guard at all, so a coach could open a
-- session that already happened and change its venue, pitch, start time, duration, warm-up
-- or pack-up minutes, silently rewriting what actually took place. Agenda and further notes
-- are administrative recording, not scheduling, and stay editable regardless of date.
create or replace function public.override_training_session(
  p_session_id uuid,
  p_session_date date default null,
  p_start_time time default null,
  p_duration_minutes integer default null,
  p_venue_id uuid default null,
  p_pitch_id uuid default null,
  p_cancel boolean default false,
  p_reason text default null,
  p_agenda text default null,
  p_further_notes text default null,
  p_warm_up_minutes integer default null,
  p_pack_up_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
  v_further_notes text;
  v_changed boolean := false;
  v_schedule_changed boolean := false;
  v_team_label text;
begin
  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.can_manage_club_training(s.club_id) then
    raise exception 'You are not authorized to change this Training Session.' using errcode = '42501';
  end if;
  if p_cancel then
    perform public.cancel_training_session(p_session_id, p_reason);
    return;
  end if;

  if p_venue_id is not null and p_pitch_id is not null and not exists (
    select 1 from public.club_pitches where id = p_pitch_id and club_id = s.club_id and venue_id = p_venue_id
  ) then
    raise exception 'The selected pitch does not belong to the selected venue.';
  end if;
  if p_agenda is not null and char_length(trim(p_agenda)) = 0 then
    raise exception 'Agenda cannot be blank.';
  end if;
  if p_agenda is not null and char_length(p_agenda) > 4000 then
    raise exception 'Agenda is too long.';
  end if;
  v_further_notes := case when p_further_notes is not null then nullif(trim(p_further_notes), '') else null end;
  if p_further_notes is not null and char_length(p_further_notes) > 2000 then
    raise exception 'Further notes are too long.';
  end if;
  if p_warm_up_minutes is not null and (p_warm_up_minutes < 0 or p_warm_up_minutes > 60 or p_warm_up_minutes % 5 <> 0) then
    raise exception 'Warm up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;
  if p_pack_up_minutes is not null and (p_pack_up_minutes < 0 or p_pack_up_minutes > 60 or p_pack_up_minutes % 5 <> 0) then
    raise exception 'Cool down / pack up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;

  v_schedule_changed := (p_session_date is not null and p_session_date is distinct from s.session_date)
    or (p_start_time is not null and p_start_time is distinct from s.start_time)
    or (p_duration_minutes is not null and p_duration_minutes is distinct from s.duration_minutes)
    or (p_venue_id is not null and p_venue_id is distinct from s.venue_id)
    or (p_pitch_id is not null and p_pitch_id is distinct from s.pitch_id)
    or (p_warm_up_minutes is not null and p_warm_up_minutes is distinct from s.warm_up_minutes)
    or (p_pack_up_minutes is not null and p_pack_up_minutes is distinct from s.pack_up_minutes);

  if v_schedule_changed and s.occurrence_date is not null and s.occurrence_date < current_date then
    raise exception 'A completed training session''s schedule cannot be changed -- only its agenda and notes can still be recorded.' using errcode = '42501';
  end if;

  v_changed := v_schedule_changed
    or (p_agenda is not null and trim(p_agenda) is distinct from s.agenda)
    or (p_further_notes is not null and v_further_notes is distinct from s.further_notes);

  update public.training_sessions set
    session_date = coalesce(p_session_date, session_date),
    occurrence_date = coalesce(p_session_date, occurrence_date),
    start_time = coalesce(p_start_time, start_time),
    duration_minutes = coalesce(p_duration_minutes, duration_minutes),
    end_time = case when p_start_time is not null or p_duration_minutes is not null
      then (coalesce(p_start_time, start_time) + make_interval(mins => coalesce(p_duration_minutes, duration_minutes)))::time
      else end_time end,
    venue_id = coalesce(p_venue_id, venue_id),
    pitch_id = coalesce(p_pitch_id, pitch_id),
    agenda = coalesce(nullif(trim(p_agenda), ''), agenda),
    further_notes = case when p_further_notes is not null then v_further_notes else further_notes end,
    warm_up_minutes = coalesce(p_warm_up_minutes, warm_up_minutes),
    pack_up_minutes = coalesce(p_pack_up_minutes, pack_up_minutes),
    is_overridden = true,
    updated_by = auth.uid()
  where id = p_session_id;

  if v_changed then
    select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = s.team_id;
    perform internal.notify_training_participants(
      p_session_id, 'training_session_updated', 'Training updated',
      format('%s training on %s has been updated.', v_team_label, to_char(coalesce(p_session_date, s.session_date), 'DD Mon'))
    );
  end if;
end;
$function$;

revoke all on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer) from public;
grant execute on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer) to authenticated;

comment on function public.override_training_session is 'The ONE occurrence-level override RPC. Coalesce-only-what-changed semantics; computes end_time server-side. A past occurrence''s agenda/further_notes stay editable (administrative recording), but date/start_time/duration/venue/pitch/warm_up/pack_up are refused once occurrence_date < current_date, mirroring cancel_training_session''s existing historical guard -- history is not silently rewritten just because a coach opens an old session.';
