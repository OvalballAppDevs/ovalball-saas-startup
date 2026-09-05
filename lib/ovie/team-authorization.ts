import type { OvieActorContext } from "./types"

/**
 * Split out of actor-context.ts as a genuinely import-free module (only
 * ./types, which is itself import-free) -- actor-context.ts's
 * buildOvieActorContext() needs lib/app-context/session-context.ts, which
 * imports the `server-only` package, and `server-only` has no resolvable
 * export outside a bundler (a plain `npx tsx` run fails with
 * ERR_MODULE_NOT_FOUND before a single assertion runs -- see
 * distance.verify.ts's own module comment, which documented this same
 * constraint and, at the time, could not verify canActOnTeam() any other
 * way than a live browser conversation). Splitting the WRITE-BOUNDARY
 * authorization check itself into its own file with no such import makes
 * it directly `tsx`-testable -- see team-authorization.verify.ts, added to
 * close that exact gap. actor-context.ts re-exports this so every existing
 * import site (orchestrator.ts, opponent-search.ts) is unaffected.
 */
export function canActOnTeam(actor: OvieActorContext, teamId: string, clubId: string): boolean {
  if (actor.isSiteAdmin) return true
  if (actor.clubs.some((c) => c.clubId === clubId && c.canManageClubFixtures)) return true
  return actor.teamScopes.some((t) => t.teamId === teamId && t.clubId === clubId && t.canManageTeam)
}
