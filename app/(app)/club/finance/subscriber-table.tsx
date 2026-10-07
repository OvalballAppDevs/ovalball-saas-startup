"use client"

import { canRetryPayment, canWaiveObligation, formatFinanceDate, type FinanceObligationRow } from "@ovalball/contracts/club/finance"

import { useId, useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

import { MonthStatusChip } from "@/components/membership/membership-board-parts"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { formatMinorUnits } from "@/lib/payments/domain/money"

import { retryFailedPayment, setObligationExemption } from "./actions"

/** The ledger's row, as the shared contract reads it: Ovalball's own ids only, never a provider's. */
export type SubscriberRow = FinanceObligationRow

/** The two ways set_obligation_exemption excuses a month, and the words each is asked in. */
type ExcuseStatus = "EXEMPT" | "WAIVED"

const EXCUSE_WORDS: Record<ExcuseStatus, { verb: string; marked: string; busy: string; keep: string }> = {
  WAIVED: { verb: "Waive", marked: "waived", busy: "Waiving…", keep: "Don't Waive" },
  EXEMPT: { verb: "Exempt", marked: "exempt", busy: "Exempting…", keep: "Don't Exempt" },
}

/** Search/filter over the canonical obligation rows -- statuses shown in the domain catalogue's words, never collapsed to yes/no. */
export function SubscriberTable({
  clubId,
  rows,
  canManageEnrolment,
  canManagePayments,
  monthLabel,
}: {
  clubId: string
  rows: SubscriberRow[]
  canManageEnrolment: boolean
  canManagePayments: boolean
  monthLabel: string
}) {
  const router = useRouter()
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const searchId = useId()
  // Waive (or Exempt) asks first, in a dialog: the month it is for, what it does and does not do, and a reason. The
  // month asked about is kept while the dialog closes, so its words do not vanish mid-animation.
  const [excuse, setExcuse] = useState<{ row: SubscriberRow; status: ExcuseStatus } | null>(null)
  const [excuseOpen, setExcuseOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [excusing, setExcusing] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)
  const reasonId = useId()
  const words = excuse ? EXCUSE_WORDS[excuse.status] : null
  const reasonMissing = reason.trim().length === 0

  const filtered = useMemo(() => rows.filter((r) => r.playerName.toLowerCase().includes(query.toLowerCase())), [rows, query])

  async function handleRetry(row: SubscriberRow) {
    if (!row.payment) return
    setBusyId(row.obligationId)
    setError(null)
    const result = await retryFailedPayment(clubId, row.payment.id)
    if (!result.ok) setError(result.error)
    else router.refresh()
    setBusyId(null)
  }

  function openExcuse(row: SubscriberRow, status: ExcuseStatus) {
    setExcuse({ row, status })
    setReason("")
    setProblem(null)
    setExcuseOpen(true)
  }

  async function confirmExcuse() {
    if (!excuse || reasonMissing || excusing) return
    const { row, status } = excuse
    setExcusing(true)
    setError(null)
    setProblem(null)
    const result = await setObligationExemption(clubId, row.obligationId, status, reason.trim())
    setExcusing(false)
    // The server's refusal stays in the dialog, beside the reason, so it can be put right and tried again.
    if (!result.ok) return setProblem(result.error)
    setExcuseOpen(false)
    router.refresh()
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
        <p className="text-sm font-medium text-ink">{`No obligations for ${monthLabel} yet`}</p>
        <p className="mt-1 text-sm text-ink-muted">Generate the month&rsquo;s obligations above once members are enrolled.</p>
      </div>
    )
  }

  return (
    <div className="rounded-2xl border border-ink/10 bg-white">
      <div className="border-b border-ink/10 p-3">
        <label htmlFor={searchId} className="sr-only">
          Search Payments
        </label>
        <input
          id={searchId}
          type="search"
          placeholder="Search by player name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-11 w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-forest-800/25 sm:h-9"
        />
      </div>
      <div role="alert">{error && <p className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive-text">{error}</p>}</div>
      <div className="relative overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{`Payments in ${monthLabel}`}</caption>
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium text-ink-muted">
              <th scope="col" className="px-4 py-2">
                Player
              </th>
              <th scope="col" className="px-4 py-2">
                Amount
              </th>
              <th scope="col" className="px-4 py-2">
                Due Date
              </th>
              <th scope="col" className="px-4 py-2">
                Status
              </th>
              <th scope="col" className="px-4 py-2">
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.obligationId} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">
                  <Link
                    href={`/club/finance/${row.payerSubscriptionId}`}
                    className="underline decoration-ink/20 underline-offset-2 outline-none hover:decoration-ink/50 focus-visible:ring-2 focus-visible:ring-forest-800"
                  >
                    {row.playerName}
                  </Link>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink">
                  {formatMinorUnits(row.amountMinor)}
                  {row.isProrated && <span className="mt-0.5 block text-xs font-normal text-ink-muted">Pro-rata first month</span>}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink-muted">{formatFinanceDate(row.dueDate)}</td>
                <td className="px-4 py-2.5">
                  <MonthStatusChip status={row.status} />
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    {canManagePayments && canRetryPayment(row) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-11 sm:h-7"
                        disabled={busyId === row.obligationId}
                        aria-label={`Retry ${row.playerName}'s payment`}
                        onClick={() => handleRetry(row)}
                      >
                        Retry
                      </Button>
                    )}
                    {canManageEnrolment && canWaiveObligation(row.status) && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="h-11 sm:h-7"
                        disabled={busyId === row.obligationId}
                        aria-label={`Waive ${monthLabel} for ${row.playerName}`}
                        onClick={() => openExcuse(row, "WAIVED")}
                      >
                        Waive
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/*
        What excusing a month does, as set_obligation_exemption does it: that one obligation's status, resolved_at and
        reason, plus a finance_audit_log row -- no other month, no GoCardless call. A payment GoCardless collects for
        the month still goes ahead (apply_payment_status_transition never moves an EXEMPT or WAIVED month), and nothing
        makes the month owed again.
      */}
      <Dialog open={excuseOpen} onOpenChange={(next) => !next && !excusing && setExcuseOpen(false)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          {excuse && words && (
            <>
              <DialogHeader>
                <DialogTitle>{`${words.verb} ${monthLabel}`}</DialogTitle>
                {/* The consequences are the description, so a screen reader reads them when the dialog opens. */}
                <DialogDescription render={<div />} className="space-y-3">
                  <p>{`${excuse.row.playerName}'s ${monthLabel} payment of ${formatMinorUnits(excuse.row.amountMinor)}, due ${formatFinanceDate(excuse.row.dueDate)}, will be marked as ${words.marked}.`}</p>
                  <ul className="list-disc space-y-1.5 pl-5 text-ink marker:text-ink-muted">
                    <li>It no longer counts as owed, and is left out of what is outstanding.</li>
                    <li>Only this one month changes. Every other month is unaffected, and any Direct Debit carries on as before.</li>
                    <li>{`This does not cancel or refund a Direct Debit payment. A payment for ${monthLabel} that is already on its way, or that the Direct Debit takes as usual, is still collected.`}</li>
                    <li>{`Nothing is deleted. The month stays on ${excuse.row.playerName}'s record, marked as ${words.marked}, and your reason is kept with it.`}</li>
                    <li>This cannot be undone from Ovalball.</li>
                  </ul>
                </DialogDescription>
              </DialogHeader>
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault()
                  void confirmExcuse()
                }}
              >
                <div className="space-y-1.5">
                  <label htmlFor={reasonId} className="text-sm font-medium text-ink">
                    Reason <span aria-hidden="true" className="text-destructive-text">*</span>
                  </label>
                  <textarea
                    id={reasonId}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    rows={3}
                    maxLength={500}
                    required
                    aria-required="true"
                    aria-describedby={`${reasonId}-hint`}
                    placeholder="Recorded with the month, e.g. injured for the whole month"
                    className="w-full rounded-lg border border-ink/15 bg-white px-3 py-2 text-sm text-ink outline-none focus-visible:border-forest-800 focus-visible:ring-2 focus-visible:ring-forest-800/25"
                  />
                  <p id={`${reasonId}-hint`} className="text-xs text-ink-muted">
                    Required. Kept with the month on the club&rsquo;s record.
                  </p>
                </div>
                {problem && (
                  <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive-text">
                    <p>{problem}</p>
                  </div>
                )}
                <DialogFooter>
                  <Button type="button" variant="outline" className="h-11 sm:h-9" disabled={excusing} onClick={() => setExcuseOpen(false)}>
                    {words.keep}
                  </Button>
                  <Button type="submit" className="h-11 px-4 font-semibold sm:h-9" disabled={excusing || reasonMissing} aria-busy={excusing}>
                    {excusing ? words.busy : `${words.verb} ${monthLabel}`}
                  </Button>
                </DialogFooter>
              </form>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
