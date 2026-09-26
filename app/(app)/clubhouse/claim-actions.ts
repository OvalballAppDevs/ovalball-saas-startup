"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

import { type ClaimableRole } from "@ovalball/contracts/clubhouse"

export type SubmitClubClaimResult = { ok: true; claimId: string } | { ok: false; error: string }

/**
 * SECTION 14 (CLUBHOUSE): submit_club_claim (SECURITY DEFINER) does all the real work -- the rate
 * limit (3 claims/day), the one-live-claim-per-person-per-club uniqueness, recording whether the club
 * already has an active Club Admin, and the security-event audit trail. This action only forwards the
 * call and translates the one error a genuine re-submission produces into a readable sentence, exactly
 * like every other RPC wrapper in this codebase -- the RPC's own refusal remains the real boundary.
 *
 * DELIBERATELY NOT A ONE-TAP ACTION: claimedRole must be one of the database's own eligible-role
 * allow-list and authorityDeclaration is a real, non-trivial written statement -- both required before
 * this is ever called, per the standing "do not make claiming a casual one-tap action" instruction.
 * A claimed role grants nothing by itself; it is only ever a suggestion to whoever reviews the claim.
 */
export async function submitClubClaim(directoryId: string, claimedRole: ClaimableRole, authorityDeclaration: string): Promise<SubmitClubClaimResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("submit_club_claim", {
    p_directory_id: directoryId,
    p_claimed_role: claimedRole,
    p_authority_declaration: authorityDeclaration.trim(),
  })
  if (error || !data) {
    if (error?.code === "23505") {
      return { ok: false, error: "You already have an open claim on this club. A Site Admin will review it." }
    }
    return { ok: false, error: error?.message ?? "Could not submit this claim." }
  }
  revalidatePath("/clubhouse")
  return { ok: true, claimId: data }
}
