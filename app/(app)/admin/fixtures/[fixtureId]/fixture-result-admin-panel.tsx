"use client"

import { useState, useTransition } from "react"

import { resolveFixtureResultDisputeAction } from "./result-admin-actions"

export function FixtureResultAdminPanel({
  fixtureId,
  resultStatus,
  homeScore,
  awayScore,
  amendmentHomeScore,
  amendmentAwayScore,
}: {
  fixtureId: string
  resultStatus: string
  homeScore: number | null
  awayScore: number | null
  amendmentHomeScore: number | null
  amendmentAwayScore: number | null
}) {
  const [pending, startTransition] = useTransition()
  const [home, setHome] = useState(String(homeScore ?? ""))
  const [away, setAway] = useState(String(awayScore ?? ""))
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  if (done) return <p className="text-sm text-pitch-700">Resolved. This fixture&apos;s result is now final.</p>

  return (
    <div className="rounded-lg border border-destructive/25 bg-destructive/5 p-4">
      <p className="text-sm text-ink/70">
        {resultStatus === "disputed"
          ? `Disputed. Recorded result: ${homeScore ?? "—"} – ${awayScore ?? "—"}.`
          : `Amendment proposed: ${amendmentHomeScore ?? "—"} – ${amendmentAwayScore ?? "—"} (original ${homeScore ?? "—"} – ${awayScore ?? "—"} preserved until resolved).`}
      </p>
      <p className="mt-1 text-xs text-ink/50">
        Resolving requires a reason and is fully audited (who/when/old score/new score/reason) -- the original result is never
        silently overwritten, it stays in the fixture&apos;s history.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/50">Home score</span>
          <input type="number" min={0} value={home} onChange={(e) => setHome(e.target.value)} className="w-20 rounded-md border border-ink/15 px-2.5 py-1.5 text-sm" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-ink/50">Away score</span>
          <input type="number" min={0} value={away} onChange={(e) => setAway(e.target.value)} className="w-20 rounded-md border border-ink/15 px-2.5 py-1.5 text-sm" />
        </label>
      </div>
      <label className="mt-3 flex flex-col gap-1">
        <span className="text-xs font-medium text-ink/50">Reason (required)</span>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="rounded-md border border-ink/15 px-2.5 py-1.5 text-sm" />
      </label>
      <button
        type="button"
        disabled={pending || home === "" || away === "" || !reason.trim()}
        onClick={() =>
          startTransition(async () => {
            setError(null)
            const res = await resolveFixtureResultDisputeAction(fixtureId, Number(home), Number(away), reason.trim())
            if (!res.ok) {
              setError(res.error)
              return
            }
            setDone(true)
          })
        }
        className="mt-3 rounded-md bg-destructive px-3.5 py-1.5 text-sm font-medium text-white outline-none transition-colors hover:bg-destructive/90 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {pending ? "Resolving…" : "Resolve dispute"}
      </button>
      {error && <p className="mt-2 text-sm text-destructive">{error}</p>}
    </div>
  )
}
