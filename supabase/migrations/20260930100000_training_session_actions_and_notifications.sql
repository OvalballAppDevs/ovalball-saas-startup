-- SIDE PROJECT 2 -- TRAINING MANAGEMENT EXTENSION: individual cancellation
-- (Section 5-12), Delete Training Plan (Section 13-18), edit-this-session
-- (Section 33-34), and participant notifications (Section 35-38, 61, 69,
-- 72-73) -- all reusing the EXISTING generic public.notifications table
-- and the existing 'calendar_training_updates' notification_topics row
-- (confirmed present, label "Calendar and training updates") rather than
-- inventing a second notification system.

-- =====================================================================
-- PART A: two new notification type_keys under the EXISTING topic.
-- =====================================================================
insert into public.notification_types (type_key, topic_key) values
  ('training_session_updated', 'calendar_training_updates'),
  ('training_session_cancelled', 'calendar_training_updates'),
  ('training_plan_cancelled', 'calendar_training_updates')
on conflict (type_key) do nothing;

-- =====================================================================
-- PART B: shared recipient resolver + sender (Section 37, 61).
-- Notifies: every active guardian of every player active on the
-- session's team, plus any player with their OWN linked account on that
-- team (adult self-managed players) -- the exact same eligibility the
-- canonical attendance model already uses (internal.is_active_player_
-- guardian / internal.is_own_linked_player), never a separate resolver.
-- For a Mini-Rugby-Group-owned session, notifies every player across the
-- group's real component teams (internal.can_manage_training's own
-- team_id/scheduling_group_id split is mirrored here). Deduplicated by
-- construction (a plain `insert ... select distinct`).
-- =====================================================================
create or replace function internal.notify_training_participants(p_training_session_id uuid, p_type text, p_title text, p_body text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_training_session_id;
  if not found then
    return;
  end if;

  insert into public.notifications (user_id, type, title, body, data)
  select distinct recipient, p_type, p_title, p_body, jsonb_build_object('training_session_id', p_training_session_id, 'training_plan_id', s.training_plan_id)
  from (
    -- Active guardians of every player active on the session's team(s).
    select g.guardian_user_id as recipient
    from public.player_team_memberships ptm
    join public.guardians g on g.player_id = ptm.player_id and g.status = 'active'
    where ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
    union
    -- Adult self-managed players (own linked account) on the same team(s).
    select p.user_id as recipient
    from public.player_team_memberships ptm
    join public.players p on p.id = ptm.player_id and p.user_id is not null
    where ptm.status = 'active'
      and (
        (s.team_id is not null and ptm.team_id = s.team_id)
        or (s.scheduling_group_id is not null and ptm.team_id in (select team_id from public.scheduling_group_members where group_id = s.scheduling_group_id))
      )
  ) recipients;
end;
$function$;

comment on function internal.notify_training_participants is 'Section 37: canonical recipient resolution for training notifications -- active guardians + self-managed adult players on the session''s own team (or every component team of its Mini-Rugby Group). Reuses the exact eligibility already established by the attendance/consent model; never a second resolver. Delivery itself is still gated per-recipient by internal.should_deliver_notification via the existing notifications_gate_delivery trigger, so an opted-out user is silently skipped exactly as for every other notification type in this codebase.';

-- =====================================================================
-- PART C: hardened cancel_training_session (Section 8-9) -- reason is now
-- REQUIRED and non-blank, cancelled_by is recorded, participants notified
-- (Section 72: within the same transaction as the mutation -- if this
-- function's transaction rolls back, so does the notification insert).
-- =====================================================================
create or replace function public.cancel_training_session(p_session_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.training_sessions;
  v_reason text := trim(coalesce(p_reason, ''));
  v_team_label text;
begin
  if v_reason = '' then
    raise exception 'A reason is required to cancel a training session.';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Cancellation reason is too long.';
  end if;

  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.has_capability('club.training.manage', 'club', s.club_id, null) then
    raise exception 'Not authorized to cancel this training session.' using errcode = '42501';
  end if;
  if s.status = 'CANCELLED' then
    raise exception 'This training session has already been cancelled.';
  end if;
  -- Section 83: cancelling a genuinely completed (past) session is blocked
  -- for ordinary cancellation authority -- history is not silently rewritten.
  if s.occurrence_date is not null and s.occurrence_date < current_date then
    raise exception 'A completed training session cannot be cancelled.' using errcode = '42501';
  end if;

  update public.training_sessions
  set status = 'CANCELLED', cancellation_reason = v_reason, cancelled_by = auth.uid(), updated_by = auth.uid(),
      is_overridden = (source = 'AUTOMATIC_PLAN')
  where id = p_session_id;

  select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = s.team_id;
  perform internal.notify_training_participants(
    p_session_id, 'training_session_cancelled', 'Training cancelled',
    format('%s training on %s at %s has been cancelled.', v_team_label, to_char(s.session_date, 'DD Mon'), coalesce(to_char(s.start_time, 'HH24:MI'), 'the scheduled time'))
  );
end;
$$;

revoke all on function public.cancel_training_session(uuid, text) from public, anon;
grant execute on function public.cancel_training_session(uuid, text) to authenticated;

-- =====================================================================
-- PART D: edit_training_session (Section 33-34, 63) -- the non-destructive
-- "Edit Training Details" action: agenda, further notes, time, duration,
-- venue, pitch for ONE occurrence only. Never touches the plan's own
-- defaults (Section 34's explicit "agenda edit must not accidentally
-- alter every Monday session" rule) -- this is the same
-- override_training_session RPC from the foundation pass, extended with
-- two new trailing optional params so the existing call site (single-
-- occurrence pitch/time override from the smoke test / regression suite)
-- keeps working unchanged. Sends a participant notification only when a
-- participant-visible field genuinely changed (Section 61's "no duplicate
-- notification on a no-op save").
-- =====================================================================
create or replace function public.override_training_session(
  p_session_id uuid, p_session_date date default null, p_start_time time default null,
  p_duration_minutes integer default null, p_venue_id uuid default null, p_pitch_id uuid default null,
  p_cancel boolean default false, p_reason text default null,
  p_agenda text default null, p_further_notes text default null
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
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.has_capability('club.training.manage', 'club', s.club_id, null) then
    raise exception 'You are not authorized to change this Training Session.' using errcode = '42501';
  end if;
  if p_cancel then
    -- Section 33-34: cancellation is its own dedicated, reason-required
    -- flow (cancel_training_session) -- this legacy parameter is kept
    -- only so the existing occurrence-override smoke test/regression call
    -- keeps compiling; routed straight through rather than duplicated.
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

  v_changed := (p_session_date is not null and p_session_date is distinct from s.session_date)
    or (p_start_time is not null and p_start_time is distinct from s.start_time)
    or (p_duration_minutes is not null and p_duration_minutes is distinct from s.duration_minutes)
    or (p_venue_id is not null and p_venue_id is distinct from s.venue_id)
    or (p_pitch_id is not null and p_pitch_id is distinct from s.pitch_id)
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

revoke all on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text) from public, anon;
grant execute on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text, text, text) to authenticated;

-- =====================================================================
-- PART E: harden deactivate_training_plan (Delete Training Plan, Section
-- 9/13-18) -- reason now REQUIRED, and participants get ONE aggregated
-- notification per plan deletion (Section 73), never one per cancelled
-- session.
-- =====================================================================
create or replace function public.deactivate_training_plan(p_plan_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.training_plans;
  v_reason text := trim(coalesce(p_reason, ''));
  v_cancelled_count integer;
  v_team_label text;
  v_nearest_date date;
begin
  if v_reason = '' then
    raise exception 'A reason is required to delete a Training Plan.';
  end if;
  if char_length(v_reason) > 1000 then
    raise exception 'Reason is too long.';
  end if;

  select * into v_plan from public.training_plans where id = p_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.has_capability('club.training.manage', 'club', v_plan.club_id, null) then
    raise exception 'You are not authorized to delete this Training Plan.' using errcode = '42501';
  end if;

  update public.training_plans
  set status = 'INACTIVE', deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = v_reason
  where id = p_plan_id;

  update public.training_sessions
  set status = 'CANCELLED', cancellation_reason = v_reason, cancelled_by = auth.uid()
  where training_plan_id = p_plan_id
    and occurrence_date >= current_date
    and is_overridden = false
    and status <> 'CANCELLED';
  get diagnostics v_cancelled_count = row_count;

  if v_cancelled_count > 0 then
    select min(occurrence_date) into v_nearest_date from public.training_sessions
      where training_plan_id = p_plan_id and status = 'CANCELLED' and cancelled_by = auth.uid() and occurrence_date >= current_date;
    select coalesce(t.display_name, 'Team') into v_team_label from public.teams t where t.id = v_plan.team_id;
    perform internal.notify_training_participants(
      -- Any one affected session is a valid anchor for the shared
      -- training_plan_id in the notification payload -- the deep-link
      -- target for a plan-level notification is the Training Management
      -- plan view, not one specific occurrence.
      (select id from public.training_sessions where training_plan_id = p_plan_id and status = 'CANCELLED' and cancelled_by = auth.uid() order by occurrence_date limit 1),
      'training_plan_cancelled', 'Training schedule changed',
      format('%s''s recurring training plan has been cancelled from %s onward. %s future session(s) will no longer take place.', v_team_label, to_char(v_nearest_date, 'DD Mon'), v_cancelled_count)
    );
  end if;
end;
$function$;

revoke all on function public.deactivate_training_plan(uuid, text) from public, anon;
grant execute on function public.deactivate_training_plan(uuid, text) to authenticated;

-- =====================================================================
-- PART F: preview impact before confirming deletion (Section 16).
-- =====================================================================
create or replace function public.get_training_plan_deletion_impact(p_plan_id uuid)
returns table (team_label text, schedule_mode text, venue_name text, pitch_name text, future_session_count integer)
language plpgsql
security definer
stable
set search_path to 'public'
as $function$
declare
  v_plan public.training_plans;
begin
  select * into v_plan from public.training_plans where id = p_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.has_capability('club.training.manage', 'club', v_plan.club_id, null) then
    raise exception 'You are not authorized to view this Training Plan.' using errcode = '42501';
  end if;

  return query
  select
    coalesce(t.display_name, 'Team'), v_plan.schedule_mode, v.name, cp.display_name,
    (select count(*)::integer from public.training_sessions ts
       where ts.training_plan_id = p_plan_id and ts.occurrence_date >= current_date and ts.is_overridden = false and ts.status <> 'CANCELLED')
  from public.teams t
  left join public.venues v on v.id = v_plan.preferred_venue_id
  left join public.club_pitches cp on cp.id = v_plan.preferred_pitch_id
  where t.id = v_plan.team_id;
end;
$function$;

revoke all on function public.get_training_plan_deletion_impact(uuid) from public, anon;
grant execute on function public.get_training_plan_deletion_impact(uuid) to authenticated;
