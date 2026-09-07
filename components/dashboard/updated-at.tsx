"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { RefreshCw } from "lucide-react"

/**
 * "Updated 2 minutes ago", plus the dashboard's refresh.
 *
 * Deliberately not Supabase Realtime. Nothing on this dashboard changes
 * fast enough to justify a socket per Site Admin -- a claim arrives every
 * few hours, not every few seconds -- and a periodic server re-render costs
 * three cheap aggregates. Realtime here would be churn dressed up as
 * immediacy.
 *
 * Two things keep the churn honest:
 *   * the interval only fires while the tab is actually visible, so a
 *     dashboard left open on a second monitor overnight issues nothing;
 *   * refreshing is router.refresh(), which re-runs the Server Component
 *     and streams back new HTML, rather than a client fetch of privileged
 *     rows the browser would then have to aggregate itself.
 */
const REFRESH_MS = 60_000

export function UpdatedAt({ generatedAt }: { generatedAt: string | null }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [now, setNow] = useState(() => Date.now())

  // Ticks the label only. Cheap, and independent of the data refresh.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    if (typeof document === "undefined") return

    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return
      startTransition(() => router.refresh())
    }, REFRESH_MS)

    return () => clearInterval(id)
  }, [router])

  const label = generatedAt ? relative(generatedAt, now) : null

  return (
    <div className="flex items-center gap-2 text-xs text-ink-muted">
      <span aria-live="polite" className="tabular-nums">
        {isPending ? "Updating…" : label ? `Updated ${label}` : "Not updated"}
      </span>
      <button
        type="button"
        onClick={() => startTransition(() => router.refresh())}
        disabled={isPending}
        className="inline-flex items-center gap-1 rounded-full border border-ink/12 px-2.5 py-1 font-medium text-ink/70 outline-none transition-colors hover:border-forest-800/30 hover:text-forest-900 focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-50"
      >
        <RefreshCw aria-hidden="true" className={`size-3 ${isPending ? "animate-spin" : ""}`} />
        Refresh
      </button>
    </div>
  )
}

function relative(iso: string, now: number): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return "just now"

  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return "just now"

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`

  const hours = Math.round(minutes / 60)
  return `${hours} hour${hours === 1 ? "" : "s"} ago`
}
