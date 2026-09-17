"use client"

import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { revokeSiteAdmin } from "./actions"

/**
 * Global platform authority -- deliberately its own component, its own
 * server action, never reachable through ChangeAccessForm. This panel offers
 * no grant at all, only revocation and a link to Site Admin Management.
 *
 * SLICE 7c: granting now takes TWO Full Site Admins. One raises a request,
 * a different one approves it, and only then does anybody become a Site
 * Admin -- by every route, including the invitation flow, because the rule
 * sits on the site_admins row rather than on any one door into it.
 *
 * Revoking still takes one, deliberately: taking authority away is the safe
 * direction, and requiring two people to stop somebody is how an incident
 * gets worse while a form is filled in. It needs a reason, because that is
 * what the audit line says to whoever reads it later.
 */
export function SiteAdminControl({ userId, isSiteAdmin, isSelf }: { userId: string; isSiteAdmin: boolean; isSelf: boolean }) {
  const MIN_REASON = 10
  const [current, setCurrent] = useState(isSiteAdmin)
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonReady = reason.trim().length >= MIN_REASON

  async function handleRevoke() {
    if (!reasonReady) return
    setWorking(true)
    setError(null)
    const result = await revokeSiteAdmin(userId, reason)
    setWorking(false)
    if (result.ok) {
      setCurrent(false)
      setConfirming(false)
      setReason("")
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="rounded-lg border border-forest-950/15 bg-forest-950/[0.02] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium text-ink">Global Ovalball access</p>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Site Admin is a global platform role, completely separate from any club membership. It is never granted by
        changing a club-level access profile, and it takes two Full Site Admins: one asks, a different one approves.
      </p>

      {current ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="rounded-full bg-forest-950/10 px-2.5 py-1 text-xs font-medium text-forest-950">Site Admin</span>
          {isSelf ? (
            <span className="text-xs text-ink-muted">You cannot revoke your own Site Admin access here.</span>
          ) : !confirming ? (
            <Button
              type="button"
              variant="ghost"
              className="h-8 text-destructive-text hover:bg-destructive/10"
              onClick={() => setConfirming(true)}
            >
              Revoke Site Admin
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="outline" className="h-9" nativeButton={false} render={<Link href="/admin/site-admins" />}>
            Invite as Site Administrator&hellip;
          </Button>
          <p className="mt-1.5 text-xs text-ink-muted">Opens Site Admin Management, where a Full Site Admin can send a scoped invitation.</p>
        </div>
      )}

      {confirming && (
        <label className="mt-3 flex flex-col gap-1.5 text-sm text-ink">
          <span className="font-medium">Reason</span>
          <span className="text-xs font-normal text-ink-muted">
            Recorded against this account, and their live sessions end as soon as you confirm.
          </span>
          <textarea
            className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
            value={reason}
            maxLength={500}
            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
            placeholder="They have left the organisation and no longer need platform access."
          />
          <span className="flex items-center gap-2">
            <Button type="button" variant="destructive" className="h-9" disabled={working || !reasonReady} onClick={handleRevoke}>
              {working ? "Revoking…" : "Confirm Revoke"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              className="h-9"
              disabled={working}
              onClick={() => {
                setConfirming(false)
                setReason("")
                setError(null)
              }}
            >
              Cancel
            </Button>
          </span>
        </label>
      )}

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
    </div>
  )
}
