"use client"

import { useState, useTransition } from "react"

import { setAttendanceResponse } from "@/app/(app)/fixtures/[fixtureId]/actions"
import type { AttendanceStatus, MyAttendanceEntry } from "@/lib/app-context/match-centre-data"

const OPTIONS: { status: AttendanceStatus; label: string; symbol: string }[] = [
  { status: "ATTENDING", label: "I'm attending", symbol: "✓" },
  { status: "CANNOT_ATTEND", label: "Can't attend", symbol: "✕" },
  { status: "UNSURE", label: "Unsure", symbol: "?" },
]

/**
 * One card per player the viewer is authorized to respond for (real Main
 * data can have more than one -- e.g. a guardian of twins on the same
 * fixture). Each card's displayed response never changes until the server
 * action actually confirms it -- a failed write reverts to the last
 * confirmed value, never leaves a permanently-lying optimistic state.
 */
export function AttendancePanel({ fixtureId, entries, fixtureCancelled }: { fixtureId: string; entries: MyAttendanceEntry[]; fixtureCancelled: boolean }) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col gap-2.5">
      {entries.map((entry) => (
        <AttendanceCard key={entry.playerId} fixtureId={fixtureId} entry={entry} fixtureCancelled={fixtureCancelled} />
      ))}
    </div>
  )
}

function AttendanceCard({ fixtureId, entry, fixtureCancelled }: { fixtureId: string; entry: MyAttendanceEntry; fixtureCancelled: boolean }) {
  const [committed, setCommitted] = useState<AttendanceStatus | null>(entry.response)
  const [pending, setPending] = useState<AttendanceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canRespond = entry.canRespond && !fixtureCancelled

  return (
    <div className="rounded-xl border border-ink/10 bg-white px-4 py-3.5">
      <p className="text-sm font-medium text-ink">{entry.displayName}&rsquo;s response</p>
      {!canRespond ? (
        <p className="mt-1 text-sm text-ink/60">{fixtureCancelled ? "This fixture has been cancelled." : (entry.cannotRespondReason ?? "You cannot respond for this player.")}</p>
      ) : (
        <>
          <div className="mt-2.5 grid grid-cols-3 gap-2">
            {OPTIONS.map((opt) => {
              const isSelected = committed === opt.status
              const isSaving = isPending && pending === opt.status
              return (
                <button
                  key={opt.status}
                  type="button"
                  disabled={isPending}
                  aria-pressed={isSelected}
                  onClick={() => {
                    setError(null)
                    setPending(opt.status)
                    startTransition(async () => {
                      const result = await setAttendanceResponse(fixtureId, entry.playerId, opt.status)
                      setPending(null)
                      if (result.ok) setCommitted(opt.status)
                      else setError(result.message)
                    })
                  }}
                  className={`flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg border px-2 py-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                    isSelected ? "border-pitch-600 bg-pitch-600/10 text-pitch-800" : "border-ink/12 text-ink/70 hover:bg-ink/5"
                  }`}
                >
                  <span aria-hidden="true" className="text-base leading-none">
                    {opt.symbol}
                  </span>
                  <span>{isSaving ? "Saving…" : opt.label}</span>
                </button>
              )
            })}
          </div>
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-700">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
