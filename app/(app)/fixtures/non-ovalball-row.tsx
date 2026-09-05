"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { declineFixtureRequest } from "./actions"

export interface NonOvalballRowData {
  id: string
  teamDisplayName: string
  opponentText: string
  proposedDate: string
  venuePreference: string
}

/**
 * A fixture arranged against a club not active on Ovalball -- never
 * "Sent" or "Awaiting response" (there is no one on Ovalball to receive
 * or respond to anything). Recorded on the calendar, quietly, with
 * honest language and no accept/decline affordance -- only a way to
 * remove it if it was arranged in error. Reuses declineFixtureRequest,
 * the same underlying row-removal RPC an ordinary outgoing request
 * cancel already uses; the distinction here is purely presentational.
 */
export function NonOvalballRow({ request }: { request: NonOvalballRowData }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const date = request.proposedDate ? new Date(request.proposedDate + "T00:00:00") : null
  const dateLabel = date?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) ?? "TBC"

  async function handleRemove() {
    setStatus("working")
    setError(null)
    const result = await declineFixtureRequest(request.id)
    if (result.ok) setStatus("done")
    else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "done") {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3 text-sm text-ink/50">
        {request.teamDisplayName} vs {request.opponentText} &mdash; removed.
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3">
      <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 text-xs font-medium text-ink/55">Not on Ovalball</span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {request.teamDisplayName} <span className="text-ink/40">vs</span> {request.opponentText}
        </p>
        <p className="text-xs text-ink/50">
          {dateLabel} · {request.venuePreference} · Recorded locally &mdash; no Ovalball request delivered
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" disabled={status === "working"} onClick={handleRemove}>
        Remove
      </Button>
    </li>
  )
}
