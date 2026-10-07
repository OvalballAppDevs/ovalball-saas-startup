"use client"

import { useId, useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"

import { cancelMembershipAction } from "../actions"

/**
 * CANCEL MEMBERSHIP, asked first in a dialog that says what cancelling actually does (cancelMembershipAction ->
 * lib/payments/gocardless/cancel-membership.ts -> end_membership_subscription): any GoCardless monthly collection is
 * cancelled first, then the membership ends; no month or payment is touched; nothing in Ovalball re-opens an ended
 * membership. A reason is required, as the server requires one. Used on the membership record and on a member's page
 * in Memberships, where "Go to Cancel Membership" focuses `#cancel-membership button` -- so the trigger stays the
 * first button in this component (the dialog itself renders in a portal, outside it).
 */
export function CancelMembershipButton({ payerSubscriptionId, playerName }: { payerSubscriptionId: string; playerName: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reasonId = useId()
  const missing = reason.trim().length === 0

  function openDialog() {
    setReason("")
    setProblem(null)
    setOpen(true)
  }

  async function submit() {
    if (missing || busy) return
    setBusy(true)
    setProblem(null)
    const result = await cancelMembershipAction(payerSubscriptionId, reason.trim())
    setBusy(false)
    // The server's refusal (GoCardless not reachable, say) stays in the dialog: nothing has changed, and trying again is safe.
    if (!result.ok) return setProblem(result.error)
    setOpen(false)
    router.refresh()
  }

  return (
    <div>
      <Button type="button" variant="outline" className="h-11 border-destructive/30 text-destructive-text hover:bg-destructive/5 sm:h-9" onClick={openDialog}>
        Cancel Membership
      </Button>
      <Dialog open={open} onOpenChange={(next) => !next && !busy && setOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Cancel Membership</DialogTitle>
            {/* The consequences are the description, so a screen reader reads them when the dialog opens. */}
            <DialogDescription render={<div />} className="space-y-3">
              <p>{`You are cancelling ${playerName}'s membership. This is what happens:`}</p>
              <ul className="list-disc space-y-1.5 pl-5 text-ink marker:text-ink-muted">
                <li>{`The membership ends today, and the payer is told it has been cancelled. It does not remove ${playerName} from the club or a team.`}</li>
                <li>Ovalball cancels any monthly Direct Debit collection with GoCardless, so no new payments are scheduled. A payment already on its way to the bank may still be collected.</li>
                <li>Nothing is deleted. Every month and payment recorded so far stays on the membership record, and your reason is kept with it.</li>
                <li>This cannot be undone from Ovalball. To start again, a guardian, or an adult player for themselves, sets the membership up afresh with a new Direct Debit, at the current price.</li>
              </ul>
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault()
              void submit()
            }}
          >
            <div className="space-y-1.5">
              <label htmlFor={reasonId} className="text-sm font-medium text-ink">
                Reason <span aria-hidden="true" className="text-destructive-text">*</span>
              </label>
              <textarea
                id={reasonId}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={3}
                maxLength={500}
                required
                aria-required="true"
                aria-describedby={`${reasonId}-hint`}
                placeholder="Recorded with the cancellation, e.g. the family has moved away"
                className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-forest-800/25"
              />
              <p id={`${reasonId}-hint`} className="text-xs text-ink-muted">
                Required. Kept with the membership&rsquo;s history.
              </p>
            </div>
            {problem && (
              <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive-text">
                <p>{problem}</p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={busy} onClick={() => setOpen(false)}>
                Keep Membership
              </Button>
              <Button type="submit" variant="destructive" className="h-11 px-4 font-semibold sm:h-9" disabled={busy || missing} aria-busy={busy}>
                {busy ? "Cancelling…" : "Cancel Membership"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
