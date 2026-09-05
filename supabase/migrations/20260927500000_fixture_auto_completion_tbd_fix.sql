-- Live regression finding: internal.complete_overdue_fixtures() joined
-- strictly on f.home_team_id to find the club whose timezone decides
-- whether a fixture's day has genuinely ended. home_team_id is NULL for
-- a genuinely undetermined-side fixture (home_away = 'TBD') -- so a TBD
-- fixture whose date had long passed stayed stuck at To Be Determined
-- forever, never resolving to Completed. Falls back to the OWNING team's
-- club (owning_team_id is never null) when the home side itself isn't
-- yet resolved -- the requesting club is still a real, known club, so its
-- timezone is the correct fallback for "has this day ended" even before
-- home/away is settled.
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
  from public.teams rt
  join public.clubs rc on rc.id = rt.club_id
  where rt.id = coalesce(f.home_team_id, f.owning_team_id)
    and f.status in ('Planned', 'Booked', 'To Be Determined')
    and (now() at time zone rc.timezone)::date > f.kickoff_date;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

comment on function internal.complete_overdue_fixtures is
  'Idempotent: resolves every ordinary active fixture (Planned/Booked/To Be Determined) whose calendar day has fully ended -- in its HOME club''s timezone when the home side is resolved, else the OWNING club''s timezone (home_team_id is null for a genuinely undetermined-side/TBD fixture, but owning_team_id never is) -- to Completed. Never touches Cancelled, already-Completed, or the three legacy CSV-import statuses. Scheduled via pg_cron; also callable on demand via public.run_fixture_completion_check().';
