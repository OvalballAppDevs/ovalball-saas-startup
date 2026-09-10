"use client"

import { useState, useTransition } from "react"

import { AvailabilityChoice } from "@/components/shared/availability-choice"
import { setAttendanceResponse } from "@/app/(app)/fixtures/[fixtureId]/actions"
import type { AttendanceStatus, MyAttendanceEntry } from "@/lib/app-context/match-centre-data"

/**
 * "Can you make the match?" -- the one thing most people open this page to do.
 *
 * IT SITS INSIDE THE MATCHDAY CARD, joined to the fixture above it, because
 * the invitation and the answer are one object. Detached in a white card
 * further down the page it read as an administrative form about the match
 * rather than the reply to it.
 *
 * SELECTION IS NEVER CARRIED BY COLOUR. Each choice has its own ICON, its own
 * WORDS, a filled ground when chosen, and aria-pressed for anyone not looking
 * at it at all. A colour-blind parent, a greyscale screenshot and a screen
 * reader all get the same answer.
 *
 * OPTIMISM IS DELIBERATELY ABSENT. The displayed response never changes until
 * the server action confirms it, so a failed write reverts to the last
 * confirmed value rather than leaving a permanently-lying tick. Somebody who
 * believes they have said yes and has not is exactly the failure this page
 * exists to prevent.
 *
 * ANSWERING IS NOT SELECTION. Saying "I'm available" tells the club you are
 * free; it does not put you in the team, and the wording stays on the right
 * side of that.
 */

/**
 * THE THREE BUTTONS LIVE IN components/shared/availability-choice.
 *
 * They used to be declared here, and Training Centre would have had to declare
 * them again -- two near-identical option tables, drifting the first time one
 * of them got a better focus ring. A matchday and a training session are
 * different records that ask a person exactly one identical question, so the
 * control that asks it is one component and this file supplies the wording,
 * the write and the failure handling.
 */

export function AttendancePanel({
  fixtureId,
  entries,
  fixtureCancelled,
}: {
  fixtureId: string
  entries: MyAttendanceEntry[]
  fixtureCancelled: boolean
}) {
  if (entries.length === 0) return null
  return (
    <div className="flex flex-col divide-y divide-white/10">
      {entries.map((entry) => (
        <AttendanceCard key={entry.playerId} fixtureId={fixtureId} entry={entry} fixtureCancelled={fixtureCancelled} />
      ))}
    </div>
  )
}

function AttendanceCard({
  fixtureId,
  entry,
  fixtureCancelled,
}: {
  fixtureId: string
  entry: MyAttendanceEntry
  fixtureCancelled: boolean
}) {
  const [committed, setCommitted] = useState<AttendanceStatus | null>(entry.response)
  const [pending, setPending] = useState<AttendanceStatus | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  const canRespond = entry.canRespond && !fixtureCancelled
  const groupLabelId = `availability-${entry.playerId}`

  return (
    <div className="px-4 py-4 sm:px-6">
      <p id={groupLabelId} className="text-sm font-medium text-chalk">
        {entry.isSelf ? "Can you make it?" : `Can ${entry.displayName.split(" ")[0]} make it?`}
      </p>

      {!canRespond ? (
        <p className="mt-1.5 text-sm text-white/70">
          {fixtureCancelled ? "This fixture has been cancelled." : (entry.cannotRespondReason ?? "You cannot respond for this player.")}
        </p>
      ) : (
        <>
          <div className="mt-3">
            <AvailabilityChoice
              question={entry.isSelf ? "Can you make it?" : `Can ${entry.displayName.split(" ")[0]} make it?`}
              questionId={groupLabelId}
              committed={committed}
              pending={isPending ? pending : null}
              disabled={isPending}
              onChoose={(status) => {
                setError(null)
                setPending(status as AttendanceStatus)
                startTransition(async () => {
                  const result = await setAttendanceResponse(fixtureId, entry.playerId, status as AttendanceStatus)
                  setPending(null)
                  if (result.ok) setCommitted(status as AttendanceStatus)
                  else setError(result.message)
                })
              }}
            />
          </div>
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
