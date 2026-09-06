import "server-only"

import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "@/types/database.types"

/**
 * Referring another rugby club to Ovalball.
 *
 * The promise is narrow on purpose: a reward is earned only when the
 * referred club's **first Ovalball subscription payment is successfully
 * collected**. Not a click, not a sign-up, not a trial, not a mandate, not
 * a submitted payment. Everything that enforces that lives in the database,
 * at the single point where a payment becomes confirmed.
 */
export type ReferralStatus =
  /** Invitation sent; the club is not on Ovalball yet. */
  | "pending"
  /** The club is on Ovalball, but has not paid Ovalball yet. */
  | "registered"
  /** Their first payment was collected, and the reward is in the ledger. */
  | "qualified"
  /** It cannot earn — self-referral, an existing subscriber, and so on. */
  | "rejected"
  /** It qualified, then the qualifying collection failed. */
  | "reversed"

export interface ClubReferral {
  id: string
  referredClubName: string
  status: ReferralStatus
  /** The value fixed when the reward was earned. Null until it is. */
  rewardAmountPence: number | null
  qualifiedAt: string | null
  createdAt: string
}

export async function getClubReferrals(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<ClubReferral[]> {
  const { data, error } = await supabase.rpc("club_referral_summary", { p_club_id: clubId })

  if (error || !data) return []

  return data.map((row) => ({
    id: row.referral_id,
    referredClubName: row.referred_club_name ?? "A club",
    status: row.status as ReferralStatus,
    rewardAmountPence: row.reward_amount_pence,
    qualifiedAt: row.qualified_at,
    createdAt: row.created_at,
  }))
}

/**
 * Records that an invitation this club sent is also a referral claim.
 * Idempotent — the same invitation always returns the same referral, so a
 * double-submitted form is harmless.
 */
export async function claimReferral(
  supabase: SupabaseClient<Database>,
  invitationId: string
): Promise<string | null> {
  const { data, error } = await supabase.rpc("claim_club_referral", {
    p_invitation_id: invitationId,
  })

  if (error) return null
  return data
}

/** What a club can currently spend, in pence. */
export async function getCreditBalancePence(
  supabase: SupabaseClient<Database>,
  clubId: string
): Promise<number> {
  const { data, error } = await supabase.rpc("club_credit_balance_pence", { p_club_id: clubId })

  if (error || data === null) return 0
  return data
}

/**
 * The one-line version of the offer, for a CTA. Deliberately says
 * "successfully collected" rather than "signs up", because that is what the
 * engine actually requires and the copy must not promise more.
 */
export const REFERRAL_OFFER_SUMMARY =
  "Refer another rugby club to Ovalball. If they start a paid subscription and their first payment is successfully collected, your club gets one month of its current plan free."
