-- SIDE PROJECT 2 -- TRAINING MANAGEMENT, Phase E/F: reconcile the
-- pre-existing manual "Schedule Training" RPCs onto the new columns
-- (additive-only signature changes -- every existing positional/named call
-- site keeps working unchanged, confirmed by reading
-- app/(app)/calendar/actions.ts before writing this), plus the computed
-- effective-status helper (Section 84/26) and the Training Management
-- landing-page overview read (Section 6).

-- =====================================================================
-- create_training_session: unchanged authority/behaviour for every
-- existing caller; new optional trailing params only (Section 31 --
-- manual training must also carry venue + duration).
-- =====================================================================
create or replace function public.create_training_session(
  p_club_id uuid, p_team_id uuid, p_scheduling_group_id uuid, p_session_date date,
  p_start_time time default null, p_end_time time default null, p_pitch_id uuid default null, p_notes text default null,
  p_venue_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_duration_minutes integer;
  v_venue_id uuid;
begin
  if not internal.can_manage_training(p_club_id, p_team_id) then
    raise exception 'Not authorized to schedule training for this club.' using errcode = '42501';
  end if;
  if num_nonnulls(p_team_id, p_scheduling_group_id) <> 1 then
    raise exception 'Training must belong to exactly one team or one shared mini-rugby group, never both.';
  end if;
  if p_team_id is not null and not exists (select 1 from public.teams where id = p_team_id and club_id = p_club_id) then
    raise exception 'That team does not belong to this club.';
  end if;
  if p_scheduling_group_id is not null and not exists (select 1 from public.scheduling_groups where id = p_scheduling_group_id and club_id = p_club_id and active) then
    raise exception 'That shared mini-rugby group does not belong to this club, or is not active.';
  end if;
  if p_pitch_id is not null and not exists (select 1 from public.club_pitches where id = p_pitch_id and club_id = p_club_id and active) then
    raise exception 'That pitch does not belong to this club, or is archived.';
  end if;

  -- Section 31: manual training still needs a real venue. An explicit
  -- p_venue_id wins; otherwise fall back to the chosen pitch's own venue
  -- (matching how public.fixtures already resolves venue_id/pitch venue --
  -- Section 9/10's "no free-text venue" without forcing every existing
  -- manual-scheduling caller to start passing one explicitly).
  if p_venue_id is not null then
    if p_pitch_id is not null and not exists (select 1 from public.club_pitches where id = p_pitch_id and venue_id = p_venue_id) then
      raise exception 'The selected pitch does not belong to the selected venue.';
    end if;
    v_venue_id := p_venue_id;
  elsif p_pitch_id is not null then
    select venue_id into v_venue_id from public.club_pitches where id = p_pitch_id;
  end if;

  if p_start_time is not null and p_end_time is not null then
    v_duration_minutes := round(extract(epoch from (p_end_time - p_start_time)) / 60)::integer;
  end if;

  insert into public.training_sessions (
    club_id, team_id, scheduling_group_id, session_date, occurrence_date, start_time, end_time, pitch_id, venue_id,
    duration_minutes, source, status, notes, created_by, updated_by
  )
  values (
    p_club_id, p_team_id, p_scheduling_group_id, p_session_date, p_session_date, p_start_time, p_end_time, p_pitch_id, v_venue_id,
    v_duration_minutes, 'MANUAL', 'PLANNED', nullif(trim(p_notes), ''), auth.uid(), auth.uid()
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_training_session(uuid, uuid, uuid, date, time, time, uuid, text, uuid) from public;
grant execute on function public.create_training_session(uuid, uuid, uuid, date, time, time, uuid, text, uuid) to authenticated;

create or replace function public.cancel_training_session(p_session_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.has_capability('club.training.manage', 'club', s.club_id, null) then
    raise exception 'Not authorized to cancel this training session.' using errcode = '42501';
  end if;

  update public.training_sessions
  set status = 'CANCELLED', cancellation_reason = nullif(trim(p_reason), ''), updated_by = auth.uid(),
      is_overridden = (source = 'AUTOMATIC_PLAN')
  where id = p_session_id;
end;
$$;

-- =====================================================================
-- internal.effective_training_session_status (Section 26/84): the ONE
-- place "Completed" is computed. A pure function of already-stored data +
-- now() -- no background job, no cron dependency, cannot go stale because
-- nothing is ever written; every reader (Calendar, Training Management,
-- Team Admin) calls this instead of re-deriving the same date math ad hoc.
-- =====================================================================
create or replace function internal.effective_training_session_status(p_status text, p_session_date date, p_end_time time)
returns text
language sql
immutable
as $function$
  select case
    when p_status = 'CANCELLED' then 'CANCELLED'
    when (p_session_date + coalesce(p_end_time, '23:59:59'::time)) < now() then 'COMPLETED'
    else 'PLANNED'
  end;
$function$;

comment on function internal.effective_training_session_status is 'Presentation-layer status ONLY (Section 84): a session past its own end time reads as COMPLETED here without ever being written back to the stored `status` column, which remains the true PLANNED/CANCELLED lifecycle (Section 26). "Completed" here means the SESSION occurred, never that attendance was taken (Section 84 explicitly separates the two concepts -- this codebase has no attendance-for-training concept yet at all, see docs/TRAINING_MANAGEMENT_ARCHITECTURE.md Section 58).';

-- =====================================================================
-- get_training_management_overview (Section 6): one batched read for the
-- Club Admin landing page -- no per-card N+1 (Section 54/55).
-- =====================================================================
create or replace function public.get_training_management_overview(p_club_id uuid)
returns table (
  active_plan_count integer,
  teams_without_plan_count integer,
  upcoming_session_count integer,
  needs_attention_plan_count integer
)
language plpgsql
security definer
stable
set search_path = public
as $function$
begin
  if not (internal.has_capability('club.training.manage', 'club', p_club_id, null) or internal.has_capability('fixture.view', 'club', p_club_id, null)) then
    raise exception 'You are not authorized to view Training Management for this club.' using errcode = '42501';
  end if;

  return query
  select
    (select count(*)::integer from public.training_plans where club_id = p_club_id and status = 'ACTIVE'),
    (select count(*)::integer from public.teams t where t.club_id = p_club_id and t.active
       and not exists (select 1 from public.training_plans tp where tp.team_id = t.id and tp.status <> 'INACTIVE')),
    (select count(*)::integer from public.training_sessions where club_id = p_club_id and occurrence_date >= current_date and status <> 'CANCELLED'),
    (select count(*)::integer from public.training_plans where club_id = p_club_id and status = 'NEEDS_ATTENTION');
end;
$function$;

revoke all on function public.get_training_management_overview(uuid) from public, anon;
grant execute on function public.get_training_management_overview(uuid) to authenticated;
