"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useState, useTransition } from "react"
import { AlertCircle, Check, Loader2, Trash2, Users } from "lucide-react"

import { Button } from "@/components/ui/button"

import { confirmTeams, removeSetupTeam } from "./actions"

/** The stored category values read the way a club says them. */
const CATEGORY_LABELS: Record<string, string> = {
  senior: "Senior",
  youth: "Youth",
  colts: "Colts",
}

export interface SetupTeam {
  id: string
  displayName: string
  category: string | null
  ageGroup: string | null
}

/**
 * Step 3 -- confirming the team list.
 *
 * The teams here were created when the club was approved, from what the
 * club itself told us. This step exists because that list is a claim, and
 * the person who runs the club is the only one who can say whether it is
 * right.
 *
 * Removal is deliberately not a delete button with a delete's confidence.
 * The server classifies each team first: one with no reference anywhere is
 * removed outright, one with fixtures, memberships or attendance behind it
 * is retired instead, and the difference is reported back rather than
 * decided here. Onboarding is not a route to destroy history.
 */
export function StepTeams({
  teams,
  confirmed,
}: {
  teams: SetupTeam[]
  confirmed: boolean
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [busyTeam, setBusyTeam] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  function handleConfirm() {
    setError(null)
    setNotice(null)
    startTransition(async () => {
      const result = await confirmTeams()
      if (!result.ok) {
        setError(result.error)
        return
      }
      router.refresh()
    })
  }

  function handleRemove(team: SetupTeam) {
    setError(null)
    setNotice(null)
    setBusyTeam(team.id)
    startTransition(async () => {
      const result = await removeSetupTeam(team.id)
      setBusyTeam(null)
      if (!result.ok) {
        setError(result.error)
        return
      }
      if (result.message) setNotice(result.message)
      router.refresh()
    })
  }

  return (
    <div className="mt-6">
      {error && (
        <p role="alert" className="mb-4 flex items-start gap-2 text-sm text-red-700">
          <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}
      {notice && (
        <p role="status" className="mb-4 rounded-lg bg-mint-100 px-4 py-3 text-sm text-forest-950">
          {notice}
        </p>
      )}

      {teams.length === 0 ? (
        <div className="rounded-lg border border-dashed border-ink/20 bg-white px-5 py-8 text-center">
          <Users aria-hidden="true" className="mx-auto size-6 text-ink-muted" />
          <p className="mt-3 text-sm font-medium text-ink">No teams yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-ink-muted">
            Add the teams your club runs this season before you finish setup &mdash; everything else in
            Ovalball hangs off them.
          </p>
          <Link
            href="/teams"
            className="mt-4 inline-flex items-center rounded-lg px-3 py-2 text-sm font-medium text-forest-800 underline underline-offset-4 outline-none hover:text-forest-950 focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Add teams in Team Administration
          </Link>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-ink/8 rounded-lg border border-ink/10 bg-white">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{t.displayName}</p>
                  {(t.category || t.ageGroup) && (
                    <p className="mt-0.5 truncate text-xs text-ink-muted">
                      {[t.ageGroup, CATEGORY_LABELS[t.category ?? ""] ?? t.category]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => handleRemove(t)}
                  className="shrink-0 text-ink-muted hover:text-red-700"
                >
                  {busyTeam === t.id ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Trash2 aria-hidden="true" className="size-4" />
                  )}
                  <span className="sr-only sm:not-sr-only">Remove</span>
                  <span className="sr-only"> {t.displayName}</span>
                </Button>
              </li>
            ))}
          </ul>

          <p className="mt-3 text-sm text-ink-muted">
            Missing a team? Add it in{" "}
            <Link
              href="/teams"
              className="font-medium text-forest-800 underline underline-offset-2 hover:text-forest-950"
            >
              Team Administration
            </Link>{" "}
            and come back &mdash; nothing here is lost.
          </p>

          <div className="mt-6 rounded-lg border border-ink/10 bg-white px-5 py-4">
            {confirmed ? (
              <p className="flex items-center gap-2 text-sm font-medium text-forest-950">
                <span aria-hidden="true" className="grid size-5 place-items-center rounded-full bg-mint-100">
                  <Check className="size-3" strokeWidth={3} />
                </span>
                Team list confirmed
              </p>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink/70">
                  {teams.length === 1
                    ? "Is this the team your club runs this season?"
                    : `Are these the ${teams.length} teams your club runs this season?`}
                </p>
                <Button type="button" disabled={pending} onClick={handleConfirm}>
                  {pending && busyTeam === null ? (
                    <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                  ) : (
                    <Check aria-hidden="true" className="size-4" />
                  )}
                  Yes, that&rsquo;s right
                </Button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
