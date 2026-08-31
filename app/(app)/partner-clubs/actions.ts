"use server"

import { revalidatePath } from "next/cache"

import { getSessionContext, manageableClubId } from "@/lib/app-context/session-context"
import { createClient } from "@/lib/supabase/server"

export type PartnershipActionResult = { ok: true } | { ok: false; error: string }

/**
 * club_partnerships_insert_scoped (can_manage_club_fixtures) is the real
 * authorization boundary -- this only resolves the caller's own club id and
 * forwards the insert. The unique partial index
 * (club_partnerships_unique_active_pair_idx) is what actually prevents a
 * duplicate pending/active relationship with the same club; its violation
 * is turned into a plain-language error rather than a raw constraint name.
 */
export async function requestPartnership(partnerClubId: string): Promise<PartnershipActionResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const ctx = await getSessionContext(supabase, user)
  const clubId = manageableClubId(ctx)
  if (!clubId) return { ok: false, error: "You don't have fixture authority at a club." }

  const { error } = await supabase.from("club_partnerships").insert({
    requesting_club_id: clubId,
    partner_club_id: partnerClubId,
    requested_by: user.id,
  })

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "You already have a pending or active relationship with this club." }
    }
    return { ok: false, error: error.message }
  }
  revalidatePath("/partner-clubs")
  return { ok: true }
}

/**
 * respond_to_club_partnership re-checks that the caller manages the
 * INVITED (partner) side itself -- the receiving club, never the
 * requester, may approve or decline.
 */
export async function respondToPartnership(partnershipId: string, approve: boolean): Promise<PartnershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("respond_to_club_partnership", {
    p_partnership_id: partnershipId,
    p_approve: approve,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/partner-clubs")
  return { ok: true }
}

/**
 * Revokes from either side -- also how a requester cancels their own
 * still-pending request, since revoke_club_partnership accepts any
 * non-revoked status from either party.
 */
export async function revokePartnership(partnershipId: string): Promise<PartnershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_club_partnership", { p_partnership_id: partnershipId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/partner-clubs")
  return { ok: true }
}
