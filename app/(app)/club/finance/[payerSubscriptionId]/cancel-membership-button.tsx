"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { cancelMembershipAction } from "../actions"

/** Explicit confirmation + reason, matching the same window.prompt/confirm pattern already used for Waive/Exempt actions on the dashboard page. */
export function CancelMembershipButton({ payerSubscriptionId, playerName }: { payerSubscriptionId: string; playerName: string }) {
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    const confirmed = window.confirm(
      `Cancel ${playerName}'s Direct Debit membership?\n\nThis stops all future monthly collections. Any already-submitted or confirmed payment is not affected. This cannot be undone from here -- the family would need to re-enrol.`
    )
    if (!confirmed) return
    const reason = window.prompt("Reason for cancelling this membership (required):")
    if (!reason || reason.trim().length === 0) return

    setStatus("loading")
    setError(null)
    const result = await cancelMembershipAction(payerSubscriptionId, reason.trim())
    if (!result.ok) {
      setError(result.error)
      setStatus("error")
    } else {
      setStatus("idle")
    }
  }

  return (
    <div>
      <Button type="button" variant="outline" className="h-9 border-destructive/30 text-destructive hover:bg-destructive/5" disabled={status === "loading"} onClick={handleClick}>
        {status === "loading" ? "Cancelling…" : "Cancel membership"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
