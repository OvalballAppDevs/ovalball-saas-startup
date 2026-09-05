"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { approvePendingTeamMembership, rejectPendingTeamMembership } from "./actions"

export interface PendingMembershipData {
  id: string
  playerName: string
  playerDob: string | null
  teamLabel: string
  guardianName: string
}

/**
 * The Team Admin's queue for a self-service Add-a-Child join
 * (add_child_for_guardian created this row as 'pending' -- never active --
 * because a self-service join has no prior invitation vouching for it).
 * Approve activates the real roster membership; reject ends it without
 * ever silently granting access.
 */
export function PendingMembershipRow({ request }: { request: PendingMembershipData }) {
  const router = useRouter()
  const [resolved, setResolved] = useState<"approved" | "rejected" | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleApprove() {
    setPending(true)
    setError(null)
    const result = await approvePendingTeamMembership(request.id)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setResolved("approved")
    router.refresh()
  }

  async function handleReject() {
    setPending(true)
    setError(null)
    const result = await rejectPendingTeamMembership(request.id, "Declined by club")
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setResolved("rejected")
    router.refresh()
  }

  if (resolved) {
    return (
      <li className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink/50">
        {request.playerName} — {resolved === "approved" ? "approved onto the team." : "declined."}
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3.5">
      <p className="text-xs font-medium text-ink/50">{request.teamLabel}</p>
      <p className="mt-1 text-sm font-medium text-ink">{request.playerName}</p>
      <p className="text-xs text-ink/55">
        {request.playerDob ?? "No date of birth given"} · Added by {request.guardianName}
      </p>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-8" disabled={pending} onClick={handleApprove}>
          Approve
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" disabled={pending} onClick={handleReject}>
          Decline
        </Button>
      </div>
    </li>
  )
}
