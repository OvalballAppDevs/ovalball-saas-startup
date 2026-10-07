import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { MembershipReason, MembershipRef, MembershipStanding } from "./board"

type Client = SupabaseClient<Database>

/**
 * ONE MEMBER, ONE READ (20270753000000) -- the club's view of one player's membership, keyed by the PLAYER, so a
 * player nobody has set a membership up for has a page too ("Not set up" is the commonest thing a club chases).
 *
 * The server decides everything here: the standing (the one `internal.membership_standing`), who may be asked,
 * whether the reader may see the payer's contact details (the People rule, `people.member.view_contact`), and
 * what the reader may do (`can`). The clients only lay it out.
 */

/** Where Ovalball's fee on a month stands (internal.membership_fee_position), in words. A status: sentence case. */
export type FeePosition = "NONE" | "EXPECTED" | "PENDING" | "EARNED" | "RETURNED" | "UNRESOLVED"

export const FEE_POSITION_LABEL: Record<FeePosition, string> = {
  NONE: "No fee",
  EXPECTED: "Taken when collected",
  PENDING: "Taken when the bank pays",
  EARNED: "Taken",
  RETURNED: "Given back: the payment failed",
  UNRESOLVED: "On a refunded payment",
}

export function feePositionLabel(position: string | null): string | null {
  return position && position in FEE_POSITION_LABEL ? FEE_POSITION_LABEL[position as FeePosition] : null
}

export interface MemberPaymentMonth {
  /** Ovalball's own ids for the month and its payment (never GoCardless's): what Waive and Retry act on. */
  obligationId: string | null
  paymentId: string | null
  /** The first day of the month this is for. */
  billingPeriod: string
  /** The membership amount for the month. */
  amountMinor: number
  /** What the Direct Debit collects: the amount, plus Ovalball's fee when members pay it. */
  collectMinor: number | null
  /** Ovalball's 2.5% on the month. */
  feeMinor: number | null
  /** Where Ovalball's fee stands: earned only once the payment is collected (internal.membership_fee_position). */
  feePosition: string | null
  dueDate: string | null
  /** The month's record (membership_obligations.status). */
  status: string
  isProrated: boolean
  /** GoCardless's payment status, when a payment exists. */
  paymentStatus: string | null
  chargeDate: string | null
}

export interface ClubMemberMembership {
  player: { id: string; firstName: string; surname: string; isAdult: boolean; teams: { id: string; name: string }[] }
  standing: {
    standing: MembershipStanding
    reason: MembershipReason
    amountDueMinor: number | null
    nextCollectionDate: string | null
    collectionStarted: boolean
    lastRemindedAt: string | null
    lastRemindedBy: string | null
    canRemind: boolean
  }
  membership:
    | (MembershipRef & {
        monthlyAmountMinor: number | null
        /** "active" or "ended" when somebody set it up; null when nobody has. */
        enrolmentStatus: string | null
        payerSubscriptionId: string | null
        effectiveFrom: string | null
        endedAt: string | null
        endReason: string | null
        collectionDay: number | null
        firstPaymentPolicy: string | null
        feeBearer: "CLUB" | "PAYER" | null
        /** Ovalball's rate on this membership in basis points (its own snapshot once somebody holds it). */
        feeBps: number | null
        /** Ovalball's fee on a month, and what the Direct Debit collects a month (the price, plus the fee when members pay it). */
        monthlyFeeMinor: number | null
        monthlyCollectMinor: number | null
        siblingOrdinal: number | null
        siblingDiscountType: string | null
        siblingDiscountValue: number | null
        baseAmountMinor: number | null
      })
    | null
  /** Contact details are present only for a reader who may see members' contact details. */
  payer: { name: string | null; relationship: "guardian" | "self"; email: string | null; phone: string | null } | null
  /** The adults the club may ask about this player (never a child), and which of them pays. */
  askable: { name: string | null; relationship: "guardian" | "self"; isPayer: boolean }[]
  directDebit: { mandateStatus: string | null; subscriptionStatus: string | null } | null
  history: MemberPaymentMonth[]
  can: { remind: boolean; releasePayer: boolean; cancel: boolean }
}

