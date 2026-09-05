-- Migrate Schedule Training's real DB-level authorization boundary
-- (internal.can_manage_training, used by create_training_session and
-- cancel_training_session) onto the canonical scoped capability engine --
-- Master Architecture Pass reconciliation item "Migrate the Calendar
-- 'Schedule training' button/action to the canonical capability engine
-- (currently still uses hasClubFixtureAuthority || manageableTeamIds.size
-- > 0, functionally correct but not expressible as a capability)".
--
-- No new capability was needed: fixture.create already exists with
-- applicable_scopes {site,club,team}, and its role-bundle defaults
-- (has_club_role_capability / has_team_role_capability) already encode
-- EXACTLY the same predicates can_manage_training used directly
-- (CLUB_ADMIN/FIXTURE_SECRETARY at club scope; CLUB_ADMIN-via-team or
-- team_admin/coach/manager at team scope) -- confirmed by reading both
-- definitions before writing this migration. Routing can_manage_training
-- through internal.has_capability('fixture.create', ...) therefore
-- preserves default behaviour exactly for every account with no
-- capability_overrides row, while making Schedule Training's own DB
-- enforcement (not just the UI "+"/button affordance) respect a Site
-- Admin grant/deny override on fixture.create for the first time.
create or replace function internal.can_manage_training(p_club_id uuid, p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    internal.has_capability('fixture.create', 'club', p_club_id, null)
    or (
      p_team_id is not null
      and internal.has_capability('fixture.create', 'team', p_club_id, p_team_id)
    );
$$;
