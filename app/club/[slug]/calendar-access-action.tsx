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
      <span className="inline-flex h-10 items-center rounded-lg border border-ink/15 bg-white px-4 text-sm font-medium text-ink-muted">
        Calendar access requested
      </span>
    )
  }

  return (
    <div className="flex min-w-0 flex-col items-start gap-1.5">
      {/* CONVERGENCE STEP 18 (UX-6/§21): the visible label is short, and the club's name stays in the
          ACCESSIBLE name.
          It used to read "Request calendar access from Step 2 Review RFC" in full. A Button is
          whitespace-nowrap and shrink-0 by design, so a long label cannot wrap or shrink -- measured at
          390px it was 355px wide inside a 316px row and gave this page a horizontal overflow. It was also
          redundant: this IS that club's page, and the card it sits in is headed with the club. */}
      <Button type="button" variant="outline" className="h-10 max-w-full" disabled={working} onClick={handleRequest}>
        {working ? "Requesting…" : "Request calendar access"}
        {!working && <span className="sr-only"> from {targetClubName}</span>}
      </Button>
      {error && <p className="text-xs text-destructive-text">{error}</p>}
    </div>
  )
}
