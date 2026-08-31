"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

import { approveClaim, rejectClaim } from "./actions"

export interface ClaimCardData {
  id: string
  clubName: string
  claimantName: string
  claimantEmail: string
  claimedRole: string
  authorityDeclaration: string
  submittedAt: string
}

export function ClaimCard({ claim }: { claim: ClaimCardData }) {
  const [decision, setDecision] = useState<"approve" | "reject" | null>(null)
  const [notes, setNotes] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [decided, setDecided] = useState<"approved" | "rejected" | null>(null)

  async function handleConfirm() {
    if (!decision) return
    setSubmitting(true)
    setError(null)
    const result = decision === "approve" ? await approveClaim(claim.id, notes) : await rejectClaim(claim.id, notes)
    setSubmitting(false)
    if (result.ok) {
      setDecided(decision === "approve" ? "approved" : "rejected")
      setDecision(null)
    } else {
      setError(result.error)
    }
  }

  if (decided) {
    return (
      <div className="rounded-lg border border-ink/10 bg-white p-5 opacity-60">
        <p className="text-sm font-medium text-ink">{claim.clubName}</p>
        <p className="mt-1 text-sm text-ink/50">
          {decided === "approved" ? "Approved" : "Rejected"} just now.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-base font-medium text-ink">{claim.clubName}</p>
          <p className="mt-0.5 text-sm text-ink/50">
            Submitted {new Date(claim.submittedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-mint-100/60 px-2.5 py-1 text-xs font-medium text-forest-800">Pending</span>
      </div>

      <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Claimant</dt>
          <dd className="mt-0.5 text-sm text-ink">{claim.claimantName}</dd>
          <dd className="text-sm text-ink/60">{claim.claimantEmail}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Declared role</dt>
          <dd className="mt-0.5 text-sm text-ink">{claim.claimedRole}</dd>
        </div>
      </dl>

      <div className="mt-3">
        <dt className="text-xs font-medium tracking-[0.04em] text-ink/45 uppercase">Authority declaration</dt>
        <dd className="mt-1 text-sm text-ink/70">&ldquo;{claim.authorityDeclaration}&rdquo;</dd>
      </div>

      {error && (
        <p className="mt-4 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      <div className="mt-5 flex items-center gap-2 border-t border-ink/10 pt-4">
        <Dialog open={decision === "approve"} onOpenChange={(open) => setDecision(open ? "approve" : null)}>
          <DialogTrigger render={<Button size="sm" className="h-9" />}>Approve</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Approve claim on {claim.clubName}?</DialogTitle>
              <DialogDescription>
                This creates the club and grants {claim.claimantName} Club Admin access immediately.
              </DialogDescription>
            </DialogHeader>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional review notes"
              className="min-h-20 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus-visible:border-pitch-600"
            />
            <DialogFooter showCloseButton>
              <Button className="h-9" disabled={submitting} onClick={handleConfirm}>
                {submitting ? "Approving…" : "Confirm approval"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={decision === "reject"} onOpenChange={(open) => setDecision(open ? "reject" : null)}>
          <DialogTrigger render={<Button size="sm" variant="outline" className="h-9" />}>Reject</DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Reject claim on {claim.clubName}?</DialogTitle>
              <DialogDescription>{claim.claimantName} will be notified. This cannot be undone from here.</DialogDescription>
            </DialogHeader>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Reason (shown to the claimant)"
              className="min-h-20 w-full rounded-lg border border-ink/15 px-3 py-2 text-sm outline-none focus-visible:border-pitch-600"
            />
            <DialogFooter showCloseButton>
              <Button variant="destructive" className="h-9" disabled={submitting} onClick={handleConfirm}>
                {submitting ? "Rejecting…" : "Confirm rejection"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
