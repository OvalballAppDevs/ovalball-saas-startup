"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { activateMembershipAction } from "./actions"

/** Sends ONLY playerId -- amount, dates, and mandate are never client-controlled inputs, so there is nothing here for a tampered request to substitute even in principle. */
export function ActivateMembershipButton({ playerId }: { playerId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setLoading(true)
    setError(null)
    const result = await activateMembershipAction(playerId)
    if (result.ok) {
      router.refresh()
    } else {
      setLoading(false)
      setError(result.error)
    }
  }

  return (
    <div>
      <Button type="button" className="h-11 w-full" disabled={loading} onClick={handleClick}>
        {loading ? "Starting…" : "Confirm & start membership"}
      </Button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
