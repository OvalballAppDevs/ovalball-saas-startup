-- Club Settings Consolidation + Central Mutation Capabilities pass --
-- direct cross-club tampering test (supabase/tests/club_settings_capability_
-- security.sql, test 10) found a genuine, live-confirmed privilege-
-- escalation gap: team_permissions_insert_scoped/update_scoped/
-- delete_scoped (20260830143512_rls_policies_and_triggers.sql,
-- 20260831150000_team_permissions_delete.sql) only ever checked that the
-- actor administers the CLUB THAT OWNS membership_id -- never that
-- team_id belongs to that SAME club. A Club Admin at Club A could
-- therefore pair their own (legitimate) membership_id with an arbitrary
-- team_id at Club B and insert a team_permissions row granting
-- themselves team_admin/coach/manager there. internal.can_manage_team()
-- trusts team_permissions.team_id without cross-checking the referenced
-- membership's club, so this row then genuinely granted real team-
-- management authority over a completely unrelated club's team --
-- confirmed live: after the insert, can_manage_team(<other club's team>)
-- returned true for the attacking actor.
--
-- Fix: every write policy on team_permissions must now also require that
-- teams.club_id (for the target team_id) equals club_memberships.club_id
-- (for the referenced membership_id). A legitimate assignment already
-- always satisfies this (assignTeamMember only ever offers a club's own
-- members for that club's own teams) -- this closes the RLS-layer gap
-- that let a tampered client bypass that app-level assumption.

drop policy if exists team_permissions_insert_scoped on public.team_permissions;
create policy team_permissions_insert_scoped on public.team_permissions for insert
  with check (
    internal.is_site_admin()
    or (
      internal.is_club_admin((select club_id from public.club_memberships where id = membership_id))
      and (select club_id from public.club_memberships where id = membership_id) = (select club_id from public.teams where id = team_id)
    )
  );

drop policy if exists team_permissions_update_scoped on public.team_permissions;
create policy team_permissions_update_scoped on public.team_permissions for update
  using (
    internal.is_site_admin()
    or (
      internal.is_club_admin((select club_id from public.club_memberships where id = membership_id))
      and (select club_id from public.club_memberships where id = membership_id) = (select club_id from public.teams where id = team_id)
    )
  );

drop policy if exists team_permissions_delete_scoped on public.team_permissions;
create policy team_permissions_delete_scoped on public.team_permissions for delete
  using (
    internal.is_site_admin()
    or (
      internal.is_club_admin((select club_id from public.club_memberships where id = membership_id))
      and (select club_id from public.club_memberships where id = membership_id) = (select club_id from public.teams where id = team_id)
    )
  );
