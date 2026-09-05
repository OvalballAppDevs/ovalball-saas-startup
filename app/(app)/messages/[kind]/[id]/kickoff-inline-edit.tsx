"use client"

import { useState } from "react"
import { Clock, Pencil } from "lucide-react"

import { Button } from "@/components/ui/button"

import { rejectFixtureKickoffChangeAction, updateFixtureKickoffAction } from "./result-actions"

export interface PendingKickoffAmendment {
  proposedDate: string
  proposedTime: string | null
  proposedByClubId: string | null
  proposedByMe: boolean
}

function formatKickoff(date: string, time: string | null) {
  const d = new Date(`${date}T00:00:00`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })
  return time ? `${d}, ${time.slice(0, 5)}` : d
}

/**
 * A material kick-off change on a fixture with a real, activated opponent
 * becomes a proposed amendment (update_fixture_kickoff's own state
 * machine) -- this chip surfaces the pending proposal clearly rather than
 * silently applying it, mirroring the result amendment pattern already
 * used elsewhere on this page.
 */
export function KickoffInlineEdit({
  fixtureId,
  kickoffDate,
  kickoffTime,
  pendingAmendment,
}: {
  fixtureId: string
  kickoffDate: string
  kickoffTime: string | null
  pendingAmendment: PendingKickoffAmendment | null
}) {
  const [editing, setEditing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dateValue, setDateValue] = useState(pendingAmendment?.proposedDate ?? kickoffDate)
  const [timeValue, setTimeValue] = useState((pendingAmendment?.proposedTime ?? kickoffTime ?? "").slice(0, 5))

  async function handleSave() {
    setPending(true)
    setError(null)
    const result = await updateFixtureKickoffAction(fixtureId, dateValue, timeValue || null)
    setPending(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setEditing(false)
  }

  async function handleReject() {
    setPending(true)
    setError(null)
    const result = await rejectFixtureKickoffChangeAction(fixtureId)
    setPending(false)
    if (!result.ok) setError(result.error)
  }

  if (pendingAmendment && !editing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-800">
        <Clock className="size-3.5" />
        Kick-off proposed: {formatKickoff(pendingAmendment.proposedDate, pendingAmendment.proposedTime)}
        {pendingAmendment.proposedByMe ? (
          <button type="button" onClick={() => setEditing(true)} className="underline underline-offset-2 hover:text-amber-950">
            Edit
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => updateFixtureKickoffAction(fixtureId, pendingAmendment.proposedDate, pendingAmendment.proposedTime).then(() => window.location.reload())}
              className="font-semibold underline underline-offset-2 hover:text-amber-950"
            >
              Accept
            </button>
            <button type="button" disabled={pending} onClick={handleReject} className="underline underline-offset-2 hover:text-amber-950">
              Decline
            </button>
          </>
        )}
      </span>
    )
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-ink/12 bg-white px-2.5 py-1 text-xs font-medium text-ink/70 outline-none transition-colors hover:border-pitch-600/40 hover:text-ink focus-visible:ring-2 focus-visible:ring-pitch-400"
      >
        <Clock className="size-3.5 text-ink/35" />
        {formatKickoff(kickoffDate, kickoffTime)}
        <Pencil className="size-3 text-ink/30" />
      </button>
    )
  }

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-pitch-600/40 bg-white py-1 pr-1.5 pl-2.5">
      <input
        type="date"
        autoFocus
        value={dateValue}
        onChange={(e) => setDateValue(e.target.value)}
        className="h-6 border-0 bg-transparent p-0 text-xs text-ink outline-none"
      />
      <input type="time" value={timeValue} onChange={(e) => setTimeValue(e.target.value)} className="h-6 w-20 border-0 bg-transparent p-0 text-xs text-ink outline-none" />
      <Button type="button" size="sm" className="h-6 rounded-full px-2 text-xs" disabled={pending || !dateValue} onClick={handleSave}>
        Save
      </Button>
      <button type="button" onClick={() => setEditing(false)} className="text-xs text-ink/40 hover:text-ink/70">
        Cancel
      </button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </span>
  )
}
