"use client"

import { useState } from "react"
import { MapPin } from "lucide-react"

import { Button } from "@/components/ui/button"

import { runGeocodingBackfillAction } from "./geocoding-actions"
import type { GeocodingStatusSummary } from "@/lib/geocoding/backfill"

/**
 * Surfaces the map's data-quality picture right where Site Admins already
 * fix club_directory rows -- "failed"/"no_postcode" here is a to-do list
 * (add or correct a postcode, then re-run), never a silent gap on the map.
 */
export function GeocodingPanel({ initialSummary }: { initialSummary: GeocodingStatusSummary }) {
  const [summary, setSummary] = useState(initialSummary)
  const [status, setStatus] = useState<"idle" | "working" | "error">("idle")
  const [error, setError] = useState<string | null>(null)
  const [lastRun, setLastRun] = useState<string | null>(null)

  async function handleRun() {
    setStatus("working")
    setError(null)
    const result = await runGeocodingBackfillAction()
    if (!result.ok) {
      setStatus("error")
      setError(result.error)
      return
    }
    setStatus("idle")
    const { geocoded, failed, markedNoPostcode } = result.summary
    setLastRun(
      `Geocoded ${geocoded}, failed ${failed}, marked ${markedNoPostcode} as no postcode on file.`
    )
    setSummary((prev) => ({
      pending: Math.max(0, prev.pending - geocoded - failed - markedNoPostcode),
      success: prev.success + geocoded,
      noPostcode: prev.noPostcode + markedNoPostcode,
      failed: prev.failed + failed,
    }))
  }

  return (
    <div className="mt-4 flex flex-col gap-3 rounded-lg border border-ink/10 bg-white p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <MapPin className="mt-0.5 size-4 shrink-0 text-forest-800" />
        <div>
          <p className="text-sm font-medium text-ink">Map location data</p>
          <p className="mt-0.5 text-xs text-ink/50">
            {summary.success} on the map &middot; {summary.pending} pending &middot; {summary.noPostcode} have no
            postcode on file &middot; {summary.failed} couldn&apos;t be resolved
          </p>
          {lastRun && <p className="mt-1 text-xs text-forest-800">{lastRun}</p>}
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      </div>
      <Button
        type="button"
        variant="outline"
        className="h-9 shrink-0"
        disabled={status === "working" || summary.pending === 0}
        onClick={handleRun}
      >
        {status === "working" ? "Geocoding…" : summary.pending === 0 ? "Nothing pending" : `Geocode ${summary.pending} pending`}
      </Button>
    </div>
  )
}
