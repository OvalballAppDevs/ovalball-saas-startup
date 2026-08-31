import { redirect } from "next/navigation"

import { getMyTeams } from "@/lib/app-context/my-teams"
import { getSessionContext, manageableClubId as getManageableClubId } from "@/lib/app-context/session-context"
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
  const manageableClubId = getManageableClubId(ctx)
  const myTeams = await getMyTeams(supabase, ctx)

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
