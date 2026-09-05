"use client"

import { ShieldCheck } from "lucide-react"
import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"
import { clubRoleLabel, teamPermissionLabel } from "@/lib/permissions/role-labels"

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
export function ConnectedUsers({ directoryId, users }: { directoryId: string; users: ConnectedUser[] }) {
  const active = users.filter((u) => u.status === "active")
  const revoked = users.filter((u) => u.status === "revoked")

  if (users.length === 0) {
    return <p className="text-sm text-ink/50">No one is connected to this club yet.</p>
  }

  return (
    <div className="flex flex-col gap-3">
      {active.map((user) => (
        <UserCard key={user.membershipId} directoryId={directoryId} user={user} />
      ))}
      {revoked.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-sm text-ink/45 select-none">
            {revoked.length} revoked membership{revoked.length === 1 ? "" : "s"}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            {revoked.map((user) => (
              <UserCard key={user.membershipId} directoryId={directoryId} user={user} />
            ))}
          </div>
        </details>
      )}
    </div>
  )
}

function UserCard({ directoryId, user }: { directoryId: string; user: ConnectedUser }) {
  const [roleTitle, setRoleTitle] = useState(user.clubRoleTitle ?? "")
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [revoking, setRevoking] = useState(false)
  const [reactivating, setReactivating] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
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
    const result = await revokeMembership({ membershipId: user.membershipId, directoryId })
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
    const result = await reactivateMembership({ membershipId: user.membershipId, directoryId })
    setReactivating(false)
    if (result.ok) {
      setRevoked(false)
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
          <p className="text-xs text-ink/45">{user.email}</p>
        </div>
        {!revoked && !confirmingRevoke && (
          <Button type="button" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10" onClick={() => setConfirmingRevoke(true)}>
            Revoke access
          </Button>
        )}
        {!revoked && confirmingRevoke && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink/55">Revoke {user.name.split(" ")[0]}&apos;s access?</span>
            <Button type="button" variant="destructive" className="h-8" disabled={revoking} onClick={handleRevoke}>
              {revoking ? "Revoking…" : "Confirm"}
            </Button>
            <Button type="button" variant="ghost" className="h-8" disabled={revoking} onClick={() => setConfirmingRevoke(false)}>
              Cancel
            </Button>
          </div>
        )}
        {revoked && (
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/50">Revoked</span>
            <Button type="button" variant="outline" className="h-8" disabled={reactivating} onClick={handleReactivate}>
              {reactivating ? "Working…" : "Reactivate"}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink/40 uppercase">Ovalball access</p>
          {user.isSiteAdmin && (
            <p className="mt-1 flex items-center gap-1 text-sm font-medium text-forest-800">
              <ShieldCheck className="size-3.5" />
              Site Admin (global)
            </p>
          )}
          <p className="mt-1 text-sm text-ink/70">{clubRoleLabel(user.ovalballRole)}</p>
        </div>

        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink/40 uppercase">Real-world club role</p>
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
              {roleTitle || <span className="text-ink/35">Not recorded — click to add</span>}
            </button>
          )}
        </div>

        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink/40 uppercase">Team scope</p>
          {user.teamRoles.length === 0 ? (
            <p className="mt-1 text-sm text-ink/35">No team assignment</p>
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

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
