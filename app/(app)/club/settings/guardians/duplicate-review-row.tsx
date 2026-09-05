"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"

import { resolveDuplicateAsExisting, resolveDuplicateAsNew } from "./actions"

export interface DuplicateReviewData {
  id: string
  teamLabel: string
  submittedName: string
  submittedDob: string | null
  matchedName: string
  matchedDob: string | null
}

/**
 * Never exposed to the submitting Parent -- this row is the staff-only
 * resolution step. "Same child" links the ORIGINAL submitting guardian to
 * the existing player (resolve_player_duplicate_review_as_existing);
 * "Different child" creates the new player after all
 * (resolve_player_duplicate_review_as_new), using the data the parent
 * already submitted rather than asking them again.
 */
export function DuplicateReviewRow({ review }: { review: DuplicateReviewData }) {
  const router = useRouter()
  const [resolved, setResolved] = useState<"existing" | "new" | null>(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handle(action: "existing" | "new") {
    setPending(true)
    setError(null)
    const result = action === "existing" ? await resolveDuplicateAsExisting(review.id) : await resolveDuplicateAsNew(review.id)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setResolved(action)
    router.refresh()
  }

  if (resolved) {
    return (
      <li className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-4 py-3 text-sm text-ink/50">
        {review.submittedName} — {resolved === "existing" ? "linked to the existing player." : "created as a new player."}
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-amber-300 bg-amber-50 px-4 py-3.5">
      <p className="text-xs font-medium text-ink/50">{review.teamLabel}</p>
      <div className="mt-1.5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs text-ink/45 uppercase">Submitted</p>
          <p className="text-sm font-medium text-ink">{review.submittedName}</p>
          <p className="text-xs text-ink/55">{review.submittedDob ?? "No date of birth given"}</p>
        </div>
        <div>
          <p className="text-xs text-ink/45 uppercase">Matches existing player</p>
          <p className="text-sm font-medium text-ink">{review.matchedName}</p>
          <p className="text-xs text-ink/55">{review.matchedDob ?? "No date of birth on record"}</p>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-8" disabled={pending} onClick={() => handle("existing")}>
          Same child — link them
        </Button>
        <Button type="button" variant="outline" size="sm" className="h-8" disabled={pending} onClick={() => handle("new")}>
          Different child — create new
        </Button>
      </div>
    </li>
  )
}
