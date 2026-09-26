import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, isFamilyFacingContext, resolveActiveContext } from "@/lib/app-context/active-context"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { OpportunitiesClient } from "./opportunities-client"

export const metadata = { title: "Looking for Opposition" }

/**
 * CLUBHOUSE PROGRAMME SECTIONS 15/16 -- LOOKING FOR OPPOSITION / OPPORTUNITY MATCHING.
 *
 * Same authority boundary as Find a Fixture (Section 6): never family-facing, real club/team staff
 * context required. The page itself never publishes, responds to or accepts anything -- every mutation
 * goes through the client component's calls to the canonical RPCs, each of which re-checks its own
 * authority regardless of what this page renders.
 */
export default async function OpportunitiesPage({ searchParams }: { searchParams: Promise<{ highlight?: string }> }) {
  const { highlight } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  if (isFamilyFacingContext(activeContext.kind)) redirect("/agenda")

  const clubId = activeClubId(ctx, activeContext)
  const teamId = activeContext.kind === "team" ? activeContext.id : null
  const myTeams = await getTeamsForActiveContext(supabase, ctx, activeContext)

  if (!clubId || myTeams.length === 0) redirect("/clubhouse")

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Clubhouse</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Looking for Opposition</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        Publish a date your team is free, or find a club looking for opposition on a date that suits you.
      </p>

      <div className="mt-8">
        <OpportunitiesClient contextTeamId={teamId} teams={myTeams} highlightId={highlight ?? null} />
      </div>
    </div>
  )
}
