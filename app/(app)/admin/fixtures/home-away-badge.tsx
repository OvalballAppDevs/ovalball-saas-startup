const STYLES: Record<string, string> = {
  Home: "bg-pitch-600/12 text-forest-800",
  Away: "bg-ink/10 text-ink/70",
  TBD: "bg-amber-500/12 text-amber-700",
  "Not Applicable": "bg-ink/8 text-ink/45",
}

/** Explicit HOME/AWAY label, never relying on team ordering alone -- used everywhere a fixture's owning-team relationship is shown (list, detail, add/edit, CSV import review). */
export function HomeAwayBadge({ value }: { value: string }) {
  return (
    <span className={`rounded-full px-2.5 py-1 text-xs font-bold tracking-[0.04em] uppercase ${STYLES[value] ?? "bg-ink/8 text-ink/50"}`}>
      {value === "Not Applicable" ? "N/A" : value.toUpperCase()}
    </span>
  )
}
