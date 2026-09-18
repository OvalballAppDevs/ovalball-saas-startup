"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { InvitationShare, type InvitationShareData } from "@/components/invitations/invitation-share"

import { resendInvitation, revokeInvitation } from "./actions"

export interface PendingInvitationData {
  id: string
  invitedEmail: string
  /** Already-worded outcome lines, resolved server-side from the invitation's own record. */
  outcome: string[]
  expiresAt: string | null
  expired: boolean
  /** The canonical lifecycle state, worded for a person. */
  status: string
  issuedBy: string | null
  issuedOn: string | null
  /** How many times it has already been reissued. */
  resendCount: number
}

/**
 * ONE WAITING INVITATION.
 *
 * It says what the invitation will produce when it is accepted -- the club role
 * and the role at each named team -- because "pending invitation to
 * someone@example.com" does not tell an administrator whether they are about to
 * let a parent in or a second Club Admin. That wording is resolved server-side
 * from the invitation's own `intended_outcome`, which is what the redemption
 * path will actually apply; this component never infers it.
 */
export function PendingInvitationRow({ invitation }: { invitation: PendingInvitationData }) {
  const [revoking, setRevoking] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [resending, setResending] = useState(false)
  const [share, setShare] = useState<InvitationShareData | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * RESEND IS A REISSUE. The old link and code stop working, because Ovalball
   * keeps only their hashes and therefore cannot send the same ones again --
   * which also makes this the fix for an invitation sent to the wrong address.
   * The panel that comes back says so.
   */
  async function handleResend() {
    setResending(true)
    setError(null)
    const result = await resendInvitation(invitation.id)
    setResending(false)
    if (result.ok) setShare(result.share)
    else setError(result.error)
  }

  async function handleRevoke() {
    setRevoking(true)
    setError(null)
    const result = await revokeInvitation(invitation.id, "Withdrawn by the club.")
    setRevoking(false)
    setConfirming(false)
    if (result.ok) setRevoked(true)
    else setError(result.error ?? "Could not revoke the invitation.")
  }

  if (revoked) {
    return (
      <li className="rounded-lg border border-dashed border-ink/15 bg-white/40 px-4 py-3 text-sm text-ink-muted">
        {invitation.invitedEmail} &mdash; revoked. The link they were sent no longer works.
      </li>
    )
  }

  return (
    <li className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{invitation.invitedEmail}</p>
        <p className="text-xs text-ink-muted">{invitation.outcome.length > 0 ? invitation.outcome.join(" · ") : "Joins as a member"}</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          {[
            invitation.issuedBy ? `Sent by ${invitation.issuedBy}` : null,
            invitation.issuedOn,
            invitation.expiresAt ? `${invitation.expired ? "expired" : "expires"} ${invitation.expiresAt}` : null,
            invitation.resendCount > 0 ? `resent ${invitation.resendCount === 1 ? "once" : `${invitation.resendCount} times`}` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
        {error && <p className="mt-1 text-xs text-destructive-text">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        {/* The canonical state, worded -- not a colour, and not a word this row
            made up. Expiry is a state the database derives from the row, so the
            list and the recipient's own /join page cannot disagree about it. */}
        <span className="text-xs font-medium text-ink-muted">{invitation.status}</span>
        {confirming ? (
          <>
            <Button type="button" variant="destructive" size="sm" className="h-8" disabled={revoking} onClick={handleRevoke}>
              {revoking ? "Revoking…" : "Confirm"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" disabled={revoking} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button type="button" variant="outline" size="sm" className="h-8" disabled={resending} onClick={handleResend}>
              {resending ? "Reissuing…" : "Resend"}
            </Button>
            <Button type="button" variant="ghost" size="sm" className="h-8" onClick={() => setConfirming(true)}>
              Revoke
            </Button>
          </>
        )}
      </div>

      {share && (
        <div className="mt-3 basis-full">
          <InvitationShare invitation={share} />
        </div>
      )}
    </li>
  )
}
