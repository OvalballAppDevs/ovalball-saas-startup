import Link from "next/link"
import { ChevronRight, CircleAlert, Info, TriangleAlert } from "lucide-react"

import type { AlertSeverity, DashboardAlert } from "@/lib/app-context/site-admin-dashboard-data"

/**
 * Needs Attention.
 *
 * Severity is carried by the WORD and the ICON SHAPE first; colour is the
 * third signal, never the only one -- the same rule the commercial page's
 * StatusPill already follows. Signals reading zero never reach this list,
 * so an empty list genuinely means nothing needs doing.
 *
 * An alert with no canonical destination renders without a link rather
 * than with a plausible one. Two Phase A signals are in that position and
 * say so in their own text; a dead link would waste more of a Site Admin's
 * time than an honest note.
 */
const SEVERITY: Record<
  AlertSeverity,
  { label: string; icon: typeof Info; row: string; chip: string; iconClass: string }
> = {
  action: {
    label: "Action required",
    icon: CircleAlert,
    row: "border-amber-300 bg-amber-50",
    chip: "bg-amber-900 text-amber-50",
    iconClass: "text-amber-900",
  },
  warning: {
    label: "Warning",
    icon: TriangleAlert,
    row: "border-ink/10 bg-white",
    chip: "bg-amber-100 text-amber-950",
    iconClass: "text-amber-800",
  },
  info: {
    label: "For information",
    icon: Info,
    row: "border-ink/10 bg-white",
    chip: "bg-ink/8 text-ink/70",
    iconClass: "text-ink/40",
  },
}

export function AlertList({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white px-5 py-6">
        <p className="text-sm font-medium text-ink">Nothing needs attention</p>
        <p className="mt-1 text-sm text-ink/55">
          No claims waiting, no disputed results, no open tickets, and no failed Ovalball
          collections.
        </p>
      </div>
    )
  }

  return (
    <ul className="flex flex-col gap-2">
      {alerts.map((alert) => {
        const s = SEVERITY[alert.severity]
        const Icon = s.icon

        return (
          <li key={alert.key} className={`rounded-lg border px-5 py-3.5 ${s.row}`}>
            <div className="flex items-start gap-3">
              <Icon aria-hidden="true" className={`mt-0.5 size-4 shrink-0 ${s.iconClass}`} />

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  {alert.count !== null ? (
                    <span
                      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium tabular-nums ${s.chip}`}
                    >
                      {alert.count.toLocaleString("en-GB")}
                    </span>
                  ) : null}
                  <p className="text-sm font-medium text-ink">{alert.title}</p>
                  <span className="sr-only">— {s.label}</span>
                </div>
                <p className="mt-1 text-sm text-ink/55">{alert.detail}</p>
              </div>

              {alert.href ? (
                <Link
                  href={alert.href}
                  className="inline-flex shrink-0 items-center gap-1 self-center text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  Open
                  <ChevronRight aria-hidden="true" className="size-3.5" />
                </Link>
              ) : null}
            </div>
          </li>
        )
      })}
    </ul>
  )
}
