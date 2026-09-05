"use client"

import { useState } from "react"
import { Globe } from "lucide-react"

import { Button } from "@/components/ui/button"

import { processVerificationBatchAction, startVerificationRunAction, type RunProgress } from "../data-quality/verification-actions"

/**
 * The exact same start-run / process-batch pipeline as the bulk "Run
 * Verification Check" on the Data Quality dashboard, scoped to just this
 * one club (current_club, total_records=1) -- never a direct canonical
 * write, same staging-then-review path.
 */
export function CheckOnlineNowButton({ directoryId, canRun }: { directoryId: string; canRun: boolean }) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RunProgress | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (!canRun) return null

  async function handleClick() {
    setRunning(true)
    setError(null)
    setProgress(null)
    const started = await startVerificationRunAction("current_club", directoryId)
    if (!started.ok) {
      setRunning(false)
      setError(started.error)
      return
    }
    const batch = await processVerificationBatchAction(started.runId)
    setRunning(false)
    if (!batch.ok) {
      setError(batch.error)
      return
    }
    setProgress(batch.progress)
  }

  return (
    <div className="flex flex-col gap-2">
      <Button type="button" variant="outline" size="sm" className="h-8 w-fit gap-1.5" disabled={running} onClick={handleClick}>
        <Globe className="size-3.5" />
        {running ? "Checking…" : "Check Online Now"}
      </Button>
      {progress && (
        <p className="text-xs text-ink/55">
          {progress.proposalsCreated > 0
            ? `${progress.proposalsCreated} proposal(s) staged for review below.`
            : progress.conflictsFound > 0
              ? "A conflict was found -- see below."
              : "No authoritative online result found for this club."}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
