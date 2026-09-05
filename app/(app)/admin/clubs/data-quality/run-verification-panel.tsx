"use client"

import { useState } from "react"
import { AlertTriangle, Loader2, PlayCircle } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"

import {
  previewVerificationScopeAction,
  processVerificationBatchAction,
  startVerificationRunAction,
  type FilterFlag,
  type RunHistoryRow,
  type RunProgress,
  type VerificationScope,
} from "./verification-actions"

const SCOPE_LABEL: Record<VerificationScope, string> = {
  current_club: "Current club",
  filtered: "Clubs matching the current filter",
  needs_review: "Clubs needing review",
  missing_data: "Clubs with missing data only",
  entire_directory: "Entire directory",
}

function statusLabel(p: RunProgress) {
  if (p.status === "completed") return "Completed"
  if (p.status === "failed") return "Failed"
  if (p.status === "partial") return "Stopped (partial)"
  return "Running"
}

/**
 * Clicking "Run Verification Check" never overwrites club_directory --
 * see verification-actions.ts. Progress is genuine: each tick is a real
 * bounded batch (processVerificationBatchAction), never a fake progress
 * bar animating toward a number nothing has actually checked.
 */
export function RunVerificationPanel({ activeFilterFlag, recentRuns }: { activeFilterFlag: FilterFlag | null; recentRuns: RunHistoryRow[] }) {
  const [open, setOpen] = useState(false)
  const [scope, setScope] = useState<VerificationScope>(activeFilterFlag ? "filtered" : "needs_review")
  const [previewCount, setPreviewCount] = useState<number | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [running, setRunning] = useState(false)

  async function loadPreview(nextScope: VerificationScope) {
    setScope(nextScope)
    setPreviewing(true)
    setError(null)
    const result = await previewVerificationScopeAction(nextScope, undefined, nextScope === "filtered" ? (activeFilterFlag ?? undefined) : undefined)
    setPreviewing(false)
    if (!result.ok) {
      setError(result.error)
      setPreviewCount(null)
      return
    }
    setPreviewCount(result.count)
  }

  async function handleOpen() {
    setOpen(true)
    setProgress(null)
    setError(null)
    await loadPreview(scope)
  }

  async function handleStart() {
    setRunning(true)
    setError(null)
    const started = await startVerificationRunAction(scope, undefined, scope === "filtered" ? (activeFilterFlag ?? undefined) : undefined)
    if (!started.ok) {
      setRunning(false)
      setError(started.error)
      return
    }

    let done = false
    while (!done) {
      const batch = await processVerificationBatchAction(started.runId)
      if (!batch.ok) {
        setRunning(false)
        setError(batch.error)
        return
      }
      setProgress(batch.progress)
      done = batch.done
    }
    setRunning(false)
  }

  return (
    <div>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!running) setOpen(v)
        }}
      >
        <DialogTrigger render={<Button type="button" size="sm" className="h-9 gap-1.5" />} onClick={handleOpen}>
          <PlayCircle className="size-4" />
          Run Verification Check
        </DialogTrigger>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Run online verification</DialogTitle>
            <DialogDescription>
              Ovalball will research available authoritative public sources and stage proposed changes for review. No
              canonical club records will be changed automatically.
            </DialogDescription>
          </DialogHeader>

          {!progress && (
            <div className="flex flex-col gap-3 py-2">
              <div>
                <label className="text-sm font-medium text-ink">Scope</label>
                <select
                  value={scope}
                  disabled={running}
                  onChange={(e) => loadPreview(e.target.value as VerificationScope)}
                  className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                >
                  {activeFilterFlag && <option value="filtered">{SCOPE_LABEL.filtered}</option>}
                  <option value="needs_review">{SCOPE_LABEL.needs_review}</option>
                  <option value="missing_data">{SCOPE_LABEL.missing_data}</option>
                  <option value="entire_directory">{SCOPE_LABEL.entire_directory}</option>
                </select>
              </div>

              <p className="text-sm text-ink/60">
                {previewing ? "Counting…" : previewCount !== null ? `Run online verification for ${previewCount.toLocaleString()} club${previewCount === 1 ? "" : "s"}?` : ""}
              </p>

              {scope === "entire_directory" && previewCount !== null && previewCount > 100 && (
                <div className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
                  <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                  <span>This is a large run. Ovalball researches available authoritative public sources and stages proposed changes for review -- it does not guarantee every record will be resolved.</span>
                </div>
              )}

              {error && <p className="text-sm text-destructive">{error}</p>}
            </div>
          )}

          {progress && (
            <div className="flex flex-col gap-2 py-2 text-sm" aria-live="polite" aria-busy={running}>
              <p className="flex items-center gap-2 font-medium text-ink">
                {running && <Loader2 className="size-4 animate-spin text-ink/40" aria-hidden="true" />}
                {statusLabel(progress)}
              </p>
              <p className="text-ink/70">
                {progress.processedRecords.toLocaleString()}/{progress.totalRecords.toLocaleString()} checked
              </p>
              <ul className="mt-1 flex flex-col gap-1 text-ink/60">
                <li>New verified proposals: {progress.proposalsCreated.toLocaleString()}</li>
                <li>Needs review / conflicts: {progress.conflictsFound.toLocaleString()}</li>
                <li>No authoritative result: {progress.noResultCount.toLocaleString()}</li>
                {progress.failedCount > 0 && <li>Failed: {progress.failedCount.toLocaleString()}</li>}
              </ul>
              {error && <p className="mt-1 text-destructive">{error}</p>}
            </div>
          )}

          <DialogFooter>
            <DialogClose render={<Button variant="outline" disabled={running} />}>{progress ? "Close" : "Cancel"}</DialogClose>
            {!progress && (
              <Button onClick={handleStart} disabled={running || previewing || previewCount === null || previewCount === 0}>
                {running ? "Running…" : "Start"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {recentRuns.length > 0 && (
        <div className="mt-4">
          <p className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Recent verification runs</p>
          <ul className="mt-2 flex flex-col gap-1.5">
            {recentRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-ink/8 bg-white px-3 py-2 text-xs">
                <span className="text-ink/70">
                  {SCOPE_LABEL[r.scope as VerificationScope] ?? r.scope} &middot; {new Date(r.startedAt).toLocaleString()}
                </span>
                <span className="text-ink/50">
                  {r.status} &middot; {r.processedRecords}/{r.totalRecords} checked &middot; {r.proposalsCreated} proposals &middot; {r.conflictsFound} conflicts
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
