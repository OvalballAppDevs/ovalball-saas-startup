"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { SUPPORT_STATUS_LABELS, type SupportStatus } from "@/lib/support/types"

import { updateSupportTicketStatus } from "./actions"

const NEXT_STATUS: Record<SupportStatus, SupportStatus[]> = {
  new: ["in_progress", "closed"],
  in_progress: ["closed"],
  closed: [],
}

/**
 * One dialog handles both "Mark as In Progress" and "Close Ticket" --
 * always two SEPARATE textareas (message to user vs. internal note), so
 * the two can never be confused into the wrong visibility the way a
 * single freeform field could be.
 */
export function StatusControl({ ticketId, currentStatus }: { ticketId: string; currentStatus: SupportStatus }) {
  const router = useRouter()
  const [target, setTarget] = useState<SupportStatus | null>(null)
  const [userMessage, setUserMessage] = useState("")
  const [internalNote, setInternalNote] = useState("")
  const [sendUpdate, setSendUpdate] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const nextOptions = NEXT_STATUS[currentStatus]

  function openDialog(status: SupportStatus) {
    setTarget(status)
    setUserMessage(status === "in_progress" ? "We've started looking into your request." : "")
    setInternalNote("")
    setSendUpdate(true)
    setError(null)
  }

  async function handleConfirm() {
    if (!target) return
    setSubmitting(true)
    setError(null)
    const result = await updateSupportTicketStatus(ticketId, target, sendUpdate ? userMessage : undefined, internalNote)
    setSubmitting(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setTarget(null)
    router.refresh()
  }

  return (
    <div>
      <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Status</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-ink/8 px-3 py-1 text-sm font-medium text-ink">{SUPPORT_STATUS_LABELS[currentStatus]}</span>
        {nextOptions.map((s) => (
          <Button key={s} type="button" size="sm" variant="outline" className="h-8" onClick={() => openDialog(s)}>
            Mark {SUPPORT_STATUS_LABELS[s]}
          </Button>
        ))}
      </div>

      <Dialog open={target !== null} onOpenChange={(open) => !open && setTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{target === "closed" ? "Close Support Request" : `Mark as ${target ? SUPPORT_STATUS_LABELS[target] : ""}`}</DialogTitle>
            <DialogDescription>
              {target === "closed"
                ? "This resolution message is sent to the requester. The internal note is never shown to them."
                : "Optionally let the requester know you've started looking into this."}
            </DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4 py-2">
            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-ink">
                <input type="checkbox" checked={sendUpdate} onChange={(e) => setSendUpdate(e.target.checked)} className="size-4 rounded border-ink/25" />
                {target === "closed" ? "Resolution / message to user" : "Send update to user"}
              </label>
              <textarea
                value={userMessage}
                onChange={(e) => setUserMessage(e.target.value)}
                disabled={!sendUpdate}
                rows={3}
                placeholder={target === "closed" ? "What was the resolution?" : "Message to user…"}
                className="mt-1.5 w-full resize-y rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none disabled:bg-ink/5 disabled:text-ink/40 focus-visible:ring-2 focus-visible:ring-pitch-400"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-ink">Internal {target === "closed" ? "closing " : ""}note (Site Admin only)</label>
              <textarea
                value={internalNote}
                onChange={(e) => setInternalNote(e.target.value)}
                rows={2}
                placeholder="Optional -- never visible to the requester"
                className="mt-1.5 w-full resize-y rounded-lg border border-amber-400/40 bg-amber-50 px-3 py-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
              />
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <DialogFooter>
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
            <Button onClick={handleConfirm} disabled={submitting}>
              {submitting ? "Saving…" : target === "closed" ? "Close Ticket" : `Mark ${target ? SUPPORT_STATUS_LABELS[target] : ""}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
