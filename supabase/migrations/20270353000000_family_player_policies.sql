-- Identity/Auth Slice 4a (contract): family and player table policies read the canonical capability decision.
--
-- Applied after the application that reads staff player data through public.player_staff_view is live
-- (20270352000000 created the view; the deployed application before it read whole player rows). Phase 2
-- AA.3 row 4a: can_manage_player, the deprecated club.guardians.manage / team.guardians.invite keys and the
-- guardian branches of is_site_admin leave the family and player tables. Policies stay stricter or equal
-- (AK Slice 4 rollback rule) except where Phase 2 names the change: staff no longer read a player's date of
-- birth from the base table (J.6 player_staff_view).
--
-- Each policy puts a cheap relationship test in front of the decision so that a list query never runs the
-- decision for rows the reader has no relationship with; site capabilities are evaluated once per statement.

-- ---------------------------------------------------------------------------------------------------------
-- players
-- ---------------------------------------------------------------------------------------------------------

drop policy if exists players_select on public.players;
drop policy if exists players_select_pending_roster_review on public.players;

create policy players_select on public.players
  for select to authenticated
  using (
    (select internal.has_site_capability('site.users.view'))
    -- CASE fixes the order: the cheap self/guardian prefilter runs first, so the capability decision is taken only
    -- for the handful of rows it admits (an AND lets the planner cost the function first, for every row).
    or case when user_id = (select auth.uid())
                 or exists (select 1 from public.guardians g
                            where g.player_id = players.id and g.guardian_user_id = (select auth.uid()) and g.state = 'ACTIVE')
            then internal.can_player_as_family('player.profile.view', id)
            else false end
  );

-- ---------------------------------------------------------------------------------------------------------
-- guardians
-- ---------------------------------------------------------------------------------------------------------

-- The players whose guardians this person administers: an ACTIVE or PENDING place at a club where they hold an
-- ACTIVE membership and family.relationship.approve or .remove, or at a team there where they hold
-- family.relationship.approve. Decided once per club and per team, never once per guardian row.
create or replace function internal.administered_guardian_player_ids()
returns setof uuid
language sql
stable
security definer
set search_path = ''
as $$
  with my_clubs as materialized (
    select cm.club_id,
      internal.can('family.relationship.approve', 'club', cm.club_id, null, null)
        or internal.can('family.relationship.remove', 'club', cm.club_id, null, null) as club_wide
    from public.club_memberships cm
    where cm.user_id = internal.effective_person() and cm.state = 'ACTIVE'
  ),
  my_teams as materialized (
    select t.id as team_id
    from public.teams t
    join my_clubs mc on mc.club_id = t.club_id and not mc.club_wide
    where internal.can('family.relationship.approve', 'team', null, t.id, null)
  )
  select distinct ptm.player_id
  from public.player_team_memberships ptm
  join public.teams t on t.id = ptm.team_id
  where ptm.state in ('ACTIVE', 'PENDING')
    and (t.club_id in (select club_id from my_clubs where club_wide) or ptm.team_id in (select team_id from my_teams));
$$;

