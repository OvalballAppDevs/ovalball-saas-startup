"use client"

import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { revokeSiteAdmin } from "./actions"

/**
 * Global platform authority -- deliberately its own component, its own
 * server action, never reachable through ChangeAccessForm. Granting Site
 * Admin happens only through the Site Admin Management invitation flow
 * (/admin/site-admins), which requires expiry, recipient-binding, and
 * authenticated acceptance; this panel intentionally offers no direct
 * one-click grant, only revoke (which has no equivalent acceptance step to
 * bypass) and a link to the invitation flow.
 */
export function SiteAdminControl({ userId, isSiteAdmin, isSelf }: { userId: string; isSiteAdmin: boolean; isSelf: boolean }) {
  const [current, setCurrent] = useState(isSiteAdmin)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    setWorking(true)
    setError(null)
    const result = await revokeSiteAdmin(userId)
    setWorking(false)
    if (result.ok) setCurrent(false)
    else setError(result.error)
  }

  return (
    <div className="rounded-lg border border-forest-950/15 bg-forest-950/[0.02] p-4">
      <div className="flex items-center gap-2">
        <ShieldCheck className="size-4 text-forest-800" />
        <p className="text-sm font-medium text-ink">Global Ovalball access</p>
      </div>
      <p className="mt-1 text-sm text-ink/55">
        Site Admin is a global platform role, completely separate from any club membership. It is never granted by
        changing a club-level access profile, and it is only ever granted through an invitation.
      </p>

      {current ? (
        <div className="mt-3 flex items-center gap-3">
          <span className="rounded-full bg-forest-950/10 px-2.5 py-1 text-xs font-medium text-forest-950">Site Admin</span>
          {isSelf ? (
            <span className="text-xs text-ink/45">You cannot revoke your own Site Admin access here.</span>
          ) : (
            <Button type="button" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10" disabled={working} onClick={handleRevoke}>
              {working ? "Revoking…" : "Revoke Site Admin"}
            </Button>
          )}
        </div>
      ) : (
        <div className="mt-3">
          <Button variant="outline" className="h-9" nativeButton={false} render={<Link href="/admin/site-admins" />}>
            Invite as Site Administrator&hellip;
          </Button>
          <p className="mt-1.5 text-xs text-ink/45">Opens Site Admin Management, where a Full Site Admin can send a scoped invitation.</p>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
