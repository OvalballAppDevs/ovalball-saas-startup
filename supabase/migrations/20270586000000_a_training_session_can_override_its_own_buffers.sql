-- PLAN DETAIL / SESSION EDIT (Step 7) -- Training Planning brief Section 5.
--
-- The mock-up's "Edit Session" screen shows Warm Up / Pack Up as per-session editable fields, matching
-- Venue/Pitch/Start/Duration. Those five already share ONE mechanism (`override_training_session`'s
-- coalesce-only-what-changed update) -- warm_up_minutes/pack_up_minutes get the SAME nullable-override
-- shape rather than a second one, and (per the Step 6 report's own rule) are still never read by the
-- pitch/fixture occupancy or conflict engine.
--
-- NULL on a session means "inherit the plan's own default" -- confirmed by reading
-- `get_training_session_card`'s live definition first: there is no existing per-session value at all,
-- so every session currently inherits implicitly. This migration makes that explicit and overridable,
-- it does not change what already displays.

alter table public.training_sessions
  add column if not exists warm_up_minutes integer,
  add column if not exists pack_up_minutes integer;

alter table public.training_sessions
  drop constraint if exists training_sessions_warm_up_range,
  add constraint training_sessions_warm_up_range check (warm_up_minutes is null or (warm_up_minutes >= 0 and warm_up_minutes <= 60 and warm_up_minutes % 5 = 0));

alter table public.training_sessions
  drop constraint if exists training_sessions_pack_up_range,
  add constraint training_sessions_pack_up_range check (pack_up_minutes is null or (pack_up_minutes >= 0 and pack_up_minutes <= 60 and pack_up_minutes % 5 = 0));

comment on column public.training_sessions.warm_up_minutes is 'Per-occurrence override of the parent plan''s warm_up_minutes. NULL inherits the plan''s own value. Written only through override_training_session. Never read by pitch/fixture occupancy.';
comment on column public.training_sessions.pack_up_minutes is 'Per-occurrence override of the parent plan''s pack_up_minutes. NULL inherits the plan''s own value. Written only through override_training_session. Never read by pitch/fixture occupancy.';

-- ---------------------------------------------------------------------------------------------------
-- override_training_session: byte-identical to the live definition plus two new trailing optional
-- params, coalesced the same way every other field already is.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.override_training_session(
  p_session_id uuid, p_session_date date default null, p_start_time time default null,
  p_duration_minutes integer default null, p_venue_id uuid default null, p_pitch_id uuid default null,
  p_cancel boolean default false, p_reason text default null,
  p_agenda text default null, p_further_notes text default null,
  p_warm_up_minutes integer default null, p_pack_up_minutes integer default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
declare
  s public.training_sessions;
  v_further_notes text;
  v_changed boolean := false;
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

  v_changed := (p_session_date is not null and p_session_date is distinct from s.session_date)
    or (p_start_time is not null and p_start_time is distinct from s.start_time)
    or (p_duration_minutes is not null and p_duration_minutes is distinct from s.duration_minutes)
    or (p_venue_id is not null and p_venue_id is distinct from s.venue_id)
    or (p_pitch_id is not null and p_pitch_id is distinct from s.pitch_id)
    or (p_agenda is not null and trim(p_agenda) is distinct from s.agenda)
    or (p_further_notes is not null and v_further_notes is distinct from s.further_notes)
    or (p_warm_up_minutes is not null and p_warm_up_minutes is distinct from s.warm_up_minutes)
    or (p_pack_up_minutes is not null and p_pack_up_minutes is distinct from s.pack_up_minutes);

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

revoke all on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer) from public, anon;
grant execute on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer) to authenticated;

drop function if exists public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text);

-- ---------------------------------------------------------------------------------------------------
-- get_training_session_card: byte-identical to the live definition, plus is_overridden and the
-- EFFECTIVE warm_up_minutes/pack_up_minutes (session override, else the parent plan's own default,
-- else null for a MANUAL session with no plan at all). The return row shape changed (new trailing
-- columns), which Postgres will not let CREATE OR REPLACE do -- the function is dropped first.
-- ---------------------------------------------------------------------------------------------------
drop function if exists public.get_training_session_card(uuid);

create function public.get_training_session_card(p_training_session_id uuid)
returns table (
  id uuid, club_id uuid, team_id uuid, team_label text, scheduling_group_id uuid, season_id uuid,
  training_plan_id uuid, session_date date, start_time time, end_time time, duration_minutes integer,
  venue_id uuid, venue_name text, pitch_id uuid, pitch_name text, status text, source text, agenda text,
  further_notes text, notes text, cancelled_at timestamptz, cancellation_reason text, cancelled_by_name text,
  my_attendance_status text, can_manage boolean, can_view_register boolean,
  is_overridden boolean, warm_up_minutes integer, pack_up_minutes integer
)
language plpgsql
stable
security definer
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

  if not internal.training_session_visible_row(s.club_id, s.team_id, s.scheduling_group_id) then
    raise exception 'You are not authorized to view this training session.' using errcode = '42501';
  end if;

  v_can_manage := internal.can_manage_training(s.club_id, s.team_id) or internal.can_manage_club_training(s.club_id);
  v_can_view_register := v_can_manage
    or internal.can('team.attendance.view', 'team', s.club_id, s.team_id, null)
    or internal.can('team.attendance.view', 'club', s.club_id, null, null);

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
    v_can_manage, v_can_view_register,
    sess.is_overridden,
    coalesce(sess.warm_up_minutes, tp.warm_up_minutes),
    coalesce(sess.pack_up_minutes, tp.pack_up_minutes)
  from public.training_sessions sess
  left join public.teams t on t.id = sess.team_id
  left join public.scheduling_groups sg on sg.id = sess.scheduling_group_id
  left join public.venues v on v.id = sess.venue_id
  left join public.club_pitches cp on cp.id = sess.pitch_id
  left join public.profiles prof on prof.id = sess.cancelled_by
  left join public.training_plans tp on tp.id = sess.training_plan_id
  where sess.id = p_training_session_id;
end;
$function$;

revoke all on function public.get_training_session_card(uuid) from public, anon;
grant execute on function public.get_training_session_card(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text, integer, integer)', 'EXECUTE') then
    raise exception 'override_training_session must not be executable by anon';
  end if;
  if has_function_privilege('anon', 'public.get_training_session_card(uuid)', 'EXECUTE') then
    raise exception 'get_training_session_card must not be executable by anon';
  end if;
end $$;
