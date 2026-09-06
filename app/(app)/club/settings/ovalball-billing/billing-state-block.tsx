import type { ClubBillingState } from "@/lib/platform/subscription"

const SECONDS_PER_DAY = 86_400

/**
 * The three questions a Club Admin actually has — what are we on, what
 * happens next, and how much — answered before any table.
 *
 * forest-950 because that is Ovalball's own chrome everywhere else in the
 * product: this is the one block where Ovalball is speaking to the club
 * rather than the club managing its own affairs. It is also what makes this
 * page unmistakable at a glance from "Subscriptions & Payments", which is
 * the club charging its own members.
 *
 * Beta is NOT a banner. A banner is something to scroll past; the answer
 * belongs in the "next collection" line, where the question is asked.
 */
export function BillingStateBlock({
  state,
  planName,
  nextCollection,
}: {
  state: ClubBillingState
  /** The plan's own name, so this never hard-codes "Standard". */
  planName: string | null
  nextCollection: {
    grossPence: number
    creditAppliedPence: number
    netPence: number
    willSkip: boolean
  } | null
}) {
  const { headline, explanation } = describeState(state, planName ?? "Your plan")
  const collectionLine = describeNextCollection(state, nextCollection)

  return (
    <section className="mt-8 rounded-lg bg-forest-950 px-6 py-7 text-chalk md:px-8 md:py-9">
      <h2 className="font-display text-display-l">{headline}</h2>

      {explanation ? (
        <p className="mt-3 max-w-xl text-sm leading-relaxed text-chalk/75">{explanation}</p>
      ) : null}

      <dl className="mt-6 space-y-3 border-t border-chalk/15 pt-5 text-sm sm:space-y-2.5">
        <div className="sm:flex sm:items-baseline sm:justify-between sm:gap-6">
          <dt className="text-chalk/60">Next collection</dt>
          <dd className={collectionLine.attention ? "text-amber-200" : "text-chalk"}>{collectionLine.text}</dd>
        </div>
        <div className="sm:flex sm:items-baseline sm:justify-between sm:gap-6">
          <dt className="text-chalk/60">Credit</dt>
          <dd className="text-chalk tabular-nums">{formatMoney(state.creditBalancePence)}</dd>
        </div>
      </dl>
    </section>
  )
}

/**
 * Nine states, written out because the failure mode of a billing page is a
 * state nobody wrote copy for.
 */
function describeState(state: ClubBillingState, planName: string): { headline: string; explanation: string | null } {
  // Rounded up: a trial with two hours left has one day left, not zero.
  const days =
    state.trialRemainingSeconds === null ? null : Math.ceil(state.trialRemainingSeconds / SECONDS_PER_DAY)

  switch (state.subscriptionStatus) {
    case "active":
      return { headline: planName, explanation: null }
    case "past_due":
      return {
        headline: `${planName} · payment failed`,
        explanation:
          "The last collection did not go through. Nothing has changed about your access to Ovalball; we will try again.",
      }
    case "scheduled":
      return {
        headline: `${planName} · starting`,
        explanation: "Your Direct Debit is set up. The first collection is scheduled.",
      }
    case "pending_setup":
      return {
        headline: `${planName} · setup needed`,
        explanation: "Set up a Direct Debit with Ovalball to start your subscription.",
      }
    case "cancelled":
      return {
        headline: `${planName} · ending`,
        explanation: "Your subscription is cancelled. You keep everything until the period you have paid for ends.",
      }
    case "ended":
      return {
        headline: "No plan",
        explanation: "Your Ovalball subscription has ended. Choose a plan to start again.",
      }
  }

  if (state.trialStatus === "active") {
    return {
      headline: days === null ? "Free trial" : `Free trial · ${days} ${days === 1 ? "day" : "days"} left`,
      explanation: null,
    }
  }

  if (state.trialStatus === "paused") {
    const base = days === null ? "Free trial · paused" : `Free trial · ${days} ${days === 1 ? "day" : "days"} left`
    return {
      headline: base,
      explanation:
        state.platformMode === "beta"
          ? "Your trial is paused while Ovalball is in Beta. The days you have left are held, and start running again when Beta ends."
          : "Your trial is paused. The days you have left are held until you resume it.",
    }
  }

  if (state.trialStatus === "completed") {
    return { headline: "Trial ended", explanation: "Choose a plan to carry on using Ovalball." }
  }

  if (state.trialStatus === "converted") {
    return { headline: "No plan", explanation: "Choose a plan to start again." }
  }

  return {
    headline: "No plan yet",
    explanation: "Start a free trial, or choose a plan.",
  }
}

function describeNextCollection(
  state: ClubBillingState,
  next: { netPence: number; creditAppliedPence: number; willSkip: boolean } | null
): { text: string; attention: boolean } {
  // Beta answers this question before anything else does. Saying it here,
  // rather than in a banner, puts the answer where the question is asked.
  if (state.platformMode === "beta") {
    return { text: "Nothing while Ovalball is in Beta", attention: false }
  }

  if (state.subscriptionStatus === "past_due") {
    return { text: "We will try the failed collection again", attention: true }
  }

  if (state.subscriptionStatus === "cancelled") {
    return {
      text: state.currentPeriodEnd ? `Nothing — your plan runs until ${formatDate(state.currentPeriodEnd)}` : "Nothing more will be collected",
      attention: false,
    }
  }

  if (state.subscriptionStatus === "pending_setup") {
    return { text: "Nothing until your Direct Debit is set up", attention: true }
  }

  if (!next) {
    if (state.trialStatus === "active" || state.trialStatus === "paused") {
      return { text: "Nothing yet — you are on a free trial", attention: false }
    }
    return { text: "Nothing scheduled", attention: false }
  }

  if (next.willSkip) {
    return {
      text: `Nothing${state.nextCollectionOn ? ` on ${formatDate(state.nextCollectionOn)}` : ""} — covered by your ${formatMoney(next.creditAppliedPence)} credit`,
      attention: false,
    }
  }

  const when = state.nextCollectionOn ? ` on ${formatDate(state.nextCollectionOn)}` : ""
  const credited = next.creditAppliedPence > 0 ? ` (${formatMoney(next.creditAppliedPence)} credit applied)` : ""
  return { text: `${formatMoney(next.netPence)}${when}${credited}`, attention: false }
}

function formatMoney(pence: number): string {
  return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 }).format(
    pence / 100
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}
