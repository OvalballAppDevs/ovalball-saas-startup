"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import {
  DISPENSATION_REASON_MAX,
  DISPENSATION_REFERENCE_MAX,
  dispensationDecisionPrompt,
  dispensationReferenceAsk,
  type DispensationRecord,
} from "@ovalball/contracts/team/dispensation"

import { Button } from "@/components/ui/button"

import {
  decideDispensationAction,
  recordDispensationReferenceAction,
  revokeDispensationAction,
  withdrawDispensationAction,
  type DispensationActionResult,
} from "@/app/(app)/dispensations/actions"

/**
 * WHAT THIS VIEWER MAY DO WITH ONE DISPENSATION -- drawn only from the record's `viewer` block, which the
 * server computed for them, and re-decided by the server on every press. Nothing here makes anybody a
 * decider: a hidden button is a courtesy, never the boundary.
 */
export function DispensationControls({ record }: { record: DispensationRecord }) {
  const v = record.viewer
  const deciding = !!v.decidesAs && record.status === "requested"
  if (!deciding && !v.mayWithdraw && !v.mayRevoke && !v.mayRecordGoverningBody) return null
  return (
    <div className="mt-6 flex flex-col gap-4">
      {deciding && <DecisionPanel record={record} />}
      {v.mayRecordGoverningBody && <ReferencePanel record={record} />}
      {v.mayWithdraw && <WithdrawPanel record={record} />}
      {v.mayRevoke && <RevokePanel record={record} />}
    </div>
  )
}

const FIELD = "w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-pitch-600 focus-visible:ring-2 focus-visible:ring-pitch-600/30"

type ActionProblem = { message: string; href?: string }

function useAction() {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<ActionProblem | null>(null)
  function run(action: () => Promise<DispensationActionResult>) {
    setError(null)
    start(async () => {
      const result = await action()
      if (!result.ok) {
        setError({ message: result.error, href: result.href })
        return
      }
      router.refresh()
    })
  }
  return { pending, error, run }
}

/**
 * A refusal, said plainly. A decision needs a recent authenticator code (the server's rule, like suspending a
 * member), so when that is the refusal the person is offered the way to enter one -- and brought straight back
 * to this record afterwards, where they press the same button again. Nothing is decided by verifying.
 */
function ActionError({ problem, recordId }: { problem: ActionProblem; recordId: string }) {
  return (
    <p className="mt-3 text-sm text-destructive-text" role="alert">
      {problem.message}
      {problem.href && (
        <>
          {" "}
          <Link
            href={`${problem.href}?next=${encodeURIComponent(`/dispensations/${recordId}`)}`}
            className="font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-pitch-400"
          >
            Verify Now
          </Link>
        </>
      )}
    </p>
  )
}

/** THE ONE DECISION: approve, or decline with the reason the person who asked will read. */
function DecisionPanel({ record }: { record: DispensationRecord }) {
  const { pending, error, run } = useAction()
  const [declining, setDeclining] = useState(false)
  const [note, setNote] = useState("")
  const [reference, setReference] = useState("")
  const who = record.player.firstName || "this player"
  const role = record.viewer.decidesAs === "SAFEGUARDING_OFFICER" ? "the club's Safeguarding Officer" : "a Club Admin"

  return (
    <section aria-labelledby="dispensation-decide" className="rounded-lg border border-forest-800/30 bg-white p-5">
      <h2 id="dispensation-decide" className="text-lg font-semibold text-ink">
        Your Decision
      </h2>
      <p className="mt-1 text-sm text-ink-muted">You decide this as {role}. The first decision made is final.</p>
      <p className="mt-3 text-sm text-ink">{dispensationDecisionPrompt(record)}</p>

      {record.requiresGoverningBody && !declining && (
        <div className="mt-4">
          <label htmlFor="dispensation-reference" className="text-sm font-medium text-ink">
            Governing Body&apos;s Reference
          </label>
          <input
            id="dispensation-reference"
            value={reference}
            maxLength={DISPENSATION_REFERENCE_MAX}
            onChange={(e) => setReference(e.target.value)}
            className={`mt-1.5 h-11 ${FIELD}`}
            aria-describedby="dispensation-reference-help"
          />
          <p id="dispensation-reference-help" className="mt-1 text-xs text-ink-muted">
            {record.safeguardingOnly
              ? `${who} is under 18 and this is an adult side. Record the governing body's approval to approve it.`
              : "This one needs the governing body's approval. Record its reference to approve it."}
          </p>
        </div>
      )}

      {declining && (
        <div className="mt-4">
          <label htmlFor="dispensation-decline" className="text-sm font-medium text-ink">
            Reason for Declining
          </label>
          <textarea
            id="dispensation-decline"
            value={note}
            rows={3}
            maxLength={DISPENSATION_REASON_MAX}
            onChange={(e) => setNote(e.target.value)}
            className={`mt-1.5 resize-none ${FIELD}`}
            aria-describedby="dispensation-decline-help"
            aria-required="true"
          />
          <p id="dispensation-decline-help" className="mt-1 text-xs text-ink-muted">
            Required. The person who asked and {who}&apos;s family read it.
          </p>
        </div>
      )}

      {error && <ActionError problem={error} recordId={record.id} />}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {declining ? (
          <>
            <Button
              type="button"
              variant="destructive"
              className="h-11 px-6"
              disabled={pending || !note.trim()}
              onClick={() => run(() => decideDispensationAction(record.id, { approve: false, note }))}
            >
              {pending ? "Declining…" : "Decline Request"}
            </Button>
            <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setDeclining(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <>
            <Button
              type="button"
              className="h-11 px-6"
              disabled={pending || (record.requiresGoverningBody && !reference.trim())}
              onClick={() => run(() => decideDispensationAction(record.id, { approve: true, governingBodyReference: reference || null }))}
            >
              {pending ? "Approving…" : "Approve"}
            </Button>
            <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setDeclining(true)}>
              Decline
            </Button>
          </>
        )}
      </div>
    </section>
  )
}

