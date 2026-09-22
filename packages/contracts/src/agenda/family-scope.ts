import type { SwitchableContext } from "../active-context-rules"
import type { SessionContext } from "../session-context"

/**
 * WHOSE CHILDREN, AND WHICH OF THEIR TEAMS.
 *
 * The PURE half of the family agenda -- no database, no request, no clock. It reads only the
 * relationships the server already proved (`SessionContext`) and the context somebody switched into,
 * and it returns the (player, team) pairs that context legitimately covers.
 *
 * It lives in the shared package because the mobile Fixtures and Calendar screens need exactly this
 * rule and must not re-derive it. A second answer to "which of my children does this view cover" is
 * how a sibling appears in a context that was meant to be one child's.
 */

export interface FamilyChild {
  playerId: string
  firstName: string
  surname: string
  fullName: string
  teamId: string
  teamName: string
  clubId: string
  clubName: string
  avatarStoragePath: string | null
}

/**
 * Which children the active context covers.
 *
 *   family -> every child this guardian holds (All Children)
 *   parent -> exactly the one child selected, never their siblings
 *   player -> the signed-in person's own player record
 *
 * The "parent" case filters on playerId AND teamId together: a child on two
 * teams is two contexts, and selecting one must not silently pull in the
 * other's fixtures.
 */
export function resolveFamilyScope(ctx: SessionContext, activeContext: SwitchableContext): FamilyChild[] {
  const fromGuardian = (g: SessionContext["guardianRelationships"][number]): FamilyChild => ({
    playerId: g.playerId,
    firstName: g.playerFirstName,
    surname: g.playerSurname,
    fullName: `${g.playerFirstName} ${g.playerSurname}`.trim(),
    teamId: g.teamId,
    teamName: g.teamDisplayName,
    clubId: g.clubId,
    clubName: g.clubName,
    avatarStoragePath: g.avatarStoragePath,
  })

  if (activeContext.kind === "family") {
    return ctx.guardianRelationships.map(fromGuardian)
  }
  if (activeContext.kind === "parent") {
    return ctx.guardianRelationships
      .filter((g) => g.playerId === activeContext.playerId && g.teamId === activeContext.id)
      .map(fromGuardian)
  }
  if (activeContext.kind === "player") {
    return ctx.linkedPlayerTeams
      .filter((p) => p.teamId === activeContext.id)
      .map((p) => ({
        playerId: p.playerId,
        firstName: ctx.firstName ?? "You",
        surname: "",
        fullName: ctx.firstName ?? "You",
        teamId: p.teamId,
        teamName: p.teamDisplayName,
        clubId: p.clubId,
        clubName: p.clubName,
        avatarStoragePath: p.avatarStoragePath,
      }))
  }
  return []
}
