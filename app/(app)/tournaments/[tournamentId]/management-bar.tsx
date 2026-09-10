"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Pencil, Trash2 } from "lucide-react"

import { Button } from "@/components/ui/button"
import type { TournamentCentreContext } from "@/lib/tournaments/view-model"

import { cancelTournamentAction } from "../actions"

/**
 * MANAGEMENT INTEGRATES INTO THE PAGE, it does not replace it.
 *
 * The controls sit in the page's own header row beside the back link, in the
 * same place Match Centre, Training Centre and Event Centre put theirs -- an
 * organiser and a parent are looking at the same tournament, and the organiser
 * simply also has two buttons. Nothing about the layout below changes.
 *
 * These buttons are a courtesy, never the protection: cancel_tournament
 * re-checks internal.can_manage_tournament server-side, so hiding them from a
 * viewer who lacks authority is presentation and the refusal is real.
 */
export function TournamentManagementBar({ tournament }: { tournament: TournamentCentreContext }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [reason, setReason] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function cancel() {
    setBusy(true)
    setError(null)
    const result = await cancelTournamentAction(tournament.id, reason.trim() || null)
    setBusy(false)
    if (!result.ok) {
      setError(result.error)
      return
    }
    setConfirming(false)
    router.refresh()
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Link
          href={`/tournaments/${tournament.id}/edit`}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-ink/15 px-3.5 text-sm font-medium text-ink outline-none hover:bg-ink/[0.03] focus-visible:ring-2 focus-visible:ring-pitch-400 sm:h-10"
        >
          <Pencil className="size-4" aria-hidden="true" />
          Manage Tournament
        </Link>
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="inline-flex h-11 items-center gap-1.5 rounded-lg border border-destructive/30 px-3.5 text-sm font-medium text-destructive-text outline-none hover:bg-destructive/5 focus-visible:ring-2 focus-visible:ring-pitch-400 sm:h-10"
        >
          <Trash2 className="size-4" aria-hidden="true" />
          Cancel Tournament
        </button>
      </div>

      {confirming && (
        <div role="dialog" aria-modal="true" aria-labelledby="tc-cancel-title" className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-5 shadow-xl">
            <h2 id="tc-cancel-title" className="font-display text-lg text-ink">
              Cancel {tournament.name}?
            </h2>
            {/* THE FULL CONSEQUENCE, stated before it happens. */}
            <p className="mt-2 text-sm text-ink-muted">
              The tournament stays in the record and is shown as cancelled to everyone who could see it. Its future pitch reservations are
              released, so those pitches become available again.
            </p>
            <label htmlFor="tc-cancel-reason" className="mt-4 block text-sm font-medium text-ink">
              Reason <span className="font-normal text-ink-muted">(optional)</span>
            </label>
            <input
              id="tc-cancel-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="mt-1.5 h-11 w-full rounded-lg border border-ink/15 px-3.5 text-base text-ink outline-none focus-visible:border-pitch-600"
              placeholder="Pitches waterlogged"
            />
            {error && <p className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive-text">{error}</p>}
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => setConfirming(false)} disabled={busy}>
                Keep Tournament
              </Button>
              <Button type="button" className="h-11 bg-destructive text-white hover:bg-destructive/90 sm:h-10" onClick={cancel} disabled={busy}>
                {busy ? "Cancelling…" : "Cancel Tournament"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
