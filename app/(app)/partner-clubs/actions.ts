"use server"

import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"

import { ACTIVE_CONTEXT_COOKIE, activeManageableClubId, resolveActiveContext } from "@/lib/app-context/active-context"
import { getSessionContext } from "@/lib/app-context/session-context"
import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

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
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? manageableClubId(ctx)` fallback -- a partnership request/action
  // must be submitted AS the club the caller is actually acting through,
  // never whichever club-wide authority happens to be first in their
  // session. See app/(app)/people/page.tsx for the identical leak class.
  const clubId = activeManageableClubId(ctx, activeContext)
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


export type InviteClubResult = { ok: true; inviteLink: string } | { ok: false; error: string }

/**
 * Invites a club that isn't on Ovalball yet -- create_partner_invitation
 * is the real authorization/validation boundary (already-claimed clubs are
 * refused server-side, not just hidden client-side). The email goes
 * through dispatchEmailEvent, the same call every other transactional
 * email in this app already uses -- but that function is itself a dev
 * no-op this session (see lib/email/dispatch.ts: no provider is
 * configured, and it never sent to the local Supabase/Mailpit SMTP path
 * either -- that's a separate pipe Supabase Auth's own magic-link emails
 * use internally). Matching the exact same precedent
 * app/(app)/admin/site-admins/actions.ts's inviteSiteAdmin already
 * established for this identical limitation, the real link is returned
 * directly in the result so it can be used/verified without depending on
 * a real send. The link points at the ordinary /signup flow;
 * reconciliation into a real club_partnerships row happens entirely
 * inside approve_club_claim once (and only if) that directory club is
 * actually claimed, keyed on directory id alone -- this action never
 * needs to thread the token through the signup wizard for reconciliation
 * to work correctly.
 */
export async function inviteClubToOvalball(clubDirectoryId: string, contactName: string, contactEmail: string): Promise<InviteClubResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const ctx = await getSessionContext(supabase, user)
  const cookieStore = await cookies()
  const activeContext = resolveActiveContext(ctx, cookieStore.get(ACTIVE_CONTEXT_COOKIE)?.value ?? null)
  // No `?? manageableClubId(ctx)` fallback -- a partnership request/action
  // must be submitted AS the club the caller is actually acting through,
  // never whichever club-wide authority happens to be first in their
  // session. See app/(app)/people/page.tsx for the identical leak class.
  const clubId = activeManageableClubId(ctx, activeContext)
  if (!clubId) return { ok: false, error: "You don't have fixture authority at a club." }

  const { data: inviterClub } = await supabase.from("clubs").select("club_directory(name)").eq("id", clubId).maybeSingle()
  const { data: invitedDirectory } = await supabase.from("club_directory").select("name").eq("id", clubDirectoryId).maybeSingle()
  const invitingClubName = inviterClub?.club_directory?.name ?? "A club on Ovalball"
  const invitedClubName = invitedDirectory?.name ?? "your club"

  const { error } = await supabase.rpc("create_partner_invitation", {
    p_inviting_club_id: clubId,
    p_club_directory_id: clubDirectoryId,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
  })
  if (error) return { ok: false, error: error.message }

  const inviteLink = `${getSiteUrl()}/signup?directory=${clubDirectoryId}`

  await dispatchEmailEvent({
    type: "partner_club_invitation",
    to: contactEmail,
    data: { invitingClubName, invitedClubName, inviteLink },
  })

  // Deliberately no revalidatePath here: the map/list never render
  // invitation state (an invited club still shows "not yet on Ovalball"
  // until it's actually claimed), so refreshing the page would only
  // destroy this popup's dialog mid-render -- unmounting it before the
  // caller can see the invite link this action just returned.
  return { ok: true, inviteLink }
}
