"use client"

import Link from "next/link"
import { useState } from "react"

import { Button } from "@/components/ui/button"

import { ReasonField } from "../../reason-field"

import { clubRoleLabel, teamPermissionLabel } from "@/lib/permissions/role-labels"

import { reactivateMembership, revokeMembership, updateMembershipRoleTitle } from "../../clubs/[directoryId]/actions"
import type { MembershipSummary } from "../types"
import { ChangeAccessForm } from "./change-access-form"

/** One club relationship, with its own Ovalball role, real-world title, team scope, and actions -- deliberately kept as separate cards rather than one flattened list, since a person can have several distinct club relationships (per the brief's "connected clubs" requirement). */
export function MembershipCard({ userId, userName, membership, canReadmit }: { userId: string; userName: string; membership: MembershipSummary; canReadmit: boolean }) {
  const [roleTitle, setRoleTitle] = useState(membership.clubRoleTitle ?? "")
  const [editingTitle, setEditingTitle] = useState(false)
  const [savingTitle, setSavingTitle] = useState(false)
  const [working, setWorking] = useState(false)
  const [status, setStatus] = useState(membership.status)
  const [changingAccess, setChangingAccess] = useState(false)
  const [confirmingRevoke, setConfirmingRevoke] = useState(false)
  const [confirmingReadmit, setConfirmingReadmit] = useState(false)
  const [reason, setReason] = useState("")
  const [readmitted, setReadmitted] = useState(false)
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
    const result = await revokeMembership({ membershipId: membership.membershipId, directoryId: membership.directoryId, reason })
    setWorking(false)
    if (result.ok) {
      setStatus("revoked")
      setConfirmingRevoke(false)
      setReason("")
    } else {
      setError(result.error)
    }
  }

  async function handleReactivate() {
    setWorking(true)
    setError(null)
    const result = await reactivateMembership({ clubId: membership.clubId, userId, directoryId: membership.directoryId, reason })
    setWorking(false)
    if (result.ok) {
      setConfirmingReadmit(false)
      setReason("")
      setReadmitted(true)
    } else setError(result.error)
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
          <p className="mt-0.5 text-xs text-ink-muted">{clubRoleLabel(membership.role)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {status === "revoked" ? (
            <>
              <span className="rounded-full bg-ink/8 px-2.5 py-1 text-xs font-medium text-ink-muted">Revoked</span>
              {readmitted ? (
                <span className="text-xs text-ink-muted">Re-admitted as a new membership</span>
              ) : !canReadmit ? null : !confirmingReadmit ? (
                <Button type="button" variant="outline" className="h-8" onClick={() => setConfirmingReadmit(true)}>
                  Re-admit
                </Button>
              ) : (
                <>
                  <ReasonField id={`readmit-reason-${membership.membershipId}`} value={reason} onChange={setReason} label="Reason for Re-admitting" />
                  <Button type="button" variant="outline" className="h-8 self-end" disabled={working || reason.trim().length === 0} onClick={handleReactivate}>
                    {working ? "Working…" : "Re-admit as Member"}
                  </Button>
                  <Button type="button" variant="ghost" className="h-8 self-end" disabled={working} onClick={() => setConfirmingReadmit(false)}>
                    Cancel
                  </Button>
                </>
              )}
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="h-8" onClick={() => setChangingAccess((v) => !v)}>
                Change access
              </Button>
              {!confirmingRevoke ? (
                <Button type="button" variant="ghost" className="h-8 text-destructive-text hover:bg-destructive/10" onClick={() => setConfirmingRevoke(true)}>
                  Revoke
                </Button>
              ) : (
                <>
                  <ReasonField id={`revoke-reason-${membership.membershipId}`} value={reason} onChange={setReason} label="Reason for Revoking" />
                  <Button type="button" variant="destructive" className="h-8 self-end" disabled={working || reason.trim().length === 0} onClick={handleRevoke}>
                    {working ? "Revoking…" : "Confirm Revoke"}
                  </Button>
                  <Button type="button" variant="ghost" className="h-8 self-end" disabled={working} onClick={() => setConfirmingRevoke(false)}>
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
              {roleTitle || <span className="text-ink-muted">Not recorded &mdash; click to add</span>}
            </button>
          )}
        </div>
        <div>
          <p className="text-[10px] font-medium tracking-[0.06em] text-ink-muted uppercase">Team scope</p>
          {membership.teamRoles.length === 0 ? (
            <p className="mt-1 text-sm text-ink-muted">No team assignment</p>
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

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}

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
