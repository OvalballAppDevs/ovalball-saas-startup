"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

import { approveGuardianLinkRequest, rejectGuardianLinkRequest } from "./actions"

/**
 * Approve or reject, with the rejection reason kept optional but offered.
 *
 * There is deliberately no bulk "approve all": each of these decides which
 * adult can see a specific child, and the whole point of the request model
 * is that a person looks at the evidence one case at a time.
 */
export function DecisionControls({ requestId, canApprove = true }: { requestId: string; canApprove?: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState("")
  const [error, setError] = useState<string | null>(null)

  async function run(kind: "approve" | "reject") {
    setBusy(kind)
    setError(null)
    const result = kind === "approve" ? await approveGuardianLinkRequest(requestId) : await rejectGuardianLinkRequest(requestId, note)
    setBusy(null)
    if (!result.ok) {
      setError(result.error)
      return
    }
    router.refresh()
  }

  return (
    <div className="flex flex-col gap-2">
      {rejecting ? (
        <div className="flex flex-wrap items-center gap-2">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" className="max-w-xs" />
          <Button type="button" variant="outline" className="h-9" disabled={busy !== null} onClick={() => void run("reject")}>
            {busy === "reject" ? "Rejecting…" : "Confirm reject"}
          </Button>
          <Button type="button" variant="ghost" className="h-9" onClick={() => setRejecting(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" className="h-9" disabled={busy !== null || !canApprove} onClick={() => void run("approve")}>
            {busy === "approve" ? "Approving…" : "Approve"}
          </Button>
          <Button type="button" variant="outline" className="h-9" onClick={() => setRejecting(true)}>
            Reject
          </Button>
        </div>
      )}
      {error && <p className="text-sm text-destructive-text">{error}</p>}
    </div>
  )
}