type Raw = Record<string, unknown>
const str = (v: unknown): string | null => (typeof v === "string" ? v : null)
const num = (v: unknown): number | null => (typeof v === "number" ? v : null)
const relationship = (v: unknown): "guardian" | "self" => (v === "self" ? "self" : "guardian")

/** Pure: the member read's JSON as both clients use it. Null when the club's memberships do not know the player. */
export function parseClubMemberMembership(raw: unknown): ClubMemberMembership | null {
  if (raw === null || raw === undefined) return null
  const r = raw as Raw
  const p = (r.player ?? {}) as Raw
  const s = (r.standing ?? {}) as Raw
  const m = r.membership as Raw | null
  const payer = r.payer as Raw | null
  const dd = r.direct_debit as Raw | null
  const can = (r.can ?? {}) as Raw
  return {
    player: {
      id: String(p.id),
      firstName: str(p.first_name) ?? "",
      surname: str(p.surname) ?? "",
      isAdult: p.is_adult === true,
      teams: ((p.teams as Raw[] | null) ?? []).map((t) => ({ id: String(t.id), name: str(t.name) ?? "" })),
    },
    standing: {
      standing: s.standing as MembershipStanding,
      reason: s.reason as MembershipReason,
      amountDueMinor: num(s.amount_due_minor),
      nextCollectionDate: str(s.next_collection_date),
      collectionStarted: s.collection_started === true,
      lastRemindedAt: str(s.last_reminded_at),
      lastRemindedBy: str(s.last_reminded_by),
      canRemind: s.can_remind === true,
    },
    membership:
      m && typeof m.id === "string"
        ? {
            id: m.id,
            name: str(m.name) ?? "",
            monthlyAmountMinor: num(m.monthly_amount_minor),
            enrolmentStatus: str(m.enrolment_status),
            payerSubscriptionId: str(m.payer_subscription_id),
            effectiveFrom: str(m.effective_from),
            endedAt: str(m.ended_at),
            endReason: str(m.end_reason),
            collectionDay: num(m.collection_day),
            firstPaymentPolicy: str(m.first_payment_policy),
            feeBearer: m.fee_bearer === "CLUB" || m.fee_bearer === "PAYER" ? m.fee_bearer : null,
            feeBps: num(m.fee_bps),
            monthlyFeeMinor: num(m.monthly_fee_minor),
            monthlyCollectMinor: num(m.monthly_collect_minor),
            siblingOrdinal: num(m.sibling_ordinal),
            siblingDiscountType: str(m.sibling_discount_type),
            siblingDiscountValue: num(m.sibling_discount_value),
            baseAmountMinor: num(m.base_amount_minor),
          }
        : null,
    payer: payer ? { name: str(payer.name), relationship: relationship(payer.relationship), email: str(payer.email), phone: str(payer.phone) } : null,
    askable: ((r.askable as Raw[] | null) ?? []).map((a) => ({ name: str(a.name), relationship: relationship(a.relationship), isPayer: a.is_payer === true })),
    directDebit: dd ? { mandateStatus: str(dd.mandate_status), subscriptionStatus: str(dd.subscription_status) } : null,
    history: ((r.history as Raw[] | null) ?? []).map((h) => ({
      obligationId: str(h.obligation_id),
      paymentId: str(h.payment_id),
      billingPeriod: str(h.billing_period) ?? "",
      amountMinor: num(h.amount_minor) ?? 0,
      collectMinor: num(h.collect_minor),
      feeMinor: num(h.fee_minor),
      feePosition: str(h.fee_position),
      dueDate: str(h.due_date),
      status: str(h.status) ?? "",
      isProrated: h.is_prorated === true,
      paymentStatus: str(h.payment_status),
      chargeDate: str(h.charge_date),
    })),
    can: { remind: can.remind === true, releasePayer: can.release_payer === true, cancel: can.cancel === true },
  }
}

/** Throws the server's refusal (42501) for anybody who may not see the club's memberships. Null: not known here. */
export async function loadClubMemberMembership(supabase: Client, clubId: string, playerId: string): Promise<ClubMemberMembership | null> {
  const { data, error } = await supabase.rpc("club_member_membership", { p_club_id: clubId, p_player_id: playerId })
  if (error) throw error
  return parseClubMemberMembership(data)
}

