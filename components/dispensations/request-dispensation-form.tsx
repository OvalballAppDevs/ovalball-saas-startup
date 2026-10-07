"use client"

import { useId, useState, useTransition } from "react"
import Link from "next/link"
import { Clock } from "lucide-react"

import { DISPENSATION_NOT_A_GRANT, DISPENSATION_REASON_MAX } from "@ovalball/contracts/team/dispensation"

import { Button } from "@/components/ui/button"

import { requestDispensationAction } from "@/app/(app)/dispensations/actions"

/**
 * REQUEST DISPENSATION -- the one way past an age-grade mismatch, offered beside a child the normal way
 * refuses. It asks; it never grants: the request waits for the club's Safeguarding Officer or a Club Admin,
 * and this says so before and after it is sent. The server decides whether this person may ask at all.
 */
export function RequestDispensationForm({
  playerId,
  playerName,
  teamId,
  teamLabel,
  sourceTeamId,
  mismatch,
  compact = false,
  startOpen = false,
}: {
  playerId: string
  playerName: string
  teamId: string
  teamLabel: string
  sourceTeamId?: string | null
  /** The mismatch, in the shared words, where the caller has it. */
  mismatch?: string | null
  compact?: boolean
  /** Open from the start, where the person has already chosen to ask (Player Moves). */
  startOpen?: boolean
}) {
  const id = useId()
  const [open, setOpen] = useState(startOpen)
  const [reason, setReason] = useState("")
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState<string | null>(null)
  const first = playerName.split(" ")[0] || playerName

  if (sent) {
    return (
      <div role="status" className="mt-3 rounded-lg border border-amber-500/40 bg-amber-50 px-4 py-3 text-sm text-amber-950">
        <p className="flex items-center gap-2 font-semibold">
          <Clock aria-hidden="true" className="size-4" />
          Request sent
        </p>
        <p className="mt-1">
          {DISPENSATION_NOT_A_GRANT} The club&apos;s Safeguarding Officer or a Club Admin decides.{" "}
          <Link href={`/dispensations/${sent}`} className="font-medium underline underline-offset-2">
            Open Request
          </Link>
        </p>
      </div>
    )
  }

  if (!open) {
    return (
      <Button type="button" variant="outline" size={compact ? "sm" : "default"} className={compact ? "mt-2 min-h-11" : "mt-3 h-11 px-5"} onClick={() => setOpen(true)} aria-label={`Request a dispensation for ${playerName}`}>
        Request Dispensation
      </Button>
    )
  }

  return (
    <div className="mt-3 rounded-lg border border-ink/10 bg-chalk px-4 py-4">
      {mismatch && <p className="text-sm text-ink">{mismatch}</p>}
      <p className="mt-2 flex items-start gap-2 text-sm text-amber-950">
        <Clock aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-amber-800" />
        <span>
          A dispensation is an exception the club has to approve. {DISPENSATION_NOT_A_GRANT}
        </span>
      </p>
      <label htmlFor={`${id}-reason`} className="mt-4 block text-sm font-medium text-ink">
        Why Should {first} Play for {teamLabel}?
      </label>
      <textarea
        id={`${id}-reason`}
        value={reason}
        rows={3}
        maxLength={DISPENSATION_REASON_MAX}
        onChange={(e) => setReason(e.target.value)}
        aria-required="true"
        aria-describedby={`${id}-help`}
        className="mt-1.5 w-full resize-none rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-600/30"
      />
      <p id={`${id}-help`} className="mt-1 text-xs text-ink-muted">
        Required. The people who decide read it, and so does {first}&apos;s family.
      </p>
      {error && (
        <p className="mt-3 text-sm text-destructive-text" role="alert">
          {error}
        </p>
      )}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        <Button
          type="button"
          className="h-11 px-6"
          disabled={pending || !reason.trim()}
          onClick={() => {
            setError(null)
            start(async () => {
              const result = await requestDispensationAction({ playerId, teamId, reason, sourceTeamId: sourceTeamId ?? null })
              if (!result.ok) {
                setError(result.error)
                return
              }
              setSent(result.id ?? "")
            })
          }}
        >
          {pending ? "Sending…" : "Send Request"}
        </Button>
        <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setOpen(false)}>
          Cancel
        </Button>
      </div>
    </div>
  )
}
