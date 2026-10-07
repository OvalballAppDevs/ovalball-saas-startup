"use server"

import { revalidatePath } from "next/cache"

import { hasCapability } from "@/lib/permissions/has-capability"
import { cancelMembership } from "@/lib/payments/gocardless/cancel-membership"
import { merchantTokenForClubPaymentAction } from "@/lib/payments/gocardless/merchant-token"
import { retryGoCardlessPayment, createGoCardlessRefund } from "@/lib/payments/gocardless/payments"
import { createClient } from "@/lib/supabase/server"
import { reminderOutcomeSentence, sendMembershipReminders } from "@ovalball/contracts/membership/board"
import { releaseResponsiblePayer } from "@ovalball/contracts/membership/member"
import { previewMembershipReminders, sendRemindersInBatches, type ReminderPreview } from "@ovalball/contracts/membership/operate"

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Every page of the club's Memberships area reads the same server answers, so a change made on one is a change on
 * all of them: Overview, Members, a member's page, Reminders, Payments and the membership record.
 */
function revalidateMemberships() {
  for (const path of ["/club/finance", "/club/finance/members", "/club/finance/reminders", "/club/finance/payments"]) revalidatePath(path)
  revalidatePath("/club/finance/members/[playerId]", "page")
  revalidatePath("/club/finance/[payerSubscriptionId]", "page")
}

/**
 * The membership operations raise sentences written for people (a refusal, a daily limit, "cancel the membership
 * first"); those are shown as they are. Anything else -- a database or provider message, a code -- is not shown raw.
 */
function readableSentence(cause: unknown, fallback: string): string {
  const message = (cause as { message?: string } | null)?.message
  const readable = message && /^[A-Z][^\n]{8,200}\.$/.test(message) && !/\b(violates|syntax|relation|function|column|constraint|null value|uuid)\b/i.test(message)
  return readable ? message : fallback
}

async function requireFinanceCapability(clubId: string, capability: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }
  const authorized = await hasCapability(supabase, capability, "club", { clubId })
  if (!authorized) return { ok: false as const, error: "You are not authorised to do this for this club." }
  return { ok: true as const, supabase, userId: user.id }
}

export async function generateObligationsForCurrentPeriod(clubId: string, billingPeriod: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "finance.enrolment.manage")
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("create_membership_obligations_for_period", { p_club_id: clubId, p_billing_period: billingPeriod })
  if (error) return { ok: false, error: readableSentence(error, "This month's obligations weren't generated. Try again.") }

  revalidateMemberships()
  return { ok: true }
}

export async function setObligationExemption(clubId: string, obligationId: string, status: "EXEMPT" | "WAIVED", reason: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "finance.enrolment.manage")
  if (!auth.ok) return auth

  const { error } = await auth.supabase.rpc("set_obligation_exemption", { p_obligation_id: obligationId, p_status: status, p_reason: reason })
  if (error) return { ok: false, error: readableSentence(error, "The month wasn't changed. Try again.") }

  revalidateMemberships()
  return { ok: true }
}

export async function retryFailedPayment(clubId: string, gocardlessPaymentDbId: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "finance.payment.act")
  if (!auth.ok) return auth

  const { data: payment } = await auth.supabase.from("gocardless_payments").select("gc_payment_id, status").eq("id", gocardlessPaymentDbId).eq("club_id", clubId).maybeSingle()
  if (!payment) return { ok: false, error: "Payment not found." }
  if (payment.status !== "failed") return { ok: false, error: "Only a failed payment can be retried." }

  const tokenRow = await merchantTokenForClubPaymentAction(clubId, auth.userId)
  if (!tokenRow) return { ok: false, error: "GoCardless connection not available." }

  try {
    await retryGoCardlessPayment({ environment: tokenRow.environment as "sandbox" | "production", accessToken: tokenRow.access_token, gcPaymentId: payment.gc_payment_id })
    revalidateMemberships()
    return { ok: true }
  } catch (error) {
    // GoCardless's own message can carry its error codes and ids: it is logged for the club's support, never shown.
    console.error("retryFailedPayment: GoCardless refused the retry", error)
    return { ok: false, error: "GoCardless didn't accept the retry. Try again later, or check the payment in GoCardless." }
  }
}

