import Link from "next/link"
import { notFound, redirect } from "next/navigation"
import { ArrowLeft } from "lucide-react"

import { getTournamentBuilderOptions } from "@/lib/app-context/tournament-builder-data"
import { getTournamentCentre } from "@/lib/app-context/tournament-centre-data"
import { createClient } from "@/lib/supabase/server"

import { TournamentManageView } from "./manage-view"

export const dynamic = "force-dynamic"
export const metadata = { title: "Manage Tournament" }

const STEPS = ["details", "teams", "opponents", "schedule", "pitches"] as const
type Step = (typeof STEPS)[number]

/**
 * MANAGING ONE TOURNAMENT.
 *
 * THE CLUB COMES FROM THE TOURNAMENT, not from whichever board context the
 * person happens to be in. Event Centre taught this: demanding an active club
 * context made Edit dead-end at the Calendar for somebody who was perfectly
 * entitled to be here and simply had a team selected.
 *
 * ANY LEGITIMATE MANAGER MAY OPEN THIS PAGE -- the occasion's manager, or a
 * team manager who can manage at least one entered team. What each of them can
 * actually change is decided section by section inside, from server-resolved
 * flags, and re-checked by the RPC behind every button.
 */
export default async function ManageTournamentPage({
  params,
  searchParams,
}: {
  params: Promise<{ tournamentId: string }>
  searchParams: Promise<{ step?: string }>
}) {
  const { tournamentId } = await params
  const { step } = await searchParams
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const tournament = await getTournamentCentre(supabase, tournamentId)
  if (!tournament) notFound()

  const canManageSomething = tournament.canManageTournament || tournament.entries.some((e) => e.canManageEntry)
  if (!canManageSomething) redirect(`/tournaments/${tournamentId}`)
  // A cancelled tournament is history: it stays visible, and it stops being
  // editable. Every RPC refuses independently.
  if (tournament.cancelled) redirect(`/tournaments/${tournamentId}`)

  const clubId = tournament.entries[0]?.clubId ?? tournament.hostClubId
  if (!clubId) redirect(`/tournaments/${tournamentId}`)
  const options = await getTournamentBuilderOptions(supabase, clubId)
  if (!options) redirect(`/tournaments/${tournamentId}`)

  const initialStep: Step = STEPS.includes(step as Step) ? (step as Step) : tournament.canManageTournament ? "details" : "opponents"

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <Link
        href={`/tournaments/${tournamentId}`}
        className="inline-flex h-11 w-fit items-center gap-1.5 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {tournament.name}
      </Link>

      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Tournament</p>
        <h1 className="mt-2 font-display text-display-l text-ink">Manage Tournament</h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          Everything about {tournament.name}, one part at a time. Changes are live as soon as they are saved.
        </p>
      </div>

      <TournamentManageView tournament={tournament} options={options} initialStep={initialStep} />
    </div>
  )
}
