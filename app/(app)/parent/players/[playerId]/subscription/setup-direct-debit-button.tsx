"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { startSubscriptionEnrolment } from "./actions"

export function SetupDirectDebitButton({ playerId, programmeId, clubId }: { playerId: string; programmeId: string; clubId: string }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    const result = await startSubscriptionEnrolment(playerId, programmeId, clubId)
    if (result.ok) {
      window.location.href = result.authorisationUrl
    } else {
      setLoading(false)
      setError(result.error)
    }
  }

  return (
    <div>
      <Button type="button" className="h-11 w-full" disabled={loading} onClick={handleClick}>
        {loading ? "Starting…" : "Set Up Direct Debit"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