/**
 * Who the club would ask, in a sentence, so nobody presses Send Reminder wondering where it goes. Names only --
 * the club's own record of who looks after the player.
 */
export function askableSentence(askable: ClubMemberMembership["askable"], firstName: string): string {
  const payer = askable.find((a) => a.isPayer)
  if (payer) return payer.relationship === "self" ? `The reminder goes to ${firstName}, who pays for their own membership.` : `The reminder goes to ${payer.name ?? "the payer"}, who pays for ${firstName}.`
  const names = askable.map((a) => (a.relationship === "self" ? firstName : (a.name ?? "a guardian")))
  if (names.length === 0) return `There is no adult the club can contact about ${firstName}'s membership.`
  if (names.length === 1) return `The reminder goes to ${names[0]}.`
  return `The reminder goes to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}.`
}

// ---- Reminder history -------------------------------------------------------------------------------------

export interface MembershipReminderEntry {
  sentAt: string
  playerId: string
  firstName: string
  surname: string
  sentBy: string | null
  /** The standing and reason the player was reminded about, as they were when the reminder was sent. */
  standing: MembershipStanding | null
  reason: MembershipReason | null
  /** Sent by the club, or by a team's own staff. */
  scope: "club" | "team"
  /** How many adults were told -- the club's finance viewers only; a team's staff never learn it. */
  recipients: number | null
}

export interface MembershipReminderHistory {
  clubId: string
  teamId: string | null
  reminders: MembershipReminderEntry[]
}

/** Pure: the history JSON as both clients read it. */
export function parseMembershipReminderHistory(raw: unknown): MembershipReminderHistory {
  const r = (raw ?? {}) as Raw
  return {
    clubId: String(r.club_id),
    teamId: str(r.team_id),
    reminders: ((r.reminders as Raw[] | null) ?? []).map((x) => ({
      sentAt: str(x.sent_at) ?? "",
      playerId: String(x.player_id),
      firstName: str(x.first_name) ?? "",
      surname: str(x.surname) ?? "",
      sentBy: str(x.sent_by),
      standing: (str(x.standing) as MembershipStanding | null) ?? null,
      reason: (str(x.reason) as MembershipReason | null) ?? null,
      scope: x.scope === "team" ? "team" : "club",
      recipients: num(x.recipients),
    })),
  }
}

/**
 * The club's reminder history, or (with `teamId`) the reminders about that team's own players. A team's staff
 * must pass their team; the server refuses the club-wide history to anybody without the club's finance view.
 */
export async function loadMembershipReminderHistory(supabase: Client, input: { clubId: string; teamId?: string | null; limit?: number }): Promise<MembershipReminderHistory> {
  const { data, error } = await supabase.rpc("membership_reminder_history", {
    p_club_id: input.clubId,
    p_team_id: input.teamId ?? undefined,
    p_limit: input.limit ?? undefined,
  })
  if (error) throw error
  return parseMembershipReminderHistory(data)
}

// ---- Changing who pays (decision #11, DERIVED) ------------------------------------------------------------

/**
 * Ends the current payer's set-up so another guardian can take the membership on. The server refuses while a
 * GoCardless collection is running (cancel the membership first) or a payment is on its way to the bank, so two
 * Direct Debits can never collect for one player. Throws the server's sentence.
 */
export async function releaseResponsiblePayer(supabase: Client, input: { payerSubscriptionId: string; reason: string }): Promise<{ playerId: string }> {
  const { data, error } = await supabase.rpc("release_responsible_payer", { p_payer_subscription_id: input.payerSubscriptionId, p_reason: input.reason })
  if (error) throw error
  const r = (data ?? {}) as Raw
  return { playerId: String(r.player_id) }
}

/** What happens when the club changes who pays, in order -- shown before the club confirms. Body copy. */
export const CHANGE_PAYER_STEPS = [
  "The current payer's set-up ends, and they are told nothing more will be collected from them for it.",
  "The membership shows as not set up.",
  "Send a reminder, and the guardian who will pay sets it up with their own Direct Debit.",
] as const
