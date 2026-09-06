"use client"

import { useState } from "react"

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
import { Label } from "@/components/ui/label"

import { setPlatformMode } from "./actions"

/**
 * The most consequential control in the product: it decides whether
 * Ovalball charges clubs at all.
 *
 * It is made to feel consequential by saying plainly what it does, not by
 * painting it red. Red is for mistakes; this is a decision. The button is
 * labelled with its outcome ("Start charging clubs") rather than its
 * mechanism ("Set mode to live"), because the outcome is what has to be
 * weighed.
 *
 * forest-950 is Ovalball's own chrome everywhere else in the product, so
 * it is the right ground for the one block that states what Ovalball
 * itself is doing.
 */
export function PlatformModePanel({
  mode,
  since,
  changedByName,
  canManage,
}: {
  mode: "beta" | "live"
  since: string | null
  changedByName: string | null
  canManage: boolean
}) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const target: "beta" | "live" = mode === "beta" ? "live" : "beta"
  const actionLabel = mode === "beta" ? "Start charging clubs" : "Stop charging clubs"

  async function handleConfirm() {
    setStatus("saving")
    setError(null)
    const result = await setPlatformMode({ mode: target, reason })
    if (result.ok) {
      setStatus("idle")
      setReason("")
      setOpen(false)
    } else {
      setStatus("error")
      setError(result.error)
    }
  }

  return (
    <section className="mt-8 rounded-lg bg-forest-950 px-6 py-7 text-chalk md:px-8 md:py-9">
      <h2 className="font-display text-display-l">
        {mode === "beta" ? "Ovalball is in Beta" : "Ovalball is live"}
      </h2>

      <p className="mt-3 max-w-xl text-sm leading-relaxed text-chalk/75">
        {mode === "beta"
          ? "No club is being charged. Trial time is paused for every club and does not resume until Beta ends. Nothing is billed for this period afterwards."
          : "Clubs on a paid plan are being charged, and trial time is running down for clubs still on trial."}
      </p>

      <p className="mt-5 text-sm text-chalk/60">
        {since ? `Since ${formatDate(since)}` : "Since the model was introduced"}
        {changedByName ? ` · set by ${changedByName}` : " · recorded by the system"}
      </p>

      {canManage ? (
        <div className="mt-6">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger render={<Button type="button" className="h-9 w-full sm:w-auto" />}>
              {actionLabel}
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{actionLabel}?</DialogTitle>
                <DialogDescription>
                  {target === "live"
                    ? "Every club on a paid plan starts being charged from its next collection date, and paused trial clocks start running again. Nothing is billed for the Beta period."
                    : "Every collection stops and every running trial clock pauses where it is. Clubs keep the trial days they have left."}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label htmlFor="mode-reason">Why this is happening</Label>
                <textarea
                  id="mode-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  rows={3}
                  placeholder="Sandbox UAT complete; the first cohort starts billing on 1 October."
                  className="w-full rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
                />
                <p className="text-xs text-ink/55">
                  The mode history cannot be edited afterwards, so this sentence is the whole
                  explanation anyone will have later.
                </p>
              </div>

              {error ? <p className="mt-1 text-sm text-destructive">{error}</p> : null}

              <DialogFooter>
                <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>
                  Cancel
                </DialogClose>
                <Button
                  type="button"
                  className="h-9"
                  disabled={reason.trim().length < 10 || status === "saving"}
                  onClick={handleConfirm}
                >
                  {status === "saving" ? "Recording…" : actionLabel}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      ) : (
        <p className="mt-6 text-sm text-chalk/60">You can see the platform mode but not change it.</p>
      )}
    </section>
  )
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })
}
