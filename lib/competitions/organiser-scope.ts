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
  if (!siteAdmin && !clubId) return null
  return { supabase, user, siteAdmin, clubId, clubRugbyCode }
}

/** The organiser scope, only when it organises THIS edition's competition in the active context. */
export async function requireEditionOrganiser(
  editionId: string,
): Promise<{ ok: true; scope: OrganiserScope; competitionId: string; organiserClubId: string | null } | { ok: false; error: string }> {
  const scope = await resolveOrganiserScope()
  if (!scope) return { ok: false, error: "Competitions are organised by Site Admin or a club's fixture administrators." }
  const { data: edition } = await scope.supabase.from("competition_editions").select("competition_id, competitions(organiser_club_id)").eq("id", editionId).maybeSingle()
  if (!edition) return { ok: false, error: "Competition not found." }
  const organiserClubId = edition.competitions?.organiser_club_id ?? null
  const acting = scope.siteAdmin || (organiserClubId !== null && organiserClubId === scope.clubId)
  if (!acting) return { ok: false, error: "You organise this competition only while acting as its organiser." }
  const { data: allowed } = await scope.supabase.rpc("can_organise_competition", { p_competition_id: edition.competition_id })
  if (!allowed) return { ok: false, error: "You do not organise this competition." }
  return { ok: true, scope, competitionId: edition.competition_id, organiserClubId }
}
