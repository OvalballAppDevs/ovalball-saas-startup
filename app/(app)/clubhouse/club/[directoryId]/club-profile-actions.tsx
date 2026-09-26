"use client"

import { useState } from "react"
import Link from "next/link"
import { MessageCircle, Search } from "lucide-react"

import { Button } from "@/components/ui/button"

import { requestPartnership, respondToPartnership, revokePartnership } from "../../actions"
import { ClaimClubDialog } from "../../claim-club-dialog"
import { InviteClubDialog } from "../../invite-club-dialog"
import { MessageClubDialog } from "../../message-club-dialog"
import type { MapClub } from "../../map-data"

/**
 * THE PROFILE'S OWN ACTION BAR -- the same shared server actions and dialogs `ClubMapCard` (the
 * map/list popup) already calls, never a second write path invented for this page. Unlike the popup's
 * compact card, this has room for every partnership lifecycle action Section 8/9 of the visual
 * blueprint asks for (Make Partnership / Accept / Decline / Cancel Request / End Partnership), not
 * only the ones that fit a hover card.
 */
export function ClubProfileActions({
  marker,
  canManagePartnerships,
  myClubId,
  isOtherClub,
  canFindFixture,
  directoryOnly = false,
}: {
  marker: MapClub
  canManagePartnerships: boolean
  myClubId: string | null
  isOtherClub: boolean
  canFindFixture: boolean
  directoryOnly?: boolean
}) {
  const [requesting, setRequesting] = useState(false)
  const [responding, setResponding] = useState<"accept" | "decline" | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [localStatus, setLocalStatus] = useState(marker.partnershipStatus)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [messageOpen, setMessageOpen] = useState(false)
  const [claimOpen, setClaimOpen] = useState(false)

  async function handleRequest() {
    if (!marker.clubId) return
    setRequesting(true)
    setError(null)
    const result = await requestPartnership(marker.clubId)
    setRequesting(false)
    if (result.ok) setLocalStatus("pending_outgoing")
    else setError(result.error)
  }

  async function handleRespond(approve: boolean) {
    if (!marker.partnershipId) return
    setResponding(approve ? "accept" : "decline")
    setError(null)
    const result = await respondToPartnership(marker.partnershipId, approve)
    setResponding(null)
    if (result.ok) setLocalStatus(approve ? "active" : "none")
    else setError(result.error)
  }

  async function handleRevoke() {
    if (!marker.partnershipId) return
    setRevoking(true)
    setError(null)
    const result = await revokePartnership(marker.partnershipId)
    setRevoking(false)
    if (result.ok) setLocalStatus("none")
    else setError(result.error)
  }

  if (directoryOnly) {
    return (
      <section className="rounded-lg border border-ink/10 bg-white p-6">
        <h2 className="text-sm font-semibold text-ink">Invite This Club</h2>
        <p className="mt-1.5 text-sm text-ink-muted">An invitation lets someone at {marker.name} create their own Ovalball account -- it does not give you or anyone else ownership of the club.</p>
        {error && <p className="mt-2 text-xs text-destructive-text">{error}</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          {canManagePartnerships && (
            <Button type="button" size="sm" className="h-10 bg-pitch-600 text-white hover:bg-pitch-600/90" onClick={() => setInviteOpen(true)}>
              Invite to Ovalball
            </Button>
          )}
          <Button type="button" size="sm" variant="outline" className="h-10" onClick={() => setClaimOpen(true)}>
            Claim This Club
          </Button>
        </div>
        <p className="mt-4 border-t border-ink/10 pt-4 text-xs text-ink-muted">
          Claiming is different from inviting -- it is how YOU get authority to manage {marker.name} on Ovalball. A Site Admin reviews every claim by hand before it takes effect.
        </p>
        <InviteClubDialog open={inviteOpen} onOpenChange={setInviteOpen} clubDirectoryId={marker.directoryId} clubName={marker.name} />
        <ClaimClubDialog open={claimOpen} onOpenChange={setClaimOpen} clubDirectoryId={marker.directoryId} clubName={marker.name} />
      </section>
    )
  }

  if (!isOtherClub || !marker.clubId) return null

  return (
    <section className="rounded-lg border border-ink/10 bg-white p-6">
      <h2 className="text-sm font-semibold text-ink">Actions</h2>
      {error && <p className="mt-2 text-xs text-destructive-text">{error}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {canFindFixture && (
          <Button size="sm" className="h-10" nativeButton={false} render={<Link href={`/clubhouse/find-fixture?opponentDirectoryId=${marker.directoryId}&opponentClubId=${marker.clubId}`} />}>
            <Search className="size-3.5" />
            Find a Fixture
          </Button>
        )}
        {myClubId && (
          <Button size="sm" variant="outline" className="h-10" onClick={() => setMessageOpen(true)}>
            <MessageCircle className="size-3.5" />
            Message Club
          </Button>
        )}
        {canManagePartnerships && localStatus === "none" && (
          <Button type="button" size="sm" variant="outline" className="h-10" disabled={requesting} onClick={handleRequest}>
            {requesting ? "Sending…" : "Make Partnership"}
          </Button>
        )}
        {canManagePartnerships && localStatus === "pending_outgoing" && (
          <Button type="button" size="sm" variant="outline" className="h-10" disabled={revoking} onClick={handleRevoke}>
            {revoking ? "Cancelling…" : "Cancel Request"}
          </Button>
        )}
        {canManagePartnerships && localStatus === "pending_incoming" && (
          <>
            <Button type="button" size="sm" className="h-10" disabled={responding !== null} onClick={() => handleRespond(true)}>
              {responding === "accept" ? "Accepting…" : "Accept"}
            </Button>
            <Button type="button" size="sm" variant="outline" className="h-10" disabled={responding !== null} onClick={() => handleRespond(false)}>
              {responding === "decline" ? "Declining…" : "Decline"}
            </Button>
          </>
        )}
        {canManagePartnerships && localStatus === "active" && (
          <Button type="button" size="sm" variant="ghost" className="h-10 text-destructive-text hover:text-destructive-text" disabled={revoking} onClick={handleRevoke}>
            {revoking ? "Ending…" : "End Partnership"}
          </Button>
        )}
      </div>
      {myClubId && <MessageClubDialog open={messageOpen} onOpenChange={setMessageOpen} myClubId={myClubId} targetClubId={marker.clubId} clubName={marker.name} />}
    </section>
  )
}
