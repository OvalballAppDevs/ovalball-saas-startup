-- `reactivate_training_plan` restored the most recent CANCELLED, non-overridden ghost row for every
-- valid occurrence date, without checking whether that date already carries a LIVE session -- which
-- it can, when an occurrence was individually overridden (`override_training_session`, "This Session
-- Only") after the plan-wide cancellation that created the ghost. Restoring the ghost then collides
-- with the partial unique index on (training_plan_id, occurrence_date) for non-cancelled rows and the
-- whole reactivation fails. An individually overridden session is exactly the kind of deliberate
-- exception a later plan-wide operation must never overwrite (the same rule `save_training_plan` and
-- `deactivate_training_plan` already honour via their own `is_overridden = false` filter) -- this
-- extends that same protection to reactivation, by never restoring a ghost onto a date that already
-- has a live session.
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
  if not internal.can_manage_club_training(v_plan.club_id) then
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
      and not exists (
        select 1 from public.training_sessions live
        where live.training_plan_id = p_plan_id
          and live.occurrence_date = ts.occurrence_date
          and live.status <> 'CANCELLED'
      )
    order by ts.occurrence_date, ts.updated_at desc
  )
  update public.training_sessions
  set status = 'PLANNED', cancellation_reason = null
  where id in (select id from latest_cancelled);

  perform public.generate_training_plan_sessions(p_plan_id);
end;
$function$;

revoke all on function public.reactivate_training_plan(uuid) from public;
grant execute on function public.reactivate_training_plan(uuid) to authenticated;

comment on function public.reactivate_training_plan is 'Reactivates a training plan: flips status back to ACTIVE, restores the most recent cancelled non-overridden ghost session for each valid occurrence date UNLESS that date already carries a live (non-cancelled) session -- an individually overridden occurrence is never displaced -- then regenerates any genuinely missing sessions.';
