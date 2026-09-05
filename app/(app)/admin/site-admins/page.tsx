import { redirect } from "next/navigation"
import { ShieldCheck } from "lucide-react"

import { requireActiveSiteAdmin } from "@/lib/app-context/require-active-site-admin"
import { createClient } from "@/lib/supabase/server"

import { AdminRow, type ActiveSiteAdminData } from "./admin-row"
import { InviteSiteAdminForm } from "./invite-form"
import { PendingInvitationRow, type PendingSiteAdminInvitationData } from "./pending-invitation-row"
import { profileLabel } from "./profiles"

/**
 * Site Admin only, same redirect-courtesy pattern as every other /admin
 * page -- RLS on site_admins/site_admin_invitations is the real boundary.
 * Only a Full Site Admin can see pending invitations or invite/revoke/
 * change-role (site_admin_invitations RLS + requireSiteAdmin(['full']) on
 * every write action here); every active Site Admin profile can see the
 * roster itself, matching site_admins' own existing RLS
 * (site_admins_all_site_admin: is_site_admin() only, unchanged).
 */
export default async function SiteAdminsPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  // Site Admin route-family guard (addendum): requires BOTH real Site
  // Admin authority AND that the account has actively switched into Site
  // Admin as its current operating context -- see requireActiveSiteAdmin()'s
  // own doc comment. An account that also happens to be, say, Burnley's
  // Club Admin must not reach this page while operating as Burnley.
  const activeSiteAdmin = await requireActiveSiteAdmin(supabase, user)
  if (!activeSiteAdmin.ok) redirect("/dashboard")
  const ctx = activeSiteAdmin.ctx

  const isFull = ctx.siteAdminRole === "full"

  const { data: activeRows } = await supabase
    .from("site_admins")
    .select("user_id, admin_role, granted_at, diagnostic_club_access, manage_team_catalogue, manage_competitions, manage_fixture_support, manage_global_lookups, manage_seasons")
    .eq("status", "active")
    .order("granted_at", { ascending: true })

  const userIds = (activeRows ?? []).map((r) => r.user_id)
  const { data: overviewRows } =
    userIds.length > 0
      ? await supabase.from("admin_user_overview").select("user_id, email, first_name, surname").in("user_id", userIds)
      : { data: [] as { user_id: string | null; email: string | null; first_name: string | null; surname: string | null }[] }
  const overviewByUserId = new Map((overviewRows ?? []).map((r) => [r.user_id, r]))

  const activeAdmins: ActiveSiteAdminData[] = (activeRows ?? []).map((row) => {
    const overview = overviewByUserId.get(row.user_id)
    const name = [overview?.first_name, overview?.surname].filter(Boolean).join(" ").trim()
    return {
      userId: row.user_id,
      email: overview?.email ?? null,
      name: name || "Unnamed user",
      adminRole: row.admin_role,
      grantedAt: row.granted_at,
      diagnosticClubAccess: row.diagnostic_club_access,
      manageTeamCatalogue: row.manage_team_catalogue,
      manageCompetitions: row.manage_competitions,
      manageFixtureSupport: row.manage_fixture_support,
      manageGlobalLookups: row.manage_global_lookups,
      manageSeasons: row.manage_seasons,
    }
  })

  let pendingInvitations: PendingSiteAdminInvitationData[] = []
  if (isFull) {
    const { data: invitationRows } = await supabase
      .from("site_admin_invitations")
      .select("id, invited_email, admin_role, expires_at")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
    pendingInvitations = (invitationRows ?? []).map((r) => ({
      id: r.id,
      invitedEmail: r.invited_email,
      adminRole: r.admin_role,
      expiresAt: r.expires_at,
    }))
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <div className="flex items-center gap-2.5">
        <ShieldCheck className="size-5 text-forest-800" />
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Site Admin</p>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-display-l text-ink">Site Admin Management</h1>
          <p className="mt-2 max-w-lg text-sm text-ink/55">
            Global Ovalball administrative access &mdash; entirely separate from club membership. Not reachable
            through any club-level access screen.
          </p>
        </div>
        {isFull && <InviteSiteAdminForm />}
      </div>

      {!isFull && (
        <p className="mt-6 rounded-lg border border-forest-800/20 bg-forest-800/5 px-4 py-3 text-sm text-forest-800">
          Your {profileLabel(ctx.siteAdminRole ?? "")} profile can view the current Site Admin roster. Inviting,
          revoking, or changing a Site Admin&apos;s profile requires Full Site Admin access.
        </p>
      )}

      <div className="mt-8">
        <p className="text-sm font-medium text-ink">Active Site Admins ({activeAdmins.length})</p>
        <ul className="mt-3 flex flex-col gap-2">
          {activeAdmins.map((admin) => (
            <AdminRow key={admin.userId} admin={admin} isSelf={admin.userId === user.id} />
          ))}
          {activeAdmins.length === 0 && <p className="text-sm text-ink/45">No active Site Admins.</p>}
        </ul>
      </div>

      {isFull && (
        <div className="mt-8">
          <p className="text-sm font-medium text-ink">Pending invitations ({pendingInvitations.length})</p>
          <ul className="mt-3 flex flex-col gap-2">
            {pendingInvitations.map((invitation) => (
              <PendingInvitationRow key={invitation.id} invitation={invitation} />
            ))}
            {pendingInvitations.length === 0 && <p className="text-sm text-ink/45">No pending invitations.</p>}
          </ul>
        </div>
      )}
    </div>
  )
}
