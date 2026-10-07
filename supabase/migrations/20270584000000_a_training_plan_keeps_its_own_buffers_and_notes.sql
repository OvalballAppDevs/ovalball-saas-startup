-- REVIEW & CREATE (Step 6) SCHEMA GAP RESOLUTION -- Training Planning brief Section 6.
--
-- Confirmed absent before writing this (forensics pass): neither public.training_plans nor
-- public.training_plan_schedule_rules has ever had a warm-up, pack-up or default-notes column.
-- public.club_scheduling_policy.warm_up_minutes/pack_up_minutes exist, but are a single CLUB-WIDE
-- fixture-buffer setting, and packages/contracts/src/pitch-allocation/training-conflicts.ts already
-- documents that a training session's occupied window is "exactly start -> start + duration, never
-- padded... the way a fixture is" -- so reusing the club-wide columns would be wrong (a different
-- concept, a different scope) and is explicitly not done here. These three new columns are PLAN-level,
-- informational, and deliberately NEVER read by the pitch/fixture occupancy or conflict engine.
--
-- warm_up_minutes / pack_up_minutes: same 0-60, 5-minute-increment vocabulary
-- club_scheduling_policy already uses, for consistency of meaning across the app, not because the two
-- are the same setting.
alter table public.training_plans
  add column if not exists warm_up_minutes integer not null default 0,
  add column if not exists pack_up_minutes integer not null default 0,
  add column if not exists default_session_notes text;

alter table public.training_plans
  drop constraint if exists training_plans_warm_up_range,
  add constraint training_plans_warm_up_range check (warm_up_minutes >= 0 and warm_up_minutes <= 60 and warm_up_minutes % 5 = 0);

alter table public.training_plans
  drop constraint if exists training_plans_pack_up_range,
  add constraint training_plans_pack_up_range check (pack_up_minutes >= 0 and pack_up_minutes <= 60 and pack_up_minutes % 5 = 0);

alter table public.training_plans
  drop constraint if exists training_plans_default_session_notes_length,
  add constraint training_plans_default_session_notes_length check (default_session_notes is null or char_length(default_session_notes) <= 2000);

comment on column public.training_plans.warm_up_minutes is 'Planning-only buffer BEFORE the session, shown to coaches/staff. Never applied to pitch occupancy or conflict detection -- see training-conflicts.ts.';
comment on column public.training_plans.pack_up_minutes is 'Planning-only buffer AFTER the session (cool-down and packing equipment away). Never applied to pitch occupancy or conflict detection.';
comment on column public.training_plans.default_session_notes is 'The plan''s own default participant-visible logistics note (e.g. "bring water"), copied onto each newly-generated training_sessions.further_notes at generation time only -- editing this afterwards does not retroactively rewrite sessions already generated, matching this codebase''s existing "never silently rewrite history" rule for training plans.';

