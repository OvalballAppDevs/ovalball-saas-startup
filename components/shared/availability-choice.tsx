"use client"

import { Check, HelpCircle, X } from "lucide-react"

import {
  ATTENDANCE_ANSWER_WORDS,
  AVAILABILITY_ANSWER_ORDER,
  SAVING_LABEL,
  type AvailabilityStatus,
} from "@ovalball/contracts/availability"
import { cn } from "@/lib/utils"

/**
 * "CAN YOU MAKE IT?" -- the one availability control Ovalball has.
 *
 * Extracted so Match Centre and Training Centre answer the same question with
 * the same control rather than two lookalikes that drift apart. A matchday and
 * a training session are different records, but they ask a person exactly one
 * thing, and it should not look like two different products asking it.
 *
 * This file is PRESENTATION ONLY. It holds no fixture or training concept, no
 * server action and no authority: the caller passes the current answer and
 * receives the chosen one. That is what makes it safe to share -- there is no
 * domain in here to leak between the two surfaces.
 *
 * SELECTION IS NEVER CARRIED BY COLOUR. Each choice has its own ICON, its own
 * WORDS, a filled ground when chosen, and aria-pressed for anybody not looking
 * at it. The colours are the ones a touchline already reads -- green yes, red
 * no, amber maybe -- and they make the three states tellable apart at a
 * glance, but remove them and the control still answers correctly.
 */

export type { AvailabilityStatus }

// The shared vocabulary lives in @ovalball/contracts/availability -- a module
// with no "use client" directive and no web dependency, because the
// server-rendered registers import it too (a client module hands them a proxy
// instead of the value) and the native client imports it as well.
export { ATTENDANCE_STATE_WORDS } from "@ovalball/contracts/availability"

/** The web's paint for each answer. The words, the order and the icon are the contract's. */
const ANSWER_PAINT: Record<AvailabilityStatus, { Icon: typeof Check; idle: string; active: string; selected: string }> = {
  ATTENDING: {
    Icon: Check,
    // pitch-400/600 are the ONLY greens the theme defines. This used to
    // reach for pitch-100/200/300, which resolve to nothing -- so the idle
    // tick inherited near-black ink on a dark ground and the selected ring
    // rendered grey, while the red and amber options got real colours.
    // Confirmed at runtime, not inferred: text-pitch-200 computed to
    // rgb(16,21,18), the inherited ink.
    idle: "border-pitch-400/40 text-pitch-400",
    active: "border-pitch-400 bg-pitch-400/30 text-chalk",
    selected: "border-pitch-400 bg-pitch-400/20",
  },
  CANNOT_ATTEND: {
    Icon: X,
    idle: "border-red-400/40 text-red-200",
    active: "border-red-300 bg-red-400/25 text-red-100",
    selected: "border-red-400/70 bg-red-400/15",
  },
  UNSURE: {
    Icon: HelpCircle,
    idle: "border-amber-400/40 text-amber-200",
    active: "border-amber-300 bg-amber-400/25 text-amber-100",
    selected: "border-amber-400/70 bg-amber-400/15",
  },
}

/**
 * THE THREE ANSWERS, IN THE CANONICAL ORDER, WITH THE CANONICAL WORDS.
 *
 * Both came from this file until M6. The words now come from
 * ATTENDANCE_ANSWER_WORDS, because the Agenda's own inline control had grown a
 * SECOND set of first-person labels -- "Can Attend / Can't Attend / Maybe" --
 * for exactly the same three database states. A parent who answered on the
 * Agenda and then opened Match Centre had their answer described in words they
 * were never offered. The labels are also Title Case now, which is what the
 * content standard says a button is, and which the sentence-case originals were
 * not.
 */
export const AVAILABILITY_OPTIONS: {
  status: AvailabilityStatus
  label: string
  Icon: typeof Check
  /** Icon badge when this answer is NOT the current one -- quiet, but still its own colour. */
  idle: string
  /** Icon badge when it IS. */
  active: string
  /** The button itself, when selected. */
  selected: string
}[] = AVAILABILITY_ANSWER_ORDER.map((status) => ({
  status,
  label: ATTENDANCE_ANSWER_WORDS[status],
  ...ANSWER_PAINT[status],
}))

/**
 * The three buttons, on a dark ground.
 *
 * A group rather than three loose buttons: a screen reader hears the question
 * once, then three states, instead of three unrelated toggles.
 */
export function AvailabilityChoice({
  question,
  questionId,
  committed,
  pending,
  disabled,
  onChoose,
}: {
  question: string
  questionId: string
  committed: AvailabilityStatus | null
  /** The option currently being written, so only that one says "Saving…". */
  pending: AvailabilityStatus | null
  disabled: boolean
  onChoose: (status: AvailabilityStatus) => void
}) {
  return (
    <div role="group" aria-labelledby={questionId} className="grid grid-cols-3 gap-2">
      {AVAILABILITY_OPTIONS.map((opt) => {
        const isSelected = committed === opt.status
        const isSaving = pending === opt.status
        return (
          <button
            key={opt.status}
            type="button"
            disabled={disabled}
            aria-pressed={isSelected}
            onClick={() => onChoose(opt.status)}
            className={cn(
              "flex min-h-16 flex-col items-center justify-center gap-1.5 rounded-xl border px-1.5 py-3 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-pitch-400 focus-visible:ring-offset-2 focus-visible:ring-offset-forest-950 disabled:opacity-60",
              isSelected ? `${opt.selected} text-chalk` : "border-white/15 bg-white/5 text-white/80 hover:border-white/30 hover:bg-white/10"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
                isSelected ? opt.active : opt.idle
              )}
            >
              <opt.Icon className="size-4" strokeWidth={isSelected ? 3 : 2.25} />
            </span>
            <span className="text-center leading-tight text-balance">{isSaving ? SAVING_LABEL : opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
