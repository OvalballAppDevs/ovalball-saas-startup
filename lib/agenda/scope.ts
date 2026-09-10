import type { SwitchableContext } from "@/lib/app-context/active-context"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { FamilyChild } from "@/lib/parent/family-agenda"
import { resolveFamilyScope } from "@/lib/parent/family-agenda"

/**
 * WHOSE RUGBY IS THIS AGENDA ABOUT?
 *
 * One resolver, run on the server, before anything is queried or rendered.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE
 *
 *   Identity, relationships and capabilities determine the visible dataset.
 *   Filters narrow that authorised dataset; they never grant visibility.
 *
 * So this function takes exactly two inputs -- the SessionContext the server
 * already proved, and which context the person is switched into -- and it
 * takes NO search parameters. There is deliberately no argument a crafted URL
 * could reach. A filter later in the pipeline can only ever remove rows from
 * what this returns.
 *
 * The scope is a DESCRIPTION, not a query. It says "this person's agenda is
 * these children" or "this club", and the loader turns that into a bounded
 * server-side read. Keeping the two apart is what makes the authority
 * testable on its own, without a database.
 *
 * WHY CONTEXT NARROWS BUT NEVER WIDENS. Switching context is a viewing
 * preference: a club admin who switches to their child's context sees that
 * child, and a coach who switches to a club context they do not administer
 * gets nothing new. Every branch below reads its answer out of ctx -- the
 * proved relationships -- and uses activeContext only to choose among them.
 */

export type AgendaScope =
  /**
   * A family or an individual player: an explicit list of (player, team)
   * pairs the server has already proved this account is entitled to.
   * Covers All Children, one selected child, and an adult player's own rugby.
   */
  | { kind: "family"; children: FamilyChild[] }
  /**
   * Team-scoped staff -- a coach, team manager or team admin. Exactly the
   * teams they hold an assignment for, never their club's other teams.
   */
  | { kind: "teams"; teamIds: string[]; clubId: string | null }
  /** Club-wide authority at ONE club: the club they are currently acting for. */
  | { kind: "club"; clubId: string; clubName: string }
  /** Full Site Admin: platform-wide, and the only scope with no id filter at all. */
  | { kind: "platform" }
  /** No agenda. Not an error -- a legitimate state for an account with no rugby yet. */
  | { kind: "none" }

/**
 * True where the viewer is looking at their own or their family's rugby, as
 * opposed to administering somebody else's. Drives whether attendance
 * chips and the "needs response" prompt make sense -- a coach is not being
 * asked whether they can attend.
 */
export function isPersonalScope(scope: AgendaScope): boolean {
  return scope.kind === "family"
}

export function resolveAgendaScope(ctx: SessionContext, activeContext: SwitchableContext): AgendaScope {
  // ---------------------------------------------------------------------
  // Family-facing contexts: All Children, one child, or the person's own
  // player record. resolveFamilyScope already draws these lines correctly
  // (a selected child never pulls in a sibling; a player context is exactly
  // that team), so this defers to it rather than restating the rules.
  // ---------------------------------------------------------------------
  if (activeContext.kind === "family" || activeContext.kind === "parent" || activeContext.kind === "player") {
    const children = resolveFamilyScope(ctx, activeContext)
    return children.length > 0 ? { kind: "family", children } : { kind: "none" }
  }

  // ---------------------------------------------------------------------
  // Site Admin. Platform-wide, and deliberately only for the context they
  // actually switched into -- a Full Site Admin looking at a club context
  // gets that club, not the platform, because that is what they asked for.
  // ---------------------------------------------------------------------
  if (activeContext.kind === "site_admin") {
    return ctx.isSiteAdmin ? { kind: "platform" } : { kind: "none" }
  }

  // ---------------------------------------------------------------------
  // A single team. STAFF assignments only: `view_only` is the legacy
  // parent-ish permission and confers no staff view of a squad's agenda --
  // a parent's route to their child's rugby is the guardian relationship
  // above, which is scoped to their own child rather than the whole team.
  // ---------------------------------------------------------------------
  if (activeContext.kind === "team") {
    const assignment = ctx.teamPermissions.find((t) => t.teamId === activeContext.id && t.permission !== "view_only")
    if (assignment) return { kind: "teams", teamIds: [assignment.teamId], clubId: assignment.clubId }
    // A Club Admin acting in a team context still legitimately holds
    // club-wide authority, but they asked for this team, so they get it.
    const clubAdminHere = ctx.clubMemberships.find(
      (m) => m.clubId === activeContext.clubId && (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    )
    if (clubAdminHere && activeContext.id) return { kind: "teams", teamIds: [activeContext.id], clubId: clubAdminHere.clubId }
    return { kind: "none" }
  }

  // ---------------------------------------------------------------------
  // A club context. Club-wide authority is CLUB_ADMIN or FIXTURE_SECRETARY
  // at THAT club -- never at whichever club happened to be first in the
  // session, which is the leak class the Fixture Management page records.
  // ---------------------------------------------------------------------
  if (activeContext.kind === "club") {
    const membership = ctx.clubMemberships.find(
      (m) => m.clubId === activeContext.id && (m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY")
    )
    if (membership) return { kind: "club", clubId: membership.clubId, clubName: membership.clubName }

    // Club member without club-wide fixture authority: they still see the
    // teams they are individually assigned to at this club, and nothing else.
    const teams = ctx.teamPermissions.filter((t) => t.clubId === activeContext.id && t.permission !== "view_only")
    if (teams.length > 0) return { kind: "teams", teamIds: teams.map((t) => t.teamId), clubId: activeContext.id }
    return { kind: "none" }
  }

  return { kind: "none" }
}

/**
 * Which filters are worth offering for this scope.
 *
 * A filter for a dimension the viewer has exactly one of is noise: a player
 * with one club does not need a club filter, and a guardian with one child
 * does not need a child filter. This is presentation only -- hiding a filter
 * never affects what the server returns, and showing one never widens it.
 */
export interface AgendaFilterAffordances {
  child: boolean
  team: boolean
  club: boolean
  /** Attendance only means something where the viewer is answering for somebody. */
  attendance: boolean
}

export function filterAffordances(scope: AgendaScope, childCount: number): AgendaFilterAffordances {
  switch (scope.kind) {
    case "family":
      return { child: childCount > 1, team: false, club: false, attendance: true }
    case "teams":
      return { child: false, team: scope.teamIds.length > 1, club: false, attendance: false }
    case "club":
      return { child: false, team: true, club: false, attendance: false }
    case "platform":
      return { child: false, team: false, club: true, attendance: false }
    default:
      return { child: false, team: false, club: false, attendance: false }
  }
}
