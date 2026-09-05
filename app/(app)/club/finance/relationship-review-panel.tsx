import Link from "next/link"

const REASON_LABEL: Record<string, string> = {
  MANDATE_PROBLEM: "Direct Debit mandate has a problem. Review membership.",
  SUBSCRIPTION_PROBLEM: "Subscription ended with the provider unexpectedly. Review membership.",
  PROGRAMME_ELIGIBILITY_ENDED: "Player is no longer eligible for this programme. Review membership.",
  PAYER_RELATIONSHIP_REQUIRES_REVIEW: "Payer relationship has changed. Review membership.",
}

export interface RelationshipReviewItem {
  payerSubscriptionId: string
  playerName: string
  reason: string
}

/**
 * A live Subscription must never become invisible just because the
 * underlying player/guardian relationship changed -- but this NEVER
 * implies money was already cancelled. Truthful "review" language only,
 * never "Subscription cancelled" unless a real provider cancellation
 * actually happened.
 */
export function RelationshipReviewPanel({ items }: { items: RelationshipReviewItem[] }) {
  if (items.length === 0) return null

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
      <p className="text-sm font-medium text-amber-900">Memberships needing review</p>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={`${item.payerSubscriptionId}-${item.reason}`} className="text-sm text-amber-900/90">
            <Link href={`/club/finance/${item.payerSubscriptionId}`} className="font-medium underline decoration-amber-900/30 underline-offset-2 hover:decoration-amber-900/60">
              {item.playerName}
            </Link>
            {" — "}
            {REASON_LABEL[item.reason] ?? item.reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
