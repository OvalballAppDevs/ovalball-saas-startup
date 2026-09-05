import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import { ChevronLeft } from "lucide-react"

import { hasCapability } from "@/lib/permissions/has-capability"
import { formatMinorUnits } from "@/lib/payments/domain/money"
import { isObligationOverdue } from "@/lib/payments/domain/dashboard-metrics"
import { createClient } from "@/lib/supabase/server"

import { CancelMembershipButton } from "./cancel-membership-button"

const MANDATE_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Submitted to bank, not yet active",
  submitted: "Submitted to bank, awaiting confirmation",
  active: "Active",
  failed: "Setup failed",
  cancelled: "Cancelled",
  expired: "Expired",
  consumed: "Replaced by a newer mandate",
}

const SUBSCRIPTION_STATUS_LABEL: Record<string, string> = {
  pending: "Set up, first collection not yet due",
  active: "Active",
  finished: "Finished (all collections complete)",
  cancelled: "Cancelled",
  paused: "Paused",
}

const PAYMENT_STATUS_LABEL: Record<string, string> = {
  pending_submission: "Scheduled, not yet submitted",
  submitted: "Submitted, awaiting confirmation",
  confirmed: "Collected",
  paid_out: "Collected and paid out",
  failed: "Collection failed",
  cancelled: "Cancelled",
  charged_back: "Charged back",
}

/**
 * The "Obligation status" column must never render the raw internal enum
 * value verbatim (e.g. "SUBMITTED") right next to the "Payment status"
 * column's own friendly label (e.g. "Scheduled, not yet submitted" for
 * the very same row) -- the word "submitted" would read as contradictory
 * in adjacent columns even though the two are correctly tracking
 * different things (Ovalball's own internal obligation workflow vs.
 * GoCardless's real payment lifecycle). Same friendly-label pattern as
 * MANDATE_STATUS_LABEL/SUBSCRIPTION_STATUS_LABEL/PAYMENT_STATUS_LABEL above.
 */
const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  SETUP_PENDING: "Membership not yet set up",
  READY: "Ready to be charged",
  SCHEDULED: "Scheduled for collection",
  SUBMITTED: "Submitted to GoCardless",
  PAID: "Paid",
  FAILED: "Failed",
  RETRYING: "Retrying after failure",
  OVERDUE: "Overdue",
  CANCELLED: "Cancelled",
  EXEMPT: "Exempt",
  WAIVED: "Waived",
  REFUNDED: "Refunded",
  CHARGEDBACK: "Charged back",
}

/**
 * One membership's full operational detail for Club Finance --
 * player/programme/payer identity (name/email only, never bank details
 * or provider tokens), mandate/subscription status, and a canonical
 * payment history built from membership_obligations (what is owed, per
 * period) each optionally joined to the ONE gocardless_payments row it
 * produced (the actual provider collection attempt) -- never two
 * separate lists that could drift or double-count the same period.
 */
