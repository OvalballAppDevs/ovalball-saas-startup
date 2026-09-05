"use client"

import { useState } from "react"

import { Button } from "@/components/ui/button"

import { reactivateUser, suspendUser } from "./actions"

/**
 * Genuinely blocks protected actions -- internal.is_account_active() is
 * composed into the four RLS helper functions almost every write policy
 * in this project funnels through, so a suspended user's authenticated
 * session immediately loses every protected action, not just a label
 * here. Suspend requires a confirmation step; reactivate is one click,
 * matching the asymmetry of a destructive-ish action vs. its reversal.
 */
export function AccountStatusControl({ userId, userName, status, isSelf }: { userId: string; userName: string; status: "active" | "suspended"; isSelf: boolean }) {
  const [current, setCurrent] = useState(status)
  const [confirming, setConfirming] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSuspend() {
    setWorking(true)
    setError(null)
    const result = await suspendUser(userId)
    setWorking(false)
    if (result.ok) {
      setCurrent("suspended")
      setConfirming(false)
    } else {
      setError(result.error)
    }
  }

  async function handleReactivate() {
    setWorking(true)
    setError(null)
    const result = await reactivateUser(userId)
    setWorking(false)
    if (result.ok) setCurrent("active")
    else setError(result.error)
  }

  return (
    <div className={`rounded-lg border p-4 ${current === "suspended" ? "border-destructive/25 bg-destructive/[0.03]" : "border-ink/10 bg-white"}`}>
      <p className="text-sm font-medium text-ink">Account status</p>
      <p className="mt-1 text-sm text-ink/55">
        {current === "suspended"
          ? "Suspended -- every protected action (club/team administration, fixtures, messaging) is blocked for this account, even though they can still sign in."
          : "Active. Suspending blocks all protected actions immediately without deleting the account or any of its history."}
      </p>

      {current === "suspended" ? (
        <Button type="button" variant="outline" className="mt-3 h-9" disabled={working} onClick={handleReactivate}>
          {working ? "Working…" : "Reactivate account"}
        </Button>
      ) : isSelf ? (
        <p className="mt-3 text-xs text-ink/45">You cannot suspend your own account.</p>
      ) : !confirming ? (
        <Button type="button" variant="ghost" className="mt-3 h-9 text-destructive hover:bg-destructive/10" onClick={() => setConfirming(true)}>
          Suspend account
        </Button>
      ) : (
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-ink/60">Suspend {userName}&apos;s account?</span>
          <Button type="button" variant="destructive" className="h-9" disabled={working} onClick={handleSuspend}>
            {working ? "Suspending…" : "Confirm suspend"}
          </Button>
          <Button type="button" variant="ghost" className="h-9" disabled={working} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
