import { redirect } from "next/navigation"
import Link from "next/link"
import { cookies } from "next/headers"
import { ArrowLeft } from "lucide-react"

import { ACTIVE_CONTEXT_COOKIE, activeClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { getTournamentBuilderOptions } from "@/lib/app-context/tournament-builder-data"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

import { TournamentDetailsForm } from "../tournament-details-form"

export const dynamic = "force-dynamic"
export const metadata = { title: "New Tournament" }

/**
 * STEP ONE OF THE CREATION FLOW, and deliberately only step one.
 *
 * A wizard that collected teams, opponents, a schedule and pitches before
 * writing anything would have to hold the whole occasion in the browser and
 * commit it in one transaction at the end -- and every one of those later
 * steps needs a real tournament_id to hang off. So the occasion is created
 * first, from the few facts that define it, and the remaining steps are
 * guided on the manage page against a real record. Nothing is lost if the
 * organiser stops halfway: what they entered exists, and the page tells them
 * what is still missing.
 */
export default async function NewTournamentPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  const clubId = activeClubId(ctx, activeContext)
  if (!clubId) redirect("/calendar")

  // The same capability the RPC re-checks. This decides whether to offer the
  // form at all; save_tournament decides whether the save happens.
  const canCreate = await hasCapability(supabase, "calendar.manage", "club", { clubId })
  if (!canCreate) redirect("/calendar")

  const options = await getTournamentBuilderOptions(supabase, clubId)
  if (!options) redirect("/calendar")

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4 px-4 py-6 md:px-8 md:py-10">
      <Link
        href="/calendar"
        className="inline-flex h-11 w-fit items-center gap-1.5 text-sm font-medium text-ink-muted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        Calendar
      </Link>

      <div>
        <p className="text-sm font-medium tracking-[0.08em] text-forest-800 uppercase">Tournament</p>
        <h1 className="mt-2 font-display text-display-l text-ink">New Tournament</h1>
        <p className="mt-2 max-w-md text-sm text-ink-muted">
          Start with what the day is and where it is. You will add your teams, their opponents and the schedule next.
        </p>
      </div>

      <TournamentDetailsForm options={options} tournament={null} />
    </div>
  )
}