export default async function MembershipDetailPage({ params }: { params: Promise<{ payerSubscriptionId: string }> }) {
  const { payerSubscriptionId } = await params
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/login")

  const { data: detail, error: detailError } = await supabase.rpc("get_membership_operational_detail", { p_payer_subscription_id: payerSubscriptionId }).maybeSingle()
  if (detailError || !detail) notFound()

  const canManagePayments = await hasCapability(supabase, "club.subscription.manage_payment_actions", "club", { clubId: detail.club_id })

  const { data: obligationsRaw } = await supabase
    .from("membership_obligations")
    .select("id, billing_period, amount_due_minor, due_date, status, is_prorated, gocardless_payment_id")
    .eq("payer_subscription_id", payerSubscriptionId)
    .order("billing_period", { ascending: false })

  const obligations = obligationsRaw ?? []
  const paymentIds = obligations.map((o) => o.gocardless_payment_id).filter((id): id is string => Boolean(id))
  const { data: paymentsRaw } = paymentIds.length > 0 ? await supabase.from("gocardless_payments").select("id, status, gc_payment_id, charge_date, confirmed_at, failed_at").in("id", paymentIds) : { data: [] }
  const paymentById = new Map((paymentsRaw ?? []).map((p) => [p.id, p]))

  // The SAME canonical, derived-truth resolver the dashboard uses --
  // truthful specific reasons, never a generic "needs attention" claim
  // and never "Subscription cancelled" unless a real provider
  // cancellation actually happened.
  const REASON_LABEL: Record<string, string> = {
    PAYMENT_FAILED: "The most recent payment failed. Review membership.",
    PAYMENT_RETRY_REQUIRES_ATTENTION: "A payment is being resubmitted after a prior failure. Review membership.",
    MANDATE_PROBLEM: "Direct Debit mandate has a problem. Review membership.",
    SUBSCRIPTION_PROBLEM: "Subscription ended with the provider unexpectedly. Review membership.",
    PROGRAMME_ELIGIBILITY_ENDED: "Player is no longer eligible for this programme. Review membership.",
    PAYER_RELATIONSHIP_REQUIRES_REVIEW: "Payer relationship has changed. Review membership.",
  }
  const { data: actionRequiredRaw } = detail.payer_status === "active" ? await supabase.rpc("get_finance_action_required", { p_club_id: detail.club_id }) : { data: [] }
  const actionRequiredReasons = (actionRequiredRaw ?? []).filter((r) => r.payer_subscription_id === payerSubscriptionId).map((r) => r.reason)

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 md:px-8 md:py-12">
      <Link href="/club/finance" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft className="h-4 w-4" /> Back to Finance Dashboard
      </Link>

      <h1 className="mt-4 font-display text-display-l text-ink">
        {detail.player_first_name} {detail.player_surname}
      </h1>
      <p className="mt-1 text-sm text-ink/60">
        Payer: {detail.payer_first_name} {detail.payer_surname} ({detail.payer_email})
      </p>

      {actionRequiredReasons.length > 0 && (
        <div className="mt-4 space-y-1 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
          {actionRequiredReasons.map((reason) => (
            <p key={reason} className="text-sm font-medium text-amber-900">
              {REASON_LABEL[reason] ?? reason}
            </p>
          ))}
        </div>
      )}
      {detail.payer_status === "ended" && (
        <div className="mt-4 rounded-lg border border-ink/15 bg-ink/5 px-4 py-3">
          <p className="text-sm font-medium text-ink">Membership cancelled{detail.payer_effective_to ? ` (effective ${new Date(detail.payer_effective_to).toLocaleDateString("en-GB")})` : ""}</p>
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-3 rounded-lg border border-ink/10 bg-white p-5 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Monthly amount</p>
          {/* Uses the SNAPSHOTTED values from this member's own enrolment -- never recomputed from current policy. */}
          {detail.base_amount_minor != null && detail.sibling_discount_type && detail.sibling_discount_type !== "NONE" && (detail.sibling_discount_amount_minor ?? 0) > 0 ? (
            <div className="mt-1 space-y-0.5 text-sm text-ink">
              <p>
                Standard rate: <span className="tabular-nums">{formatMinorUnits(detail.base_amount_minor)}</span>
              </p>
              <p className="text-ink/70">
                Sibling discount: {ordinalWord(detail.sibling_ordinal ?? 0)} child,{" "}
                {detail.sibling_discount_type === "PERCENTAGE" ? `${detail.sibling_discount_value}%` : formatMinorUnits(detail.sibling_discount_value ?? 0)} (-
                {formatMinorUnits(detail.sibling_discount_amount_minor ?? 0)})
              </p>
              <p className="font-medium">
                Membership rate: <span className="tabular-nums">{formatMinorUnits(detail.final_amount_minor ?? detail.base_amount_minor)}</span>
              </p>
            </div>
          ) : (
            <p className="mt-1 text-sm text-ink">{formatMinorUnits(detail.final_amount_minor ?? detail.programme_amount_minor ?? 0)}</p>
          )}
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">First-payment policy</p>
          <p className="mt-1 text-sm text-ink">{detail.programme_first_payment_policy}</p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Direct Debit mandate</p>
          <p className="mt-1 text-sm text-ink">{detail.mandate_status ? (MANDATE_STATUS_LABEL[detail.mandate_status] ?? detail.mandate_status) : "Not set up"}</p>
        </div>
        <div>
          <p className="text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">Recurring subscription</p>
          <p className="mt-1 text-sm text-ink">{detail.subscription_status ? (SUBSCRIPTION_STATUS_LABEL[detail.subscription_status] ?? detail.subscription_status) : "Not yet active"}</p>
        </div>
      </div>

      {canManagePayments && detail.payer_status === "active" && (
        <div className="mt-6">
          <CancelMembershipButton payerSubscriptionId={payerSubscriptionId} playerName={`${detail.player_first_name} ${detail.player_surname}`} />
        </div>
      )}

      <div className="mt-8">
        <h2 className="text-sm font-medium tracking-[0.04em] text-ink/50 uppercase">Payment history</h2>
        <div className="mt-3 overflow-x-auto rounded-lg border border-ink/10 bg-white">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink/10 text-left text-xs font-medium tracking-[0.04em] text-ink/50 uppercase">
                <th className="px-4 py-2">Billing period</th>
                <th className="px-4 py-2">Amount owed</th>
                <th className="px-4 py-2">Due date</th>
                <th className="px-4 py-2">Obligation status</th>
                <th className="px-4 py-2">Payment status</th>
              </tr>
            </thead>
            <tbody>
              {obligations.map((o) => {
                const payment = o.gocardless_payment_id ? paymentById.get(o.gocardless_payment_id) : null
                return (
                  <tr key={o.id} className="border-b border-ink/5 last:border-0">
                    <td className="px-4 py-2.5 text-ink">{o.billing_period.slice(0, 7)}</td>
                    <td className="px-4 py-2.5 tabular-nums text-ink/80">
                      {formatMinorUnits(o.amount_due_minor)}
                      {o.is_prorated && <span className="mt-0.5 block text-[10px] font-normal text-ink/45">Pro-rata</span>}
                    </td>
                    <td className="px-4 py-2.5 tabular-nums text-ink/60">{new Date(o.due_date).toLocaleDateString("en-GB")}</td>
                    <td className="px-4 py-2.5 text-ink/80">{isObligationOverdue(o.status, o.due_date) ? OBLIGATION_STATUS_LABEL.OVERDUE : OBLIGATION_STATUS_LABEL[o.status] ?? o.status}</td>
                    <td className="px-4 py-2.5 text-ink/80">{payment ? (PAYMENT_STATUS_LABEL[payment.status] ?? payment.status) : "—"}</td>
                  </tr>
                )
              })}
              {obligations.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-center text-sm text-ink/50">
                    No billing history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

/** Same wording rule as the Parent page's declaration -- ordinal only, never another child's own financial details. */
function ordinalWord(n: number): string {
  const suffix = n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"
  return `${n}${suffix}`
}
