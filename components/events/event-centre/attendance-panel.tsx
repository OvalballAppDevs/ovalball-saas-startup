"use client"

import { useState, useTransition } from "react"

import { AvailabilityChoice, type AvailabilityStatus } from "@/components/shared/availability-choice"
import { setEventAttendanceResponse } from "@/app/(app)/events/[eventId]/actions"
import type { EventPlayerEntry } from "@/lib/app-context/event-centre-data"

/**
 * "Can you make it?"
 *
 * THE SAME CONTROL AS MATCH CENTRE AND TRAINING CENTRE, not a lookalike. The
 * three buttons come from components/shared/availability-choice, which both
 * other surfaces render too -- so the tick, the ring, the focus behaviour and
 * the wording change on all three at once. The vocabulary is deliberately NOT
 * re-invented as Going / Maybe / Not Going for events: one domain state has
 * one name across the product.
 *
 * WHAT DIFFERS IS THE VERB AND THE WRITE. This panel asks about an event and
 * calls the event action. That is the whole of the difference, and it is where
 * the difference belongs.
 *
 * OPTIMISM IS DELIBERATELY ABSENT. The displayed answer changes only after the
 * server confirms it, so a failed write leaves the last true answer on screen
 * rather than a tick that is lying.
 *
 * AUTHORITY IS NOT DECIDED HERE. The list is what the server said this viewer
 * may answer for, and the write is refused in the database by the canonical
 * safeguarding rule if it should be -- an under-16 answering for themselves is
 * rejected there, not hidden here.
 */
export function EventAttendancePanel({ eventId, entries }: { eventId: string; entries: EventPlayerEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col divide-y divide-white/10">
      {entries.map((entry) => (
        <EventAttendanceCard key={entry.playerId} eventId={eventId} entry={entry} />
      ))}
    </div>
  )
}

function EventAttendanceCard({ eventId, entry }: { eventId: string; entry: EventPlayerEntry }) {
  const [committed, setCommitted] = useState<AvailabilityStatus | null>((entry.status as AvailabilityStatus | null) ?? null)
  const [pending, setPending] = useState<AvailabilityStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const questionId = `event-availability-${entry.playerId}`
  const firstName = entry.playerName.split(" ")[0] || entry.playerName

  return (
    <div className="px-4 py-4 sm:px-6">
      <p id={questionId} className="text-sm font-medium text-chalk">
        {`Can ${firstName} make it?`}
      </p>
      {entry.teamDisplayName && <p className="mt-0.5 text-xs text-white/60">{entry.teamDisplayName}</p>}

      {/* THE CONTROL IS OFFERED ONLY TO SOMEBODY WHO MAY USE IT. A viewer who
          cannot answer for this player is told so plainly rather than given a
          control that will be refused. */}
      {entry.canRespond ? (
        <div className="mt-3">
          <AvailabilityChoice
            question={`Can ${firstName} make it?`}
            questionId={questionId}
            committed={committed}
            pending={pending}
            disabled={isPending}
            onChoose={(next) => {
              setError(null)
              setPending(next)
              startTransition(async () => {
                const result = await setEventAttendanceResponse(eventId, entry.playerId, next)
                // The displayed answer moves only once the server has
                // confirmed it -- a failed write leaves the last true answer
                // on screen rather than a tick that is lying.
                if (result?.error) setError(result.error)
                else setCommitted(next)
                setPending(null)
              })
            }}
          />
          {error && (
            <p role="alert" className="mt-2 text-xs text-red-200">
              {error}
            </p>
          )}
        </div>
      ) : (
        <p className="mt-2 text-xs text-white/60">
          Only an adult responsible for this player can answer for them.
        </p>
      )}
    </div>
  )
}
