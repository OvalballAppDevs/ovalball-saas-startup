import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { getSessionContext } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

import { GenderForm } from "./gender-form"

export const metadata = { title: "Playing Details" }

/**
 * Playing details for one player.
 *
 * This exists because the Season Handover board could correctly refuse to
 * guess a player's gender and then offer nobody a way to supply it. The people
 * entitled to answer are the ones who already hold that relationship -- an
 * active guardian, or the adult player themselves -- so the form is rendered
 * for them and for nobody else. Club and team staff can read this page, and
 * are told plainly who can complete it; letting them edit it would widen staff
 * authority over protected identity information, which it must not.
 *
 * The server is the authority either way: set_player_playing_pathway refuses a
 * caller it does not recognise regardless of what this page renders.
 */
export default async function PlayerDetailsPage({ params }: { params: Promise<{ playerId: string }> }) {
  const { playerId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)

  const { data: player } = await supabase
    .from("players")
    .select("id, first_name, surname, playing_pathway, user_id")
    .eq("id", playerId)
    .maybeSingle()

  if (!player) notFound()

  const isGuardian = ctx.guardianRelationships.some((g) => g.playerId === playerId)
  const isSelf = player.user_id === user.id
  const canEdit = isGuardian || isSelf || ctx.siteAdminRole === "full"

  const firstName = player.first_name
  const pathway = (player.playing_pathway ?? null) as "MALE" | "FEMALE" | null

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/parent/children" className="inline-flex items-center gap-1.5 text-sm font-medium text-ink-muted hover:text-ink">
        <ChevronLeft className="size-4" />
        Your Children
      </Link>

      <p className="mt-4 text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Playing Details</p>
      <h1 className="mt-2 font-display text-display-l text-ink">
        {player.first_name} {player.surname}
      </h1>
      <p className="mt-2 max-w-lg text-sm text-ink-muted">
        The information a club needs to place {firstName} in the right team. Ovalball never infers any of it from the team
        they are in now.
      </p>

      {canEdit ? (
        <GenderForm playerId={player.id} playerFirstName={firstName} current={pathway} />
      ) : (
        <div className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
          <p className="text-sm font-medium text-ink">Gender</p>
          <p className="mt-1 max-w-lg text-sm text-ink/60">
            {pathway
              ? `Recorded as ${pathway === "MALE" ? "Boys" : "Girls"}.`
              : `Not recorded yet. Only ${firstName}'s guardian, or ${firstName} if they manage their own account, can add this. Running a team or club does not carry the authority to record it.`}
          </p>
        </div>
      )}
    </div>
  )
}
