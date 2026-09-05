import type { SwitchableContext } from "./active-context"
import { canManageClubFixturesAnywhere, isViewOnlyEverywhere, manageableTeams, type SessionContext } from "./session-context"

export interface NavItem {
  href: string
  label: string
}

/**
 * Turns a session's real permissions -- SCOPED to whichever context is
 * currently active (see active-context.ts) -- into the nav item list from
 * the brief's own worked examples. This is presentation logic only: every
 * route this points at re-checks the same permissions server-side before
 * rendering anything, so a stale or tampered client render of this list
 * can hide a link but never grant the page behind it. Context changes
 * WHICH of the session's real, already-held permissions the nav reflects
 * -- it never adds one that getSessionContext didn't already return.
 */
export function buildNavItems(
  ctx: SessionContext,
  activeContext: SwitchableContext
): { primary: NavItem[]; roleLabel: string; clubName: string; clubLogoUrl: string | null } {
  const items: NavItem[] = [{ href: "/dashboard", label: "Dashboard" }]
  const viewOnly = isViewOnlyEverywhere(ctx)

  const inTeamContext = activeContext.kind === "team"
  const inSiteAdminContext = activeContext.kind === "site_admin"
  const inParentContext = activeContext.kind === "parent"
  const inPlayerContext = activeContext.kind === "player"
  // Player View gets exactly the same restriction as Parent View below --
  // both are read-only-by-design contexts over one team (Relationship
  // Registry §20: "this distinguishes Player View from Parent View even
  // when both experiences happen to be mostly read-only").
  const inParentOrPlayerContext = inParentContext || inPlayerContext

  // Parent/Player View is presentation-only and MUST NOT inherit whatever
  // other real authority this same account holds elsewhere in the session
  // -- canManageClubFixturesAnywhere()/manageableTeams() are deliberately
  // session-wide (their own names say "Anywhere"), so using them unguarded
  // here would leak Fixtures/Messages/Teams/People links into Parent/Player
  // View for a multi-role account (e.g. a Club Admin who is ALSO a parent)
  // purely because the account holds admin authority on a DIFFERENT
  // team/club, not because the parent/player relationship itself grants
  // it. hasClubFixtureAuthority/manageable are forced empty in this
  // context specifically to prevent that -- Dashboard and this one team's
  // Calendar are the only items a parent/player view is currently designed
  // to show; broader parent-facing visibility (Messages, Documents) is a
  // real, disclosed, separate product decision, not silently included here.
  const hasClubFixtureAuthority = inParentOrPlayerContext ? false : canManageClubFixturesAnywhere(ctx)
  const manageable = inParentOrPlayerContext ? [] : manageableTeams(ctx)

  const calendarLabel =
    inTeamContext || inParentOrPlayerContext
      ? activeContext.label
      : viewOnly && ctx.teamPermissions.length === 1
        ? ctx.teamPermissions[0].teamDisplayName
        : "Calendar"
  items.push({ href: "/calendar", label: calendarLabel })

  // Parent/Player View: Dashboard + this one team's Calendar only, full
  // stop -- never falls through to any of the authority-gated sections
  // below, regardless of what else this account can do in another context.
  if (inParentOrPlayerContext) {
    return { primary: items, roleLabel: activeContext.roleLabel, clubName: activeContext.label, clubLogoUrl: activeContext.logoUrl }
  }

  // A Site Admin context is the admin console -- deliberately never the
  // club/team operational surface too, even for someone who separately
  // holds real club/team authority elsewhere. Switching context is how
  // they move between those worlds; nav never shows both superimposed.
  if (!inSiteAdminContext) {
    if (hasClubFixtureAuthority || manageable.length > 0) {
      // /fixtures/management is the master fixture register (same
      // component family as Site Admin's, per the reconciliation-pass
      // requirement that this be one product, scoped by authority, not a
      // separate implementation) -- it carries its own quick "View Fixture
      // Requests" Sheet plus a link through to /fixtures for full
      // sent/rejected/non-Ovalball request history. /fixtures itself
      // remains a real, separately-useful page, just no longer the
      // primary nav destination.
      items.push({ href: "/fixtures/management", label: "Fixtures" })
    }
    // Player Requests: a team-scoped context's own entry point into the
    // call-up domain (PLAYER REQUESTS Section 12) -- reachable by a plain
    // team_admin/coach/manager with no club-wide role at all, since
    // /teams/[teamId] itself (club-authority-gated) never was. Only shown
    // when the ACTIVE team is one this session holds real (non-view-only)
    // authority over -- never for a club-wide context, which already
    // reaches every team's requests via /club/player-moves.
    if (inTeamContext && activeContext.id && manageable.some((t) => t.teamId === activeContext.id)) {
      items.push({ href: `/teams/${activeContext.id}/player-requests`, label: "Player Requests" })
    }
    // Messages is team-scoped, not club-scoped -- a Team Admin/Coach needs
    // it for their own team's fixture conversations even with no club-wide
    // role, unlike Partner Clubs (club_partnerships RLS has no team-level
    // read clause at all, so a team-only manager genuinely has nothing to
    // see there).
    if (hasClubFixtureAuthority || manageable.length > 0) {
      items.push({ href: "/messages", label: "Messages" })
    }
    // Club-wide-only tools (Partner Clubs, People) only show in a CLUB
    // context -- a Team-scoped context is a deliberately narrower "operate
    // as this one team" mode, per the "U13 Boys A Team Manager should see
    // their authorized U13 scope, not automatically gain other club-wide
    // tools" requirement.
    //
    // Club Settings and Season Rollover are deliberately NOT primary nav
    // items (Master Architecture Pass addendum, "Club Settings still
    // incorrect in nav"/"Season Rollover still incorrect") -- both are
    // pure configuration, reached exclusively through the gear next to the
    // active identity block (resolveContextSettingsLink() -> /club/settings),
    // never duplicated as a second top-level entry. Season Rollover lives
    // as a section inside that same Club Settings hub now, alongside Club
    // Profile/Teams/Lookup Administration -- see app/(app)/club/settings/page.tsx.
    if (!inTeamContext) {
      if (hasClubFixtureAuthority) {
        items.push({ href: "/partner-clubs", label: "Partner Clubs" })
      }
      if (ctx.clubMemberships.length > 0) {
        items.push({ href: "/documents", label: "Documents" })
      }
      if (activeContext.kind === "club" && activeContext.roleLabel === "Club Admin") {
        items.push({ href: "/people", label: "People" })
      }
    }
  }

  if (inSiteAdminContext) {
    items.push({ href: "/admin/claims", label: "Claims" })
    items.push({ href: "/admin/documents", label: "Documents" })
    items.push({ href: "/admin/clubs", label: "Club Management" })
    items.push({ href: "/admin/users", label: "User Management" })
    items.push({ href: "/admin/permissions", label: "Permission Management" })
    items.push({ href: "/admin/fixtures", label: "Fixture Management" })
    items.push({ href: "/admin/messages", label: "Message Management" })
    items.push({ href: "/admin/seasons", label: "Seasons" })
    items.push({ href: "/admin/team-directory", label: "Team Directory" })
    items.push({ href: "/admin/competitions", label: "Competitions" })
    items.push({ href: "/admin/lookups", label: "Lookup Administration" })
    items.push({ href: "/admin/support", label: "Support Tickets" })
    items.push({ href: "/admin/site-admins", label: "Site Admin Management" })
    items.push({ href: "/admin/system-health", label: "System Health" })
  }

  return {
    primary: items,
    roleLabel: activeContext.roleLabel,
    clubName: activeContext.label,
    clubLogoUrl: activeContext.logoUrl,
  }
}
