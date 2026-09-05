import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { reconcileOverdueFixtureResults } from "@/lib/app-context/reconcile-results"
import { canManageClubFixturesAnywhere, getSessionContext, isClubAdminAnywhere } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { FixtureManagementView } from "../../admin/fixtures/fixture-management-view"
import { FixtureRequestsSheet } from "../fixture-requests-sheet"
import { getIncomingFixtureRequestsSummary } from "../incoming-requests-summary"

/**
 * Section 14/25: the Club Admin/Fixtures Secretary Fixture Management
 * surface -- the SAME FixtureManagementView component Site Admin's /admin/
 * fixtures uses, scoped by clubId (server-side, via buildAdminFixtureQuery's
 * existing clubId filter), never a second copy-pasted table/form. Header
 * reads "CLUB ADMIN"/"FIXTURES SECRETARY", not "SITE ADMIN".
 */
export default async function ClubFixtureManagementPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  if (!canManageClubFixturesAnywhere(ctx) && !ctx.isSiteAdmin) redirect("/fixtures")

  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? manageableClubId(ctx)` fallback -- this is the real Fixture
  // Management CRUD surface (edit/delete fixtures, results, requests), so
  // falling back to whichever club-wide authority happened to be first in
  // the session was a severe, live-confirmed-pattern leak class: Parent
  // View (or any non-club active context) on one club could still reach
  // and fully manage a DIFFERENT club's fixtures merely because this
  // account also holds Club Admin/Fixture Secretary there. See
  // app/(app)/people/page.tsx for the identical fix applied first.
  const myClubId = activeManageableClubId(ctx, activeContext)
  if (!myClubId) redirect("/fixtures")

  await reconcileOverdueFixtureResults(supabase)
  const resolvedParams = await searchParams

  const membership = ctx.clubMemberships.find((m) => m.clubId === myClubId)
  const myClubName = membership?.clubName ?? "Your club"
  const eyebrow = membership?.role === "FIXTURE_SECRETARY" ? "Fixtures Secretary" : "Club Admin"

  // Context-scoped, not session-wide -- see app/(app)/fixtures/page.tsx.
  const myTeams = await getTeamsForActiveContext(supabase, ctx, activeContext)
  const teamIds = myTeams.map((t) => t.id)
  const { incoming, tournamentInvitations } = await getIncomingFixtureRequestsSummary(supabase, teamIds, myClubId, ctx.isSiteAdmin, isClubAdminAnywhere(ctx))

  return (
    <FixtureManagementView
      supabase={supabase}
      searchParams={resolvedParams}
      scope={{ clubId: myClubId, clubName: myClubName, eyebrow, importHref: "/fixtures/import", basePath: "/fixtures/management" }}
      headerExtra={<FixtureRequestsSheet incoming={incoming} tournamentInvitations={tournamentInvitations} />}
    />
  )
}
