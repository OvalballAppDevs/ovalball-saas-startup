"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { approveSiteAdminGrant, rejectSiteAdminGrant } from "./actions"
import { ADMIN_PROFILES } from "./profiles"

const MIN_REASON = 10

export interface GrantRequestData {
  id: string
  targetUserId: string
  targetName: string
  targetEmail: string | null
  profileKey: string
  reason: string
  requestedByName: string
  requestedBySelf: boolean
  targetIsSelf: boolean
  createdAt: string
  expiresAt: string
}

/**
 * SLICE 7e (S7-8) -- one pending request, and the decision on it.
 *
 * The two refusals this row can hit are shown BEFORE the buttons rather than
 * after a click, because they are not errors: an administrator cannot decide
 * their own request, and cannot decide a request about themselves. Presenting
 * those as failures would suggest something went wrong, when what happened is
 * the rule doing precisely what it exists for. The database refuses either way.
 */
export function GrantRequestRow({ request }: { request: GrantRequestData }) {
  const [intent, setIntent] = useState<"approve" | "reject" | null>(null)
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const blocked = request.requestedBySelf
    ? "You raised this request, so somebody else has to decide it."
    : request.targetIsSelf
      ? "This request is about you, so somebody else has to decide it."
      : null

  const reasonReady = reason.trim().length >= MIN_REASON
  const profile = ADMIN_PROFILES.find((p) => p.profileKey === request.profileKey)

  async function submit() {
    if (!intent || !reasonReady) return
    setWorking(true)
    setError(null)
    const result = await (intent === "approve" ? approveSiteAdminGrant : rejectSiteAdminGrant)(request.id, reason)
    setWorking(false)
    if (result.ok) {
      setIntent(null)
      setReason("")
    } else {
      setError(result.error)
    }
  }

  return (
    <li className="rounded-lg border border-amber-500/25 bg-amber-500/5 p-4">
      <p className="text-sm font-medium text-ink">
        {request.targetName} &rarr; {profile?.label ?? request.profileKey}
      </p>
      <p className="mt-0.5 text-sm text-ink-muted">
        {request.targetEmail ? `${request.targetEmail} · ` : ""}asked for by {request.requestedByName} on{" "}
        {formatDate(request.createdAt)} &middot; runs out {formatDate(request.expiresAt)}
      </p>
      <p className="mt-2 text-sm text-ink/70">{request.reason}</p>

      {blocked ? (
        <p className="mt-3 text-sm text-ink-muted">{blocked}</p>
      ) : intent ? (
        <div className="mt-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            <span className="font-medium">Reason</span>
            <span className="text-xs font-normal text-ink-muted">
              Your decision, in your own words. It is recorded against {request.targetName}&apos;s account.
            </span>
            <textarea
              className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
              value={reason}
              maxLength={500}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              placeholder={
                intent === "approve"
                  ? "Agreed at the board meeting on 2 September; they take over support in October."
                  : "The board has not agreed this yet — raise it again once it has."
              }
            />
          </label>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant={intent === "approve" ? "default" : "destructive"}
              className="h-9"
              disabled={working || !reasonReady}
              onClick={submit}
            >
              {working ? "Working…" : intent === "approve" ? "Confirm Approval" : "Confirm Rejection"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={() => setIntent(null)}>
              Cancel
            </Button>
            {!reasonReady && reason.length > 0 && (
              <span className="text-xs text-ink-muted">A few more words &mdash; at least {MIN_REASON} characters.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button type="button" className="h-9" onClick={() => setIntent("approve")}>
            Approve
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="h-9 text-destructive-text hover:bg-destructive/10"
            onClick={() => setIntent("reject")}
          >
            Reject
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
    </li>
  )
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
}
