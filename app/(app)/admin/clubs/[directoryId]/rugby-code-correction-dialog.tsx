"use client"

import { useState } from "react"
import { AlertTriangle } from "lucide-react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { correctClubRugbyCode } from "./actions"

/**
 * The only UI path to correct_club_rugby_code() -- Full Site Admin only
 * (enforced server-side; this dialog is reachable by any Club Data Admin
 * viewing the page, and the action itself returns a clear rejection for
 * anyone else, matching every other privileged-action pattern in this
 * codebase). A reason is mandatory, matching the brief's "confirmation +
 * reason + audit" requirement -- the audit row itself is written by the
 * RPC, not here.
 */
export function RugbyCodeCorrectionDialog({
  directoryId,
  currentCode,
  onCorrected,
}: {
  directoryId: string
  currentCode: "union" | "league"
  onCorrected: (next: "union" | "league") => void
}) {
  const [open, setOpen] = useState(false)
  const [newCode, setNewCode] = useState<"union" | "league">(currentCode === "union" ? "league" : "union")
  const [reason, setReason] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleConfirm() {
    if (reason.trim().length === 0) {
      setError("A reason is required.")
      return
    }
    setSubmitting(true)
    setError(null)
    const result = await correctClubRugbyCode(directoryId, newCode, reason)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    onCorrected(newCode)
    setOpen(false)
    setReason("")
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="outline" size="sm" className="h-8 shrink-0" />}>Correct</DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Correct rugby code</DialogTitle>
          <DialogDescription>
            This changes the club&apos;s canonical sporting identity for every fixture, team, and search result. Never do
            this to merge two similarly-named clubs.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-2">
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            <span>
              Currently {currentCode === "union" ? "Rugby Union" : "Rugby League"}. This is a data-integrity action, not
              a routine edit.
            </span>
          </div>

          <div>
            <label className="text-sm font-medium text-ink">Correct code</label>
            <select
              value={newCode}
              onChange={(e) => setNewCode(e.target.value as "union" | "league")}
              className="mt-1.5 h-10 w-full rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            >
              <option value="union">Rugby Union</option>
              <option value="league">Rugby League</option>
            </select>
          </div>

          <div>
            <label className="text-sm font-medium text-ink">Reason (required)</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              rows={3}
              placeholder="Why is this club's rugby code actually different, and what confirms it?"
              className="mt-1.5 w-full resize-y rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={handleConfirm} disabled={submitting || reason.trim().length === 0}>
            {submitting ? "Correcting…" : "Confirm correction"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
