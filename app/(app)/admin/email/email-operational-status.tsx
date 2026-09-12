/**
 * ONE EMAIL'S OPERATIONAL SECTION -- status, template, usage, health, all
 * at a glance, above the template editor rather than inside it. Answers
 * "is this working" before "what does it say".
 */
export function EmailOperationalStatus({
  active,
  wired,
  templateStatus,
  thisMonthRecipientDeliveries,
  allTimeRecipientDeliveries,
  lastSentAt,
  providerAccepted,
  failed,
}: {
  active: boolean
  wired: boolean
  templateStatus: string
  thisMonthRecipientDeliveries: number
  allTimeRecipientDeliveries: number
  lastSentAt: string | null
  providerAccepted: number
  failed: number
}) {
  return (
    <section className="mt-4 rounded-lg border border-ink/10 bg-white p-5">
      {failed > 0 && (
        <p className="mb-4 flex items-center gap-1.5 rounded-lg border border-amber-500/30 bg-amber-50/60 px-3 py-2 text-sm text-ink">
          {failed} failed this month
        </p>
      )}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Stat label="Status" value={!wired ? "Not Wired" : active ? "Enabled" : "Disabled"} />
        <Stat label="Template" value={templateStatus} />
        <Stat label="This Month" value={`${thisMonthRecipientDeliveries.toLocaleString()} recipient emails`} />
        <Stat label="All Time" value={`${allTimeRecipientDeliveries.toLocaleString()} recipient emails`} />
        <Stat
          label="Last Sent"
          value={
            lastSentAt
              ? new Date(lastSentAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })
              : "Never sent from this deployment"
          }
        />
        <Stat label="Recent Health" value={`${providerAccepted} accepted / ${failed} failed`} />
      </dl>
      {!wired && (
        <p className="mt-4 text-xs text-ink-muted">
          Nothing in Ovalball sends this email yet, so there is no channel to enable or disable.
        </p>
      )}
    </section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{value}</dd>
    </div>
  )
}
