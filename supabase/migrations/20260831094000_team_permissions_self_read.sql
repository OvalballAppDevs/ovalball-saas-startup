-- team_permissions_select_scoped (20260830143512_rls_policies_and_triggers.sql,
-- already applied to remote, never edited in place) only lets Site Admin or
-- that club's CLUB_ADMIN read a team_permissions row -- the person the row
-- is actually ABOUT could not see their own team assignment. That's a real
-- gap, not a hypothetical one: a Team Admin/Coach/Parent's own nav/dashboard
-- has to read their own team_permissions rows to know which teams they're
-- scoped to, and it could not, before this migration. Adds a self-read
-- clause alongside the existing admin clause; grants nothing new to anyone
-- else.

drop policy team_permissions_select_scoped on public.team_permissions;

create policy team_permissions_select_scoped on public.team_permissions for select
  using (
    internal.is_site_admin()
    or internal.is_club_admin((select club_id from public.club_memberships where id = membership_id))
    or exists (
      select 1 from public.club_memberships cm
      where cm.id = membership_id and cm.user_id = (select auth.uid())
    )
  );
