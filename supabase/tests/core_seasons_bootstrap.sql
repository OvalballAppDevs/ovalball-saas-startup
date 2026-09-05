-- Bootstrap: the canonical test Season records every other regression file
-- implicitly depends on (fixture creation resolves season_id from
-- kickoff_date via internal.resolve_season_for_date -- see
-- internal.capture_fixture_team_snapshot, 20260902150000). This file must
-- run FIRST in run_regression.sh, before any file that creates a dated
-- fixture: previously these rows were only created by season_rollover.sql
-- partway through the suite, so every fixture created by an earlier file
-- was permanently stamped season_id = NULL (nothing ever backfills it
-- retroactively). Identical rows/ids to season_rollover.sql's own insert
-- (on conflict do nothing there), so this is purely a run-order fix, not a
-- new season definition.

\set ON_ERROR_STOP off
\pset pager off

do $$
begin
  insert into public.seasons (id, name, starts_on, ends_on, pre_season_starts_on, rugby_code) values
    ('98000000-0000-0000-0000-000000000101', 'Union 2025/26 Test', '2025-09-01', '2026-05-31', '2025-06-01', 'union'),
    ('98000000-0000-0000-0000-000000000102', 'Union 2026/27 Test', '2026-09-01', '2027-05-31', '2026-06-01', 'union'),
    ('98000000-0000-0000-0000-000000000103', 'League 2026 Test', '2026-03-01', '2026-10-31', '2025-11-01', 'league'),
    ('98000000-0000-0000-0000-000000000104', 'League 2027 Test', '2027-03-01', '2027-10-31', '2026-11-01', 'league'),
    ('98000000-0000-0000-0000-000000000105', 'League 2028 Test', '2028-03-01', '2028-10-31', '2027-11-01', 'league')
  on conflict (id) do nothing;
end $$;
