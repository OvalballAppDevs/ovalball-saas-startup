-- CANONICAL FIXTURE MANAGEMENT / PITCH SYNC pass, Sections 13-16/41:
-- once a fixture's calendar day has genuinely passed, its ordinary active
-- scheduling status (Planned/Booked/To Be Determined) should resolve to
-- Completed automatically -- never dependent on a Club Admin happening to
-- open Fixture Management that day (a page-load useEffect is explicitly
-- NOT this: it would silently do nothing for a club that never revisits
-- an old date). Follows the exact same pattern this project already
-- established for automatic season transitions
-- (20260924850000_automatic_season_transition.sql): an idempotent
-- internal.* engine, a callable public.*_check() for a site admin to run
-- on demand or verify without waiting on the clock, and a local-only
-- pg_cron schedule.
--
-- Timezone correctness (explicit product requirement -- never complete a
-- fixture at UTC midnight if that's still evening in the club's own
-- timezone): compared against the HOME club's own clubs.timezone (the
-- same per-club IANA column the season-transition engine already relies
-- on), since a fixture's calendar day is genuinely over exactly when that
-- day has ended where the match is actually played.
--
-- Terminal-state safety: only fixtures currently Planned, Booked, or To
-- Be Determined are ever touched. Cancelled and Completed are already
-- terminal; the three legacy CSV-import-only statuses (Annual Holiday,
-- Festival, Lancashire Cup) are historical record-keeping values, never
-- something this automation should reinterpret as "completed activity".
-- Idempotent by construction: a fixture already Completed no longer
-- matches the status filter on a second run, so re-running produces zero
-- rows and no duplicate audit/event noise.
create or replace function internal.complete_overdue_fixtures()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_count integer;
begin
  update public.fixtures f
  set status = 'Completed', updated_at = now()
  from public.teams ht
  join public.clubs hc on hc.id = ht.club_id
  where ht.id = f.home_team_id
    and f.status in ('Planned', 'Booked', 'To Be Determined')
    and (now() at time zone hc.timezone)::date > f.kickoff_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function internal.complete_overdue_fixtures is
  'Idempotent: resolves every ordinary active fixture (Planned/Booked/To Be Determined) whose calendar day has fully ended in its HOME club''s own timezone to Completed. Never touches Cancelled, already-Completed, or the three legacy CSV-import statuses. Scheduled via pg_cron below; also callable on demand via public.run_fixture_completion_check().';

-- Manual/test trigger -- a site admin can run the exact same engine on
-- demand (verifying it, or catching a club up immediately) without
-- waiting for or faking pg_cron's own clock, mirroring
-- public.run_season_transition_check().
create or replace function public.run_fixture_completion_check()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not internal.is_site_admin() then
    raise exception 'Only a site admin may manually trigger the fixture completion check.' using errcode = '42501';
  end if;
  return internal.complete_overdue_fixtures();
end;
$$;

grant execute on function public.run_fixture_completion_check() to authenticated;

-- Local-only scheduling: on the real deployed system, provisioning
-- pg_cron (or an equivalent scheduled Edge Function) on the REMOTE
-- Supabase project is a deployment step for whoever operates that
-- project -- this migration only ever touches the local database,
-- consistent with this whole pass's standing "no remote Supabase"
-- constraint.
create extension if not exists pg_cron;
select cron.schedule('complete-overdue-fixtures', '*/15 * * * *', $$select internal.complete_overdue_fixtures()$$);
