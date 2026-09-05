"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { requestPartnership } from "../../(app)/partner-clubs/actions"

/**
 * Reuses the exact same requestPartnership server action the authenticated
 * Partner Clubs page already calls -- no second request system. Only
 * rendered by the server parent when the viewer is authenticated with
 * fixture authority somewhere and this isn't their own club (see
 * page.tsx), so the only remaining state to handle here is the existing
 * relationship status, if any.
 */
export function CalendarAccessAction({
  targetClubId,
  targetClubName,
  status,
}: {
  targetClubId: string
  targetClubName: string
  status: "none" | "pending" | "active" | "revoked"
}) {
  const router = useRouter()
  const [current, setCurrent] = useState(status)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRequest() {
    setWorking(true)
    setError(null)
    const result = await requestPartnership(targetClubId)
    setWorking(false)
    if (result.ok) {
      setCurrent("pending")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  if (current === "active") {
    return (
      <Button type="button" variant="outline" className="h-10" render={<Link href={`/partner-clubs/${targetClubId}`} />}>
        View shared calendar
      </Button>
    )
  }

  if (current === "pending") {
    return (
      <span className="inline-flex h-10 items-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-medium text-ink/50">
        Calendar access requested
      </span>
    )
  }

  return (
    <div className="flex flex-col items-start gap-1.5">
      <Button type="button" variant="outline" className="h-10" disabled={working} onClick={handleRequest}>
        {working ? "Requesting…" : `Request calendar access from ${targetClubName}`}
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
