-- team_permissions had select/insert/update RLS (20260830143512_rls_policies_
-- and_triggers.sql) but no delete policy at all -- RLS denies every command
-- with no matching policy, so nobody, not even Site Admin, could remove a
-- team assignment. A real gap, not hypothetical: the People/Teams admin
-- experience needs "remove David Smith from U12 A Coach" to actually work.
-- Same shape as team_permissions_insert_scoped/update_scoped (and the
-- sibling invitation_teams_delete_scoped) -- Site Admin or that membership's
-- club's Club Admin only, never delegated to a Team Admin/Coach.
create policy team_permissions_delete_scoped on public.team_permissions for delete
  using (
    internal.is_site_admin()
    or internal.is_club_admin((select club_id from public.club_memberships where id = membership_id))
  );
