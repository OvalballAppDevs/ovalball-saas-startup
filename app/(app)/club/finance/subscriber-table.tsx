"use client"

import { useMemo, useState } from "react"
import Link from "next/link"

import { Button } from "@/components/ui/button"
import { formatMinorUnits } from "@/lib/payments/domain/money"

import { retryFailedPayment, setObligationExemption } from "./actions"

export interface SubscriberRow {
  obligationId: string
  payerSubscriptionId: string
  playerName: string
  amountMinor: number
  dueDate: string
  status: string
  resolvedReason: string | null
  payment: { id: string; status: string; gc_payment_id: string } | null
  isProrated: boolean
}

const STATUS_TONE: Record<string, string> = {
  PAID: "bg-mint-100 text-forest-950",
  FAILED: "bg-destructive/10 text-destructive",
  OVERDUE: "bg-destructive/10 text-destructive",
  RETRYING: "bg-amber-100 text-amber-900",
  SUBMITTED: "bg-pitch-50 text-forest-800",
  SCHEDULED: "bg-pitch-50 text-forest-800",
  SETUP_PENDING: "bg-ink/8 text-ink/60",
  EXEMPT: "bg-ink/8 text-ink/60",
  WAIVED: "bg-ink/8 text-ink/60",
  CANCELLED: "bg-ink/8 text-ink/60",
  REFUNDED: "bg-ink/8 text-ink/60",
  CHARGEDBACK: "bg-destructive/10 text-destructive",
}

/** Search/filter over the canonical obligation rows -- statuses shown verbatim from the domain catalogue, never collapsed to yes/no. */
export function SubscriberTable({ clubId, rows, canManageEnrolment, canManagePayments }: { clubId: string; rows: SubscriberRow[]; canManageEnrolment: boolean; canManagePayments: boolean }) {
  const [query, setQuery] = useState("")
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const filtered = useMemo(() => rows.filter((r) => r.playerName.toLowerCase().includes(query.toLowerCase())), [rows, query])

  async function handleRetry(row: SubscriberRow) {
    if (!row.payment) return
    setBusyId(row.obligationId)
    setError(null)
    const result = await retryFailedPayment(clubId, row.payment.id)
    if (!result.ok) setError(result.error)
    setBusyId(null)
  }

  async function handleExempt(row: SubscriberRow, status: "EXEMPT" | "WAIVED") {
    const reason = window.prompt(`Reason for marking ${row.playerName} as ${status.toLowerCase()}:`)
    if (!reason) return
    setBusyId(row.obligationId)
    setError(null)
    const result = await setObligationExemption(clubId, row.obligationId, status, reason)
    if (!result.ok) setError(result.error)
    setBusyId(null)
  }

  if (rows.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-ink/15 bg-white/60 px-5 py-8 text-center">
        <p className="text-sm font-medium text-ink">No obligations for this period yet</p>
        <p className="mt-1 text-sm text-ink/55">Generate this month&rsquo;s obligations above once subscribers are enrolled.</p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-ink/10 bg-white">
      <div className="border-b border-ink/10 p-3">
        <input
          type="text"
          placeholder="Search by player name"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="h-9 w-full max-w-xs rounded-lg border border-ink/15 bg-white px-3 text-sm text-ink outline-none focus-visible:border-pitch-600"
        />
      </div>
      {error && <p className="border-b border-destructive/20 bg-destructive/5 px-3 py-2 text-sm text-destructive">{error}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">
              <th className="px-4 py-2">Player</th>
              <th className="px-4 py-2">Amount</th>
              <th className="px-4 py-2">Due date</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Action</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.obligationId} className="border-b border-ink/5 last:border-0">
                <td className="px-4 py-2.5 font-medium text-ink">
                  <Link href={`/club/finance/${row.payerSubscriptionId}`} className="underline decoration-ink/20 underline-offset-2 hover:decoration-ink/50">
                    {row.playerName}
                  </Link>
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink/80">
                  {formatMinorUnits(row.amountMinor)}
                  {row.isProrated && <span className="mt-0.5 block text-[10px] font-normal text-ink/45">Pro-rata first month</span>}
                </td>
                <td className="px-4 py-2.5 tabular-nums text-ink/60">{new Date(row.dueDate).toLocaleDateString("en-GB")}</td>
                <td className="px-4 py-2.5">
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_TONE[row.status] ?? "bg-ink/8 text-ink/60"}`}>{row.status}</span>
                </td>
                <td className="px-4 py-2.5">
                  <div className="flex gap-2">
                    {canManagePayments && row.status === "FAILED" && row.payment && (
                      <Button type="button" size="sm" variant="outline" className="h-7" disabled={busyId === row.obligationId} onClick={() => handleRetry(row)}>
                        Retry
                      </Button>
                    )}
                    {canManageEnrolment && !["EXEMPT", "WAIVED", "PAID", "REFUNDED"].includes(row.status) && (
                      <Button type="button" size="sm" variant="ghost" className="h-7" disabled={busyId === row.obligationId} onClick={() => handleExempt(row, "WAIVED")}>
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
    </div>
  )
}
