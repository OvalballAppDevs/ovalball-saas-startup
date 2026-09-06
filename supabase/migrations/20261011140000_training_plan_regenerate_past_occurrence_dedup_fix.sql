-- Bug fix, found via a live idempotency audit (POST-SIDE2 INTEGRATION --
-- DUPLICATE TRAINING SESSION ROOT-CAUSE AUDIT, 2026-09-06), run to check
-- whether the automatic Training Plan generation path was the source of an
-- unrelated duplicate-training-session finding on Burnley RUFC's U13 C team.
-- It was NOT (that finding traced to a test-isolation issue in
-- season_rollover.sql, fixed separately) -- but the audit's own idempotency
-- proof (create a plan, save it again unchanged) surfaced a real, distinct,
-- narrower defect in this path, reproduced live before this fix:
--
-- save_training_plan's edit branch cancels only FUTURE, non-overridden
-- AUTOMATIC_PLAN sessions (`occurrence_date >= current_date`) before
-- deleting and recreating the plan's schedule rules with brand-new row ids,
-- then calls generate_training_plan_sessions to regenerate the plan's full
-- resolved occurrence set (which, by design, spans the whole season --
-- including dates already in the past relative to today, per
-- resolve_training_plan_occurrence_dates). generate_training_plan_sessions'
-- own duplicate guard was `on conflict (schedule_rule_id, occurrence_date)
-- do nothing` -- a key that can never collide across a save, because the
-- schedule_rule_id it's keyed on is always freshly minted on every edit.
-- For a FUTURE occurrence this was harmless (the old row was already
-- explicitly cancelled first, so exactly one live row survives per date --
-- the intended "reconcile, never silently rewrite history" behaviour). For
-- a PAST occurrence -- deliberately never cancelled, so real history is
-- never touched -- the old live row was left untouched AND a second, live,
-- genuinely duplicate row for the same past date was inserted alongside it
-- on every single re-save of a plan whose season includes any elapsed date.
--
-- Fix: the real, stable identity for "has this plan already generated a
-- live occurrence for this date" is (training_plan_id, occurrence_date)
-- restricted to non-cancelled rows -- not (schedule_rule_id,
-- occurrence_date), which churns on every edit. Enforced as a DB-level
-- invariant (a partial unique index, safe to add now that a live check
-- confirmed zero existing violations) and used as generate_training_plan_
-- sessions' own conflict target, replacing the schedule_rule_id-keyed one.
-- This fixes both the past-occurrence duplication (a live non-cancelled row
-- already exists for that date -> skipped) and continues to behave
-- identically for future occurrences (the old row is already CANCELLED at
-- that point, so it does not count as "existing" under this new key,
-- exactly matching the existing cancel-then-replace design) and for
-- reactivate_training_plan (which restores CANCELLED rows to PLANNED
-- before calling this function, so those dates already have a live row and
-- are correctly skipped, same net effect as before, now for the correct
-- reason).

create unique index training_sessions_plan_occurrence_active_idx
  on public.training_sessions (training_plan_id, occurrence_date)
  where training_plan_id is not null and occurrence_date is not null and status <> 'CANCELLED';

comment on index public.training_sessions_plan_occurrence_active_idx is 'At most one non-cancelled generated session per (training_plan_id, occurrence_date) -- the real identity of an automatic occurrence, stable across a Training Plan edit even though schedule_rule_id is re-minted on every save. See this migration''s own header for the bug this closes.';

-- Second, related fix surfaced by the new invariant above: reactivate_
-- training_plan (20261011040000) restores EVERY future, non-overridden
-- CANCELLED session for the plan back to PLANNED in one indiscriminate
-- UPDATE, keyed only on training_plan_id -- with no regard for WHY a row
-- was cancelled. A plan edited more than once accumulates distinct
-- CANCELLED rows for the same occurrence_date for two different reasons:
-- (a) save_training_plan's own edit-reconcile cancelling a date whose rule
-- was later removed entirely (a deliberate configuration change -- that
-- date should stay cancelled, not come back from a later deactivate/
-- reactivate of the whole plan), and (b) deactivate_training_plan cancelling
-- every still-current date when the plan itself is paused (those SHOULD
-- come back on reactivation). The original UPDATE could not tell these
-- apart and would restore both -- multiple CANCELLED rows sharing one date
-- could each get flipped to PLANNED, producing exactly the kind of
-- duplicate the new invariant now correctly rejects instead of silently
-- allowing.
--
-- Fix: restore only the most-recently-cancelled row for a date, and only
-- when that date is still part of the plan's CURRENT resolved schedule
-- (internal.resolve_training_plan_occurrence_dates) -- i.e. only dates a
-- live schedule rule still actually covers today. A date whose rule was
-- removed by an intervening edit is correctly left as permanent history,
-- never resurrected by reactivating the plan as a whole.
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

  with valid_dates as (
    select distinct occurrence_date from internal.resolve_training_plan_occurrence_dates(p_plan_id)
  ),
  latest_cancelled as (
    select distinct on (ts.occurrence_date) ts.id
    from public.training_sessions ts
    join valid_dates vd on vd.occurrence_date = ts.occurrence_date
    where ts.training_plan_id = p_plan_id
      and ts.occurrence_date >= current_date
      and ts.is_overridden = false
      and ts.status = 'CANCELLED'
    order by ts.occurrence_date, ts.updated_at desc
  )
  update public.training_sessions
  set status = 'PLANNED', cancellation_reason = null
  where id in (select id from latest_cancelled);

  perform public.generate_training_plan_sessions(p_plan_id);
end;
$function$;

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
    on conflict (training_plan_id, occurrence_date) where training_plan_id is not null and occurrence_date is not null and status <> 'CANCELLED' do nothing
    returning 1
  )
  select count(*) into v_created from ins;

  return query select v_created, (v_total - v_created);
end;
$function$;