/** Open where the reference is a step; otherwise an optional addition behind one quiet button. */
function ReferencePanel({ record }: { record: DispensationRecord }) {
  const { pending, error, run } = useAction()
  const ask = dispensationReferenceAsk(record)
  const [open, setOpen] = useState(record.requiresGoverningBody)
  const [reference, setReference] = useState("")
  return (
    <section aria-labelledby="dispensation-record-reference" className="rounded-lg border border-ink/10 bg-white p-5">
      <h2 id="dispensation-record-reference" className="text-base font-semibold text-ink">
        {ask.title}
      </h2>
      <p className="mt-1 text-sm text-ink-muted">{ask.body}</p>
      {open && (
        <>
          <label htmlFor="dispensation-reference-later" className="mt-3 block text-sm font-medium text-ink">
            Reference
          </label>
          <input
            id="dispensation-reference-later"
            value={reference}
            maxLength={DISPENSATION_REFERENCE_MAX}
            onChange={(e) => setReference(e.target.value)}
            className={`mt-1.5 h-11 ${FIELD}`}
          />
        </>
      )}
      {error && <ActionError problem={error} recordId={record.id} />}
      <div className="mt-4 flex flex-col gap-2 sm:flex-row">
        {open ? (
          <>
            <Button
              type="button"
              className="h-11 px-6"
              disabled={pending || !reference.trim()}
              onClick={() => run(() => recordDispensationReferenceAction(record.id, reference))}
            >
              {pending ? "Saving…" : "Save Reference"}
            </Button>
            {!record.requiresGoverningBody && (
              <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            )}
          </>
        ) : (
          <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setOpen(true)}>
            {ask.action}
          </Button>
        )}
      </div>
    </section>
  )
}

function WithdrawPanel({ record }: { record: DispensationRecord }) {
  const { pending, error, run } = useAction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  return (
    <section aria-label="Withdraw this request" className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm text-ink">No longer needed? Withdrawing it ends the request before anybody decides it.</p>
      {open && (
        <div className="mt-3">
          <label htmlFor="dispensation-withdraw" className="text-sm font-medium text-ink">
            Reason (Optional)
          </label>
          <textarea
            id="dispensation-withdraw"
            value={reason}
            rows={2}
            maxLength={DISPENSATION_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            className={`mt-1.5 resize-none ${FIELD}`}
          />
        </div>
      )}
      {error && <ActionError problem={error} recordId={record.id} />}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {open ? (
          <>
            <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => run(() => withdrawDispensationAction(record.id, reason))}>
              {pending ? "Withdrawing…" : "Withdraw Request"}
            </Button>
            <Button type="button" variant="ghost" className="h-11 px-6" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setOpen(true)}>
            Withdraw
          </Button>
        )}
      </div>
    </section>
  )
}

function RevokePanel({ record }: { record: DispensationRecord }) {
  const { pending, error, run } = useAction()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const who = record.player.firstName || "the player"
  return (
    <section aria-label="Revoke this dispensation" className="rounded-lg border border-ink/10 bg-white p-5">
      <p className="text-sm text-ink">
        Revoking stops anything new relying on this approval. A place {who} already holds stays, and shows as outside the age grade.
      </p>
      {open && (
        <div className="mt-3">
          <label htmlFor="dispensation-revoke" className="text-sm font-medium text-ink">
            Reason for Revoking
          </label>
          <textarea
            id="dispensation-revoke"
            value={reason}
            rows={2}
            maxLength={DISPENSATION_REASON_MAX}
            onChange={(e) => setReason(e.target.value)}
            className={`mt-1.5 resize-none ${FIELD}`}
            aria-required="true"
          />
          <p className="mt-1 text-xs text-ink-muted">Required. The family and the club&apos;s other decision makers are told.</p>
        </div>
      )}
      {error && <ActionError problem={error} recordId={record.id} />}
      <div className="mt-3 flex flex-col gap-2 sm:flex-row">
        {open ? (
          <>
            <Button
              type="button"
              variant="destructive"
              className="h-11 px-6"
              disabled={pending || !reason.trim()}
              onClick={() => run(() => revokeDispensationAction(record.id, reason))}
            >
              {pending ? "Revoking…" : "Revoke Dispensation"}
            </Button>
            <Button type="button" variant="outline" className="h-11 px-6" disabled={pending} onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </>
        ) : (
          <Button type="button" variant="outline" className="h-11 px-6" onClick={() => setOpen(true)}>
            Revoke
          </Button>
        )}
      </div>
    </section>
  )
}
