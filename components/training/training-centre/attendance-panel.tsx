"use client"

import { useState, useTransition } from "react"

import { AvailabilityChoice, type AvailabilityStatus } from "@/components/shared/availability-choice"
import { setTrainingAttendanceResponse } from "@/app/(app)/training/[sessionId]/actions"
import type { TrainingAttendanceEntry } from "@/lib/app-context/training-centre-data"

/**
 * "Can you make training?"
 *
 * THE SAME CONTROL AS MATCH CENTRE, not a lookalike. The three buttons come
 * from components/shared/availability-choice, which Match Centre's own
 * attendance panel also renders -- so a change to the tick, the ring, the
 * focus behaviour or the wording lands on both surfaces at once. Two copies
 * would have been two products asking the same question slightly differently.
 *
 * WHAT DIFFERS IS THE VERB AND THE WRITE. This panel asks about a session and
 * calls the training action; that is the whole of the difference, and it is
 * where the difference belongs.
 *
 * OPTIMISM IS DELIBERATELY ABSENT. The displayed answer changes only after the
 * server confirms it, so a failed write leaves the last true answer on screen
 * rather than a tick that is lying. Somebody who believes they have said yes
 * and has not is exactly the failure this page exists to prevent.
 *
 * AUTHORITY IS NOT DECIDED HERE. The list of players is what the server said
 * this viewer may answer for, and the write is refused in the database by the
 * canonical safeguarding rule if it should be -- an under-16 answering for
 * themselves is rejected there, not hidden here.
 */

export function TrainingAttendancePanel({ sessionId, entries }: { sessionId: string; entries: TrainingAttendanceEntry[] }) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col divide-y divide-white/10">
      {entries.map((entry) => (
        <TrainingAttendanceCard key={entry.playerId} sessionId={sessionId} entry={entry} />
      ))}
    </div>
  )
}

function TrainingAttendanceCard({ sessionId, entry }: { sessionId: string; entry: TrainingAttendanceEntry }) {
  const [committed, setCommitted] = useState<AvailabilityStatus | null>(entry.response)
  const [pending, setPending] = useState<AvailabilityStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const questionId = `training-availability-${entry.playerId}`

  return (
    <div className="px-4 py-4 sm:px-6">
      {/* Contextual wording, shared design. A guardian is asked about their
          child by name; an adult player is asked about themselves. */}
      <p id={questionId} className="text-sm font-medium text-chalk">
        {entry.isSelf ? "Can you make training?" : `Can ${entry.firstName} make training?`}
      </p>

      {/* THE CONTROL IS OFFERED ONLY TO SOMEBODY WHO MAY USE IT.
          `canRespond` is the write's own safeguarding rule, resolved
          server-side and already accounting for a cancelled session. An
          under-16 answering for themselves, or a 16-17 year old without
          recorded guardian consent, now reads a calm sentence instead of
          tapping three inviting buttons and being refused in red -- which is
          exactly what Match Centre does for the same person under the same
          policy. */}
      {!entry.canRespond ? (
        <p className="mt-1.5 text-sm text-white/70">{entry.cannotRespondReason ?? "You cannot respond for this player."}</p>
      ) : (
        <>
          <div className="mt-3">
            <AvailabilityChoice
              question={entry.isSelf ? "Can you make training?" : `Can ${entry.firstName} make training?`}
              questionId={questionId}
              committed={committed}
              pending={isPending ? pending : null}
              disabled={isPending}
              onChoose={(status) => {
                setError(null)
                setPending(status)
                startTransition(async () => {
                  const result = await setTrainingAttendanceResponse(sessionId, entry.playerId, status)
                  setPending(null)
                  if (result.ok) setCommitted(status)
                  else setError(result.message)
                })
              }}
            />
          </div>
          {committed === null && !error && <p className="mt-2.5 text-sm text-white/70">You haven&rsquo;t responded yet.</p>}
          {error && (
            <p role="alert" className="mt-2.5 text-sm text-red-200">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  )
}
