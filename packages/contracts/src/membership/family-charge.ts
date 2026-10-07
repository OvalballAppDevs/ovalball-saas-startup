import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import { formatMinorUnits, ordinalWord } from "../club/finance"
import { feePercent, parseFirstPaymentExample, type FeeBearer, type FirstPaymentExample } from "./setup"

type Client = SupabaseClient<Database>

/**
 * WHAT A FAMILY'S DIRECT DEBIT COLLECTS, AND WHO PAYS OVALBALL'S FEE (20270751000000).
 *
 * OWNER-LOCKED (6 October 2026): each club chooses who pays Ovalball's 2.5%, and the parent's setup must say which.
 * `family_membership_charge` is the one server answer for it -- the membership, its monthly price for this payer,
 * who pays the fee, what the Direct Debit collects each month, the club's collection day and, before set-up, the
 * first payment. The website's family page and the app read it through this module and say it in these words, so
 * a parent is never told one figure on one screen and charged another.
 *
 * A guardian who is not the payer is answered `youPay: false` and nothing else of the payer's.
 */
export interface FamilyMembershipCharge {
  clubId: string
  programmeId: string | null
  takingMemberships: boolean
  membership: { id: string; name: string } | null
  setUp: boolean
  youPay: boolean
  collectionDay: number | null
  firstPaymentPolicy: string | null
  currency: string
  feeBps: number
  feeBearer: FeeBearer | null
  monthlyAmountMinor: number | null
  monthlyFeeMinor: number | null
  monthlyCollectMinor: number | null
  /** Before set-up only: the first payment if the family set the Direct Debit up today. */
  first: FirstPaymentExample | null
}

type Raw = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : typeof v === "string" && v !== "" && !Number.isNaN(Number(v)) ? Number(v) : null)

/** Pure: the server's JSON as both clients read it. */
export function parseFamilyMembershipCharge(raw: unknown): FamilyMembershipCharge | null {
  if (!raw || typeof raw !== "object") return null
  const r = raw as Raw
  const m = r.membership as Raw | null | undefined
  const bearer = str(r.fee_bearer)
  return {
    clubId: String(r.club_id),
    programmeId: str(r.programme_id),
    takingMemberships: r.taking_memberships === true,
    membership: m && typeof m === "object" ? { id: String(m.id), name: str(m.name) ?? "Membership" } : null,
    setUp: r.set_up === true,
    youPay: r.you_pay !== false,
    collectionDay: num(r.collection_day),
    firstPaymentPolicy: str(r.first_payment_policy),
    currency: str(r.currency) ?? "GBP",
    feeBps: num(r.fee_bps) ?? 0,
    feeBearer: bearer === "CLUB" || bearer === "PAYER" ? bearer : null,
    monthlyAmountMinor: num(r.monthly_amount_minor),
    monthlyFeeMinor: num(r.monthly_fee_minor),
    monthlyCollectMinor: num(r.monthly_collect_minor),
    first: parseFirstPaymentExample(r.first),
  }
}

/** Throws the server's refusal (42501) for anybody who is not this player's guardian or the player. */
export async function loadFamilyMembershipCharge(supabase: Client, playerId: string, clubId: string): Promise<FamilyMembershipCharge | null> {
  const { data, error } = await supabase.rpc("family_membership_charge", { p_player_id: playerId, p_club_id: clubId })
  if (error) throw error
  return parseFamilyMembershipCharge(data)
}

const longDate = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" })
const monthName = (iso: string) => new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" })

/**
 * A family's first payment, said to them: the amount the Direct Debit takes first (Ovalball's fee included when
 * members pay it), what it covers, and what follows. From the server's example only.
 */
export function familyFirstPayment(f: FirstPaymentExample): { amountMinor: number; covers: string; then: string } {
  const then = `Then ${formatMinorUnits(f.monthlyCollectMinor)} a month from ${longDate(f.thenMonthlyFrom)}.`
  if (f.belowMinimum) {
    return { amountMinor: 0, covers: `Nothing for the rest of ${monthName(f.joinDate)}: the part month is under the £1 Direct Debit minimum.`, then }
  }
  if (f.nothingInJoiningMonth) {
    return { amountMinor: f.firstCollectMinor, covers: `Nothing is due for ${monthName(f.joinDate)}. Your first payment is for ${monthName(f.firstBillingPeriod)}.`, then }
  }
  if (f.isProrated) {
    return { amountMinor: f.firstCollectMinor, covers: `For the ${f.proratedDays} days left in ${monthName(f.joinDate)}, collected once your Direct Debit is set up.`, then }
  }
  return { amountMinor: f.firstCollectMinor, covers: `For ${monthName(f.firstBillingPeriod)}.`, then }
}

/** "Collected on the 15th of each month" -- the club's own day, never a hard-coded 1st. */
export function collectionDayLine(day: number | null): string {
  return day ? `Collected on the ${ordinalWord(day)} of each month` : "Collected monthly"
}

/**
 * Who pays Ovalball's fee and what the Direct Debit collects, in one or two sentences a parent reads before they
 * authorise anything. Null when there is nothing to say (no fee arrangement, nothing to collect, or the viewer is
 * not the payer).
 */
export function familyFeeSentence(charge: FamilyMembershipCharge, clubName: string): string | null {
  if (!charge.youPay || charge.monthlyAmountMinor === null || charge.monthlyAmountMinor <= 0 || !charge.feeBearer) return null
  const pct = feePercent(charge.feeBps)
  const collect = formatMinorUnits(charge.monthlyCollectMinor ?? charge.monthlyAmountMinor)
  if (charge.feeBearer === "PAYER") {
    return `${clubName} asks members to pay Ovalball's ${pct} fee (${formatMinorUnits(charge.monthlyFeeMinor ?? 0)} a month) on top of the membership price, so your Direct Debit collects ${collect} a month.`
  }
  return `${clubName} pays Ovalball's ${pct} fee itself, so your Direct Debit collects the membership price: ${collect} a month.`
}
