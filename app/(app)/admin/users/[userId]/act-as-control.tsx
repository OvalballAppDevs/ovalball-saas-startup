"use client"

import { useState, useTransition } from "react"
import { UserCog } from "lucide-react"

import { startActingAs } from "@/app/(app)/impersonation-actions"

/**
 * CONVERGENCE STEP 13 / SLICE 9 -- beginning an act-as session.
 *
 * The reason box is not a formality and is not optional: it is the first thing the audit shows, and
 * the server refuses anything under eight characters. The wording below tells the truth about what
 * is about to happen rather than reassuring: whose account, for how long, and that they will be told.
 *
 * Whether this session can CHANGE anything is not offered as a choice here, because it is not the
 * browser's to decide -- the server reads it from `site.users.impersonate_act` at the moment the
 * session starts.
 */
export function ActAsControl({ userId, personName }: { userId: string; personName: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <section className="rounded-2xl border border-line bg-surface p-4 sm:p-6">
      <h2 className="flex items-center gap-2 font-display text-base text-ink">
        <UserCog className="size-4 text-ink-muted" aria-hidden="true" />
        Act as This Person
      </h2>
      <p className="mt-1 text-sm text-ink-muted">
        See Ovalball as {personName} sees it, to help with something they have reported. The session ends by
        itself after 30 minutes, both of you are named in the audit, and {personName} is told afterwards.
      </p>

      {open ? (
        <div className="mt-3 flex flex-col gap-2">
          <label htmlFor="act-as-reason" className="text-sm font-medium text-ink">
            Why are you doing this?
          </label>
          <input
            id="act-as-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Investigating the fixture they reported missing"
            className="min-h-11 rounded-lg border border-line bg-surface px-3 text-sm text-ink"
          />
          <p className="text-xs text-ink-muted">This is recorded and shown in the audit. At least 8 characters.</p>
          {error && <p className="text-sm text-danger">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending || reason.trim().length < 8}
              onClick={() =>
                start(async () => {
                  setError(null)
                  const result = await startActingAs(userId, reason.trim())
                  if (!result.ok) setError(result.message)
                })
              }
              className="inline-flex min-h-11 items-center rounded-full bg-forest-700 px-4 text-sm text-chalk disabled:opacity-50"
            >
              Start Acting as {personName}
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => { setOpen(false); setError(null) }}
              className="inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-3 inline-flex min-h-11 items-center rounded-full border border-line px-4 text-sm text-ink hover:bg-surface-muted"
        >
          Act as This Person
        </button>
      )}
    </section>
  )
}
