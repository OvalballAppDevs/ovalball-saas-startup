"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { cancelOwnMembershipAction } from "./actions"

/**
 * Truthful confirmation copy only -- never promises a consequence
 * GoCardless doesn't guarantee. Does not mention rugby club/team
 * membership being removed (it isn't, and this button has no power over
 * that relationship at all).
 */
export function CancelOwnMembershipButton({ playerId, playerName }: { playerId: string; playerName: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    const confirmed = window.confirm(
      `Cancel ${playerName}'s membership?\n\n` +
        `- Future monthly collections will be stopped.\n` +
        `- A payment already submitted or being processed may still complete -- GoCardless does not guarantee it can be stopped once submitted.\n` +
        `- Your past payments remain on record.\n` +
        `- This does not remove ${playerName} from the club or team.`
    )
    if (!confirmed) return
    const reason = window.prompt("Reason for cancelling (required):")
    if (!reason || reason.trim().length === 0) return

    setStatus("loading")
    setError(null)
    const result = await cancelOwnMembershipAction(playerId, reason.trim())
    if (!result.ok) {
      setError(result.error)
      setStatus("error")
    } else {
      setStatus("idle")
    }
  }

  return (
    // mb-16: this is the last interactive element on the page -- without
    // extra clearance, a fixed-position chat/support widget can overlap
    // it at the bottom of a short page on mobile.
    <div className="mt-3 mb-16">
      <Button type="button" variant="outline" className="h-9 border-destructive/30 text-destructive hover:bg-destructive/5" disabled={status === "loading"} onClick={handleClick}>
        {status === "loading" ? "Cancelling…" : "Cancel membership"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
