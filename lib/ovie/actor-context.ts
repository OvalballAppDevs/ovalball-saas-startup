import type { SessionContext } from "@/lib/app-context/session-context"
import { isViewOnlyEverywhere, manageableTeams } from "@/lib/app-context/session-context"

import type { OvieActorContext } from "./types"
import { canActOnTeam } from "./team-authorization"

export { canActOnTeam }

/**
 * Ovie's actor context is a pure reduction of the app's own SessionContext
 * (lib/app-context/session-context.ts) -- the same "who is this session"
 * resolution every other authenticated page already uses. No separate
 * query, no separate permission model. Building this from a
 * server-resolved SessionContext (never from client-supplied club/team
 * ids) is what makes every downstream Ovie search/write inherit exactly
 * the user's real capabilities, never more.
 */
export function buildOvieActorContext(ctx: SessionContext): OvieActorContext {
  const manageable = new Set(manageableTeams(ctx).map((t) => t.teamId))
  return {
    userId: ctx.user.id,
    clubs: ctx.clubMemberships.map((m) => ({
      clubId: m.clubId,
      clubName: m.clubName,
      canManageClubFixtures: m.role === "CLUB_ADMIN" || m.role === "FIXTURE_SECRETARY",
    })),
    teamScopes: ctx.teamPermissions.map((tp) => ({
      teamId: tp.teamId,
      clubId: tp.clubId,
      canManageTeam: manageable.has(tp.teamId),
    })),
    isSiteAdmin: ctx.isSiteAdmin,
    viewOnly: isViewOnlyEverywhere(ctx),
  }
}
