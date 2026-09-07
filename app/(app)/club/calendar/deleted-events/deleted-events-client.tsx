"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import { restoreFixture } from "@/app/(app)/calendar/fixture-lifecycle-actions"

export interface DeletedEventRow {
  eventType: "fixture" | "training"
  canonicalId: string
  teamName: string
  opponentLabel: string | null
  eventDate: string
  eventTime: string | null
  venueName: string | null
  originalStatus: string
  deletedAt: string
  deletedByName: string
  deletedReason: string | null
}

/**
 * Section H's table: event type, fixture/training identity, team, date/
 * time, opponent where applicable, venue, deleted-at/by, reason, original
 * status, canonical record ID. Section J: a real, minimal Restore action
 * for archived fixtures (restore_fixture already exists and is safe --
 * training has no equivalent per-session restore yet, so no button is
 * offered there rather than inventing one).
 */
export function DeletedCalendarEventsClient({ events }: { events: DeletedEventRow[] }) {
  const router = useRouter()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleRestore(canonicalId: string) {
    setPendingId(canonicalId)
    setError(null)
    startTransition(async () => {
      const result = await restoreFixture(canonicalId)
      setPendingId(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  if (events.length === 0) {
    return <div className="mt-6 rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-10 text-center text-sm text-ink-muted">Nothing has been deleted or archived.</div>
  }

  return (
    <div className="mt-6">
      {error && <p className="mb-3 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive-text">{error}</p>}
      <div className="overflow-x-auto rounded-lg border border-ink/10 bg-white">
        <table className="w-full min-w-[960px] text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink-muted uppercase">
              <th scope="col" className="px-4 py-3">Type</th>
              <th scope="col" className="px-4 py-3">Team</th>
              <th scope="col" className="px-4 py-3">Opponent</th>
              <th scope="col" className="px-4 py-3">Date</th>
              <th scope="col" className="px-4 py-3">Venue</th>
              <th scope="col" className="px-4 py-3">Original status</th>
              <th scope="col" className="px-4 py-3">Deleted / cancelled</th>
              <th scope="col" className="px-4 py-3">By</th>
              <th scope="col" className="px-4 py-3">Reason</th>
              <th scope="col" className="px-4 py-3">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => (
              <tr key={`${e.eventType}:${e.canonicalId}`} className="border-b border-ink/5 align-top last:border-0">
                <td className="px-4 py-3">
                  <span className={cn("rounded-full border px-2 py-0.5 text-xs font-medium", e.eventType === "fixture" ? "border-forest-800/20 bg-forest-800/5 text-forest-900" : "border-ink/15 bg-ink/5 text-ink/70")}>
                    {e.eventType === "fixture" ? "Fixture" : "Training"}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink">{e.teamName}</td>
                <td className="px-4 py-3 text-ink/70">{e.opponentLabel ?? "--"}</td>
                <td className="px-4 py-3 text-ink/70">
                  {new Date(`${e.eventDate}T00:00:00`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  {e.eventTime ? ` · ${e.eventTime.slice(0, 5)}` : ""}
                </td>
                <td className="px-4 py-3 text-ink/70">{e.venueName ?? "--"}</td>
                <td className="px-4 py-3 text-ink/70">{e.originalStatus}</td>
                <td className="px-4 py-3 text-ink/70">{new Date(e.deletedAt).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" })}</td>
                <td className="px-4 py-3 text-ink/70">{e.deletedByName}</td>
                <td className="max-w-[220px] px-4 py-3 text-ink/70">{e.deletedReason ?? "--"}</td>
                <td className="px-4 py-3">
                  {e.eventType === "fixture" && (
                    <Button type="button" variant="outline" className="h-8 text-xs" disabled={isPending && pendingId === e.canonicalId} onClick={() => handleRestore(e.canonicalId)}>
                      {isPending && pendingId === e.canonicalId ? "Restoring…" : "Restore"}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
