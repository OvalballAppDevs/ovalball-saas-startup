import Link from "next/link"
import { ArrowUpRight } from "lucide-react"

/**
 * The Site Admin dashboard's KPI primitive.
 *
 * Built to carry more than Phase A needs -- a trend, a comparison, a
 * sparkline -- but it renders none of those unless real data is passed for
 * them. A card with a fabricated "+12%" would be worse than a card without
 * one, so the design has to look finished with the number alone, and it
 * does: the figure is the hero, the label sits under it, and the optional
 * second line is genuinely optional.
 *
 * `href` is omitted rather than made up when no canonical Site Admin
 * destination exists yet (Registered Parents and Registered Players have
 * none). A card that does not link simply is not a link.
 */
export function KpiCard({
  label,
  value,
  secondary,
  href,
  sparkline,
  trend,
}: {
  label: string
  value: number
  /** e.g. "41 active". Rendered only when supplied. */
  secondary?: string
  href?: string | null
  /** Reserved for a later phase. Nothing is drawn when absent. */
  sparkline?: React.ReactNode
  /** Reserved for a later phase. Never synthesised from a single reading. */
  trend?: { direction: "up" | "down" | "flat"; label: string }
}) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-ink/55">{label}</p>
        {href ? (
          <ArrowUpRight
            aria-hidden="true"
            className="size-4 shrink-0 text-ink/25 transition-colors group-hover:text-forest-800"
          />
        ) : null}
      </div>

      <p className="mt-3 font-display text-4xl leading-none text-ink tabular-nums">
        {value.toLocaleString("en-GB")}
      </p>

      {secondary ? <p className="mt-2 text-xs text-ink/50 tabular-nums">{secondary}</p> : null}

      {trend ? (
        <p className="mt-2 text-xs text-ink/50">
          {trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—"} {trend.label}
        </p>
      ) : null}

      {sparkline ? <div className="mt-3">{sparkline}</div> : null}
    </>
  )

  const shell = "rounded-lg border border-ink/10 bg-white px-5 py-4"

  if (!href) {
    return <div className={shell}>{body}</div>
  }

  return (
    <Link
      href={href}
      className={`group block ${shell} outline-none transition-colors hover:border-forest-800/30 focus-visible:ring-2 focus-visible:ring-pitch-400`}
    >
      {body}
    </Link>
  )
}

/** Matches KpiCard's footprint so a loading grid does not jump when it resolves. */
export function KpiCardSkeleton({ label }: { label: string }) {
  return (
    <div className="rounded-lg border border-ink/10 bg-white px-5 py-4" aria-busy="true">
      <p className="text-sm text-ink/55">{label}</p>
      <div className="mt-3 h-9 w-20 animate-pulse rounded bg-ink/8" />
      <span className="sr-only">Loading {label}</span>
    </div>
  )
}
