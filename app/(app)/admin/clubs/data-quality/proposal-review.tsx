"use client"

import { useState } from "react"
import Link from "next/link"
import { AlertTriangle, ExternalLink } from "lucide-react"

import { Button } from "@/components/ui/button"

import { acceptResearchProposal, rejectResearchProposal } from "./actions"
import type { PendingProposal } from "./query"

const CONFIDENCE_STYLE: Record<string, string> = {
  high: "bg-pitch-600/12 text-forest-800",
  medium: "bg-amber-500/15 text-amber-800",
  low: "bg-ink/8 text-ink/55",
}

/**
 * One proposal at a time -- current value, proposed value, source and
 * confidence side by side, so a reviewer can see exactly what would
 * change and why before accepting. Accept applies it to the real
 * club_directory row via accept_directory_research_proposal(); reject
 * just closes the proposal out, changing nothing. Never a bulk "accept
 * all" here -- every field-level change gets an individual look.
 */
export function ProposalReviewCard({ proposal }: { proposal: PendingProposal }) {
  const [status, setStatus] = useState<"idle" | "working" | "done">("idle")
  const [error, setError] = useState<string | null>(null)

  async function handleAccept() {
    setStatus("working")
    setError(null)
    const result = await acceptResearchProposal(proposal.id)
    if (result.ok) {
      setStatus("done")
    } else {
      setStatus("idle")
      setError(result.error)
    }
  }

  async function handleReject() {
    setStatus("working")
    setError(null)
    const result = await rejectResearchProposal(proposal.id)
    if (result.ok) {
      setStatus("done")
    } else {
      setStatus("idle")
      setError(result.error)
    }
  }

  if (status === "done") return null

  return (
    <div className="rounded-lg border border-ink/10 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <Link href={`/admin/clubs/${proposal.directoryId}`} className="text-sm font-medium text-forest-800 hover:text-forest-950">
            {proposal.clubName}
          </Link>
          <p className="text-xs text-ink/45">Field: {proposal.field}</p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${CONFIDENCE_STYLE[proposal.confidence] ?? ""}`}>
          {proposal.confidence} confidence
        </span>
      </div>

      {proposal.status === "conflicting" && (
        <div className="mt-3 flex items-start gap-1.5 rounded-lg bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>{proposal.conflictReason ?? "Sources disagree -- flagged for manual review."}</span>
        </div>
      )}

      <div className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Current</p>
          <p className="mt-1 text-ink/70">{proposal.currentValue || <span className="text-ink/35">Empty</span>}</p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/40 uppercase">Proposed</p>
          <p className="mt-1 text-ink">{proposal.proposedValue}</p>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-ink/50">
        <span>Source: {proposal.source}</span>
        {proposal.sourceUrl && (
          <a href={proposal.sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-forest-800 hover:text-forest-950">
            <ExternalLink className="size-3" />
            View
          </a>
        )}
      </div>

      {error && <p className="mt-2 text-xs text-destructive">{error}</p>}

      <div className="mt-3 flex items-center gap-2">
        <Button type="button" size="sm" className="h-8" disabled={status === "working"} onClick={handleAccept}>
          Accept
        </Button>
        <Button type="button" size="sm" variant="outline" className="h-8" disabled={status === "working"} onClick={handleReject}>
          Reject
        </Button>
      </div>
    </div>
  )
}
