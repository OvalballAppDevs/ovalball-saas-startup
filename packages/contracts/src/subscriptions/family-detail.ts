import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { MANDATE_STATUS_LABEL, SUBSCRIPTION_STATUS_LABEL, loadFamilySubscription, type FamilySubscription } from "./family"

type Client = SupabaseClient<Database>

/**
 * WHAT A FAMILY MAY KNOW ABOUT A MEMBERSHIP (CA-M9).
 *
 * The website's parent subscription page, as a contract: what the membership is, whom it covers, what
 * it costs and how often, where the Direct Debit stands, and what -- if anything -- the family must
 * do next. Every read is the same RLS-scoped table the website reads; the eligibility read is the
 * canonical `get_enrolment_eligibility`.
 *
 * WHAT IS NEVER RETURNED: a bank account, a sort code, any `gc_*` provider identifier, a billing
 * request id, an authorisation URL, a payer's identity beyond "you are the payer". A phone shows a
 * family its membership; it never becomes a payment form.
 *
 * WHAT CANNOT BE DONE HERE: starting the Direct Debit. That is a server-side provider call the
 * website makes (`startSubscriptionEnrolment`), which returns a single-use, payer-bound
 * authorisation URL. The phone hands off to the canonical web page for it, deliberately.
 */
export interface FamilySubscriptionDetail {
  summary: FamilySubscription
  /** Whether this signed-in person is the payer. Only the payer may cancel, on the website. */
  youAreThePayer: boolean
  /** Pence per month, where a price is agreed. */
  monthlyAmountMinor: number | null
  currency: string
  /** "Collected on the 1st of each month" -- the programme's one frequency. */
  frequencyLabel: string
  siblingDiscount: { ordinal: number; description: string } | null
  directDebit: { statusLabel: string; nextPossibleChargeDate: string | null } | null
  ongoing: { statusLabel: string; amountMinor: number | null } | null
  thisMonth: { amountDueMinor: number; dueDate: string | null; statusLabel: string; prorated: boolean } | null
  /** The one next step, in the family's words, or null when nothing is needed. */
  nextStep: string | null
  /** The canonical web page where the Direct Debit is set up and the membership managed. */
  webPath: string
}

const OBLIGATION_STATUS_LABEL: Record<string, string> = {
  PENDING: "Due",
  SCHEDULED: "Scheduled",
  SUBMITTED: "With your bank",
  PAID: "Paid",
  FAILED: "Payment failed",
  CANCELLED: "Cancelled",
  SETUP_PENDING: "Waiting for Direct Debit setup",
  WAIVED: "Waived",
}

export function formatMinor(amountMinor: number, currency = "GBP"): string {
  const symbol = currency === "GBP" ? "£" : `${currency} `
  return `${symbol}${(amountMinor / 100).toFixed(2)}`
}

export async function loadFamilySubscriptionDetail(
  supabase: Client,
  input: { playerId: string; playerName: string; clubId: string; userId: string }
): Promise<FamilySubscriptionDetail | null> {
  const summary = await loadFamilySubscription(supabase, input)
  if (!summary) return null
  const webPath = `/parent/players/${input.playerId}/subscription`

  const { data: eligibility } = await supabase.rpc("get_enrolment_eligibility", { p_player_id: input.playerId, p_club_id: input.clubId })
  const row = Array.isArray(eligibility) ? eligibility[0] : eligibility
  const payerSubscriptionId = row?.existing_payer_subscription_id ?? null

  const base: FamilySubscriptionDetail = {
    summary,
    youAreThePayer: false,
    monthlyAmountMinor: null,
    currency: "GBP",
    frequencyLabel: "Collected on the 1st of each month",
    siblingDiscount: null,
    directDebit: null,
    ongoing: null,
    thisMonth: null,
    nextStep: summary.attention === "setup_required" ? "Set up the Direct Debit on the Ovalball website to start the membership." : null,
    webPath,
  }
  if (!payerSubscriptionId) return base

  const { data: payer } = await supabase
    .from("player_subscription_payers")
    .select("payer_user_id, final_amount_minor, sibling_ordinal, sibling_discount_type, sibling_discount_value")
    .eq("id", payerSubscriptionId)
    .maybeSingle()
  const { data: billingRequest } = await supabase
    .from("gocardless_billing_requests")
    .select("id, status, created_at")
    .eq("payer_subscription_id", payerSubscriptionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data: mandate } = billingRequest
    ? await supabase.from("gocardless_mandates").select("status, next_possible_charge_date").eq("billing_request_id", billingRequest.id).maybeSingle()
    : { data: null }
  const { data: subscription } = await supabase
    .from("gocardless_subscriptions")
    .select("status, amount_minor")
    .eq("payer_subscription_id", payerSubscriptionId)
    .in("status", ["pending", "active"])
    .maybeSingle()
  const period = `${new Date().toISOString().slice(0, 7)}-01`
  const { data: obligation } = await supabase
    .from("membership_obligations")
    .select("amount_due_minor, due_date, status, is_prorated, currency")
    .eq("payer_subscription_id", payerSubscriptionId)
    .eq("billing_period", period)
    .maybeSingle()

  const discount =
    payer && payer.sibling_ordinal && payer.sibling_ordinal > 1 && payer.sibling_discount_value
      ? {
          ordinal: payer.sibling_ordinal,
          description:
            payer.sibling_discount_type === "PERCENT"
              ? `${payer.sibling_discount_value}% sibling discount applied`
              : `${formatMinor(payer.sibling_discount_value)} sibling discount applied`,
        }
      : null

  const nextStep =
    summary.attention === "failed"
      ? "The Direct Debit could not be set up. Set it up again on the Ovalball website."
      : summary.attention === "setup_required"
        ? "Finish setting up the Direct Debit on the Ovalball website to start the membership."
        : obligation?.status === "FAILED"
          ? "This month's collection failed. The club will be in touch about the next step."
          : null

  return {
    ...base,
    youAreThePayer: payer?.payer_user_id === input.userId,
    monthlyAmountMinor: payer?.final_amount_minor ?? subscription?.amount_minor ?? null,
    currency: obligation?.currency ?? "GBP",
    siblingDiscount: discount,
    directDebit: mandate ? { statusLabel: MANDATE_STATUS_LABEL[mandate.status] ?? mandate.status, nextPossibleChargeDate: mandate.next_possible_charge_date ?? null } : null,
    ongoing: subscription ? { statusLabel: SUBSCRIPTION_STATUS_LABEL[subscription.status] ?? subscription.status, amountMinor: subscription.amount_minor ?? null } : null,
    thisMonth: obligation
      ? { amountDueMinor: obligation.amount_due_minor, dueDate: obligation.due_date ?? null, statusLabel: OBLIGATION_STATUS_LABEL[obligation.status] ?? obligation.status, prorated: obligation.is_prorated === true }
      : null,
    nextStep,
  }
}
