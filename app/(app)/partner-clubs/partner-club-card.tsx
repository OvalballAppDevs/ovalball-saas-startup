"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarRange } from "lucide-react"

import { Button } from "@/components/ui/button"

import { revokePartnership } from "./actions"

export interface ActivePartnerData {
  partnershipId: string
  clubId: string
  clubName: string
  town: string | null
  county: string | null
  rugbyCode: string
  activeSince: string
}

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Union", league: "League" }

export function PartnerClubCard({ partner }: { partner: ActivePartnerData }) {
  const [revoking, setRevoking] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    setRevoking(true)
    setError(null)
    const result = await revokePartnership(partner.partnershipId)
    setRevoking(false)
    if (result.ok) setRevoked(true)
    else setError(result.error)
  }

  if (revoked) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white/50 px-5 py-4 text-sm text-ink/50">
        {partner.clubName} &mdash; calendar sharing revoked.
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-ink/10 bg-white px-5 py-4">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-ink">{partner.clubName}</p>
        <p className="mt-0.5 text-xs text-ink/50">
          {[partner.town, partner.county].filter(Boolean).join(", ") || "Location unknown"} · {RUGBY_CODE_LABEL[partner.rugbyCode] ?? partner.rugbyCode}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          size="sm"
          className="h-9"
          nativeButton={false}
          render={<Link href={`/partner-clubs/${partner.clubId}`} />}
        >
          <CalendarRange className="size-4" />
          View availability
        </Button>
        <Button type="button" size="sm" variant="ghost" className="h-9" disabled={revoking} onClick={handleRevoke}>
          {revoking ? "Revoking…" : "Revoke"}
        </Button>
      </div>
    </div>
  )
}
