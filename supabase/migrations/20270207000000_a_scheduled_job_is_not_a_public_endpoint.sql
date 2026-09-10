-- =====================================================================
-- A SCHEDULED JOB IS NOT A PUBLIC ENDPOINT
--
-- Found by the cross-product event-integrity audit, sweeping for the pattern
-- the training-visibility fix had just exposed: a SECURITY DEFINER function
-- that anyone may call and that checks nothing.
--
-- Ovalball has five cron-style wrappers. Four of them gate their caller:
--
--   run_fixture_completion_check              GATED
--   run_season_transition_check               GATED
--   run_trial_expiry_check                    GATED
--   run_fixture_attendance_invitation_check   GATED
--   reconcile_overdue_fixture_results         NO GATE   <-- this one
--
-- reconcile_overdue_fixture_results is SECURITY DEFINER, it WRITES (it
-- finalises fixture results, mirrors the result onto the paired fixture, and
-- inserts an audit row attributed to the original submitter), and its EXECUTE
-- privilege was left at the default, which is PUBLIC. So an unauthenticated
-- caller could invoke the platform's result-reconciliation job at will.
--
-- WHAT IT COULD NOT DO, stated honestly so the severity is not overplayed: it
-- takes no arguments, it cannot set a score, and it only touches fixtures
-- whose dispute deadline has ALREADY passed -- so it cannot cut short the
-- 24-hour window or invent a result. What it could do is run the platform's
-- scheduled work on demand, repeatedly, from anywhere.
--
-- THE FIX IS THE SHAPE THE OTHER FOUR ALREADY USE: the job stays callable by
-- the scheduler and by a Site Admin who needs to run it by hand, and by nobody
-- else. Revoking alone would be enough for PostgREST, but the in-body check is
-- what makes the rule survive a future re-grant -- the same belt-and-braces
-- the sibling wrappers have.
-- =====================================================================

revoke execute on function public.reconcile_overdue_fixture_results() from public;
revoke execute on function public.reconcile_overdue_fixture_results() from anon;
revoke execute on function public.reconcile_overdue_fixture_results() from authenticated;

create or replace function public.reconcile_overdue_fixture_results()
returns integer
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_count integer := 0;
  r record;
begin
  -- THE GATE. auth.uid() is null when pg_cron runs this, which is the
  -- scheduler's own legitimate path; a request arriving through PostgREST
  -- always carries an identity, and that identity must be a Site Admin.
  if auth.uid() is not null and not internal.is_site_admin() then
    raise exception 'Only a Site Admin may run fixture result reconciliation by hand.' using errcode = '42501';
  end if;

  for r in
    select id, mirror_fixture_id, home_score, away_score, result_submitted_by
    from public.fixtures
    where result_status = 'awaiting_confirmation' and result_deadline_at is not null and result_deadline_at < now()
    for update skip locked
  loop
    update public.fixtures
    set result_status = 'final', result_confirmed_by = r.result_submitted_by, result_confirmed_at = now(), result_deadline_at = null
    where id = r.id;
    if r.mirror_fixture_id is not null then
      update public.fixtures
      set result_status = 'final', result_confirmed_by = r.result_submitted_by, result_confirmed_at = now(), result_deadline_at = null
      where id = r.mirror_fixture_id;
    end if;
    insert into public.fixture_result_submissions (fixture_id, kind, home_score, away_score, submitted_by, note)
    values (r.id, 'auto_finalized', r.home_score, r.away_score, r.result_submitted_by, 'Automatically finalized -- no dispute within 24 hours.');
    perform internal.fixture_result_system_event(r.id, r.result_submitted_by, format('Result automatically finalized after 24 hours with no dispute: %s - %s.', r.home_score, r.away_score));
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$function$;

revoke execute on function public.reconcile_overdue_fixture_results() from public;
revoke execute on function public.reconcile_overdue_fixture_results() from anon;
revoke execute on function public.reconcile_overdue_fixture_results() from authenticated;
grant execute on function public.reconcile_overdue_fixture_results() to service_role;

comment on function public.reconcile_overdue_fixture_results() is
  'Scheduled job: finalises fixture results whose dispute window has expired. Callable by the scheduler and by a Site Admin; never by an ordinary or anonymous caller.';
