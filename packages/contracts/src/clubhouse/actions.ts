import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * CLUBHOUSE NETWORK ACTIONS — thin wrappers around the EXISTING canonical partnership/invitation
 * domain (`club_partnerships`, `club_ovalball_invitations`), not a second implementation. Every check
 * here is the database's own -- `club_partnerships_insert_scoped` RLS for requesting, the
 * `respond_to_club_partnership`/`revoke_club_partnership`/`create_partner_invitation` RPCs for
 * everything else, exactly as `app/(app)/partner-clubs/actions.ts` already called them. Moved here so
 * mobile can call the SAME operations rather than only being able to view their result (the
 * architecture audit's own finding: Partner Clubs had zero mobile write path before this).
 */

export type PartnershipActionResult = { ok: true } | { ok: false; error: string }

/**
 * request_club_partnership (20270743000000) is the one door, for the website and the app alike: it checks the
 * caller manages the asking club, and always writes a PENDING request from the person asking -- only the other
 * club can make it active. (The table no longer takes a direct insert: one let a Club Admin write an ACTIVE
 * partnership with any club.) A duplicate pending/active relationship comes back as the server's own sentence.
 */
export async function requestPartnership(supabase: Client, viewerClubId: string, partnerClubId: string): Promise<PartnershipActionResult> {
  const { error } = await supabase.rpc("request_club_partnership", {
    p_requesting_club_id: viewerClubId,
    p_partner_club_id: partnerClubId,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** respond_to_club_partnership re-checks that the caller manages the INVITED (partner) side itself. */
export async function respondToPartnership(supabase: Client, partnershipId: string, approve: boolean): Promise<PartnershipActionResult> {
  const { error } = await supabase.rpc("respond_to_club_partnership", { p_partnership_id: partnershipId, p_approve: approve })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/** Either side may revoke -- also how a requester cancels their own still-pending outgoing request. */
export async function revokePartnership(supabase: Client, partnershipId: string): Promise<PartnershipActionResult> {
  const { error } = await supabase.rpc("revoke_club_partnership", { p_partnership_id: partnershipId })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

export type InviteClubResult = { ok: true; invitationId: string; inviteLink: string } | { ok: false; error: string }

/**
 * create_partner_invitation is the real authorization/validation boundary (an already-claimed club is
 * refused server-side, not just hidden client-side; the contact name/email are the RPC's own existing
 * required fields, unchanged here). Returns the invite link directly -- reconciliation into a real
 * club_partnerships row happens entirely inside approve_club_claim if/when that directory club is
 * actually claimed, keyed on directory id alone, so no token needs to travel through the signup wizard.
 * Sending an email (web) or opening a native share sheet (mobile) is each caller's own concern, layered
 * on top of this one shared RPC call -- never a second invitation store.
 */
export async function inviteClubToOvalball(
  supabase: Client,
  siteUrl: string,
  viewerClubId: string,
  clubDirectoryId: string,
  contactName: string,
  contactEmail: string
): Promise<InviteClubResult> {
  const { data: invitationId, error } = await supabase.rpc("create_partner_invitation", {
    p_inviting_club_id: viewerClubId,
    p_club_directory_id: clubDirectoryId,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
  })
  if (error) return { ok: false, error: error.message }
  return { ok: true, invitationId: invitationId as string, inviteLink: `${siteUrl}/signup?directory=${clubDirectoryId}` }
}