create or replace function internal.can_administer_player_guardians(p_player_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_player_id is not null and p_player_id in (select internal.administered_guardian_player_ids());
$$;

drop policy if exists guardians_select on public.guardians;
create policy guardians_select on public.guardians
  for select to authenticated
  using (
    guardian_user_id = (select auth.uid())
    or (select internal.has_site_capability('site.family.manage'))
    or player_id in (select internal.administered_guardian_player_ids())
  );

-- ---------------------------------------------------------------------------------------------------------
-- guardian_link_requests
-- ---------------------------------------------------------------------------------------------------------

drop policy if exists guardian_link_requests_select_approver on public.guardian_link_requests;
create policy guardian_link_requests_select_approver on public.guardian_link_requests
  for select to authenticated
  using (
    (select internal.has_site_capability('site.family.manage'))
    or internal.can_decide_guardian_link_request(id)
  );

-- ---------------------------------------------------------------------------------------------------------
-- guardian_player_permissions (written only through set_guardian_player_permission)
-- ---------------------------------------------------------------------------------------------------------

drop policy if exists guardian_player_permissions_insert_scoped on public.guardian_player_permissions;
drop policy if exists guardian_player_permissions_select_scoped on public.guardian_player_permissions;
create policy guardian_player_permissions_select_scoped on public.guardian_player_permissions
  for select to authenticated
  using (
    guardian_user_id = (select auth.uid())
    or (select internal.has_site_capability('site.family.manage'))
    or case when exists (select 1 from public.guardians g
                         where g.player_id = guardian_player_permissions.player_id and g.guardian_user_id = (select auth.uid()) and g.state = 'ACTIVE')
            then internal.can_player_as_family('family.permission.manage', player_id)
            else false end
    or exists (select 1 from public.players pl
               where pl.id = guardian_player_permissions.player_id and pl.user_id = (select auth.uid()))
  );

-- ---------------------------------------------------------------------------------------------------------
-- player_account_invitations (issued only through invite_player_account)
-- ---------------------------------------------------------------------------------------------------------

drop policy if exists player_account_invitations_select_scoped on public.player_account_invitations;
create policy player_account_invitations_select_scoped on public.player_account_invitations
  for select to authenticated
  using (
    invited_by = (select auth.uid())
    or (select internal.has_site_capability('site.family.manage'))
    or case when exists (select 1 from public.guardians g
                         where g.player_id = player_account_invitations.player_id and g.guardian_user_id = (select auth.uid()) and g.state = 'ACTIVE')
            then internal.can('player.account.invite', 'child', null, null, player_id)
            else false end
  );

-- ---------------------------------------------------------------------------------------------------------
-- player_duplicate_reviews (resolved only through the resolve_player_duplicate_review_* RPCs)
-- ---------------------------------------------------------------------------------------------------------

drop policy if exists player_duplicate_reviews_select_scoped on public.player_duplicate_reviews;
drop policy if exists player_duplicate_reviews_update_scoped on public.player_duplicate_reviews;
create policy player_duplicate_reviews_select_scoped on public.player_duplicate_reviews
  for select to authenticated
  using (
    (select internal.has_site_capability('site.family.manage'))
    or exists (select 1 from public.teams t
               join public.club_memberships cm on cm.club_id = t.club_id and cm.user_id = (select auth.uid()) and cm.state = 'ACTIVE'
               where t.id = player_duplicate_reviews.team_id
                 and internal.can('family.duplicate.resolve', 'club', t.club_id, null, null))
  );

-- ---------------------------------------------------------------------------------------------------------
-- guardian_invitations (issued and accepted only through RPCs until Slice 5)
-- ---------------------------------------------------------------------------------------------------------

drop policy if exists guardian_invitations_insert_scoped on public.guardian_invitations;
drop policy if exists guardian_invitations_update_scoped on public.guardian_invitations;
drop policy if exists guardian_invitations_select_scoped on public.guardian_invitations;
create policy guardian_invitations_select_scoped on public.guardian_invitations
  for select to authenticated
  using (
    invited_by_user_id = (select auth.uid())
    or (select internal.has_site_capability('site.invitations.manage'))
    or case when exists (select 1 from public.club_memberships cm
                         where cm.club_id = guardian_invitations.club_id and cm.user_id = (select auth.uid()) and cm.state = 'ACTIVE')
            then internal.can('family.invitation.create', 'team', null, team_id, null)
                 or internal.can('family.invitation.create', 'club', club_id, null, null)
            else false end
  );

revoke all on function internal.can_administer_player_guardians(uuid) from public, anon;
grant execute on function internal.can_administer_player_guardians(uuid) to authenticated;
revoke all on function internal.administered_guardian_player_ids() from public, anon;
grant execute on function internal.administered_guardian_player_ids() to authenticated;
