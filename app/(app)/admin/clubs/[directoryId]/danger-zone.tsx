"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { quickEditClub } from "../actions"
import {
  deactivateClubAdmin,
  deleteCanonicalClub,
  reactivateClubAdmin,
  restoreClubMembershipAuthorityAdmin,
  type SuspendedClubMembership,
} from "./actions"

/**
 * Two-tier destructive-action hierarchy, per the brief: deactivate/archive
 * is the normal administrative action (reversible, one click); permanent
 * delete is exceptional (blocked server-side whenever real history exists,
 * and gated by typing the exact club name -- never a bare confirm dialog).
 */
export interface ActivatedClubLifecycle {
  clubId: string
  status: "active" | "suspended" | "deactivated"
  deactivatedAt: string | null
  deactivationReason: string | null
}

export function DangerZone({
  directoryId,
  clubName,
  directoryActive,
  hasHistory,
  activatedClub,
  initialSuspendedMemberships,
}: {
  directoryId: string
  clubName: string
  directoryActive: boolean
  hasHistory: boolean
  activatedClub: ActivatedClubLifecycle | null
  initialSuspendedMemberships: SuspendedClubMembership[]
}) {
  const router = useRouter()
  const [active, setActive] = useState(directoryActive)
  const [togglingActive, setTogglingActive] = useState(false)

  const [deleteOpen, setDeleteOpen] = useState(false)
  const [confirmText, setConfirmText] = useState("")
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const [clubStatus, setClubStatus] = useState(activatedClub?.status ?? "active")
  const [deactivateOpen, setDeactivateOpen] = useState(false)
  const [deactivateReason, setDeactivateReason] = useState("")
  const [deactivating, setDeactivating] = useState(false)
  const [deactivateError, setDeactivateError] = useState<string | null>(null)
  const [deactivateResult, setDeactivateResult] = useState<number | null>(null)
  const [reactivating, setReactivating] = useState(false)
  const [reactivateError, setReactivateError] = useState<string | null>(null)

  const [suspendedMemberships, setSuspendedMemberships] = useState(initialSuspendedMemberships)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoreError, setRestoreError] = useState<string | null>(null)

  async function handleDeactivate() {
    if (!activatedClub) return
    setDeactivating(true)
    setDeactivateError(null)
    const result = await deactivateClubAdmin(activatedClub.clubId, deactivateReason)
    setDeactivating(false)
    if (!result.ok) {
      setDeactivateError(result.error)
      return
    }
    setClubStatus("deactivated")
    setDeactivateResult(result.membershipsSuspended)
    setDeactivateOpen(false)
  }

  async function handleReactivate() {
    if (!activatedClub) return
    setReactivating(true)
    setReactivateError(null)
    const result = await reactivateClubAdmin(activatedClub.clubId)
    setReactivating(false)
    if (!result.ok) {
      setReactivateError(result.error)
      return
    }
    setClubStatus("active")
    setDeactivateResult(null)
  }

  async function handleRestoreAccess(membershipId: string) {
    setRestoringId(membershipId)
    setRestoreError(null)
    const result = await restoreClubMembershipAuthorityAdmin(membershipId)
    setRestoringId(null)
    if (!result.ok) {
      setRestoreError(result.error)
      return
    }
    setSuspendedMemberships((prev) => prev.filter((m) => m.membershipId !== membershipId))
  }

  async function toggleActive() {
    setTogglingActive(true)
    const result = await quickEditClub({ directoryId, field: "active", value: !active })
    setTogglingActive(false)
    if (result.ok) {
      setActive(!active)
      router.refresh()
    }
  }

  async function handleDelete() {
    setDeleting(true)
    setDeleteError(null)
    const result = await deleteCanonicalClub(directoryId, confirmText)
    setDeleting(false)
    if (result.ok) {
      router.push("/admin/clubs")
    } else {
      setDeleteError(result.error)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {activatedClub && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          {clubStatus === "active" ? (
            <>
              <p className="text-sm font-medium text-ink">Deactivate {clubName} from Ovalball</p>
              <p className="mt-0.5 text-sm text-ink/55">
                Removes the club&apos;s active Ovalball access. Fixtures, results, messages, settings, and records are
                retained and unaffected -- opponents keep their fixtures exactly as they are.
              </p>
              {deactivateResult !== null && (
                <p className="mt-3 rounded-lg bg-forest-50 px-3.5 py-2.5 text-sm text-forest-800">
                  {clubName} has been deactivated.{" "}
                  {deactivateResult === 0
                    ? "It had no active members to pause."
                    : `${deactivateResult} member${deactivateResult === 1 ? "'s" : "s'"} access was paused.`}
                </p>
              )}
              <div className="mt-3">
                <Dialog open={deactivateOpen} onOpenChange={setDeactivateOpen}>
                  <DialogTrigger render={<Button type="button" variant="outline" className="h-9" />}>Deactivate club</DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Deactivate {clubName} from Ovalball?</DialogTitle>
                      <DialogDescription>
                        The club will lose active Ovalball access, but its fixtures, results, messages, settings and
                        records will be retained.
                      </DialogDescription>
                    </DialogHeader>
                    <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                      <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                      <p>
                        This club&apos;s members lose write access immediately. Existing fixtures are never cancelled --
                        opponents keep them, and can edit kick-off/pitch/results directly since this club can no
                        longer respond.
                      </p>
                    </div>
                    <div className="mt-2">
                      <label htmlFor="deactivate-club-reason" className="text-sm font-medium text-ink/80">
                        Reason
                      </label>
                      <textarea
                        id="deactivate-club-reason"
                        value={deactivateReason}
                        onChange={(e) => setDeactivateReason(e.target.value)}
                        placeholder="e.g. Club has left Ovalball for this season"
                        rows={3}
                        className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
                      />
                    </div>
                    {deactivateError && <p className="mt-2 text-sm text-destructive">{deactivateError}</p>}
                    <DialogFooter>
                      <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
                      <Button
                        type="button"
                        variant="destructive"
                        className="h-10"
                        disabled={deactivating || !deactivateReason.trim()}
                        onClick={handleDeactivate}
                      >
                        {deactivating ? "Deactivating…" : "Deactivate club"}
                      </Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-lg bg-ink/5 px-3.5 py-2.5 text-sm text-ink/70">
                <p className="font-medium text-ink">
                  Deactivated
                  {activatedClub.deactivatedAt
                    ? ` on ${new Date(activatedClub.deactivatedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                    : ""}
                </p>
                {activatedClub.deactivationReason && <p className="mt-0.5 text-ink/60">&ldquo;{activatedClub.deactivationReason}&rdquo;</p>}
                <p className="mt-1 text-ink/50">
                  Still a recognised club in the directory. Historical fixtures, results, messages, and records remain
                  intact for opponents and Site Admin review.
                </p>
              </div>
              {reactivateError && <p className="mt-2 text-sm text-destructive">{reactivateError}</p>}
              <Button type="button" variant="outline" className="mt-3 h-9" disabled={reactivating} onClick={handleReactivate}>
                {reactivating ? "Reactivating…" : "Reactivate club"}
              </Button>
            </>
          )}
        </div>
      )}

      {activatedClub && clubStatus === "active" && suspendedMemberships.length > 0 && (
        <div className="rounded-lg border border-ink/10 bg-white p-4">
          <p className="text-sm font-medium text-ink">Previous club access</p>
          <p className="mt-0.5 text-sm text-ink/55">
            The club is active again, but these members&apos; authority stays paused until you restore it individually
            -- data returned automatically, privileged access does not.
          </p>
          {restoreError && <p className="mt-2 text-sm text-destructive">{restoreError}</p>}
          <ul className="mt-3 space-y-2">
            {suspendedMemberships.map((m) => (
              <li key={m.membershipId} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 px-3.5 py-2.5">
                <div className="text-sm">
                  <span className="font-medium text-ink">{m.name}</span>
                  <span className="ml-2 text-ink/50">Former role: {m.role === "CLUB_ADMIN" ? "Club Admin" : m.role === "FIXTURE_SECRETARY" ? "Fixture Secretary" : m.role}</span>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="h-9"
                  disabled={restoringId === m.membershipId}
                  onClick={() => handleRestoreAccess(m.membershipId)}
                >
                  {restoringId === m.membershipId ? "Restoring…" : "Restore access"}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-ink/10 bg-white p-4">
        <div>
          <p className="text-sm font-medium text-ink">{active ? "Deactivate this club" : "Reactivate this club"}</p>
          <p className="mt-0.5 text-sm text-ink/55">
            {active
              ? "Hides it from signup, claim, and join discovery. Existing fixtures, teams, and members are untouched, and it stays visible here."
              : "Makes it searchable again during signup and claim/join flows."}
          </p>
        </div>
        <Button type="button" variant="outline" className="h-10 shrink-0" disabled={togglingActive} onClick={toggleActive}>
          {togglingActive ? "Working…" : active ? "Deactivate" : "Reactivate"}
        </Button>
      </div>

      <div className="rounded-lg border border-destructive/25 bg-destructive/[0.03] p-4">
        <p className="text-sm font-medium text-destructive">Permanently delete this canonical record</p>
        <p className="mt-0.5 text-sm text-ink/55">
          Only possible for a club that was never activated, claimed, or otherwise connected to real Ovalball history.
          This cannot be undone.
        </p>

        {!deleteOpen ? (
          <Button type="button" variant="destructive" className="mt-3 h-9" onClick={() => setDeleteOpen(true)}>
            Permanently delete&hellip;
          </Button>
        ) : (
          <div className="mt-3 flex flex-col gap-3">
            {hasHistory && (
              <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                This club cannot be permanently deleted because it has existing Ovalball history. Deactivate it instead.
              </p>
            )}
            {!hasHistory && (
              <>
                <label className="text-sm text-ink/70">
                  Type <span className="font-medium text-ink">{clubName}</span> to confirm.
                  <input
                    value={confirmText}
                    onChange={(e) => setConfirmText(e.target.value)}
                    className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-destructive"
                    autoFocus
                  />
                </label>
                {deleteError && <p className="text-sm text-destructive">{deleteError}</p>}
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="destructive"
                    className="h-9"
                    disabled={deleting || confirmText !== clubName}
                    onClick={handleDelete}
                  >
                    {deleting ? "Deleting…" : "Permanently delete"}
                  </Button>
                  <Button type="button" variant="ghost" className="h-9" disabled={deleting} onClick={() => setDeleteOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
