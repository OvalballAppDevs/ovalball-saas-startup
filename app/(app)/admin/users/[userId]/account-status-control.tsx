"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { disableUser, reactivateUser, suspendUser } from "./actions"

const MIN_REASON = 10

type Status = "active" | "suspended" | "disabled"

/**
 * Genuinely blocks protected actions -- internal.is_account_active() is
 * composed into the resolver chain almost every write policy in this project
 * funnels through, so a suspended person's authenticated session immediately
 * loses every protected action, not just a label here.
 *
 * SLICE 7: the reason box is the change worth explaining. Suspending an
 * account used to be a single click that left nothing on the record beyond
 * the fact that it happened. public.site_set_account_state now requires a
 * reason of at least ten characters, because the audit line is read later by
 * somebody who was not in the room -- "revoked" and "asked to" are not
 * explanations. The control therefore asks for one up front rather than
 * letting the database refuse after the click.
 *
 * Disabling is kept separate from suspending and confirmed on its own, and
 * not because of the UI: they are different capabilities. SITE_SUPPORT may
 * suspend and reinstate; only SITE_FULL may disable. A Support administrator
 * who tries will be refused by the RPC, and the message says so.
 */
export function AccountStatusControl({
  userId,
  userName,
  status,
  isSelf,
}: {
  userId: string
  userName: string
  status: Status
  isSelf: boolean
}) {
  const [current, setCurrent] = useState<Status>(status)
  const [intent, setIntent] = useState<"suspend" | "disable" | "reinstate" | null>(null)
  const [reason, setReason] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reasonReady = reason.trim().length >= MIN_REASON

  function begin(next: "suspend" | "disable" | "reinstate") {
    setIntent(next)
    setReason("")
    setError(null)
  }

  function cancel() {
    setIntent(null)
    setReason("")
    setError(null)
  }

  async function submit() {
    if (!intent || !reasonReady) return
    setWorking(true)
    setError(null)
    const act = intent === "suspend" ? suspendUser : intent === "disable" ? disableUser : reactivateUser
    const result = await act(userId, reason)
    setWorking(false)
    if (result.ok) {
      setCurrent(intent === "suspend" ? "suspended" : intent === "disable" ? "disabled" : "active")
      cancel()
    } else {
      setError(result.error)
    }
  }

  const tone = current === "active" ? "border-ink/10 bg-white" : "border-destructive/25 bg-destructive/[0.03]"

  return (
    <div className={`rounded-lg border p-4 ${tone}`}>
      <p className="text-sm font-medium text-ink">Account Status</p>
      <p className="mt-1 text-sm text-ink-muted">
        {current === "suspended"
          ? "Suspended — every protected action is blocked for this account, though they can still sign in."
          : current === "disabled"
            ? "Disabled — this account is switched off. Reinstating it restores access to everything it held before."
            : "Active. Suspending blocks all protected actions immediately without deleting the account or any of its history."}
      </p>

      {isSelf ? (
        <p className="mt-3 text-xs text-ink-muted">You cannot change your own account&apos;s status.</p>
      ) : intent ? (
        <div className="mt-3">
          <label className="flex flex-col gap-1.5 text-sm text-ink">
            <span className="font-medium">Reason</span>
            <span className="text-xs font-normal text-ink-muted">
              This is recorded against {userName}&apos;s account and read by whoever reviews it later. Say what
              happened, not just what you did.
            </span>
            <textarea
              className="min-h-20 rounded-md border border-ink/15 bg-white px-3 py-2 text-sm text-ink focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:outline-none"
              value={reason}
              maxLength={500}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setReason(e.target.value)}
              placeholder="The club reported this account was shared between two people."
            />
          </label>
          <div className="mt-2 flex items-center gap-2">
            <Button
              type="button"
              variant={intent === "reinstate" ? "default" : "destructive"}
              className="h-9"
              disabled={working || !reasonReady}
              onClick={submit}
            >
              {working
                ? "Working…"
                : intent === "suspend"
                  ? "Confirm Suspend"
                  : intent === "disable"
                    ? "Confirm Disable"
                    : "Confirm Reinstate"}
            </Button>
            <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={cancel}>
              Cancel
            </Button>
            {!reasonReady && reason.length > 0 && (
              <span className="text-xs text-ink-muted">A few more words — at least {MIN_REASON} characters.</span>
            )}
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {current === "active" ? (
            <>
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-destructive-text hover:bg-destructive/10"
                onClick={() => begin("suspend")}
              >
                Suspend Account
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-9 text-destructive-text hover:bg-destructive/10"
                onClick={() => begin("disable")}
              >
                Disable Account
              </Button>
            </>
          ) : (
            <Button type="button" variant="outline" className="h-9" onClick={() => begin("reinstate")}>
              Reinstate Account
            </Button>
          )}
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive-text">{error}</p>}
    </div>
  )
}
