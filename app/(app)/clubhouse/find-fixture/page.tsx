import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, isFamilyFacingContext, resolveActiveContext } from "@/lib/app-context/active-context"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { FindFixtureClient } from "./find-fixture-client"

export const metadata = { title: "Find a Fixture" }

interface FindFixturePageProps {
  searchParams: Promise<{ opponentDirectoryId?: string; opponentClubId?: string }>
}

/**
 * CLUBHOUSE PROGRAMME SECTION 6 -- FIND A FIXTURE.
 *
 * Read-only discovery is open to any club/team staff context (never family-facing -- see
 * isFamilyFacingContext below, the exact boundary /fixtures/new already draws). Progressing into an
 * actual request still requires real fixture authority, re-checked server-side by
 * find_fixture_candidate_teams and, ultimately, by the unchanged fixture_requests RLS the /fixtures/new
 * handoff goes through -- this page never creates or mutates a fixture itself.
 */
export default async function FindFixturePage({ searchParams }: FindFixturePageProps) {
  const { opponentDirectoryId, opponentClubId } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)

  // Parents/guardians and players get no operational opposition-discovery workflow -- the same
  // boundary /fixtures/new already draws (isFamilyFacingContext), never a second, looser one here.
  if (isFamilyFacingContext(activeContext.kind)) redirect("/agenda")

  const clubId = activeClubId(ctx, activeContext)
  const teamId = activeContext.kind === "team" ? activeContext.id : null
  const myTeams = await getTeamsForActiveContext(supabase, ctx, activeContext)

  if (!clubId || myTeams.length === 0) redirect("/clubhouse")

  let initialOpponent: { directoryId: string; clubId: string | null; name: string } | null = null
  if (opponentDirectoryId) {
    const { data: directoryRow } = await supabase.from("club_directory").select("id, name").eq("id", opponentDirectoryId).maybeSingle()
    if (directoryRow) initialOpponent = { directoryId: directoryRow.id, clubId: opponentClubId ?? null, name: directoryRow.name }
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Clubhouse</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Find a Fixture</h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        Search real, compatible opposition across the Ovalball network, then arrange the fixture through the usual request.
      </p>

      <div className="mt-8">
        <FindFixtureClient clubId={clubId} contextTeamId={teamId} teams={myTeams} initialOpponent={initialOpponent} />
      </div>
    </div>
  )
}
