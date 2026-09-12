import type { EmailRecentDelivery } from "@/lib/email/usage"

const STATUS_LABEL: Record<string, string> = {
  sent: "Accepted",
  failed: "Failed",
  suppressed: "Suppressed",
  queued: "Queued",
  sending: "Sending",
}

/**
 * A BOUNDED recent-delivery view -- the last 20 rows for this event
 * (lib/email/usage.ts#fetchRecentDeliveries), never an unbounded dump.
 * `destination` already arrives masked from the database (first character
 * plus domain); this component does not touch a raw recipient address.
 */
export function EmailDeliveryHistory({ deliveries }: { deliveries: EmailRecentDelivery[] }) {
  if (deliveries.length === 0) return null

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg text-ink">Delivery History</h2>
      <p className="mt-1 max-w-xl text-sm text-ink-muted">The most recent sends of this email, from the delivery ledger.</p>
      <ul className="mt-3 divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
        {deliveries.map((d) => (
          <li key={d.id} className="flex flex-col gap-1 px-5 py-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="min-w-0 text-sm text-ink">
              {new Date(d.queuedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}
              {d.destination && <span className="ml-2 text-ink-muted">&middot; {d.destination}</span>}
            </span>
            <span className="flex shrink-0 flex-wrap items-center gap-2">
              {d.isTest && <Chip tone="quiet">Test</Chip>}
              <Chip tone={d.status === "failed" ? "amber" : d.status === "sent" ? "forest" : "quiet"}>
                {STATUS_LABEL[d.status] ?? d.status}
              </Chip>
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Chip({ tone, children }: { tone: "quiet" | "forest" | "amber"; children: React.ReactNode }) {
  const tones = {
    quiet: "border-ink/15 text-ink-muted",
    forest: "border-forest-800/30 text-forest-800",
    amber: "border-amber-500/40 text-ink",
  } as const
  return <span className={`rounded-full border px-2.5 py-0.5 text-xs whitespace-nowrap ${tones[tone]}`}>{children}</span>
}
