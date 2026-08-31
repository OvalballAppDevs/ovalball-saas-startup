-- Closes two gaps found while wiring up the real signup-completion flow
-- (auth callback -> profiles/club_claims/club_join_requests/directory_requests):
--
-- 1. directory_requests had no rugby_code column, even though signup STEP 3
--    collects it before "Can't find your club?" is ever reached -- without
--    this, that answer would be silently dropped instead of recorded.
-- 2. Neither club_claims nor directory_requests had anywhere to record the
--    team categories a claimant/proposer ticks ("which teams does your club
--    run?") -- proposed_teams stores that as the same shape the signup UI
--    already uses (an array of {category, additionalLetters}), for a Site
--    Admin to seed the real `teams` rows from once a claim/proposal is
--    approved. It is provisional, pre-approval data, not the approved
--    `teams` table itself -- no team row is created by writing here.
--
-- Neither change touches club_directory, clubs, or the claim-workflow
-- status/approval columns themselves.

alter table public.club_claims
  add column proposed_teams jsonb not null default '[]'::jsonb;

comment on column public.club_claims.proposed_teams is
  'Provisional "which teams does your club run" answer from signup STEP 3, shaped like [{category, additionalLetters}]. Reference data for a Site Admin seeding real teams rows on approval -- never itself a teams row.';

alter table public.directory_requests
  add column rugby_code text check (rugby_code in ('union', 'league')),
  add column proposed_teams jsonb not null default '[]'::jsonb;

comment on column public.directory_requests.rugby_code is
  'Collected in signup STEP 3 before the "Can''t find your club?" path -- nullable only because existing rows (none yet) predate this column, not because a new submission should omit it.';

comment on column public.directory_requests.proposed_teams is
  'Same shape and purpose as club_claims.proposed_teams -- see that column comment.';

-- club_claims/club_join_requests/directory_requests previously had no
-- SELECT policy for the person who submitted them -- only
-- *_select_admin/scoped (Site Admin, or an existing Club Admin for join
-- requests) could read any row at all. That silently blocked the required
-- pending-claimant UX ("see the status of their claim"): the claimant
-- themselves could not even see their own submission. These mirror the
-- existing club_memberships_select_scoped pattern (self OR admin), and
-- grant nothing beyond read access to a user's own rows.

create policy club_claims_select_self on public.club_claims
  for select
  using (claimant_user_id = (select auth.uid()) or internal.is_site_admin());

create policy club_join_requests_select_self on public.club_join_requests
  for select
  using (
    requesting_user_id = (select auth.uid())
    or internal.is_site_admin()
    or internal.is_club_admin(club_id)
  );

create policy directory_requests_select_self on public.directory_requests
  for select
  using (submitted_by = (select auth.uid()) or internal.is_site_admin());
