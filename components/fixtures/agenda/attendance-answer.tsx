"use client"

import { useState, useTransition } from "react"

import { respondFromAgenda } from "@/app/(app)/agenda/respond-actions"

export type AnswerStatus = "ATTENDING" | "CANNOT_ATTEND" | "UNSURE"

/**
 * THE ONE WAY A FAMILY ANSWERS, WHEREVER THEY ARE ASKED.
 *
 * Convergence Step 9. The canonical states are the database's own --
 * ATTENDING, CANNOT_ATTEND, UNSURE, and no row at all for "not answered yet".
 * Nothing here invents a fourth, and nothing here decides anything: the server
 * action calls the canonical RPC, which decides who may answer for whom.
 *
 * WHY IT LOOKS LIKE THIS.
 *
 * Three buttons, always all three, always in the same order, always labelled.
 * A parent answering four things on a Tuesday evening is not reading; they are
 * recognising shapes and positions. A control that hid the options behind a
 * menu, or that changed its order once one was chosen, would cost more than it
 * saved.
 *
 * STATE IS NEVER COMMUNICATED BY COLOUR ALONE. The chosen answer carries
 * `aria-pressed`, a filled background AND a tick, so it survives a screen
 * reader, a monochrome display and colour blindness alike.
 *
 * NO OPTIMISM. The button shows what the SERVER accepted. An answer that
 * failed -- because a sixteen year old does not have their guardian's consent
 * recorded, because the player left the team, because the session expired --
 * leaves the previous answer standing and says why. A control that flipped
 * first and reconciled later would tell a parent their child is expected at a
 * match nobody has been told about.
 */
export function AttendanceAnswer({
  kind,
  eventId,
  playerId,
  current,
  subject,
  what,
}: {
  kind: "fixture" | "training"
  eventId: string
  playerId: string
  current: AnswerStatus | null
  /** Whose answer this is -- a child's first name, or "you" for the viewer's own rugby. */
  subject: string
  /** What is being answered, so repeated controls do not all announce the same name. */
  what: string
}) {
  const [answer, setAnswer] = useState<AnswerStatus | null>(current)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function choose(status: AnswerStatus) {
    if (status === answer) return
    setError(null)
    startTransition(async () => {
      const result = await respondFromAgenda(kind, eventId, playerId, status)
      if (result.ok) setAnswer(status)
      else setError(result.message)
    })
  }

  // DARK INK ON THE BRAND GREEN, not white. globals.css records the measurement
  // and the decision: white on pitch-600 is about 3.1:1, below AA, while dark
  // ink on the same green clears 6:1 and keeps the accent as the fill. Writing
  // `text-white` here would have reintroduced L22's exact defect on a control a
  // parent taps every week -- which is what suite 49's axe run caught.
  const options: { status: AnswerStatus; label: string; chosen: string }[] = [
    { status: "ATTENDING", label: "Can Attend", chosen: "bg-pitch-600 text-ink" },
    { status: "CANNOT_ATTEND", label: "Can't Attend", chosen: "bg-ink text-white" },
    { status: "UNSURE", label: "Maybe", chosen: "bg-amber-100 text-amber-950" },
  ]

  return (
    <div className="mt-2">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={`${subject} — ${what}`}>
        {options.map((option) => {
          const isChosen = answer === option.status
          return (
            <button
              key={option.status}
              type="button"
              disabled={pending}
              aria-pressed={isChosen}
              // The accessible name carries WHO and WHAT, because a page full
              // of these would otherwise announce "Can Attend" eight times.
              aria-label={`${option.label} — ${subject}, ${what}`}
              onClick={() => choose(option.status)}
              className={`min-h-11 rounded-lg border px-3 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-pitch-400 disabled:opacity-60 ${
                isChosen ? `${option.chosen} border-transparent` : "border-ink/15 bg-white text-ink hover:border-ink/35"
              }`}
            >
              {isChosen && (
                <span aria-hidden="true" className="mr-1">
                  ✓
                </span>
              )}
              {option.label}
            </button>
          )
        })}
      </div>
      {answer === null && !error && (
        <p className="mt-1 text-xs text-ink-muted">Waiting for your response.</p>
      )}
      {error && (
        <p role="alert" className="mt-1 text-xs text-destructive-text">
          {error}
        </p>
      )}
    </div>
  )
}
