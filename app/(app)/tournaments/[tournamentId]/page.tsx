import { Suspense } from "react"
import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { TournamentCentreHero } from "@/components/tournaments/tournament-centre/hero"
import { TournamentCentreView } from "@/components/tournaments/tournament-centre/tournament-centre-view"
import { getTournamentCentre } from "@/lib/app-context/tournament-centre-data"
import { resolveClubLogoUrl } from "@/lib/app-context/club-logo"
import { createClient } from "@/lib/supabase/server"

import { TournamentManagementBar } from "./management-bar"

export const dynamic = "force-dynamic"

/**
 * TOURNAMENT CENTRE -- the one canonical route for one physical tournament.
 *
 * ONE tournament_id, ONE route. Wrapper links may point here from Calendar,
 * from Pitch Allocation and from a team page, but they converge on this
 * implementation rather than carrying their own. There is deliberately no
 * /tournaments/[id]/parent, /player or /staff.
 *
 * PRIVACY IS FILTERED BEFORE RENDER. get_tournament_centre returns null unless
 * internal.tournament_visible_row allows this viewer, so an unauthorised
 * request never receives the payload at all -- there is nothing here to hide
 * in React.
 */
export async function generateMetadata({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params
  const supabase = await createClient()
  const tournament = await getTournamentCentre(supabase, tournamentId)
  return { title: tournament ? `${tournament.name} | Tournament Centre` : "Tournament Centre" }
}

export default async function TournamentCentrePage({ params }: { params: Promise<{ tournamentId: string }> }) {
  const { tournamentId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const tournament = await getTournamentCentre(supabase, tournamentId)
  // A tournament this viewer may not see is indistinguishable from one that
  // does not exist, which is the correct answer to a forged id.
  if (!tournament) notFound()

  const { data: clubRow } = tournament.entries[0]
    ? await supabase
        .from("clubs")
        .select("logo_storage_path, club_directory(logo_storage_path)")
        .eq("id", tournament.entries[0].clubId)
        .maybeSingle()
    : { data: null }
  const clubLogoUrl = resolveClubLogoUrl(supabase, clubRow)

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/calendar"
          className="inline-flex h-11 items-center gap-1.5 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          Calendar
        </Link>
        {tournament.canManageTournament && !tournament.cancelled && <TournamentManagementBar tournament={tournament} />}
      </div>

      <TournamentCentreHero tournament={tournament} clubLogoUrl={clubLogoUrl} />

      {/* useSearchParams needs a Suspense boundary in the App Router. */}
      <Suspense fallback={<div className="h-40 rounded-2xl border border-ink/10 bg-white" />}>
        <TournamentCentreView tournament={tournament} />
      </Suspense>
    </div>
  )
}
