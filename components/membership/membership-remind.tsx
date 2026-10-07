"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { AlertTriangle, CheckCircle2 } from "lucide-react"

/**
 * THE ACTING HALF OF THE MEMBERSHIP BOARD ON THE WEBSITE: a button that runs a server action and hands back the
 * server's own sentence, and the one place that sentence is said. The server decides who may remind whom, holds a
 * repeat back for 72 hours and limits a sender to 100 a day; these only carry its answer.
 */

/** What an action said, and -- for a reminder -- how many families it actually reminded. */
export type Said = { tone: "ok" | "error"; text: string; sent?: number }

const PRIMARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg bg-pitch-600 px-4 text-sm font-semibold text-forest-950 outline-none hover:bg-pitch-600/85 focus-visible:ring-2 focus-visible:ring-forest-800 focus-visible:ring-offset-2 disabled:opacity-60 sm:min-h-9"
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-ink/15 bg-white px-3 text-sm font-medium text-forest-800 outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-forest-800 disabled:opacity-60 sm:min-h-9"

/**
 * Runs a server action, says it is working, and hands back the server's sentence. `held` keeps the same button in
 * the same place once its job is done ("Reminder Sent"): still focusable, so a keyboard or screen-reader user is not
 * dropped to the top of the page when the refreshed page no longer offers the reminder.
 */
export function RemindButton({
  label,
  visibleLabel,
  primary = false,
  action,
  onDone,
  held = false,
  heldLabel = "Reminder Sent",
  className = "",
}: {
  /** The accessible name; it always contains the visible words. */
  label: string
  visibleLabel?: string
  primary?: boolean
  action: () => Promise<Said>
  onDone: (said: Said) => void
  held?: boolean
  heldLabel?: string
  className?: string
}) {
  const [pending, start] = useTransition()
  // Unavailable while working or once done, but never `disabled`: a disabled button loses keyboard focus.
  const unavailable = held || pending
  return (
    <button
      type="button"
      aria-disabled={unavailable || undefined}
      aria-busy={pending}
      aria-label={held ? heldLabel : label}
      onClick={() => {
        if (unavailable) return
        start(async () => onDone(await action()))
      }}
      className={`${primary ? PRIMARY : SECONDARY} ${unavailable ? "cursor-default opacity-60" : ""} ${className}`}
    >
      {pending ? "Sending…" : held ? heldLabel : (visibleLabel ?? label)}
    </button>
  )
}

/**
 * What an action just did, said where it happened. A success is polite and a problem is said at once; both regions
 * are always in the page, so what appears in them is announced rather than merely drawn.
 */
export function OutcomeNotice({ said, className = "" }: { said: Said | null; className?: string }) {
  return (
    <>
      <div role="status" aria-live="polite">
        {said?.tone === "ok" && (
          <p className={`flex max-w-prose items-start gap-2 rounded-xl bg-mint-100 px-4 py-3 text-sm text-forest-800 ${className}`}>
            <CheckCircle2 aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-rugby-700" />
            <span>{said.text}</span>
          </p>
        )}
      </div>
      <div role="alert">
        {said?.tone === "error" && (
          <p className={`flex max-w-prose items-start gap-2 rounded-xl bg-red-50 px-4 py-3 text-sm text-destructive-text ${className}`}>
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            <span>{said.text}</span>
          </p>
        )}
      </div>
    </>
  )
}

/** The outcome of an action, and the server's fresh answer behind it. */
export function useOutcome() {
  const router = useRouter()
  const [said, setSaid] = useState<Said | null>(null)
  const [, startRefresh] = useTransition()
  return {
    said,
    done: (next: Said) => {
      setSaid(next)
      startRefresh(() => router.refresh())
    },
    clear: () => setSaid(null),
  }
}

/** The players this view has just reminded, so their buttons stay in place as "Reminder Sent". */
export function useRemindedHere() {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set())
  return {
    has: (playerId: string) => ids.has(playerId),
    /** Wraps an outcome handler: a reminder that reached somebody marks these players as reminded here. */
    track: (playerIds: string[], onDone: (said: Said) => void) => (said: Said) => {
      if (said.tone === "ok" && (said.sent ?? 0) > 0) setIds((current) => new Set([...current, ...playerIds]))
      onDone(said)
    },
  }
}
