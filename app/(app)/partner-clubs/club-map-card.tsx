"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarRange, ExternalLink } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Button } from "@/components/ui/button"

import { respondToPartnership, requestPartnership } from "./actions"
import { ClubStatusPill } from "./club-status-pill"
import { InviteClubDialog } from "./invite-club-dialog"
import type { MapClub } from "./map-data"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Union", league: "League" }

/**
 * The one card design behind both the map's pin popups and the list
 * panel -- same crest, status pill, and actions either place, so
 * clicking a pin and scanning the list never show two different
 * descriptions of the same club. Message Requests isn't built yet (a
 * separate, later phase of this same brief), so a partner club
 * deliberately gets no "Message" action here rather than one that would
 * silently fail or fake success.
 */
export function ClubMapCard({ club, dense = false }: { club: MapClub; dense?: boolean }) {
  const [requesting, setRequesting] = useState(false)
  const [responding, setResponding] = useState<"accept" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState(club.partnershipStatus)
  const [inviteOpen, setInviteOpen] = useState(false)

  async function handleRequest() {
    if (!club.clubId) return
    setRequesting(true)
    setError(null)
    const result = await requestPartnership(club.clubId)
    setRequesting(false)
    if (result.ok) setLocalStatus("pending_outgoing")
    else setError(result.error)
  }

  async function handleRespond(approve: boolean) {
    if (!club.partnershipId) return
    setResponding(approve ? "accept" : "decline")
    setError(null)
    const result = await respondToPartnership(club.partnershipId, approve)
    setResponding(null)
    if (result.ok) setLocalStatus(approve ? "active" : "none")
    else setError(result.error)
  }

  const locationText = [club.town, club.county].filter(Boolean).join(", ") || (club.hasLocation ? "Location on file" : "Location unavailable")

  return (
    <div className={dense ? "flex flex-col gap-2.5" : "flex flex-col gap-3 p-1"}>
      <div className="flex items-start gap-3">
        <ClubAvatar logoUrl={club.logoUrl} name={club.name} size={dense ? "sm" : "md"} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-ink">{club.name}</p>
          <p className="mt-0.5 text-xs text-ink/50">
            {locationText}
            {club.postcode ? ` · ${club.postcode}` : ""} &middot; {RUGBY_CODE_LABEL[club.rugbyCode] ?? club.rugbyCode}
          </p>
          <div className="mt-1.5">
            <ClubStatusPill club={{ ...club, partnershipStatus: localStatus }} />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-destructive">{error}</p>}

      {!club.isOwnClub && club.clubId && (
        <div className="flex flex-wrap items-center gap-2">
          {localStatus === "none" && (
            <Button type="button" size="sm" className="h-9" disabled={requesting} onClick={handleRequest}>
              {requesting ? "Sending…" : "Request partnership"}
            </Button>
          )}
          {localStatus === "pending_outgoing" && (
            <Button type="button" size="sm" variant="outline" className="h-9" disabled>
              Request sent
            </Button>
          )}
          {localStatus === "pending_incoming" && (
            <>
              <Button type="button" size="sm" className="h-9" disabled={responding !== null} onClick={() => handleRespond(true)}>
                {responding === "accept" ? "Accepting…" : "Accept"}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-9" disabled={responding !== null} onClick={() => handleRespond(false)}>
                {responding === "decline" ? "Declining…" : "Decline"}
              </Button>
            </>
          )}
          {localStatus === "active" && (
            <Button size="sm" className="h-9" nativeButton={false} render={<Link href={`/partner-clubs/${club.clubId}`} />}>
              <CalendarRange className="size-3.5" />
              Shared calendar
            </Button>
          )}
          {club.slug && (
            <Button size="sm" variant="ghost" className="h-9" nativeButton={false} render={<Link href={`/club/${club.slug}`} target="_blank" rel="noopener noreferrer" />}>
              <ExternalLink className="size-3.5" />
              View club
            </Button>
          )}
        </div>
      )}

      {!club.isOwnClub && !club.clubId && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-9 bg-pitch-600 text-white hover:bg-pitch-600/90" onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
          <InviteClubDialog open={inviteOpen} onOpenChange={setInviteOpen} clubDirectoryId={club.directoryId} clubName={club.name} />
        </div>
      )}
    </div>
  )
}
