"use client"

import { useState } from "react"
import { AlertTriangle, ArchiveRestore, CalendarClock } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import { foldTeam, reactivateTeam, requestFixtureRestoration } from "./actions"

export interface RestorableFixtureRow {
  id: string
  kickoffDate: string
  raw: string
  homeAway: "Home" | "Away"
}

export interface TeamLifecycleData {
  teamId: string
  displayName: string
  active: boolean
  foldedAt: string | null
  foldReason: string | null
  restorableFixtures: RestorableFixtureRow[]
}

export function TeamLifecycleSection({ team }: { team: TeamLifecycleData }) {
  const [foldOpen, setFoldOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [folding, setFolding] = useState(false)
  const [foldError, setFoldError] = useState<string | null>(null)
  const [foldResult, setFoldResult] = useState<number | null>(null)

  const [reactivating, setReactivating] = useState(false)
  const [reactivateError, setReactivateError] = useState<string | null>(null)

  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [restoredIds, setRestoredIds] = useState<Set<string>>(new Set())
  const [restoreError, setRestoreError] = useState<string | null>(null)

  async function handleFold() {
    setFolding(true)
    setFoldError(null)
    const result = await foldTeam(team.teamId, reason)
    setFolding(false)
    if (!result.ok) {
      setFoldError(result.error)
      return
    }
    setFoldResult(result.fixturesAffected)
    setFoldOpen(false)
  }

  async function handleReactivate() {
    setReactivating(true)
    setReactivateError(null)
    const result = await reactivateTeam(team.teamId)
    setReactivating(false)
    if (!result.ok) setReactivateError(result.error)
    else setFoldResult(null)
  }

  async function handleRestore(fixtureId: string) {
    setRestoringId(fixtureId)
    setRestoreError(null)
    const result = await requestFixtureRestoration(team.teamId, fixtureId)
    setRestoringId(null)
    if (!result.ok) {
      setRestoreError(result.error)
      return
    }
    setRestoredIds((prev) => new Set(prev).add(fixtureId))
  }

  return (
    <div className="mt-6 rounded-lg border border-ink/10 bg-white p-6">
      <p className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Team lifecycle</p>

      {team.active ? (
        <>
          <p className="mt-2 text-sm text-ink/60">
            Folding a team cancels its future fixture schedule and notifies affected clubs. Past fixtures and results
            are always retained.
          </p>
          {foldResult !== null && (
            <p className="mt-3 rounded-lg bg-forest-50 px-3.5 py-2.5 text-sm text-forest-800">
              {team.displayName} has folded.{" "}
              {foldResult === 0 ? "It had no future fixtures to remove." : `${foldResult} future fixture${foldResult === 1 ? "" : "s"} removed from the active schedule.`}
            </p>
          )}
          <div className="mt-4">
            <Dialog open={foldOpen} onOpenChange={setFoldOpen}>
              <DialogTrigger render={<Button type="button" variant="destructive" className="h-10" />}>Fold team</DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Fold {team.displayName}?</DialogTitle>
                  <DialogDescription>
                    This will cancel its future active fixture schedule and notify affected clubs. Historical
                    fixtures and results are retained.
                  </DialogDescription>
                </DialogHeader>
                <div className="flex items-start gap-2 rounded-lg bg-amber-50 px-3.5 py-2.5 text-sm text-amber-900">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                  <p>Future fixtures against clubs active on Ovalball will be removed and those clubs notified.</p>
                </div>
                <div className="mt-2">
                  <label htmlFor="fold-reason" className="text-sm font-medium text-ink/80">
                    Reason
                  </label>
                  <textarea
                    id="fold-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="e.g. Not enough players this season"
                    rows={3}
                    className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3.5 py-2.5 text-sm text-ink outline-none focus-visible:border-pitch-600"
                  />
                </div>
                {foldError && <p className="mt-2 text-sm text-destructive">{foldError}</p>}
                <DialogFooter>
                  <DialogClose render={<Button type="button" variant="outline" className="h-10" />}>Cancel</DialogClose>
                  <Button type="button" variant="destructive" className="h-10" disabled={folding || !reason.trim()} onClick={handleFold}>
                    {folding ? "Folding…" : "Fold team"}
                  </Button>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>
        </>
      ) : (
        <>
          <div className="mt-2 rounded-lg bg-ink/5 px-3.5 py-2.5 text-sm text-ink/70">
            <p className="font-medium text-ink">Folded{team.foldedAt ? ` on ${new Date(team.foldedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}</p>
            {team.foldReason && <p className="mt-0.5 text-ink/60">&ldquo;{team.foldReason}&rdquo;</p>}
          </div>
          {reactivateError && <p className="mt-2 text-sm text-destructive">{reactivateError}</p>}
          <Button type="button" variant="outline" className="mt-4 h-10 gap-2" disabled={reactivating} onClick={handleReactivate}>
            <ArchiveRestore className="size-4" />
            {reactivating ? "Reactivating…" : "Reactivate team"}
          </Button>
        </>
      )}

      {team.active && team.restorableFixtures.length > 0 && (
        <div className="mt-6 border-t border-ink/10 pt-5">
          <p className="flex items-center gap-2 text-sm font-medium text-ink">
            <CalendarClock className="size-4 text-ink/50" />
            Previously cancelled fixtures
          </p>
          <p className="mt-1 text-sm text-ink/60">
            These were removed from the schedule when this team last folded. Request restoration individually —
            each is conflict-checked before being reinstated.
          </p>
          {restoreError && <p className="mt-2 text-sm text-destructive">{restoreError}</p>}
          <ul className="mt-3 space-y-2">
            {team.restorableFixtures.map((f) => {
              const restored = restoredIds.has(f.id)
              return (
                <li key={f.id} className="flex items-center justify-between gap-3 rounded-lg border border-ink/10 px-3.5 py-2.5">
                  <div className="text-sm">
                    <span className="font-medium text-ink">
                      {new Date(f.kickoffDate).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <span className="ml-2 text-ink/60">
                      {f.homeAway} vs {f.raw}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-9"
                    disabled={restoringId === f.id || restored}
                    onClick={() => handleRestore(f.id)}
                  >
                    {restored ? "Requested" : restoringId === f.id ? "Requesting…" : "Request restoration"}
                  </Button>
                </li>
              )
            })}
          </ul>
        </div>
      )}
    </div>
  )
}
