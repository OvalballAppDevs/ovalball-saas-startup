import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { PageIdentity } from "@/components/shell/page-identity"
import { TeamSubscriptionsSection } from "@/components/teams/team-subscriptions-section"
import { hasCapability } from "@/lib/permissions/has-capability"
import { loadTeamSubscriptions } from "@/lib/teams/team-subscriptions"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Subscriptions" }

/**
 * THE SQUAD'S SUBSCRIPTION STATE, FOR THE PERSON WHO RUNS THE SQUAD.
 *
 * `finance.subscription.view` held at TEAM scope, which is the bounded authority added for exactly
 * this job: operational state for players of this team, and nothing else. Held at CLUB scope it is the
 * club's whole finance surface, and a club holder is let in here too -- a Club Admin looking at one of
 * their own teams is asking a smaller version of a question they may already ask in full.
 *
 * THE REFUSAL IS A REFUSAL, not a hidden link. Somebody without the capability who types this URL gets
 * sent away here, and the loader is never called for them -- the page does not render an empty table
 * and call that security.
 *
 * WHAT IS NOT HERE, and cannot be: bank details, mandate references, GoCardless customer or payment
 * identifiers, the club's ledger, exports, payment actions, or any other team. The shape
 * `loadTeamSubscriptions` returns carries none of them, so this page could not leak one if it tried.
 */
export default async function TeamSubscriptionsPage({ params }: { params: Promise<{ teamId: string }> }) {
  const { teamId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: team } = await supabase
    .from("teams")
    .select("id, club_id, display_name")
    .eq("id", teamId)
    .maybeSingle()
  if (!team) notFound()

  const mayView =
    (await hasCapability(supabase, "finance.subscription.view", "team", {
      clubId: team.club_id,
      teamId: team.id,
    })) || (await hasCapability(supabase, "finance.subscription.view", "club", { clubId: team.club_id }))
  if (!mayView) redirect("/dashboard")

  const summary = await loadTeamSubscriptions(supabase, team.id)

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 md:px-8 md:py-12">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-forest-800 hover:text-forest-950"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {team.display_name}
      </Link>

      <PageIdentity workspace="Team" title="Subscriptions" className="mt-2" />
      <p className="mt-2 text-sm text-ink-muted">
        Whether each player in {team.display_name} is set up to pay this month. Payments themselves are
        handled by the club.
      </p>

      {summary.rows.length > 0 ? (
        <TeamSubscriptionsSection summary={summary} />
      ) : (
        <div className="mt-8 rounded-2xl border border-dashed border-line bg-surface px-4 py-6">
          <p className="text-sm font-medium text-ink">No players in this team yet</p>
          <p className="mt-0.5 text-sm text-ink-muted">
            Subscription state appears here once players have joined the squad.
          </p>
        </div>
      )}
    </div>
  )
}
