import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { formatMoneyMinor } from "./board"

type Client = SupabaseClient<Database>

/**
 * THE MONEY REACHES THE CLUB (20270754000000, Part 2 §29) -- each GoCardless payout explained from GoCardless's own
 * items, read the same way on the web and the phone.
 *
 * The chain, in the order the money moves: what members paid through Ovalball → GoCardless's fees (VAT included in
 * them, shown as "of which") → Ovalball's fee → refunds → failed or charged-back payments → the club's other
 * GoCardless activity → what was paid into the club's bank. Every figure is GoCardless's own; nothing is estimated.
 * A payout arrives days after the payments in it were collected: the board's "Collected" is not this.
 */

export interface ClubPayout {
  id: string
  /** The reference on the club's bank statement. */
  reference: string | null
  arrivalDate: string | null
  status: "pending" | "paid" | "bounced"
  currency: string
  /** What was paid into the club's bank. */
  amountMinor: number
  membersPaidMinor: number
  /** Negative: money GoCardless took for its own fees. VAT is part of it, not on top. */
  gocardlessFeesMinor: number
  gocardlessVatMinor: number
  /** Negative: Ovalball's 2.5% on the payments in this payout (positive when GoCardless gave it back on a failure). */
  ovalballFeeMinor: number
  refundsMinor: number
  failuresMinor: number
  /** The club's GoCardless activity that is not an Ovalball membership payment. */
  otherMinor: number
  items: number
  ovalballPayments: number
  /** GoCardless sums the items and rounds: true when they come to the amount paid in. */
  balanced: boolean
}

type Raw = Record<string, unknown>
const num = (v: unknown) => (typeof v === "number" ? v : 0)
const str = (v: unknown) => (typeof v === "string" ? v : null)

export function parseClubPayouts(raw: unknown): ClubPayout[] {
  const r = (raw ?? {}) as Raw
  return ((r.payouts as Raw[] | null) ?? []).map((p) => ({
    id: String(p.id),
    reference: str(p.reference),
    arrivalDate: str(p.arrival_date),
    status: p.status === "paid" || p.status === "bounced" ? p.status : "pending",
    currency: str(p.currency) ?? "GBP",
    amountMinor: num(p.amount_minor),
    membersPaidMinor: num(p.members_paid_minor),
    gocardlessFeesMinor: num(p.gocardless_fees_minor),
    gocardlessVatMinor: num(p.gocardless_vat_minor),
    ovalballFeeMinor: num(p.ovalball_fee_minor),
    refundsMinor: num(p.refunds_minor),
    failuresMinor: num(p.failures_minor),
    otherMinor: num(p.other_minor),
    items: num(p.items),
    ovalballPayments: num(p.ovalball_payments),
    balanced: p.balanced === true,
  }))
}

/** The club's payouts, newest first. Throws the server's refusal (42501) for anybody without the club's finance view. */
export async function loadClubPayouts(supabase: Client, clubId: string, limit = 24): Promise<ClubPayout[]> {
  const { data, error } = await supabase.rpc("club_payouts", { p_club_id: clubId, p_limit: limit })
  if (error) throw error
  return parseClubPayouts(data)
}

/** A signed amount as a person reads a statement line: "−£0.60", "£32.80". */
export function signedMoney(amountMinor: number, currency = "GBP"): string {
  return amountMinor < 0 ? `−${formatMoneyMinor(-amountMinor, currency)}` : formatMoneyMinor(amountMinor, currency)
}

/**
 * The payout's lines, in the order the money moved, leaving out what is nil. Labels are form-label style (Title
 * Case); the last line is always what reached the bank.
 */
export function payoutLines(p: ClubPayout): { key: string; label: string; amountMinor: number; note?: string }[] {
  const lines: { key: string; label: string; amountMinor: number; note?: string }[] = [
    { key: "members", label: "Members Paid Through Ovalball", amountMinor: p.membersPaidMinor },
  ]
  if (p.gocardlessFeesMinor !== 0)
    lines.push({ key: "gocardless", label: "GoCardless's Fees", amountMinor: p.gocardlessFeesMinor, note: p.gocardlessVatMinor !== 0 ? `Including ${formatMoneyMinor(Math.abs(p.gocardlessVatMinor), p.currency)} VAT` : undefined })
  if (p.ovalballFeeMinor !== 0) lines.push({ key: "ovalball", label: "Ovalball's Fee", amountMinor: p.ovalballFeeMinor })
  if (p.refundsMinor !== 0) lines.push({ key: "refunds", label: "Refunds", amountMinor: p.refundsMinor })
  if (p.failuresMinor !== 0) lines.push({ key: "failures", label: "Failed or Reclaimed Payments", amountMinor: p.failuresMinor })
  if (p.otherMinor !== 0) lines.push({ key: "other", label: "Other GoCardless Activity", amountMinor: p.otherMinor, note: "Payments the club collected outside Ovalball, and their fees" })
  lines.push({ key: "paid", label: "Paid Into the Club's Bank", amountMinor: p.amountMinor })
  return lines
}

/** A status, so sentence case. */
export function payoutStatusLabel(status: ClubPayout["status"]): string {
  return status === "paid" ? "Paid" : status === "bounced" ? "Returned by the bank" : "On its way"
}

/** The one sentence that keeps "collected" and "paid out" apart. Body copy. */
export const PAYOUTS_EXPLAINED =
  "GoCardless pays the club a few working days after it collects. Each payout below is what reached the club's bank, with what GoCardless and Ovalball took from it."
