/**
 * A compact panel surfacing what needs a Club Admin's attention in a month the Overview does not cover -- counts only,
 * driven by the same canonical rows the table below shows. In the ledger's own words (contracts' OBLIGATION_STATUS_SHORT):
 * a month nobody has paid yet is "not yet collected", so it never collides with a person's "Not set up".
 */
export function AttentionPanel({ failedCount, notSetUpCount, overdueCount }: { failedCount: number; notSetUpCount: number; overdueCount: number }) {
  if (failedCount === 0 && notSetUpCount === 0 && overdueCount === 0) {
    return <p className="rounded-2xl border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink-muted">Nothing needs attention this month.</p>
  }

  const items = [
    failedCount > 0 && { label: `${failedCount} failed`, tone: "danger" as const },
    // Red only for a failed payment (MONTH_STATUS_TONE): overdue is amber, as it is everywhere else.
    overdueCount > 0 && { label: `${overdueCount} overdue`, tone: "warning" as const },
    notSetUpCount > 0 && { label: `${notSetUpCount} not yet collected`, tone: "warning" as const },
  ].filter((x): x is { label: string; tone: "danger" | "warning" } => Boolean(x))

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3">
      <span className="sr-only">Needs attention:</span>
      {items.map((item) => (
        <span key={item.label} className={`rounded-full px-3 py-1 text-xs font-medium ${item.tone === "danger" ? "bg-destructive/10 text-destructive-text" : "bg-amber-200/60 text-amber-900"}`}>
          {item.label}
        </span>
      ))}
    </div>
  )
}
