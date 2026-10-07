import Link from "next/link"
import { FINANCE_WEB_PATHS, REVIEW_REASON_LABEL, type ReviewItem } from "@ovalball/contracts/club/finance"

/**
 * A live Subscription must never become invisible just because the
 * underlying player/guardian relationship changed -- but this NEVER
 * implies money was already cancelled. Truthful "review" language only,
 * never "Subscription cancelled" unless a real provider cancellation
 * actually happened. The words are the shared contract's, so the phone says the same.
 */
export function RelationshipReviewPanel({ items }: { items: ReviewItem[] }) {
  if (items.length === 0) return null

  return (
    <section aria-labelledby="memberships-review" className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
      <h3 id="memberships-review" className="text-sm font-semibold text-amber-900">
        Memberships Needing Review
      </h3>
      <ul className="mt-2 space-y-1.5">
        {items.map((item) => (
          <li key={`${item.payerSubscriptionId}-${item.reason}`} className="text-sm text-amber-900/90">
            <Link
              href={FINANCE_WEB_PATHS.membership(item.payerSubscriptionId)}
              className="font-medium underline decoration-amber-900/30 underline-offset-2 outline-none hover:decoration-amber-900/60 focus-visible:ring-2 focus-visible:ring-forest-800"
            >
              {item.playerName}
            </Link>
            {" — "}
            {REVIEW_REASON_LABEL[item.reason] ?? "Review membership."}
          </li>
        ))}
      </ul>
    </section>
  )
}
