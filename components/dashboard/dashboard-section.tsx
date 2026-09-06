import Link from "next/link"
import { AlertTriangle, ChevronRight, Lock } from "lucide-react"

/**
 * Section shell for the Site Admin dashboard.
 *
 * Every section is a real <section> with a real heading, so the page has a
 * navigable outline rather than a wall of divs -- a Site Admin using a
 * screen reader can jump between Platform, Needs Attention and System
 * Health the same way a sighted one scans for them.
 */
export function DashboardSection({
  title,
  description,
  action,
  children,
}: {
  title: string
  description?: string
  action?: { href: string; label: string }
  children: React.ReactNode
}) {
  const headingId = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`

  return (
    <section aria-labelledby={headingId} className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 id={headingId} className="font-display text-xl text-ink">
          {title}
        </h2>
        {action ? (
          <Link
            href={action.href}
            className="inline-flex items-center gap-1 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            {action.label}
            <ChevronRight aria-hidden="true" className="size-3.5" />
          </Link>
        ) : null}
      </div>
      {description ? <p className="mt-1 max-w-2xl text-sm text-ink/55">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  )
}

/**
 * What a section shows when its read failed.
 *
 * The whole point of Phase A's error handling: this is visibly NOT "0". A
 * Site Admin must never have to wonder whether the platform genuinely has
 * no clubs or whether the query fell over.
 */
export function SectionError({ message, what }: { message: string; what: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 px-5 py-4"
    >
      <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-900" />
      <div className="min-w-0">
        <p className="text-sm font-medium text-amber-950">{what} could not be loaded</p>
        <p className="mt-1 text-sm text-amber-900">
          This is a read failure, not a zero. Refresh to try again; the figures below and above are
          unaffected.
        </p>
        <p className="mt-1.5 font-mono text-xs break-words text-amber-900/80">{message}</p>
      </div>
    </div>
  )
}

/** The database refused the read outright. Different from a failure, and said so. */
export function SectionUnauthorized({ what }: { what: string }) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-ink/10 bg-white px-5 py-4">
      <Lock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink/40" />
      <div>
        <p className="text-sm font-medium text-ink">{what} is not available to your Site Admin profile</p>
        <p className="mt-1 text-sm text-ink/55">
          A Full Site Admin can grant the capability this section needs.
        </p>
      </div>
    </div>
  )
}
