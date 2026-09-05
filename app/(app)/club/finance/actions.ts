"use server"

import { revalidatePath } from "next/cache"

import { hasCapability } from "@/lib/permissions/has-capability"
import { cancelMembership } from "@/lib/payments/gocardless/cancel-membership"
import { retryGoCardlessPayment, createGoCardlessRefund } from "@/lib/payments/gocardless/payments"
import { createClient } from "@/lib/supabase/server"

export type ActionResult = { ok: true } | { ok: false; error: string }

async function requireFinanceCapability(clubId: string, capability: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }
  const authorized = await hasCapability(supabase, capability, "club", { clubId })
  if (!authorized) return { ok: false as const, error: "You are not authorized to do this for this club." }
  return { ok: true as const, supabase, userId: user.id }
}

export async function generateObligationsForCurrentPeriod(clubId: string, billingPeriod: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "club.subscription.manage_enrolment")
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("create_membership_obligations_for_period", { p_club_id: clubId, p_billing_period: billingPeriod })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/club/finance")
  return { ok: true }
}

export async function setObligationExemption(clubId: string, obligationId: string, status: "EXEMPT" | "WAIVED", reason: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "club.subscription.manage_enrolment")
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("set_obligation_exemption", { p_obligation_id: obligationId, p_status: status, p_reason: reason })
  if (error) return { ok: false, error: error.message }

  revalidatePath("/club/finance")
  return { ok: true }
}

export async function retryFailedPayment(clubId: string, gocardlessPaymentDbId: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "club.subscription.manage_payment_actions")
  if (!auth.ok) return auth

  const { data: payment } = await auth.supabase.from("gocardless_payments").select("gc_payment_id, status").eq("id", gocardlessPaymentDbId).eq("club_id", clubId).maybeSingle()
  if (!payment) return { ok: false, error: "Payment not found." }
  if (payment.status !== "failed") return { ok: false, error: "Only a failed payment can be retried." }

  const { data: tokenRow, error: tokenError } = await auth.supabase.rpc("get_gocardless_token_for_club_admin_action", { p_club_id: clubId }).maybeSingle()
  if (tokenError || !tokenRow) return { ok: false, error: "GoCardless connection not available." }

  try {
    await retryGoCardlessPayment({ environment: tokenRow.environment as "sandbox" | "production", accessToken: tokenRow.access_token, gcPaymentId: payment.gc_payment_id })
    revalidatePath("/club/finance")
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error."
    return { ok: false, error: `Retry failed: ${message}` }
  }
}

export async function issueRefund(clubId: string, gocardlessPaymentDbId: string, amountMinor: number, reason: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "club.subscription.manage_payment_actions")
  if (!auth.ok) return auth

  const { data: payment } = await auth.supabase.from("gocardless_payments").select("id, gc_payment_id, status").eq("id", gocardlessPaymentDbId).eq("club_id", clubId).maybeSingle()
  if (!payment) return { ok: false, error: "Payment not found." }
  if (payment.status !== "confirmed" && payment.status !== "paid_out") return { ok: false, error: "Only a confirmed payment can be refunded." }

  const { data: refundId, error: recordError } = await auth.supabase.rpc("record_payment_refund", { p_payment_id: payment.id, p_amount_minor: amountMinor, p_reason: reason })
  if (recordError) return { ok: false, error: recordError.message }

  const { data: tokenRow, error: tokenError } = await auth.supabase.rpc("get_gocardless_token_for_club_admin_action", { p_club_id: clubId }).maybeSingle()
  if (tokenError || !tokenRow) return { ok: false, error: "Refund recorded locally, but GoCardless connection is not available to submit it. Contact support." }

  try {
    await createGoCardlessRefund({
      environment: tokenRow.environment as "sandbox" | "production",
      accessToken: tokenRow.access_token,
      gcPaymentId: payment.gc_payment_id,
      amountMinor,
      idempotencyKey: `refund-${refundId}`,
    })
    revalidatePath("/club/finance")
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error."
    return { ok: false, error: `Refund recorded locally, but the GoCardless API call failed: ${message}` }
  }
}

