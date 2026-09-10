"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { cancelClubEvent } from "./actions"

/**
 * CANCEL EVENT.
 *
 * DELIBERATELY THE SAME INTERACTION AS CANCEL FIXTURE, down to the shape of
 * the sentence, the required reason and the two button labels ("Keep …" /
 * "Confirm Cancellation"). A club administrator should not have to learn a
 * second way to call something off, and a destructive action that looks
 * different from the last destructive action is exactly where a mis-click
 * happens.
 *
 * A REASON IS REQUIRED, as it is for a fixture. People have already made
 * plans around this event; "cancelled" without a reason invites a round of
 * messages asking why, and the reason is what Event Centre and the Calendar
 * then show in place of guesswork.
 *
 * NEVER A DELETE. The canonical RPC sets status and keeps the row, so the
 * event stays on the Calendar struck through, the register of who had already
 * answered survives, and the pitch is freed by the same relationship that
 * reserved it. There is one cancellation state and this is it.
 */
export function CancelEventDialog({
  eventId,
  eventName,
  dateLabel,
  onClose,
}: {
  eventId: string
  eventName: string
  dateLabel: string
  onClose: () => void
}) {
  const router = useRouter()
  const [reason, setReason] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const trimmedReason = reason.trim()

  async function handleConfirm() {
    setSaving(true)
    setError(null)
    const result = await cancelClubEvent(eventId, trimmedReason)
    if (!result.ok) {
      setError(result.error ?? "Something went wrong. Please try again.")
      setSaving(false)
      return
    }
    onClose()
    router.refresh()
  }

  return (
    <div role="dialog" aria-modal="true" aria-label="Cancel Event" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl">
        <p className="font-display text-lg text-ink">Cancel this event?</p>
        <p className="mt-2 text-sm text-ink/70">
          This will cancel <strong>{eventName}</strong> on <strong>{dateLabel}</strong>.
        </p>
        <p className="mt-2 text-sm text-ink/70">
          It stays on everyone&rsquo;s calendar marked as cancelled rather than disappearing, so anybody who had already made plans can see
          what happened. Any pitches it reserved are freed immediately, and the responses people have already given are kept.
        </p>

        <label htmlFor="cancel-event-reason" className="mt-4 block text-sm font-medium text-ink/70">
          Reason for Cancellation
        </label>
        <textarea
          id="cancel-event-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={1000}
          rows={3}
          placeholder="e.g. Venue double-booked, not enough tickets sold"
          className="mt-1.5 w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-400/40"
        />

        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive-text">
            {error}
          </p>
        )}

        <div className="mt-5 flex items-center justify-end gap-3">
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={onClose} disabled={saving}>
            Keep Event
          </Button>
          <Button
            type="button"
            variant="destructive"
            className="h-11 sm:h-9"
            onClick={handleConfirm}
            disabled={saving || trimmedReason === ""}
          >
            {saving ? "Cancelling…" : "Confirm Cancellation"}
          </Button>
        </div>
      </div>
    </div>
  )
}
