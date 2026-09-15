"use client"

import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { clubRoleLabel, teamPermissionLabel } from "@/lib/permissions/role-labels"

import { ReasonField } from "../../reason-field"

import { reactivateMembership, revokeMembership, updateMembershipRoleTitle, type ConnectedUser } from "./actions"

/**
 * Who is connected to this club, why, and with what authority -- three
 * columns kept visually distinct per the brief: global Site Admin access,
 * the Ovalball club_memberships.role permission, and the free-text
 * real-world club_role_title, plus team scope underneath. Real-world role
 * is editable (descriptive only); access can be revoked (sets
 * status='revoked', never a delete, never touches .role) but never
 * granted/promoted from here -- that stays out of scope for this slice.
 */
export function ConnectedUsers({ clubId, directoryId, users }: { clubId: string; directoryId: string; users: ConnectedUser[] }) {
  const active = users.filter((u) => u.status === "active")
  const revoked = users.filter((u) => u.status === "revoked")
  // A removed membership stays as history; someone already re-admitted is
  // not offered re-admission again from their old row.
  const activeUserIds = new Set(active.map((u) => u.userId))

  if (users.length === 0) {
    return <p className="text-sm text-ink-muted">No one is connected to this club yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {active.map((user) => (
        <UserCard key={user.membershipId} clubId={clubId} directoryId={directoryId} user={user} canReadmit={false} />
      ))}
      {revoked.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-ink-muted select-none">
            {revoked.length} revoked membership{revoked.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {revoked.map((user) => (
              <UserCard key={user.membershipId} clubId={clubId} directoryId={directoryId} user={user} canReadmit={!activeUserIds.has(user.userId)} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function UserCard({ clubId, directoryId, user, canReadmit }: { clubId: string; directoryId: string; user: ConnectedUser; canReadmit: boolean }) {
  const [roleTitle, setRoleTitle] = useState(user.clubRoleTitle ?? "")
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [confirmingReadmit, setConfirmingReadmit] = useState(false)
  const [readmitted, setReadmitted] = useState(false)
  const [reason, setReason] = useState("")
  const [revoked, setRevoked] = useState(user.status === "revoked")
  const [error, setError] = useState<string | null>(null)

  async function saveTitle() {
    setSavingTitle(true)
    setError(null)
    const result = await updateMembershipRoleTitle({ membershipId: user.membershipId, directoryId, clubRoleTitle: roleTitle })
    setSavingTitle(false)
    if (result.ok) {
      setEditingTitle(false)
    } else {
      setError(result.error)
    }
  }

  async function handleRevoke() {
    setRevoking(true)
    setError(null)
    const result = await revokeMembership({ membershipId: user.membershipId, directoryId, reason })
    setRevoking(false)
    if (result.ok) {
      setRevoked(true)
    } else {
      setError(result.error)
    }
  }

  async function handleReactivate() {
    setReactivating(true)
    setError(null)
    const result = await reactivateMembership({ clubId, userId: user.userId, directoryId, reason })
    setReactivating(false)
    if (result.ok) {
      setReadmitted(true)
      setConfirmingReadmit(false)
      setReason("")
    } else {
      setError(result.error)
    }
  }

  return (
    <div className={`rounded-lg border border-ink/10 bg-white p-4 ${revoked ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link
            href={`/admin/users/${user.userId}`}
            className="font-medium text-ink underline decoration-dotted outline-none hover:text-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            {user.name}
          </Link>
          <p className="text-xs text-ink-muted">{user.email}</p>
        </div>
        {!revoked && !confirmingRevoke && (
          <Button type="button" variant="ghost" className="h-8 text-destructive-text hover:bg-destructive/10" onClick={() => setConfirmingRevoke(true)}>
            Revoke access
          </Button>
        )}
        {!revoked && confirmingRevoke && (
          <div className="flex flex-wrap items-end gap-2">
            <ReasonField id={`revoke-reason-${user.membershipId}`} value={reason} onChange={setReason} label={`Reason for Revoking ${user.name.split(" ")[0]}'s Access`} />
            <Button type="button" variant="destructive" className="h-8" disabled={revoking || reason.trim().length === 0} onClick={handleRevoke}>
              {revoking ? "Revoking…" : "Confirm"}
            </Button>
            <Button type="button" variant="ghost" className="h-8" disabled={revoking} onClick={() => setConfirmingRevoke(false)}>
              Cancel
            </Button>
          </div>
        )}
        {revoked && (
          <div className="flex flex-wrap items-end gap-2">
            <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink-muted">Revoked</span>
            {readmitted ? (
              <span className="text-xs text-ink-muted">Re-admitted as a new membership</span>
            ) : canReadmit && !confirmingReadmit ? (
              <Button type="button" variant="outline" className="h-8" onClick={() => setConfirmingReadmit(true)}>
                Re-admit
              </Button>
            ) : canReadmit ? (
              <>
                <ReasonField id={`readmit-reason-${user.membershipId}`} value={reason} onChange={setReason} label="Reason for Re-admitting" />
                <Button type="button" variant="outline" className="h-8" disabled={reactivating || reason.trim().length === 0} onClick={handleReactivate}>
                  {reactivating ? "Working…" : "Re-admit as Member"}
                </Button>
                <Button type="button" variant="ghost" className="h-8" disabled={reactivating} onClick={() => setConfirmingReadmit(false)}>
                  Cancel
                </Button>
              </>
            ) : null}
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink-muted uppercase">Ovalball access</p>
          {user.isSiteAdmin && (
            <p className="mt-1 flex items-center gap-1 text-sm font-medium text-forest-800">
              <ShieldCheck className="size-3.5" />
              Site Admin (global)
            </p>
          )}
          <p className="mt-1 text-sm text-ink/70">{clubRoleLabel(user.ovalballRole)}</p>
        </div>

        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink-muted uppercase">Real-world club role</p>
          {editingTitle ? (
            <div className="mt-1 flex items-center gap-1.5">
              <input
                value={roleTitle}
                onChange={(e) => setRoleTitle(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && saveTitle()}
                placeholder="e.g. Club Secretary"
                className="h-8 min-w-0 flex-1 rounded-md border border-ink/15 bg-white px-2 text-sm text-ink outline-none focus-visible:border-pitch-600"
                autoFocus
              />
              <Button type="button" size="sm" className="h-8" disabled={savingTitle} onClick={saveTitle}>
                Save
              </Button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              className="mt-1 block text-left text-sm text-ink/70 underline decoration-dotted outline-none hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              {roleTitle || <span className="text-ink-muted">Not recorded — click to add</span>}
            </button>
          )}
        </div>

        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink-muted uppercase">Team scope</p>
          {user.teamRoles.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">No team assignment</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {user.teamRoles.map((t) => (
                <li key={t.teamId} className="text-sm text-ink/70">
                  {t.teamName} &mdash; {teamPermissionLabel(t.permission)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
    </div>
  )
}
