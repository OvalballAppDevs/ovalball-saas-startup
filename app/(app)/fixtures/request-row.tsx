"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { acceptFixtureRequest, declineFixtureRequest } from "./actions"

export interface RequestRowData {
  id: string
  direction: "outgoing" | "incoming"
  teamDisplayName: string
  opponentText: string
  proposedDate: string
  venuePreference: string
}

export function RequestRow({ request }: { request: RequestRowData }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handle(action: "accept" | "decline") {
    setStatus("working")
    setError(null)
    const result = action === "accept" ? await acceptFixtureRequest(request.id) : await declineFixtureRequest(request.id)
    if (result.ok) {
      setStatus("done")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  const date = request.proposedDate ? new Date(request.proposedDate + "T00:00:00") : null
  const dateLabel = date?.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" }) ?? "TBC"

  if (status === "done") {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3.5 text-sm text-ink/50">
        {request.teamDisplayName} vs {request.opponentText} &mdash; updated.
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <span
        className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${
          request.direction === "incoming" ? "bg-pitch-600/15 text-forest-900" : "bg-ink/5 text-ink/60"
        }`}
      >
        {request.direction === "incoming" ? "Received" : "Sent"}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">
          {request.teamDisplayName} <span className="text-ink/40">vs</span> {request.opponentText}
        </p>
        <p className="text-xs text-ink/50">
          {dateLabel} · {request.venuePreference}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {request.direction === "incoming" ? (
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" className="h-8" disabled={status === "working"} onClick={() => handle("accept")}>
            Accept
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={status === "working"} onClick={() => handle("decline")}>
            Decline
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" disabled={status === "working"} onClick={() => handle("decline")}>
          Cancel
        </Button>
      )}
    </li>
  )
}
