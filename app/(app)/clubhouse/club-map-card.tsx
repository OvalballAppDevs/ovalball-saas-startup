"use client"

import { useState } from "react"
import Link from "next/link"
import { CalendarRange, ExternalLink, MessageCircle, Search } from "lucide-react"

import { ClubAvatar } from "@/components/club/club-avatar"
import { Button } from "@/components/ui/button"

import { respondToPartnership, requestPartnership } from "./actions"
import { ClubStatusPill } from "./club-status-pill"
import { InviteClubDialog } from "./invite-club-dialog"
import { MessageClubDialog } from "./message-club-dialog"
import type { MapClub } from "./map-data"

const RUGBY_CODE_LABEL: Record<string, string> = { union: "Union", league: "League" }

/**
 * The one card design behind both the map's pin popups and the list
 * panel -- same crest, status pill, and actions either place, so
 * clicking a pin and scanning the list never show two different
 * descriptions of the same club.
 *
 * CLUBHOUSE PROGRAMME SECTION 10: "Message" goes straight to
 * start_or_get_club_conversation with this exact club pre-selected --
 * never a second search for a club already on screen. Offered for any
 * active Ovalball club (club.clubId set), not only a partner -- the RPC
 * itself works for any two clubs, auto-accepting only when they are
 * already partners. myClubId is optional/nullable because a viewer with
 * no manageable club at all should never see it; the RPC's own authority
 * check remains the real gate regardless of what this card shows.
 *

 * CLUBHOUSE PROGRAMME SECTION 5: `canManagePartnerships` gates Request
 * Partnership/Accept/Decline/Revoke -- this card is now reachable by a
 * legitimate team-context viewer too (the Section 2 nav entry always
 * promised it; the page-level redirect that used to block them away was
 * closed this section), and a team-scoped Coach or Team Manager never
 * holds `club.partners.manage`. The underlying RPCs already refuse the
 * call server-side regardless, but offering a button that can only ever
 * fail is exactly what "READ != MANAGE" says not to do -- so the caller
 * passes real, capability-derived authority in, never a default assumed
 * here.
 */
export function ClubMapCard({
  club,
  dense = false,
  canManagePartnerships,
  myClubId = null,
}: {
  club: MapClub
  dense?: boolean
  canManagePartnerships: boolean
  myClubId?: string | null
}) {
  const [requesting, setRequesting] = useState(false)
  const [responding, setResponding] = useState<"accept" | "decline" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState(club.partnershipStatus)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)

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
          <p className="mt-0.5 text-xs text-ink-muted">
            {locationText}
            {club.postcode ? ` · ${club.postcode}` : ""} &middot; {RUGBY_CODE_LABEL[club.rugbyCode] ?? club.rugbyCode}
          </p>
          <div className="mt-1.5">
            <ClubStatusPill club={{ ...club, partnershipStatus: localStatus }} />
          </div>
        </div>
      </div>

      {error && <p className="text-xs text-destructive-text">{error}</p>}

      {!club.isOwnClub && club.clubId && (
        <div className="flex flex-wrap items-center gap-2">
          {canManagePartnerships && localStatus === "none" && (
            <Button type="button" size="sm" className="h-9" disabled={requesting} onClick={handleRequest}>
              {requesting ? "Sending…" : "Request Partnership"}
            </Button>
          )}
          {canManagePartnerships && localStatus === "pending_outgoing" && (
            <Button type="button" size="sm" variant="outline" className="h-9" disabled>
              Request Sent
            </Button>
          )}
          {canManagePartnerships && localStatus === "pending_incoming" && (
            <>
              <Button type="button" size="sm" className="h-9" disabled={responding !== null} onClick={() => handleRespond(true)}>
                {responding === "accept" ? "Accepting…" : "Accept"}
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-9" disabled={responding !== null} onClick={() => handleRespond(false)}>
                {responding === "decline" ? "Declining…" : "Decline"}
              </Button>
            </>
          )}
          {/* Not gated on canManagePartnerships -- both navigate to an already independently-
              authority-checked destination (app/(app)/clubhouse/[clubId]/page.tsx and
              app/(app)/clubhouse/find-fixture/page.tsx both redirect an unauthorised viewer away
              themselves) rather than mutating anything here. Section 6 SELECTED CLUB ENTRY: this
              club arrives preselected/filtered, never re-searched. */}
          <Button size="sm" variant="outline" className="h-9" nativeButton={false} render={<Link href={`/clubhouse/find-fixture?opponentDirectoryId=${club.directoryId}&opponentClubId=${club.clubId}`} />}>
            <Search className="size-3.5" />
            Find a Fixture
          </Button>
          {myClubId && (
            <Button size="sm" variant="outline" className="h-9" onClick={() => setMessageOpen(true)}>
              <MessageCircle className="size-3.5" />
              Message
            </Button>
          )}
          {localStatus === "active" && (
            <Button size="sm" className="h-9" nativeButton={false} render={<Link href={`/clubhouse/${club.clubId}`} />}>
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

      {canManagePartnerships && !club.isOwnClub && !club.clubId && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" className="h-9 bg-pitch-600 text-white hover:bg-pitch-600/90" onClick={() => setInviteOpen(true)}>
            Invite
          </Button>
          <InviteClubDialog open={inviteOpen} onOpenChange={setInviteOpen} clubDirectoryId={club.directoryId} clubName={club.name} />
        </div>
      )}

      {myClubId && club.clubId && !club.isOwnClub && (
        <MessageClubDialog open={messageOpen} onOpenChange={setMessageOpen} myClubId={myClubId} targetClubId={club.clubId} clubName={club.name} />
      )}
    </div>
  )
}
