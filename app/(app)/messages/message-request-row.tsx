"use client"

import { useState } from "react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Button } from "@/components/ui/button"

import { respondToClubMessageRequest } from "./club-actions"

export interface MessageRequestRowData {
  id: string
  clubName: string
  clubLogoUrl: string | null
  firstMessagePreview: string | null
  requestedAt: string
  direction: "incoming" | "outgoing"
}

/**
 * Incoming: Accept/Decline, per the brief's own worked example (club
 * name, crest, first-message preview, sent time, Accept/Decline).
 * Outgoing: a plain "Sent -- awaiting response" row, no action -- there is
 * no cancel affordance for a message request in this pass (unlike a
 * fixture request, cancelling isn't in the brief's scope here).
 */
export function MessageRequestRow({ request }: { request: MessageRequestRowData }) {
  const [status, setStatus] = useState<"idle" | "working" | "done" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handle(approve: boolean) {
    setStatus("working")
    setError(null)
    const result = await respondToClubMessageRequest(request.id, approve)
    if (result.ok) {
      setStatus("done")
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  const timeLabel = new Date(request.requestedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })

  if (status === "done") {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3.5 text-sm text-ink/50">{request.clubName} &mdash; updated.</li>
    )
  }

  return (
    <li className="flex flex-wrap items-start gap-3 rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <ClubAvatar logoUrl={request.clubLogoUrl} name={request.clubName} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-ink">{request.clubName}</p>
          <span className="shrink-0 text-xs text-ink/40">{timeLabel}</span>
        </div>
        {request.firstMessagePreview && <p className="mt-1 truncate text-sm text-ink/65">&ldquo;{request.firstMessagePreview}&rdquo;</p>}
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      {request.direction === "incoming" ? (
        <div className="flex shrink-0 items-center gap-2">
          <Button type="button" size="sm" className="h-8" disabled={status === "working"} onClick={() => handle(true)}>
            Accept
          </Button>
          <Button type="button" size="sm" variant="outline" className="h-8" disabled={status === "working"} onClick={() => handle(false)}>
            Decline
          </Button>
        </div>
      ) : (
        <span className="shrink-0 rounded-full bg-ink/5 px-2.5 py-1 text-xs font-medium text-ink/50">Sent &middot; awaiting response</span>
      )}
    </li>
  )
}
