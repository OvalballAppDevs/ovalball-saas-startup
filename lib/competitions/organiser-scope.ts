import "server-only"

import { cookies } from "next/headers"
import type { SupabaseClient, User } from "@supabase/supabase-js"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { isActiveSiteAdminContext } from "@/lib/app-context/site-admin-context-rule"
import { canBulkPlanFixtures } from "@/lib/fixtures/fixture-team-authority"
import { createClient } from "@/lib/supabase/server"
import type { Database } from "@/types/database.types"

/**
 * WHO IS ORGANISING, RIGHT NOW.
 *
 * The database decides whether an account may organise a competition
 * (internal.can_organise_competition). What it cannot see is the context the
 * person is acting in, so this adds it: a Site Admin organises while active as
 * Site Admin; a club organises its own competitions while active as that club's
 * Club Admin or Fixture Secretary. Team staff are never organisers, and
 * organising a competition grants nothing over anybody's other fixtures.
 *
 * CONVERGENCE STEP 15 adds the third organiser: a governing body, while active as that body. It is
 * context-scoped for exactly the reason the club is -- a county fixtures secretary is usually also
 * somebody's Club Admin, and neither authority may be exercised while acting as the other.
 *
 * The database half of this is one added disjunct in internal.can_organise_competition. This file is
 * the context half, and it is not the boundary: the RPC below is still asked, and it refuses anybody
 * the relationship does not cover regardless of what this returns.
 */

type Supabase = SupabaseClient<Database>

export interface OrganiserScope {
  supabase: Supabase
  user: User
  /** Active as Site Admin with competition authority. */
  siteAdmin: boolean
  /** The club this person is active as, when they administer its fixtures. */
  clubId: string | null
  clubRugbyCode: string | null
  /**
   * The governing body this person is active as, when they may organise its competitions
   * (BODY_ADMIN or BODY_COMPETITIONS). Null in every other context -- including for the same person
   * while they are acting as their club.
   */
  bodyId: string | null
  bodyName: string | null
}

export async function resolveOrganiserScope(): Promise<OrganiserScope | null> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const siteAdmin = isActiveSiteAdminContext(ctx, activeContext) && (ctx.manageCompetitions || ctx.siteAdminRole === "full")
  let clubId = activeManageableClubId(ctx, activeContext)
  if (clubId && !(await canBulkPlanFixtures(supabase, clubId))) clubId = null
  let clubRugbyCode: string | null = null
  if (clubId) {
    const { data } = await supabase.from("clubs").select("club_directory(rugby_code)").eq("id", clubId).maybeSingle()
    clubRugbyCode = data?.club_directory?.rugby_code ?? null
  }

  // THE GOVERNING BODY ORGANISER, only while actually acting as it, and only for the two roles that
  // run competitions. A BODY_VIEWER reaches this and gets null, which is the truth.
  let bodyId: string | null = null
  let bodyName: string | null = null
  if (activeContext.kind === "governing" && activeContext.id) {
    const held = ctx.governingBodies.find((b) => b.bodyId === activeContext.id)
    if (held && (held.myRole === "BODY_ADMIN" || held.myRole === "BODY_COMPETITIONS")) {
      bodyId = held.bodyId
      bodyName = held.canonicalName
    }
  }

  if (!siteAdmin && !clubId && !bodyId) return null
  return { supabase, user, siteAdmin, clubId, clubRugbyCode, bodyId, bodyName }
}

/** The organiser scope, only when it organises THIS edition's competition in the active context. */
export async function requireEditionOrganiser(
  editionId: string,
): Promise<
  | { ok: true; scope: OrganiserScope; competitionId: string; organiserClubId: string | null; organiserBodyId: string | null }
  | { ok: false; error: string }
> {
  const scope = await resolveOrganiserScope()
  if (!scope) {
    return { ok: false, error: "Competitions are organised by Site Admin, a club's fixture administrators, or the governing body that runs them." }
  }
  const { data: edition } = await scope.supabase
    .from("competition_editions")
    .select("competition_id, competitions(organiser_club_id, organiser_constituent_body_id)")
    .eq("id", editionId)
    .maybeSingle()
  if (!edition) return { ok: false, error: "Competition not found." }
  const organiserClubId = edition.competitions?.organiser_club_id ?? null
  const organiserBodyId = edition.competitions?.organiser_constituent_body_id ?? null
  const acting =
    scope.siteAdmin ||
    (organiserClubId !== null && organiserClubId === scope.clubId) ||
    (organiserBodyId !== null && organiserBodyId === scope.bodyId)
  if (!acting) return { ok: false, error: "You organise this competition only while acting as its organiser." }
  // The database is still asked, and it is still the answer. The context check above only decides
  // which of this person's real authorities they are currently exercising.
  const { data: allowed } = await scope.supabase.rpc("can_organise_competition", { p_competition_id: edition.competition_id })
  if (!allowed) return { ok: false, error: "You do not organise this competition." }
  return { ok: true, scope, competitionId: edition.competition_id, organiserClubId, organiserBodyId }
}

/**
 * Where "back" goes from the Competition Creator.
 *
 * A club organiser and a Site Admin came from /fixtures/competitions. A governing officer did not --
 * that page is club fixture administration and would refuse them -- so they return to their own
 * organisation's Competitions, which is their competitions list.
 */
export function organiserCompetitionsHref(scope: OrganiserScope): string {
  return scope.bodyId && !scope.siteAdmin && !scope.clubId ? `/governing/${scope.bodyId}/competitions` : "/fixtures/competitions"
}
