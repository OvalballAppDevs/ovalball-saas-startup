-- SIDE PROJECT 2 -- TRAINING MANAGEMENT, Phase C: the ONE canonical
-- recurrence resolver (Section 79) plus plan create/edit/generate/
-- deactivate/override RPCs. Calendar and Pitch Allocation never
-- independently interpret recurrence -- they only ever read the
-- training_sessions rows this resolver's generator produces.

-- =====================================================================
-- internal.resolve_training_plan_occurrence_dates: pure read-only
-- resolver. For SEASON/SEASON_PRE_SEASON modes the effective date range
-- is derived fresh from the plan's own season row every time (never
-- hardcoded, never Union-specific -- Section 12/13), so a later season-date
-- correction is picked up automatically on the next generation run.
-- =====================================================================
create or replace function internal.resolve_training_plan_occurrence_dates(p_training_plan_id uuid)
returns table (schedule_rule_id uuid, occurrence_date date, start_time time, duration_minutes integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.training_plans;
  v_season public.seasons;
begin
  select * into v_plan from public.training_plans where id = p_training_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;

  if v_plan.schedule_mode in ('SEASON', 'SEASON_PRE_SEASON') then
    select * into v_season from public.seasons where id = v_plan.season_id;
    if not found then
      raise exception 'Season not found for this plan.' using errcode = '22023';
    end if;
    if v_plan.schedule_mode = 'SEASON_PRE_SEASON' and v_season.pre_season_starts_on is null then
      -- Section 13: never invent a pre-season start date. The caller
      -- (save_training_plan) is responsible for putting the plan into
      -- NEEDS_ATTENTION and refusing activation in this case -- this
      -- resolver simply returns zero rows rather than guessing.
      return;
    end if;

    return query
      select r.id, d::date, r.start_time, r.duration_minutes
      from public.training_plan_schedule_rules r
      cross join lateral generate_series(
        case when v_plan.schedule_mode = 'SEASON_PRE_SEASON' then v_season.pre_season_starts_on else v_season.starts_on end,
        v_season.ends_on,
        interval '1 day'
      ) as d
      where r.training_plan_id = p_training_plan_id
        and extract(dow from d) = r.weekday;
  else
    -- CUSTOM: each rule supplies its own bounded date range (Section 14).
    return query
      select r.id, d::date, r.start_time, r.duration_minutes
      from public.training_plan_schedule_rules r
      cross join lateral generate_series(r.starts_on, r.ends_on, interval '1 day') as d
      where r.training_plan_id = p_training_plan_id
        and r.starts_on is not null and r.ends_on is not null
        and extract(dow from d) = r.weekday;
  end if;
end;
$function$;

revoke all on function internal.resolve_training_plan_occurrence_dates(uuid) from public, anon, authenticated;

-- Thin authenticated-facing preview wrapper (Section 78): the browser
-- previews a plan's occurrence COUNT before save using this exact
-- resolver, never a separate client-side recurrence reimplementation.
create or replace function public.preview_training_plan_occurrences(
  p_club_id uuid, p_schedule_mode text, p_season_id uuid,
  p_rules jsonb
)
returns table (schedule_rule_index integer, occurrence_date date, start_time time, duration_minutes integer)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_season public.seasons;
  v_rule jsonb;
  v_idx integer := 0;
begin
  if not internal.has_capability('club.training.manage', 'club', p_club_id, null) then
    raise exception 'You are not authorized to preview Training Plans for this club.' using errcode = '42501';
  end if;

  if p_schedule_mode in ('SEASON', 'SEASON_PRE_SEASON') then
    select * into v_season from public.seasons where id = p_season_id;
    if not found then
      raise exception 'Season not found.' using errcode = '22023';
    end if;
    if p_schedule_mode = 'SEASON_PRE_SEASON' and v_season.pre_season_starts_on is null then
      return;
    end if;
    for v_rule in select * from jsonb_array_elements(p_rules)
    loop
      return query
        select v_idx, d::date, (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
        from generate_series(
          case when p_schedule_mode = 'SEASON_PRE_SEASON' then v_season.pre_season_starts_on else v_season.starts_on end,
          v_season.ends_on, interval '1 day'
        ) as d
        where extract(dow from d) = (v_rule->>'weekday')::integer;
      v_idx := v_idx + 1;
    end loop;
  else
    for v_rule in select * from jsonb_array_elements(p_rules)
    loop
      return query
        select v_idx, d::date, (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
        from generate_series((v_rule->>'starts_on')::date, (v_rule->>'ends_on')::date, interval '1 day') as d
        where extract(dow from d) = (v_rule->>'weekday')::integer;
      v_idx := v_idx + 1;
    end loop;
  end if;
end;
$function$;

revoke all on function public.preview_training_plan_occurrences(uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.preview_training_plan_occurrences(uuid, text, uuid, jsonb) to authenticated;

-- =====================================================================
-- public.generate_training_plan_sessions: idempotent, set-based (one
-- INSERT .. SELECT .. ON CONFLICT DO NOTHING -- Section 22/80/81: safe
-- under concurrent/repeated calls, no client-side dedup, transactionally
-- atomic by construction since it is a single statement in a single
-- function invocation).
-- =====================================================================
create or replace function public.generate_training_plan_sessions(p_training_plan_id uuid)
returns table (created_count integer, skipped_existing_count integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan public.training_plans;
  v_created integer;
  v_total integer;
begin
  select * into v_plan from public.training_plans where id = p_training_plan_id;
  if not found then
    raise exception 'Training plan not found.';
  end if;
  if not internal.has_capability('club.training.manage', 'club', v_plan.club_id, null) then
    raise exception 'You are not authorized to generate sessions for this plan.' using errcode = '42501';
  end if;
  if v_plan.status <> 'ACTIVE' then
    return query select 0, 0;
    return;
  end if;

  select count(*) into v_total from internal.resolve_training_plan_occurrence_dates(p_training_plan_id);

  with resolved as (
    select * from internal.resolve_training_plan_occurrence_dates(p_training_plan_id)
  ),
  ins as (
    insert into public.training_sessions (
      club_id, team_id, training_plan_id, schedule_rule_id, season_id,
      session_date, occurrence_date, start_time, end_time, duration_minutes,
      venue_id, pitch_id, source, status, created_by, updated_by
    )
    select
      v_plan.club_id, v_plan.team_id, v_plan.id, r.schedule_rule_id, v_plan.season_id,
      r.occurrence_date, r.occurrence_date, r.start_time, (r.start_time + make_interval(mins => r.duration_minutes))::time, r.duration_minutes,
      v_plan.preferred_venue_id, v_plan.preferred_pitch_id, 'AUTOMATIC_PLAN', 'PLANNED', auth.uid(), auth.uid()
    from resolved r
    on conflict (schedule_rule_id, occurrence_date) where schedule_rule_id is not null and occurrence_date is not null do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  return query select v_created, (v_total - v_created);
end;
$function$;

revoke all on function public.generate_training_plan_sessions(uuid) from public, anon;
grant execute on function public.generate_training_plan_sessions(uuid) to authenticated;

-- =====================================================================
-- public.save_training_plan: create OR update, full server-side required-
-- field validation (Section 48), transactionally safe (Section 80 -- one
-- PL/pgSQL function body = one implicit transaction), then reconciles and
-- (re)generates sessions in the same call.
--
-- p_rules shape: jsonb array of
--   {weekday, start_time, duration_minutes, starts_on?, ends_on?}
-- =====================================================================
create or replace function public.save_training_plan(
  p_plan_id uuid, -- null to create
  p_club_id uuid, p_team_id uuid, p_schedule_mode text, p_season_id uuid,
  p_preferred_venue_id uuid, p_preferred_pitch_id uuid, p_rules jsonb
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_plan_id uuid;
  v_rule jsonb;
  v_needs_attention_reason text := null;
  v_status text := 'ACTIVE';
  v_season public.seasons;
  v_removed_count integer;
begin
  if not internal.has_capability('club.training.manage', 'club', p_club_id, null) then
    raise exception 'You are not authorized to manage Training Plans for this club.' using errcode = '42501';
  end if;

  -- Section 48: every required field, enforced server-side regardless of
  -- what the browser sent.
  if p_team_id is null then raise exception 'A team is required.'; end if;
  if not exists (select 1 from public.teams where id = p_team_id and club_id = p_club_id and active) then
    raise exception 'That is not an active team at this club.';
  end if;
  if p_schedule_mode not in ('SEASON', 'SEASON_PRE_SEASON', 'CUSTOM') then
    raise exception 'Invalid schedule mode.';
  end if;
  if p_schedule_mode in ('SEASON', 'SEASON_PRE_SEASON') and p_season_id is null then
    raise exception 'A season is required for this schedule mode.';
  end if;
  if p_preferred_venue_id is null then raise exception 'A preferred training venue is required.'; end if;
  if p_preferred_pitch_id is null then raise exception 'A preferred training pitch is required.'; end if;
  if not exists (select 1 from public.venues where id = p_preferred_venue_id and (club_id = p_club_id or club_id is null) and active) then
    raise exception 'That venue is not available to this club.';
  end if;
  -- Section 10: the preferred pitch must belong to the selected venue.
  if not exists (select 1 from public.club_pitches where id = p_preferred_pitch_id and club_id = p_club_id and active and venue_id = p_preferred_venue_id) then
    raise exception 'The preferred pitch must belong to the selected venue.';
  end if;
  if p_rules is null or jsonb_array_length(p_rules) = 0 then
    raise exception 'At least one schedule rule is required.';
  end if;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    if v_rule->>'weekday' is null or (v_rule->>'weekday')::integer not between 0 and 6 then
      raise exception 'Each schedule rule requires a valid weekday.';
    end if;
    if v_rule->>'start_time' is null then
      raise exception 'Each schedule rule requires a start time.';
    end if;
    if v_rule->>'duration_minutes' is null or (v_rule->>'duration_minutes')::integer < 15 or (v_rule->>'duration_minutes')::integer > 240 then
      raise exception 'Each schedule rule requires a valid duration.';
    end if;
    if p_schedule_mode = 'CUSTOM' then
      if v_rule->>'starts_on' is null or v_rule->>'ends_on' is null then
        raise exception 'Each custom schedule row requires a from and to date.';
      end if;
      if (v_rule->>'starts_on')::date > (v_rule->>'ends_on')::date then
        raise exception 'A schedule row''s from date cannot be after its to date.';
      end if;
      -- Section 49: reject a range where the selected weekday never occurs.
      if not exists (
        select 1 from generate_series((v_rule->>'starts_on')::date, (v_rule->>'ends_on')::date, interval '1 day') d
        where extract(dow from d) = (v_rule->>'weekday')::integer
      ) then
        raise exception 'This schedule row''s date range never includes the selected weekday.';
      end if;
    end if;
  end loop;

  if p_schedule_mode = 'SEASON_PRE_SEASON' then
    select * into v_season from public.seasons where id = p_season_id;
    if not found or v_season.pre_season_starts_on is null then
      v_status := 'NEEDS_ATTENTION';
      v_needs_attention_reason := 'This season has no canonical pre-season start date configured -- ask a Site Admin to set one, or switch this plan to Season only.';
    end if;
  end if;

  if p_plan_id is null then
    insert into public.training_plans (
      club_id, team_id, season_id, schedule_mode, preferred_venue_id, preferred_pitch_id,
      status, needs_attention_reason, created_by, updated_by
    ) values (
      p_club_id, p_team_id, p_season_id, p_schedule_mode, p_preferred_venue_id, p_preferred_pitch_id,
      v_status, v_needs_attention_reason, auth.uid(), auth.uid()
    ) returning id into v_plan_id;
  else
    v_plan_id := p_plan_id;
    if not exists (select 1 from public.training_plans where id = v_plan_id and club_id = p_club_id) then
      raise exception 'Training plan not found for this club.';
    end if;
    update public.training_plans set
      team_id = p_team_id, season_id = p_season_id, schedule_mode = p_schedule_mode,
      preferred_venue_id = p_preferred_venue_id, preferred_pitch_id = p_preferred_pitch_id,
      status = v_status, needs_attention_reason = v_needs_attention_reason,
      updated_by = auth.uid()
    where id = v_plan_id;

    -- Section 23: reconcile, never silently rewrite history. Any FUTURE,
    -- non-overridden AUTOMATIC_PLAN session belonging to this plan is
    -- cancelled (not deleted -- Section 85) before rules are replaced and
    -- regenerated; the unique occurrence index then lets the fresh
    -- generation call below recreate whatever's still valid without ever
    -- touching the past or a manually-overridden row.
    update public.training_sessions
    set status = 'CANCELLED', cancellation_reason = 'Training Plan schedule was edited.'
    where training_plan_id = v_plan_id
      and occurrence_date >= current_date
      and is_overridden = false
      and status <> 'CANCELLED';
    get diagnostics v_removed_count = row_count;

    delete from public.training_plan_schedule_rules where training_plan_id = v_plan_id;
  end if;

  for v_rule in select * from jsonb_array_elements(p_rules)
  loop
    insert into public.training_plan_schedule_rules (training_plan_id, weekday, starts_on, ends_on, start_time, duration_minutes)
    values (
      v_plan_id, (v_rule->>'weekday')::integer,
      case when p_schedule_mode = 'CUSTOM' then (v_rule->>'starts_on')::date else null end,
      case when p_schedule_mode = 'CUSTOM' then (v_rule->>'ends_on')::date else null end,
      (v_rule->>'start_time')::time, (v_rule->>'duration_minutes')::integer
    );
  end loop;

  if v_status = 'ACTIVE' then
    perform public.generate_training_plan_sessions(v_plan_id);
  end if;

  return v_plan_id;
end;
$function$;

revoke all on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb) from public, anon;
grant execute on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb) to authenticated;

-- =====================================================================
-- public.deactivate_training_plan (Section 24): stops future generation
-- and cancels future non-overridden occurrences; never deletes history.
-- =====================================================================
create or replace function public.deactivate_training_plan(p_plan_id uuid, p_reason text default null)
returns void
language plpgsql
security definer
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
    raise exception 'You are not authorized to deactivate this Training Plan.' using errcode = '42501';
  end if;

  update public.training_plans
  set status = 'INACTIVE', deactivated_at = now(), deactivated_by = auth.uid(), deactivation_reason = nullif(trim(p_reason), '')
  where id = p_plan_id;

  update public.training_sessions
  set status = 'CANCELLED', cancellation_reason = coalesce(nullif(trim(p_reason), ''), 'Training Plan was deactivated.')
  where training_plan_id = p_plan_id
    and occurrence_date >= current_date
    and is_overridden = false
    and status <> 'CANCELLED';
end;
$function$;

revoke all on function public.deactivate_training_plan(uuid, text) from public, anon;
grant execute on function public.deactivate_training_plan(uuid, text) to authenticated;

-- =====================================================================
-- public.reactivate_training_plan: sets an INACTIVE plan back to ACTIVE
-- and regenerates its bounded occurrence set (idempotent -- untouched
-- historical/overridden rows are never recreated or duplicated).
-- =====================================================================
create or replace function public.reactivate_training_plan(p_plan_id uuid)
returns void
language plpgsql
security definer
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
    raise exception 'You are not authorized to reactivate this Training Plan.' using errcode = '42501';
  end if;

  update public.training_plans set status = 'ACTIVE', deactivated_at = null, deactivated_by = null, deactivation_reason = null where id = p_plan_id;
  perform public.generate_training_plan_sessions(p_plan_id);
end;
$function$;

revoke all on function public.reactivate_training_plan(uuid) from public, anon;
grant execute on function public.reactivate_training_plan(uuid) to authenticated;

-- =====================================================================
-- public.override_training_session (Section 25/37): change ONE occurrence
-- without touching the plan. Preferred_pitch_id on the plan is never
-- overwritten by an occurrence-level change (Section 37).
-- =====================================================================
create or replace function public.override_training_session(
  p_session_id uuid, p_session_date date default null, p_start_time time default null,
  p_duration_minutes integer default null, p_venue_id uuid default null, p_pitch_id uuid default null,
  p_cancel boolean default false, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  s public.training_sessions;
begin
  select * into s from public.training_sessions where id = p_session_id;
  if not found then
    raise exception 'Training session not found.';
  end if;
  if not internal.can_manage_training(s.club_id, s.team_id) and not internal.has_capability('club.training.manage', 'club', s.club_id, null) then
    raise exception 'You are not authorized to change this Training Session.' using errcode = '42501';
  end if;

  if p_venue_id is not null and p_pitch_id is not null and not exists (
    select 1 from public.club_pitches where id = p_pitch_id and club_id = s.club_id and venue_id = p_venue_id
  ) then
    raise exception 'The selected pitch does not belong to the selected venue.';
  end if;

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
    status = case when p_cancel then 'CANCELLED' else status end,
    cancellation_reason = case when p_cancel then nullif(trim(p_reason), '') else cancellation_reason end,
    is_overridden = true,
    updated_by = auth.uid()
  where id = p_session_id;
end;
$function$;

revoke all on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text) from public, anon;
grant execute on function public.override_training_session(uuid, date, time, integer, uuid, uuid, boolean, text) to authenticated;
