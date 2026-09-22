import Link from "next/link"

import type { SubscriptionState, TeamSubscriptionSummary } from "@/lib/teams/team-subscriptions"

/**
 * SUBSCRIPTIONS, FOR ONE TEAM, FOR PEOPLE WHO MAY SEE THEM.
 *
 * A team manager with club finance authority opens this to answer one question -- is anybody in my
 * squad not set up -- so the answer is a short list with the problems first, not the club's revenue.
 *
 * IT IS RENDERED ONLY WHERE THE CAPABILITY IS HELD. The caller checks `finance.subscription.view` at
 * CLUB scope before loading anything, because that is the only finance authority this product has.
 * This component never decides that, and the page behind every link re-checks it server-side.
 *
 * WHAT IS DELIBERATELY ABSENT: any bank detail, mandate reference or provider identifier. A manager
 * chasing a missing Direct Debit needs a name and a state; the person's banking arrangements are not
 * theirs to see and are not in the data this renders.
 */

const STATE_LABEL: Record<SubscriptionState, string> = {
  PAID: "Paid",
  DUE: "Due",
  FAILED: "Payment failed",
  NOT_SET_UP: "Not set up",
  NOT_EXPECTED: "Nothing due",
}

/** Only the two that need somebody to act are given weight. The rest are quiet on purpose. */
const STATE_CLASS: Record<SubscriptionState, string> = {
  FAILED: "bg-destructive/10 text-destructive-text",
  NOT_SET_UP: "bg-amber-100 text-amber-800",
  DUE: "bg-ink/5 text-ink-muted",
  PAID: "bg-pitch-600/10 text-forest-800",
  NOT_EXPECTED: "bg-ink/5 text-ink-muted",
}

export function TeamSubscriptionsSection({ summary }: { summary: TeamSubscriptionSummary }) {
  if (summary.rows.length === 0) return null

  return (
    <section className="mt-8" aria-labelledby="team-subscriptions">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="team-subscriptions" className="text-sm font-medium tracking-[0.04em] text-ink-muted uppercase">
          Subscriptions
        </h2>
        <Link
          href="/club/finance"
          className="inline-flex min-h-11 items-center text-sm font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
        >
          Club Finance
        </Link>
      </div>

      <p className="mt-1 text-sm text-ink-muted">
        {summary.attentionCount > 0
          ? `${summary.attentionCount} ${summary.attentionCount === 1 ? "player needs" : "players need"} setting up or chasing this month.`
          : "Everyone in this squad is set up for this month."}
      </p>

      {/* A LIST, NOT A TABLE. Three facts per player read fine stacked on a phone, and a manager
          checking this pitch-side is the likeliest reader. */}
      <ul className="mt-3 flex flex-col gap-2">
        {summary.rows.map((row) => (
          <li
            key={row.playerId}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-2xl border border-line bg-surface px-4 py-3"
          >
            <span className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.playerName}</span>
            {row.amountDueMinor !== null && (
              <span className="text-sm text-ink-muted">£{(row.amountDueMinor / 100).toFixed(2)}</span>
            )}
            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATE_CLASS[row.state]}`}>
              {STATE_LABEL[row.state]}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