-- ---------------------------------------------------------------------------------------------------
-- save_training_plan: three new TRAILING optional parameters (all default to today's behaviour), so
-- every existing caller (web's app/(app)/club/training/actions.ts, which calls by name) keeps working
-- unchanged. Everything else in this function body is byte-identical to the live definition.
-- ---------------------------------------------------------------------------------------------------
create or replace function public.save_training_plan(
  p_plan_id uuid, -- null to create
  p_club_id uuid, p_team_id uuid, p_schedule_mode text, p_season_id uuid,
  p_preferred_venue_id uuid, p_preferred_pitch_id uuid, p_rules jsonb,
  p_warm_up_minutes integer default 0, p_pack_up_minutes integer default 0, p_default_session_notes text default null
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
  v_is_new boolean := (p_plan_id is null);
  v_team_label text;
  v_venue_label text;
  v_schedule_summary text;
  v_warm_up integer := coalesce(p_warm_up_minutes, 0);
  v_pack_up integer := coalesce(p_pack_up_minutes, 0);
  v_notes text := nullif(trim(coalesce(p_default_session_notes, '')), '');
begin
  if not internal.has_capability('club.training.manage', 'club', p_club_id, null) then
    raise exception 'You are not authorized to manage Training Plans for this club.' using errcode = '42501';
  end if;

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
  if not exists (select 1 from public.club_pitches where id = p_preferred_pitch_id and club_id = p_club_id and active and venue_id = p_preferred_venue_id) then
    raise exception 'The preferred pitch must belong to the selected venue.';
  end if;
  if p_rules is null or jsonb_array_length(p_rules) = 0 then
    raise exception 'At least one schedule rule is required.';
  end if;
  if v_warm_up < 0 or v_warm_up > 60 or v_warm_up % 5 <> 0 then
    raise exception 'Warm up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;
  if v_pack_up < 0 or v_pack_up > 60 or v_pack_up % 5 <> 0 then
    raise exception 'Cool down / pack up must be between 0 and 60 minutes, in 5-minute steps.';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes are too long.';
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
      status, needs_attention_reason, warm_up_minutes, pack_up_minutes, default_session_notes, created_by, updated_by
    ) values (
      p_club_id, p_team_id, p_season_id, p_schedule_mode, p_preferred_venue_id, p_preferred_pitch_id,
      v_status, v_needs_attention_reason, v_warm_up, v_pack_up, v_notes, auth.uid(), auth.uid()
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
      warm_up_minutes = v_warm_up, pack_up_minutes = v_pack_up, default_session_notes = v_notes,
      updated_by = auth.uid()
    where id = v_plan_id;

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

  select display_name into v_team_label from public.teams where id = p_team_id;
  select name into v_venue_label from public.venues where id = p_preferred_venue_id;
  select string_agg(
    (case r.weekday
      when 0 then 'Sunday' when 1 then 'Monday' when 2 then 'Tuesday' when 3 then 'Wednesday'
      when 4 then 'Thursday' when 5 then 'Friday' when 6 then 'Saturday'
    end) || ' ' || to_char(r.start_time, 'FMHH24:MI'),
    ', ' order by r.weekday
  ) into v_schedule_summary
  from (
    select distinct weekday, start_time from public.training_plan_schedule_rules where training_plan_id = v_plan_id
  ) r;

  if v_is_new then
    perform internal.notify_team_staff(
      p_team_id, 'training_plan_created', 'Training plan created',
      format('%s''s training schedule is now available: %s at %s.', coalesce(v_team_label, 'Your team'), coalesce(v_schedule_summary, 'the set times'), coalesce(v_venue_label, 'the selected venue')),
      jsonb_build_object('training_plan_id', v_plan_id)
    );
  elsif coalesce(v_removed_count, 0) > 0 then
    perform internal.notify_team_staff(
      p_team_id, 'training_plan_schedule_changed', 'Training plan updated',
      format('%s''s training schedule has changed from today: %s at %s.', coalesce(v_team_label, 'Your team'), coalesce(v_schedule_summary, 'the set times'), coalesce(v_venue_label, 'the selected venue')),
      jsonb_build_object('training_plan_id', v_plan_id)
    );
  end if;

  return v_plan_id;
end;
$function$;

revoke all on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, integer, integer, text) from public, anon;
grant execute on function public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, integer, integer, text) to authenticated;

-- Drop the old 8-arg overload explicitly -- Postgres would otherwise keep both signatures alive, and a
-- caller passing only the original 8 positionally would silently keep hitting the old one forever.
drop function if exists public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb);

-- ---------------------------------------------------------------------------------------------------
-- generate_training_plan_sessions: byte-identical to the live definition except one column
-- (further_notes) now seeded from the plan's own default_session_notes -- ONLY at generation time, for
-- newly-inserted rows (ON CONFLICT DO NOTHING already means an existing row is never touched, so this
-- can never clobber a session-level override). Nothing here changes occupancy: venue_id/pitch_id/
-- start_time/end_time/duration_minutes are computed exactly as before.
-- ---------------------------------------------------------------------------------------------------
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
  if not internal.can_manage_club_training(v_plan.club_id) then
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
      venue_id, pitch_id, source, status, further_notes, created_by, updated_by
    )
    select
      v_plan.club_id, v_plan.team_id, v_plan.id, r.schedule_rule_id, v_plan.season_id,
      r.occurrence_date, r.occurrence_date, r.start_time, (r.start_time + make_interval(mins => r.duration_minutes))::time, r.duration_minutes,
      v_plan.preferred_venue_id, v_plan.preferred_pitch_id, 'AUTOMATIC_PLAN', 'PLANNED', v_plan.default_session_notes, auth.uid(), auth.uid()
    from resolved r
    on conflict (training_plan_id, occurrence_date) where training_plan_id is not null and occurrence_date is not null and status <> 'CANCELLED' do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  return query select v_created, (v_total - v_created);
end;
$function$;

revoke all on function public.generate_training_plan_sessions(uuid) from public, anon;
grant execute on function public.generate_training_plan_sessions(uuid) to authenticated;

do $$
begin
  if has_function_privilege('anon', 'public.save_training_plan(uuid, uuid, uuid, text, uuid, uuid, uuid, jsonb, integer, integer, text)', 'EXECUTE') then
    raise exception 'save_training_plan must not be executable by anon';
  end if;
  if has_function_privilege('anon', 'public.generate_training_plan_sessions(uuid)', 'EXECUTE') then
    raise exception 'generate_training_plan_sessions must not be executable by anon';
  end if;
end $$;
