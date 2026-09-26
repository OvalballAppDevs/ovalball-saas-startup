import type { SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "@ovalball/contracts"
import { type ClaimableRole } from "@ovalball/contracts/clubhouse"

export { CLAIMABLE_ROLES, type ClaimableRole } from "@ovalball/contracts/clubhouse"

type Client = SupabaseClient<Database>

/**
 * SECTION 14 (CLUBHOUSE): "Claim This Club", mobile -- reproduces the website's own
 * `claim-actions.ts` exactly, no service role. submit_club_claim itself checks only that the caller
 * is signed in with a usable session; it is deliberately never gated on club.partners.manage or any
 * other pre-existing authority, because claiming is how someone GETS authority over a club.
 */
export type SubmitClubClaimResult = { ok: true; claimId: string } | { ok: false; error: string }

export async function submitClubClaim(supabase: Client, directoryId: string, claimedRole: ClaimableRole, authorityDeclaration: string): Promise<SubmitClubClaimResult> {
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
  return { ok: true, claimId: data }
}
