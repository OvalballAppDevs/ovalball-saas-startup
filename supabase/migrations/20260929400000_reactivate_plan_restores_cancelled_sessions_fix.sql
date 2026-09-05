-- Bug fix, caught live via browser verification (Section 24 deactivate/
-- reactivate round trip): reactivate_training_plan called
-- generate_training_plan_sessions, which is correctly idempotent via
-- ON CONFLICT (schedule_rule_id, occurrence_date) DO NOTHING -- but that
-- means it silently skipped every occurrence deactivate_training_plan had
-- just marked CANCELLED, because the row already existed. The plan came
-- back ACTIVE but every one of its future sessions stayed permanently
-- CANCELLED with no way back except a manual per-session override --
-- reactivation was a no-op in practice.
--
-- Fix: restore any future, non-overridden CANCELLED session belonging to
-- this plan back to PLANNED before regenerating. This is safe to do
-- unconditionally because is_overridden=false is exactly the set
-- deactivate_training_plan itself is willing to touch (Section 23/25's
-- own invariant) -- a session a Club Admin genuinely cancelled
-- individually (e.g. a real weather cancellation) always has
-- is_overridden=true via override_training_session, so it is never
-- touched by either deactivate or this reactivate fix.
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

  update public.training_sessions
  set status = 'PLANNED', cancellation_reason = null
  where training_plan_id = p_plan_id
    and occurrence_date >= current_date
    and is_overridden = false
    and status = 'CANCELLED';

  perform public.generate_training_plan_sessions(p_plan_id);
end;
$function$;
