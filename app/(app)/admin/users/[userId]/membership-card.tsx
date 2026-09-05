"use client"

import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { clubRoleLabel, teamPermissionLabel } from "@/lib/permissions/role-labels"

import { reactivateMembership, revokeMembership, updateMembershipRoleTitle } from "../../clubs/[directoryId]/actions"
import type { MembershipSummary } from "../types"
import { ChangeAccessForm } from "./change-access-form"

/** One club relationship, with its own Ovalball role, real-world title, team scope, and actions -- deliberately kept as separate cards rather than one flattened list, since a person can have several distinct club relationships (per the brief's "connected clubs" requirement). */
export function MembershipCard({ userId, userName, membership }: { userId: string; userName: string; membership: MembershipSummary }) {
  const [roleTitle, setRoleTitle] = useState(membership.clubRoleTitle ?? "")
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState(membership.status)
  const [changingAccess, setChangingAccess] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function saveTitle() {
    setSavingTitle(true)
    setError(null)
    const result = await updateMembershipRoleTitle({ membershipId: membership.membershipId, directoryId: membership.directoryId, clubRoleTitle: roleTitle })
    setSavingTitle(false)
    if (result.ok) setEditingTitle(false)
    else setError(result.error)
  }

  async function handleRevoke() {
    setWorking(true)
    setError(null)
    const result = await revokeMembership({ membershipId: membership.membershipId, directoryId: membership.directoryId })
    setWorking(false)
    if (result.ok) {
      setStatus("revoked")
      setConfirmingRevoke(false)
    } else {
      setError(result.error)
    }
  }

  async function handleReactivate() {
    setWorking(true)
    setError(null)
    const result = await reactivateMembership({ membershipId: membership.membershipId, directoryId: membership.directoryId })
    setWorking(false)
    if (result.ok) setStatus("active")
    else setError(result.error)
  }

  return (
    <div className={`rounded-lg border border-ink/10 bg-white p-4 ${status === "revoked" ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href={`/admin/clubs/${membership.directoryId}`}
            className="text-sm font-medium text-ink underline decoration-dotted outline-none hover:text-forest-800 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            {membership.clubName}
          </Link>
          <p className="mt-0.5 text-xs text-ink/45">{clubRoleLabel(membership.role)}</p>
        </div>
        <div className="flex items-center gap-2">
          {status === "revoked" ? (
            <>
              <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink/50">Revoked</span>
              <Button type="button" variant="outline" className="h-8" disabled={working} onClick={handleReactivate}>
                {working ? "Working…" : "Reactivate"}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="h-8" onClick={() => setChangingAccess((v) => !v)}>
                Change access
              </Button>
              {!confirmingRevoke ? (
                <Button type="button" variant="ghost" className="h-8 text-destructive hover:bg-destructive/10" onClick={() => setConfirmingRevoke(true)}>
                  Revoke
                </Button>
              ) : (
                <>
                  <Button type="button" variant="destructive" className="h-8" disabled={working} onClick={handleRevoke}>
                    {working ? "Revoking…" : "Confirm revoke"}
                  </Button>
                  <Button type="button" variant="ghost" className="h-8" disabled={working} onClick={() => setConfirmingRevoke(false)}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          )}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
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
              {roleTitle || <span className="text-ink/35">Not recorded &mdash; click to add</span>}
            </button>
          )}
        </div>
        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink/40 uppercase">Team scope</p>
          {membership.teamRoles.length === 0 ? (
            <p className="mt-1 text-sm text-ink/35">No team assignment</p>
          ) : (
            <ul className="mt-1 flex flex-col gap-0.5">
              {membership.teamRoles.map((t) => (
                <li key={t.teamId} className="text-sm text-ink/70">
                  {t.teamName} &mdash; {teamPermissionLabel(t.permission)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}

      {changingAccess && (
        <div className="mt-4">
          <ChangeAccessForm
            membershipId={membership.membershipId}
            directoryId={membership.directoryId}
            userId={userId}
            userName={userName}
            clubId={membership.clubId}
            clubName={membership.clubName}
            currentRole={membership.role}
            currentTeamRoles={membership.teamRoles}
            onDone={() => setChangingAccess(false)}
          />
        </div>
      )}
    </div>
  )
}
