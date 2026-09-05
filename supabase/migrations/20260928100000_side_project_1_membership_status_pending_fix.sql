-- Fixes a bug in the immediately preceding migration
-- (20260928000000_side_project_1_membership_status_pending.sql): widening
-- the status enum to include 'pending' without also widening
-- player_team_memberships_ended_requires_status left that second
-- constraint still reading "status = 'active' OR ended_at IS NOT NULL",
-- which rejects every 'pending' row (a pending row is neither active nor
-- ended). Caught live: a direct insert of a 'pending' row failed with
-- "violates check constraint player_team_memberships_ended_requires_status"
-- before this fix.
alter table public.player_team_memberships
  drop constraint player_team_memberships_ended_requires_status;
alter table public.player_team_memberships
  add constraint player_team_memberships_ended_requires_status
  check (status in ('active', 'pending') or ended_at is not null);