export async function issueRefund(clubId: string, gocardlessPaymentDbId: string, amountMinor: number, reason: string): Promise<ActionResult> {
  const auth = await requireFinanceCapability(clubId, "finance.payment.act")
  if (!auth.ok) return auth

  const { data: payment } = await auth.supabase.from("gocardless_payments").select("id, gc_payment_id, status").eq("id", gocardlessPaymentDbId).eq("club_id", clubId).maybeSingle()
  if (!payment) return { ok: false, error: "Payment not found." }
  if (payment.status !== "confirmed" && payment.status !== "paid_out") return { ok: false, error: "Only a confirmed payment can be refunded." }

  const { data: refundId, error: recordError } = await auth.supabase.rpc("record_payment_refund", { p_payment_id: payment.id, p_amount_minor: amountMinor, p_reason: reason })
  if (recordError) return { ok: false, error: recordError.message }

  const tokenRow = await merchantTokenForClubPaymentAction(clubId, auth.userId)
  if (!tokenRow) return { ok: false, error: "Refund recorded locally, but GoCardless connection is not available to submit it. Contact support." }

  try {
    await createGoCardlessRefund({
      environment: tokenRow.environment as "sandbox" | "production",
      accessToken: tokenRow.access_token,
      gcPaymentId: payment.gc_payment_id,
      amountMinor,
      idempotencyKey: `refund-${refundId}`,
    })
    revalidateMemberships()
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

  const authorized = await hasCapability(supabase, "finance.payment.act", "club", { clubId: programmeRow.club_id })
  if (!authorized) return { ok: false, error: "You are not authorised to cancel memberships for this club." }

  if (payerRow.status !== "active") {
    // Idempotent -- a repeated request (double-click, retry) for an
    // already-ended membership is a safe no-op, not an error.
    return { ok: true }
  }

  const tokenRow = await merchantTokenForClubPaymentAction(programmeRow.club_id, user.id)
  if (!tokenRow) return { ok: false, error: "GoCardless connection not available." }

  const result = await cancelMembership({
    supabase,
    environment: tokenRow.environment as "sandbox" | "production",
    accessToken: tokenRow.access_token,
    payerSubscriptionId,
    reason: reason.trim(),
    actorUserId: user.id,
  })
  if (!result.ok) return result

  revalidateMemberships()
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
  const auth = await requireFinanceCapability(clubId, "finance.subscription.export")
  if (!auth.ok) return auth

  const { data, error } = await auth.supabase.rpc("export_finance_rows", { p_club_id: clubId, p_billing_period: billingPeriod })
  if (error) return { ok: false, error: readableSentence(error, "The export couldn't be made. Try again.") }

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

/**
 * A MEMBERSHIP REMINDER (20270746000000), to each player's responsible payer -- or, with nothing set up, to
 * the guardians the one contact rule allows; never a child. The server decides who may send, who is asked,
 * and holds a repeat back for 72 hours; this returns its outcome as a sentence. One member's Remind uses it.
 */
export async function remindMembers(clubId: string, playerIds: string[]): Promise<{ tone: "ok" | "error"; text: string; sent?: number }> {
  const supabase = await createClient()
  try {
    const result = await sendMembershipReminders(supabase, { clubId, playerIds })
    revalidateMemberships()
    return { tone: "ok", text: reminderOutcomeSentence(result), sent: result.sent }
  } catch (cause) {
    return { tone: "error", text: readableSentence(cause, "The reminder wasn't sent. Try again.") }
  }
}

/**
 * THE REMINDERS SCREEN'S SEND (Part 2): any size of audience, in the server's own batches, one after another. A
 * refusal part-way (the 100-a-day limit, say) stops there and is said beside what was already sent -- nothing is
 * retried, so a family is never asked twice.
 */
export async function sendRemindersAction(clubId: string, playerIds: string[]): Promise<{ tone: "ok" | "error"; text: string; sent?: number }> {
  const supabase = await createClient()
  if (playerIds.length === 0) return { tone: "error", text: "Choose who to remind." }
  const { result, error } = await sendRemindersInBatches((ids) => sendMembershipReminders(supabase, { clubId, playerIds: ids }), playerIds)
  revalidateMemberships()
  if (error) {
    const why = readableSentence(error, result.sent > 0 ? "The rest weren't sent. Try again." : "The reminders weren't sent. Try again.")
    return { tone: "error", text: result.sent > 0 ? `${reminderOutcomeSentence(result)} ${why}` : why, sent: result.sent }
  }
  return { tone: "ok", text: reminderOutcomeSentence(result), sent: result.sent }
}

/**
 * What a reminder would say and to how many, before anybody presses Send: the server's own composer and the sending
 * rule, recording nothing and telling nobody anything.
 */
export async function previewRemindersAction(clubId: string, playerIds: string[]): Promise<{ ok: true; preview: ReminderPreview } | { ok: false; error: string }> {
  if (playerIds.length === 0) return { ok: true, preview: { willSend: 0, skipped: [], example: null, examples: [] } }
  const supabase = await createClient()
  try {
    // The preview reads up to 500 at a time: each situation's message, with how many families get it.
    return { ok: true, preview: await previewMembershipReminders(supabase, { clubId, playerIds: playerIds.slice(0, 500) }) }
  } catch (cause) {
    return { ok: false, error: readableSentence(cause, "The message couldn't be shown. Try again.") }
  }
}

/**
 * CHANGING WHO PAYS (decision #11): the current payer's set-up ends so another guardian can take the membership on.
 * The server decides who may, and refuses while a Direct Debit is collecting or a payment is on its way to the bank
 * -- so two collections can never run for one player. `collecting` marks the refusal whose way forward is Cancel
 * Membership.
 */
export async function changeWhoPaysAction(payerSubscriptionId: string, reason: string): Promise<{ ok: true } | { ok: false; error: string; collecting: boolean }> {
  if (reason.trim().length === 0) return { ok: false, error: "Say why the payer is changing.", collecting: false }
  const supabase = await createClient()
  try {
    await releaseResponsiblePayer(supabase, { payerSubscriptionId, reason: reason.trim() })
    revalidateMemberships()
    return { ok: true }
  } catch (cause) {
    const e = (cause ?? {}) as { code?: string; message?: string }
    return {
      ok: false,
      error: readableSentence(cause, "Who pays wasn't changed. Try again."),
      collecting: e.code === "55000" && /is collecting/i.test(e.message ?? ""),
    }
  }
}
