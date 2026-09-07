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
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

import { extendTrial } from "./actions"

/**
 * Rare, Full Site Admin only, and reached from a row's menu rather than a
 * visible button — a control on every row invites use, and this one should
 * be a deliberate act.
 */
export function ExtendTrialDialog({ clubId, clubName }: { clubId: string; clubName: string }) {
  const [open, setOpen] = useState(false)
  const [days, setDays] = useState("14")
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle")
  const [error, setError] = useState<string | null>(null)

  const parsedDays = Number.parseInt(days, 10)
  const daysValid = Number.isInteger(parsedDays) && parsedDays > 0 && parsedDays <= 365

  async function handleConfirm() {
    setStatus("saving")
    setError(null)
    const result = await extendTrial({ clubId, extraDays: parsedDays, reason })
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
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button type="button" variant="ghost" className="h-8" />}>
        Extend trial
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Extend {clubName}&rsquo;s trial</DialogTitle>
          <DialogDescription>
            Adds usable days to the trial. A trial that had already run out starts again, paused, so
            the club can choose when to resume it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="extend-days">Extra days</Label>
            <Input
              id="extend-days"
              inputMode="numeric"
              value={days}
              onChange={(e) => setDays(e.target.value)}
              className="max-w-32"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="extend-reason">Why</Label>
            <Input
              id="extend-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Lost two weeks to the pitch allocation bug."
            />
          </div>
        </div>

        {error ? <p className="mt-1 text-sm text-destructive-text">{error}</p> : null}

        <DialogFooter>
          <DialogClose render={<Button type="button" variant="ghost" className="h-9" />}>Cancel</DialogClose>
          <Button
            type="button"
            className="h-9"
            disabled={!daysValid || reason.trim().length < 5 || status === "saving"}
            onClick={handleConfirm}
          >
            {status === "saving" ? "Extending…" : `Add ${daysValid ? parsedDays : ""} days`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
