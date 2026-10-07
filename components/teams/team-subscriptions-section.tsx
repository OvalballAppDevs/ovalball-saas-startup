import Link from "next/link"
import { STANDING_LABEL, type TeamMembershipBoard } from "@ovalball/contracts/membership/board"
import type { MembershipReminderHistory } from "@ovalball/contracts/membership/member"
import { standingGuidance } from "@ovalball/contracts/membership/operate"

import { previewTeamReminders, remindTeamMembers } from "@/app/(app)/teams/[teamId]/subscriptions/actions"
import { StandingBar, StandingLegend, monthName, shortDate } from "@/components/membership/membership-board-parts"
import { TeamMembershipRows } from "@/components/membership/team-membership-rows"

/**
 * MEMBERSHIPS, FOR ONE TEAM, FOR THE PEOPLE WHO RUN IT (Club Memberships Part 2).
 *
 * The team's slice of the one membership standing the club's board shows -- the same words, the same order, the
 * same derivation on the server -- so the web, the phone and the club can never disagree about whether a player is
 * paid up. A Team Manager's question is "is anybody in my squad not sorted", so the squad's standing comes first,
 * then who needs action with what it means, then everybody else folded away, and the team's own recent reminders.
 *
 * IT IS RENDERED ONLY WHERE THE CAPABILITY IS HELD: the caller checks `finance.subscription.view` at the team or the
 * club, and `team_membership_board` checks it again. WHAT IS DELIBERATELY ABSENT, because the operation cannot return
 * it (decision #2): any amount, the payer, the Direct Debit, the club's money and any other team. Remind is offered
 * only to a reader the server lets remind this team (`canRemind`: the team's own finance view, or the club's
 * enrolment managers) -- a club-wide viewer without that sees the standing and no button that would be refused.
 */
export function TeamSubscriptionsSection({
  board,
  teamId,
  canRemind,
  history,
  variant = "home",
}: {
  board: TeamMembershipBoard
  teamId: string
  canRemind: boolean
  history: MembershipReminderHistory | null
  variant?: "home" | "page"
}) {
  const remind = canRemind ? remindTeamMembers.bind(null, teamId) : undefined
  const previewReminders = canRemind ? previewTeamReminders.bind(null, teamId) : undefined
  const paused = board.programmeEnabled && !board.takingNewMemberships

  if (!board.programmeEnabled || board.rows.length === 0) {
    if (variant === "home") return null
    return (
      <div className="mt-8 rounded-2xl border border-dashed border-ink/15 bg-white px-5 py-6">
        <p className="text-sm font-medium text-ink">{board.programmeEnabled ? "No players with a membership yet" : "The club doesn't run memberships through Ovalball yet"}</p>
        <p className="mt-0.5 max-w-prose text-sm text-ink-muted">
          {board.programmeEnabled
            ? "Each player's membership appears here once they have a place in the team and the team has a membership."
            : "When the club starts, each player's membership appears here."}
        </p>
      </div>
    )
  }

  // On the team's own page these sections sit under the page title; on the team's home, under "Memberships".
  const level = variant === "page" ? 2 : 3
  const Heading = level === 2 ? "h2" : "h3"

  const summary = (
    <section aria-labelledby={`team-standing-${variant}`} className="rounded-2xl border border-ink/10 bg-white p-5 md:p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <Heading id={`team-standing-${variant}`} className="text-base font-semibold text-ink">
          {`${monthName(board.asOf)} Standing`}
        </Heading>
        <p className="text-sm text-ink-muted tabular-nums">{`${board.counts.total} ${board.counts.total === 1 ? "player" : "players"}`}</p>
      </div>
      <StandingBar counts={board.counts} className="mt-4" />
      <StandingLegend counts={board.counts} showZero={false} className="mt-3" />
      {paused && <p className="mt-3 max-w-prose text-sm text-ink">The club isn&rsquo;t taking new memberships just now. Members already paying carry on.</p>}
    </section>
  )

  const recent = history && <RecentReminders history={history} limit={variant === "home" ? 3 : 10} level={level} />
  const privacy = <p className="text-xs text-ink-muted">Whether each player is paid up, not how they pay. Amounts, payers and bank details never appear here.</p>

  if (variant === "home") {
    return (
      <section className="mt-8" aria-labelledby="team-membership">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h2 id="team-membership" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
            Memberships
          </h2>
          <Link
            href={`/teams/${teamId}/subscriptions`}
            className="inline-flex min-h-11 items-center rounded-md text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-forest-800 sm:min-h-8"
          >
            Open Memberships
          </Link>
        </div>
        <div className="mt-3 space-y-4">
          {summary}
          <TeamMembershipRows rows={board.rows} remind={remind} previewReminders={previewReminders} limit={3} />
          {recent}
          {privacy}
        </div>
      </section>
    )
  }

  return (
    <div className="@container mt-8">
      <div className="grid items-start gap-5 @3xl:grid-cols-12">
        <div className="min-w-0 space-y-5 @3xl:col-span-8">
          {summary}
          <TeamMembershipRows rows={board.rows} remind={remind} previewReminders={previewReminders} level={2} />
        </div>
        <aside aria-label="Reminders" className="min-w-0 space-y-4 @3xl:col-span-4">
          {recent}
          {privacy}
        </aside>
      </div>
    </div>
  )
}

/** The team's own reminders, newest first: who, why and by whom -- never who was told. */
function RecentReminders({ history, limit, level }: { history: MembershipReminderHistory; limit: number; level: 2 | 3 }) {
  const entries = history.reminders.slice(0, limit)
  const Heading = level === 2 ? "h2" : "h3"
  return (
    <section aria-labelledby="team-recent-reminders" className="rounded-2xl border border-ink/10 bg-white p-5">
      <Heading id="team-recent-reminders" className="text-base font-semibold text-ink">
        Recent Reminders
      </Heading>
      {entries.length === 0 ? (
        <p className="mt-2 text-sm text-ink-muted">No reminders have been sent about the team&rsquo;s players yet.</p>
      ) : (
        <ul className="mt-2 divide-y divide-ink/[0.07]">
          {entries.map((e, i) => (
            <li key={`${e.sentAt}-${e.playerId}-${i}`} className="py-2.5 first:pt-1">
              <p className="text-sm text-ink">{`${e.firstName} ${e.surname}`.trim()}</p>
              <p className="text-xs text-ink-muted">
                {[
                  e.reason ? standingGuidance(e.reason, "team").title : e.standing ? STANDING_LABEL[e.standing] : null,
                  e.sentBy ? `by ${e.sentBy}` : null,
                  shortDate(e.sentAt),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
