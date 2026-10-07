import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"
import { loadTeamMembershipBoard } from "@ovalball/contracts/membership/board"
import { loadMembershipReminderHistory } from "@ovalball/contracts/membership/member"

import { PageIdentity } from "@/components/shell/page-identity"
import { TeamSubscriptionsSection } from "@/components/teams/team-subscriptions-section"
import { hasCapability } from "@/lib/permissions/has-capability"
import { createClient } from "@/lib/supabase/server"

export const metadata = { title: "Memberships" }

/**
 * THE SQUAD'S MEMBERSHIPS, FOR THE PERSON WHO RUNS THE SQUAD (Club Memberships Part 2).
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
 * WHO MAY REMIND is the sending operation's own rule (send_membership_reminders with this team): the
 * team's own finance view, or the club's enrolment managers. A club-wide VIEWER without enrolment is
 * shown the standing and no Remind button, rather than a button the server would refuse.
 *
 * WHAT IS NOT HERE, and cannot be (decision #2): amounts, payers, bank details, mandate references,
 * GoCardless identifiers, the club's ledger, exports, payment actions, or any other team. The team's
 * board carries none of them, so this page could not leak one if it tried.
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

  const [teamView, clubView, clubEnrolment] = await Promise.all([
    hasCapability(supabase, "finance.subscription.view", "team", { clubId: team.club_id, teamId: team.id }),
    hasCapability(supabase, "finance.subscription.view", "club", { clubId: team.club_id }),
    hasCapability(supabase, "finance.enrolment.manage", "club", { clubId: team.club_id }),
  ])
  if (!teamView && !clubView) redirect("/dashboard")
  const canRemind = teamView || clubEnrolment

  const [board, history] = await Promise.all([
    loadTeamMembershipBoard(supabase, team.id).catch(() => null),
    loadMembershipReminderHistory(supabase, { clubId: team.club_id, teamId: team.id, limit: 10 }).catch(() => null),
  ])

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 md:px-8 md:py-12">
      <Link
        href="/dashboard"
        className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-forest-800 hover:text-forest-950"
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
        {team.display_name}
      </Link>

      <PageIdentity workspace="Team" title="Memberships" className="mt-2" />
      <p className="mt-2 max-w-prose text-sm text-ink-muted">
        Whether each player in {team.display_name} is paid up this month, and a way to remind their families.
        Payments themselves are handled by the club.
      </p>

      {board ? (
        <TeamSubscriptionsSection board={board} teamId={team.id} canRemind={canRemind} history={history} variant="page" />
      ) : (
        <p role="alert" className="mt-8 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">
          The team&rsquo;s memberships couldn&rsquo;t be loaded. Refresh the page to try again.
        </p>
      )}
    </div>
  )
}
