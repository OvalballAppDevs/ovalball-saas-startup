import "server-only"

import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { actingBulkAuthority, plannerClubFor, plannerTeamUniverse, type PlannerTeamUniverse } from "@/lib/fixtures/fixture-team-authority"
import { createClient } from "@/lib/supabase/server"

/**
 * WHO IS PLANNING, FOR WHICH CLUB, AND WHICH TEAMS.
 *
 * The page, the two row actions and the lookups all start here, so none of
 * them can come to a different answer. The club comes from the active context
 * (or, for an account with no club context, the club it named), and access is
 * CLUB/SITE BULK PLANNING AUTHORITY -- the same predicate the staging tables
 * and publish_import_row enforce. A team's own staff have single-fixture
 * authority, which is not a way in (lib/fixtures/fixture-team-authority.ts).
 *
 * A club is not trusted because it was sent. It is the SUBJECT of the universe
 * check: naming a club this person may plan nothing for returns null exactly as
 * naming no club does.
 */
export interface PlannerScope {
  supabase: Awaited<ReturnType<typeof createClient>>
  userId: string
  universe: PlannerTeamUniverse
}

export async function resolvePlannerScope(requestedClubId?: string | null): Promise<PlannerScope | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = plannerClubFor(ctx, activeContext, requestedClubId)
  if (!clubId) return null

  if (!actingBulkAuthority(ctx, activeContext, clubId)) return null
  const universe = await plannerTeamUniverse(supabase, clubId)
  if (!universe) return null
  return { supabase, userId: user.id, universe }
}
