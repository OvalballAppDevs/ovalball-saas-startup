"use client"

import { useState } from "react"

import { confirmSafeguardingOfficer } from "./actions"

export interface PendingNomination {
  assignmentId: string
  clubId: string
  clubName: string
  personName: string
  officerType: "primary" | "deputy"
  alsoClubAdmin: boolean
  nominatedAt: string
}

/**
 * One nomination waiting on Ovalball (AN-6). The reason box is not decoration: the database refuses a
 * confirmation without one and records what was written, so this is the moment the reason is captured
 * rather than a field someone fills in afterwards.
 *
 * `alsoClubAdmin` is shown because AN-6 asks for it by name. A club whose Safeguarding Officer is also
 * its administrator is a legitimate arrangement and a small club may have no alternative, but it is
 * one the person confirming should be looking at rather than discovering later.
 */
export function PendingNominationRow({ nomination }: { nomination: PendingNomination }) {
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (done) {
    return (
      <li className="rounded-lg border border-forest-200 bg-forest-50 px-4 py-3 text-sm text-ink">
        {nomination.personName} is now a confirmed Safeguarding Officer for {nomination.clubName}.
      </li>
    )
  }

  return (
    <li className="rounded-lg border border-ink-100 px-4 py-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-medium text-ink">
          {nomination.personName} — {nomination.clubName}
        </p>
        <p className="text-xs text-ink-muted">
          {nomination.officerType === "primary" ? "Primary officer" : "Deputy"} · nominated {nomination.nominatedAt}
        </p>
      </div>
      {nomination.alsoClubAdmin ? (
        <p className="mt-1 text-xs font-medium text-amber-800">
          This person is also a Club Admin at this club.
        </p>
      ) : null}
      <p className="mt-2 text-sm text-ink-muted">
        This nomination grants nothing until you confirm it.
      </p>
      <label className="mt-3 block text-sm text-ink">
        Reason
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={2}
          className="mt-1 w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
          placeholder="Why this appointment is being confirmed."
        />
      </label>
      {error ? <p className="mt-2 text-sm text-rose-700">{error}</p> : null}
      <button
        type="button"
        disabled={busy || reason.trim().length === 0}
        onClick={async () => {
          setBusy(true)
          setError(null)
          const result = await confirmSafeguardingOfficer(nomination.assignmentId, reason)
          setBusy(false)
          if (result.ok) setDone(true)
          else setError(result.error)
        }}
        className="mt-3 rounded-md bg-forest-800 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
      >
        {busy ? "Confirming…" : "Confirm Appointment"}
      </button>
    </li>
  )
}
