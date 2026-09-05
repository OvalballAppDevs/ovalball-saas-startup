"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { respondToPartnership, revokePartnership } from "./actions"

export interface PendingPartnershipData {
  id: string
  clubName: string
  town: string | null
  direction: "incoming" | "outgoing"
  requestedAt: string
  /** True when this request was created automatically after a fixture was accepted between the two clubs, rather than requested directly through Partner Clubs. */
  fromFixture: boolean
}

export function PartnershipRequestRow({ request }: { request: PendingPartnershipData }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handle(action: "approve" | "decline" | "cancel") {
    setStatus("working")
    setError(null)
    const result = action === "cancel" ? await revokePartnership(request.id) : await respondToPartnership(request.id, action === "approve")
    if (result.ok) {
      setStatus("done")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  if (status === "done") {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3.5 text-sm text-ink/50">
        {request.clubName} &mdash; updated.
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
        <p className="truncate text-sm font-medium text-ink">{request.clubName}</p>
        <p className="text-xs text-ink/50">{request.town ?? "Location unknown"}</p>
        {request.fromFixture && (
          <p className="mt-1 text-xs text-forest-800">Sent automatically after a fixture was agreed between your clubs.</p>
        )}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {request.direction === "incoming" ? (
        <div className="flex shrink-0 gap-2">
          <Button type="button" size="sm" className="h-8" disabled={status === "working"} onClick={() => handle("approve")}>
            Approve
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={status === "working"} onClick={() => handle("decline")}>
            Decline
          </Button>
        </div>
      ) : (
        <Button type="button" size="sm" variant="ghost" className="h-8 shrink-0" disabled={status === "working"} onClick={() => handle("cancel")}>
          Cancel
        </Button>
      )}
    </li>
  )
}
