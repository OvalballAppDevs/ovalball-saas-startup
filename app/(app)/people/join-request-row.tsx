"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"

import { decideJoinRequest } from "./actions"

export interface JoinRequestData {
  id: string
  name: string
  requestedRole: string | null
  createdAt: string
}

export function JoinRequestRow({ request }: { request: JoinRequestData }) {
  const [decided, setDecided] = useState<"approved" | "declined" | null>(null)
  const [declining, setDeclining] = useState(false)
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function decide(decision: "APPROVE" | "DECLINE") {
    setSaving(true)
    setError(null)
    const result = await decideJoinRequest(request.id, decision, decision === "DECLINE" ? reason : "")
    setSaving(false)
    if (result.ok) setDecided(decision === "APPROVE" ? "approved" : "declined")
    else setError(result.error)
  }

  if (decided) {
    return (
      <li className="rounded-lg border border-ink/10 bg-white/50 px-4 py-3 text-sm text-ink-muted">
        {request.name} &mdash; {decided === "approved" ? "approved as a member." : "request declined."}
      </li>
    )
  }

  const reasonId = `join-request-reason-${request.id}`

  return (
    <li className="rounded-lg border border-ink/10 bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{request.name}</p>
          <p className="text-xs text-ink-muted">
            {request.requestedRole ? `Says they are: ${request.requestedRole}` : "No role given"} &middot; asked{" "}
            {new Date(request.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
          </p>
        </div>
        {!declining && (
          <div className="flex shrink-0 items-center gap-2">
            <Button type="button" className="h-9" disabled={saving} onClick={() => decide("APPROVE")}>
              {saving ? "Approving…" : "Approve"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={saving} onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </div>
        )}
      </div>

      {declining && (
        <div className="mt-3 flex flex-col gap-2">
          <Label htmlFor={reasonId}>Reason for Declining</Label>
          <input
            id={reasonId}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            maxLength={500}
            className="h-9 rounded-lg border border-ink/15 bg-white px-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
          />
          <p className="text-xs text-ink-muted">Kept in the club&apos;s records. It is not shown to the person who asked.</p>
          <div className="flex items-center gap-2">
            <Button type="button" variant="destructive" className="h-9" disabled={saving || reason.trim().length === 0} onClick={() => decide("DECLINE")}>
              {saving ? "Declining…" : "Decline Request"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={saving} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-2 text-xs text-destructive-text">{error}</p>}
    </li>
  )
}
