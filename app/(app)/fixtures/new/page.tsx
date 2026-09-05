import { redirect } from "next/navigation"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getTeamsForActiveContext } from "@/lib/app-context/my-teams"
import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { RequestFixtureForm } from "./request-fixture-form"

interface NewFixtureRequestPageProps {
  searchParams: Promise<{ opponentClubId?: string; opponentDirectoryId?: string; targetTeamId?: string; date?: string }>
}

export default async function NewFixtureRequestPage({ searchParams }: NewFixtureRequestPageProps) {
  const { opponentClubId, opponentDirectoryId, targetTeamId, date } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // The active context's own club, full stop -- activeClubId() already
  // resolves a "club" context to itself and a "team"/"parent" context to
  // THAT team's own owning club (matching a Coach/Manager with no
  // separate club-wide role, per internal.can_manage_team), so no further
  // fallback is needed for the legitimate cases. The two fallbacks this
  // used to have -- `manageableClubId(ctx)` (first club-wide authority
  // ANYWHERE) and `ctx.teamPermissions.find(...)` (first non-view-only
  // team permission ANYWHERE) -- only ever fired for a Site Admin (or
  // no-context) session, and both picked an arbitrary, possibly unrelated
  // club/team rather than the one actually active. /fixtures/new is a
  // club/team-level flow, not a Site Admin one, so redirecting away (via
  // the `!manageableClubId` check below) is correct there.
  // Parent/Guardian and Player (both read-only by product decision) must
  // never be able to send a fixture request on the team's behalf,
  // regardless of which teams getTeamsForActiveContext below would
  // otherwise resolve. Checked before any team/club resolution so neither
  // ever reaches the team-scoped list this page used to leak (every team
  // in the whole club, via the old session-wide getMyTeams(ctx)).
  if (activeContext.kind === "parent" || activeContext.kind === "player") redirect("/fixtures")

  const manageableClubId = activeClubId(ctx, activeContext)
  // Context-scoped, not session-wide -- see app/(app)/fixtures/page.tsx.
  const myTeams = await getTeamsForActiveContext(supabase, ctx, activeContext)

  if (!manageableClubId || myTeams.length === 0) redirect("/fixtures")

  // Arriving from a partner club's availability view -- resolve the
  // prefilled opponent (and suggested target team, if that team really
  // does belong to the resolved opponent club) server-side, never trust
  // the URL, so the form can skip straight past the search step.
  let initialOpponent: { directoryId: string; clubId: string; name: string } | null = null
  let suggestedTargetTeam: { id: string; displayName: string } | null = null
  if (opponentClubId && opponentDirectoryId) {
    const { data: directoryRow } = await supabase
      .from("club_directory")
      .select("id, name, clubs!inner(id)")
      .eq("id", opponentDirectoryId)
      .eq("clubs.id", opponentClubId)
      .maybeSingle()
    if (directoryRow) {
      initialOpponent = { directoryId: directoryRow.id, clubId: opponentClubId, name: directoryRow.name }
      if (targetTeamId) {
        const { data: teamRow } = await supabase
          .from("teams")
          .select("id, display_name")
          .eq("id", targetTeamId)
          .eq("club_id", opponentClubId)
          .maybeSingle()
        if (teamRow) suggestedTargetTeam = { id: teamRow.id, displayName: teamRow.display_name }
      }
    }
  }
  const initialDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Fixtures</p>
      <h1 className="mt-2 font-display text-display-l text-ink">Request a fixture</h1>
      <p className="mt-2 max-w-md text-sm text-ink/55">
        Ask a partner club for a date. Select as many of your teams as you like — each one can have its own
        home/away preference and gets tracked independently.
      </p>

      <div className="mt-8">
        <RequestFixtureForm
          clubId={manageableClubId}
          teams={myTeams}
          initialOpponent={initialOpponent}
          initialDate={initialDate}
          suggestedTargetTeam={suggestedTargetTeam}
        />
      </div>
    </div>
  )
}
