/**
 * TRANSACTIONAL EMAIL -- the compact operational overview at the top of
 * Email Configuration.
 *
 * Every number here comes from public.email_deliveries, the one canonical
 * delivery ledger, through a single set-based aggregate query
 * (lib/email/usage.ts#fetchEmailUsageSummary) -- never counted client-side,
 * never a query per email type.
 *
 * WHAT "PROVIDER ACCEPTED" DOES AND DOES NOT MEAN
 *
 * A provider returning success means the message was ACCEPTED for
 * delivery, not that it reached an inbox -- Ovalball has no visibility
 * past that point without webhook delivery tracking, which does not exist
 * yet. This is why the label says "Provider Accepted" and not "Delivered",
 * and why nothing on this page claims a ZeptoMail credit balance Ovalball
 * does not actually have access to.
 */
export function UsageDashboard({
  thisMonthRecipientDeliveries,
  providerAccepted,
  failed,
  testSends,
  activeEventCount,
  totalEventCount,
}: {
  thisMonthRecipientDeliveries: number
  providerAccepted: number
  failed: number
  testSends: number
  activeEventCount: number
  totalEventCount: number
}) {
  const stats: Array<{ label: string; value: string; tone: "default" | "warn" }> = [
    { label: "This Month", value: thisMonthRecipientDeliveries.toLocaleString(), tone: "default" },
    { label: "Provider Accepted", value: providerAccepted.toLocaleString(), tone: "default" },
    { label: "Failed", value: failed.toLocaleString(), tone: failed > 0 ? "warn" : "default" },
    { label: "Test Emails", value: testSends.toLocaleString(), tone: "default" },
    { label: "Active Email Types", value: `${activeEventCount} of ${totalEventCount}`, tone: "default" },
  ]

  return (
    <section className="mt-8">
      <h2 className="font-display text-lg text-ink">Transactional Email</h2>
      <p className="mt-1 max-w-xl text-sm text-ink-muted">
        Recipient delivery attempts this month, from the delivery ledger. Provider acceptance is not proof an email
        reached an inbox.
      </p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
            <dt className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">{s.label}</dt>
            <dd className={`mt-1 font-mono text-2xl font-semibold tabular-nums ${s.tone === "warn" ? "text-destructive-text" : "text-ink"}`}>
              {s.value}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  )
}
