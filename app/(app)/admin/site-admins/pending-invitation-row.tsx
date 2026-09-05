"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { revokeSiteAdminInvitation } from "./actions"
import { profileLabel } from "./profiles"

export interface PendingSiteAdminInvitationData {
  id: string
  invitedEmail: string
  adminRole: string
  expiresAt: string
}

function isExpired(iso: string): boolean {
  return new Date(iso).getTime() < Date.now()
}

export function PendingInvitationRow({ invitation }: { invitation: PendingSiteAdminInvitationData }) {
  const [revoking, setRevoking] = useState(false)
  const [revoked, setRevoked] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    setRevoking(true)
    setError(null)
    const result = await revokeSiteAdminInvitation(invitation.id)
    setRevoking(false)
    if (result.ok) setRevoked(true)
    else setError(result.error)
  }

  if (revoked) {
    return (
      <li className="rounded-lg border border-dashed border-ink/15 bg-white/40 px-4 py-3 text-sm text-ink/40">
        {invitation.invitedEmail} &mdash; revoked.
      </li>
    )
  }

  const expired = isExpired(invitation.expiresAt)

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{invitation.invitedEmail}</p>
        <p className="text-xs text-ink/45">
          {profileLabel(invitation.adminRole)} · {expired ? "Expired" : `Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`}
        </p>
        {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <span className="text-xs font-medium text-ink/40">Pending</span>
        <Button type="button" variant="ghost" size="sm" className="h-8" disabled={revoking} onClick={handleRevoke}>
          {revoking ? "Revoking…" : "Revoke"}
        </Button>
      </div>
    </li>
  )
}
