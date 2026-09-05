-- Closes a real privilege-escalation gap left by 20260831260000: the
-- original site_admins_all_site_admin policy (from the base migration set,
-- 20260830143512) grants INSERT/UPDATE/DELETE on public.site_admins to
-- ANY active Site Admin, including the new restricted profiles
-- (read_only, message_moderator, etc). Since RLS -- not application code --
-- is this project's actual security boundary throughout (every admin
-- server action says so explicitly), a restricted Site Admin could still
-- grant themselves admin_role='full' by calling the REST API directly,
-- bypassing both requireSiteAdmin's new allowedProfiles gate and the
-- invitation-only flow entirely. This directly contradicts the brief's
-- "never letting a restricted Site Admin grant themselves additional
-- global powers." Split the single ALL policy into SELECT (any active
-- Site Admin, unchanged -- the roster itself is legitimately visible to
-- every profile) and INSERT/UPDATE/DELETE (Full Site Admin only, matching
-- exactly what the application layer already enforces for
-- inviteSiteAdmin/changeSiteAdminRole/revokeActiveSiteAdmin/revokeSiteAdmin).

drop policy site_admins_all_site_admin on public.site_admins;

create policy site_admins_select_site_admin on public.site_admins for select
  using (internal.is_site_admin());

create policy site_admins_insert_full_admin on public.site_admins for insert
  with check (internal.is_full_site_admin());

create policy site_admins_update_full_admin on public.site_admins for update
  using (internal.is_full_site_admin());

create policy site_admins_delete_full_admin on public.site_admins for delete
  using (internal.is_full_site_admin());
