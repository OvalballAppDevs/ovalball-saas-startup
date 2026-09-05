-- Side Project 1 integration (SIDE_PROJECT_1_FINAL_INTEGRATION_2026_09_05),
-- Phase 2 step 1: widen player_team_memberships.status from
-- ('active','ended') to ('active','pending','ended').
--
-- Phase 1 audit independently verified this is safe against every existing
-- Main consumer: all 7 status-filtering sites in Main's migrations
-- (senior-cohort graduation, fixture call-ups, team-type-deactivation-
-- impact, narrow capability model, call-up decide/dispensation-linking)
-- use positive `status = 'active'` matching, never the dangerous inverse
-- `status != 'ended'` that would silently treat 'pending' as active. This
-- migration only widens the constraint; it does not touch any existing
-- row or any consumer -- 'pending' is introduced here, actually produced
-- by the self-service Add-Child flow added in a later migration.
alter table public.player_team_memberships
  drop constraint player_team_memberships_status_check;
alter table public.player_team_memberships
  add constraint player_team_memberships_status_check
  check (status in ('active', 'pending', 'ended'));

comment on column public.player_team_memberships.status is
  'active: real, current team member -- the only status every existing Main consumer (eligibility, call-ups, dispensations, graduation, capability checks) matches on via status = ''active''. pending: self-service Add-a-Child join awaiting team.roster.manage/club.roster.manage approval -- not yet a real team member; excluded from every active-status consumer by construction since none of them match on it. ended: historical, no longer a member.';
