/** A compact panel surfacing what needs a Club Admin's attention this month -- counts only, driven by the same canonical rows the table below shows. */
export function AttentionPanel({ failedCount, notSetUpCount, overdueCount }: { failedCount: number; notSetUpCount: number; overdueCount: number }) {
  if (failedCount === 0 && notSetUpCount === 0 && overdueCount === 0) {
    return <p className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink/50">Nothing needs attention this month.</p>
  }

  const items = [
    failedCount > 0 && { label: `${failedCount} Failed`, tone: "danger" as const },
    overdueCount > 0 && { label: `${overdueCount} Overdue`, tone: "danger" as const },
    notSetUpCount > 0 && { label: `${notSetUpCount} Not Set Up`, tone: "warning" as const },
  ].filter((x): x is { label: string; tone: "danger" | "warning" } => Boolean(x))

  return (
    <div className="flex flex-wrap gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
      {items.map((item) => (
        <span key={item.label} className={`rounded-full px-3 py-1 text-xs font-medium ${item.tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-amber-200/60 text-amber-900"}`}>
          {item.label}
        </span>
      ))}
    </div>
  )
}
