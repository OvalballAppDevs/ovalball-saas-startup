import {
  canManageClubFixturesAnywhere,
  isClubAdminAnywhere,
  isViewOnlyEverywhere,
  manageableTeams,
  type SessionContext,
  type TeamPermissionValue,
} from "./session-context"

export interface NavItem {
  href: string
  label: string
}

/**
 * Turns a session's real permissions into the nav item list from the
 * brief's own worked examples (Parent / U12 Coach / Fixture Secretary /
 * Club Admin all get different lists here). This is presentation logic
 * only -- every route this points at re-checks the same permissions
 * server-side before rendering anything, so a stale or tampered client
 * render of this list can hide a link but never grant the page behind it.
 */
export function buildNavItems(ctx: SessionContext): { primary: NavItem[]; roleLabel: string; clubName: string } {
  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard" }]
  const hasClubFixtureAuthority = canManageClubFixturesAnywhere(ctx)
  const manageable = manageableTeams(ctx)
  const viewOnly = isViewOnlyEverywhere(ctx)

  const calendarLabel =
    viewOnly && ctx.teamPermissions.length === 1 ? ctx.teamPermissions[0].teamDisplayName : "Calendar"
  items.push({ href: "/calendar", label: calendarLabel })

  if (hasClubFixtureAuthority || manageable.length > 0) {
    items.push({ href: "/fixtures", label: "Fixtures" })
  }
  // Messages is team-scoped, not club-scoped -- a Team Admin/Coach needs it
  // for their own team's fixture conversations even with no club-wide role,
  // unlike Partner Clubs (club_partnerships RLS has no team-level read
  // clause at all, so a team-only manager genuinely has nothing to see
  // there).
  if (hasClubFixtureAuthority || manageable.length > 0) {
    items.push({ href: "/messages", label: "Messages" })
  }
  if (hasClubFixtureAuthority) {
    items.push({ href: "/partner-clubs", label: "Partner Clubs" })
    items.push({ href: "/teams", label: "Teams" })
  }
  if (isClubAdminAnywhere(ctx)) {
    items.push({ href: "/people", label: "People" })
    items.push({ href: "/club", label: "Club" })
  }
  if (ctx.isSiteAdmin) {
    items.push({ href: "/admin/claims", label: "Site Admin" })
  }

  return {
    primary: items,
    roleLabel: computeRoleLabel(ctx),
    clubName: ctx.clubMemberships[0]?.clubName ?? (ctx.isSiteAdmin ? "Ovalball" : "Ovalball"),
  }
}

function computeRoleLabel(ctx: SessionContext): string {
  const parts: string[] = []
  for (const m of ctx.clubMemberships) {
    if (m.role === "CLUB_ADMIN") parts.push("Club Admin")
    else if (m.role === "FIXTURE_SECRETARY") parts.push("Fixture Secretary")
  }
  for (const tp of ctx.teamPermissions) {
    parts.push(`${tp.teamDisplayName} — ${permissionLabel(tp.permission)}`)
  }
  if (ctx.isSiteAdmin) parts.push("Site Admin")
  return parts.length > 0 ? parts.join(" · ") : "Member"
}

function permissionLabel(permission: TeamPermissionValue): string {
  switch (permission) {
    case "team_admin":
      return "Team Admin"
    case "coach":
      return "Coach"
    case "manager":
      return "Manager"
    case "view_only":
      return "Parent/Player"
    default:
      return permission
  }
}
