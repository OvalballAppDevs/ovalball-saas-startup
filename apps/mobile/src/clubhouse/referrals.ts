import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"

/**
 * REFERRING ANOTHER RUGBY CLUB — the platform's own real, DB-enforced referral-reward domain
 * (`platform_referrals`), already live on the web billing surface. Never built for mobile before this
 * screen; this is the mobile-side wiring to the SAME canonical RPCs, not a second referral store.
 *
 * THE PROMISE IS NARROW ON PURPOSE, and this module states it no more generously than the web copy
 * does: a reward is earned only once the referred club's FIRST Ovalball subscription payment is
 * successfully collected -- never a click, a signup, a trial or a mandate. Everything that enforces
 * that lives in the database; nothing here grants credit or claims a reward has been earned.
 */
type Client = SupabaseClient<Database>

export type ReferralStatus = "pending" | "registered" | "qualified" | "rejected" | "reversed"

export interface ClubReferral {
  id: string
  referredClubName: string
  status: ReferralStatus
  rewardAmountPence: number | null
  qualifiedAt: string | null
  createdAt: string
}

export async function readClubReferrals(supabase: Client, clubId: string): Promise<ClubReferral[]> {
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

export async function readClubCreditBalancePence(supabase: Client, clubId: string): Promise<number> {
  const { data, error } = await supabase.rpc("club_credit_balance_pence", { p_club_id: clubId })
  if (error || typeof data !== "number") return 0
  return data
}

export function poundsLabel(pence: number): string {
  return `£${(pence / 100).toFixed(2)}`
}