/**
 * The ONE Club-Admin-triggered "stop this membership" action -- resolves
 * the club/environment/token server-side from payerSubscriptionId,
 * proving the caller's own manage_payment_actions capability for THAT
 * club before any provider call is ever made (never a client-supplied
 * club/token pair).
 */
export async function cancelMembershipAction(payerSubscriptionId: string, reason: string): Promise<ActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You must be signed in." }

  if (!reason || reason.trim().length === 0) return { ok: false, error: "A reason is required to cancel a membership." }

  const { data: payerRow } = await supabase.from("player_subscription_payers").select("id, programme_id, status").eq("id", payerSubscriptionId).maybeSingle()
  if (!payerRow) return { ok: false, error: "Membership not found." }

  const { data: programmeRow } = await supabase.from("club_subscription_programmes").select("club_id").eq("id", payerRow.programme_id).maybeSingle()
  if (!programmeRow) return { ok: false, error: "Programme not found." }

  const authorized = await hasCapability(supabase, "club.subscription.manage_payment_actions", "club", { clubId: programmeRow.club_id })
  if (!authorized) return { ok: false, error: "You are not authorized to cancel memberships for this club." }

  if (payerRow.status !== "active") {
    // Idempotent -- a repeated request (double-click, retry) for an
    // already-ended membership is a safe no-op, not an error.
    return { ok: true }
  }

  const { data: tokenRow, error: tokenError } = await supabase.rpc("get_gocardless_token_for_club_admin_action", { p_club_id: programmeRow.club_id }).maybeSingle()
  if (tokenError || !tokenRow) return { ok: false, error: "GoCardless connection not available." }

  const result = await cancelMembership({
    supabase,
    environment: tokenRow.environment as "sandbox" | "production",
    accessToken: tokenRow.access_token,
    payerSubscriptionId,
    reason: reason.trim(),
    actorUserId: user.id,
  })
  if (!result.ok) return result

  revalidatePath("/club/finance")
  return { ok: true }
}

export type ExportResult = { ok: true; csv: string } | { ok: false; error: string }

/**
 * Safe CSV export -- no bank details, sort codes, provider tokens, or
 * raw payloads, ever. Values are CSV-escaped (wrapped in quotes with
 * internal quotes doubled) since player/payer names are free-text and
 * could otherwise break the format.
 */
export async function exportFinanceCsv(clubId: string, billingPeriod: string): Promise<ExportResult> {
  const auth = await requireFinanceCapability(clubId, "club.subscription.export")
  if (!auth.ok) return auth

  const { data, error } = await auth.supabase.rpc("export_finance_rows", { p_club_id: clubId, p_billing_period: billingPeriod })
  if (error) return { ok: false, error: error.message }

  const escape = (value: string | number | null) => `"${String(value ?? "").replace(/"/g, '""')}"`
  // Base rate, sibling ordinal, sibling discount, and final membership
  // rate -- explains pricing without a sibling's own name (ordinal number
  // is sufficient) and without any bank data.
  const header = ["Player", "Payer", "Payer email", "Billing period", "Amount", "Obligation status", "Due date", "Payment status", "Subscription status", "Base rate", "Sibling ordinal", "Sibling discount", "Final rate"]
  const lines = [
    header.map(escape).join(","),
    ...(data ?? []).map((row) =>
      [
        `${row.player_first_name} ${row.player_surname}`,
        row.payer_first_name && row.payer_surname ? `${row.payer_first_name} ${row.payer_surname}` : "",
        row.payer_email,
        row.billing_period,
        (row.amount_due_minor / 100).toFixed(2),
        row.obligation_status,
        row.due_date,
        row.payment_status ?? "",
        row.subscription_status ?? "",
        row.base_amount_minor != null ? (row.base_amount_minor / 100).toFixed(2) : "",
        row.sibling_ordinal ?? "",
        row.sibling_discount_type && row.sibling_discount_type !== "NONE" ? row.sibling_discount_type : "",
        row.final_amount_minor != null ? (row.final_amount_minor / 100).toFixed(2) : "",
      ]
        .map(escape)
        .join(",")
    ),
  ]

  return { ok: true, csv: lines.join("\n") }
}
