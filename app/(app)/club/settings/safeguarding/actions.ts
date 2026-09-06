"use server"

import { revalidatePath } from "next/cache"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * Creates the CONTACT record only -- RLS/RPC (nominate_safeguarding_officer,
 * gated on club.safeguarding.manage_contact) is the real boundary. Grants
 * nothing by itself: status starts 'not_invited' (spec section 5/8).
 */
export async function nominateSafeguardingOfficer(
  clubId: string,
  officerType: "primary" | "deputy",
  contactName: string,
  contactEmail: string
): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("nominate_safeguarding_officer", {
    p_club_id: clubId,
    p_officer_type: officerType,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/safeguarding")
  return { ok: true }
}

export async function updateSafeguardingOfficerContact(officerId: string, contactName: string, contactEmail: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("update_safeguarding_officer_contact", {
    p_officer_id: officerId,
    p_contact_name: contactName,
    p_contact_email: contactEmail,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/safeguarding")
  return { ok: true }
}

/**
 * The row itself never grants access -- accept_safeguarding_officer_
 * invitation() (called from /invite/safeguarding-officer/[token]) is the
 * only path from here to a real, authorized officer, and it requires the
 * recipient's own authenticated session email to match. No real email is
 * sent this session (lib/email/dispatch.ts is a dev no-op everywhere in
 * this app) -- the invite link is also returned directly for the inviter
 * to share by hand.
 */
export async function inviteSafeguardingOfficer(officerId: string, clubName: string, contactEmail: string): Promise<{ ok: true; inviteLink: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("invite_safeguarding_officer", { p_officer_id: officerId }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the invitation." }

  const inviteLink = `${getSiteUrl()}/invite/safeguarding-officer/${data.token}`
  await dispatchEmailEvent({ type: "safeguarding_officer_invitation", to: contactEmail, data: { clubName, inviteLink } })

  revalidatePath("/club/settings/safeguarding")
  return { ok: true, inviteLink }
}

export async function resendSafeguardingOfficerInvitation(officerId: string, clubName: string, contactEmail: string): Promise<{ ok: true; inviteLink: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("resend_safeguarding_officer_invitation", { p_officer_id: officerId }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not resend the invitation." }

  const inviteLink = `${getSiteUrl()}/invite/safeguarding-officer/${data.token}`
  await dispatchEmailEvent({ type: "safeguarding_officer_invitation", to: contactEmail, data: { clubName, inviteLink } })

  revalidatePath("/club/settings/safeguarding")
  return { ok: true, inviteLink }
}

export async function revokeSafeguardingOfficerInvitation(invitationId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("revoke_safeguarding_officer_invitation", { p_invitation_id: invitationId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/safeguarding")
  return { ok: true }
}

export async function deactivateSafeguardingOfficer(officerId: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("deactivate_safeguarding_officer", { p_officer_id: officerId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/safeguarding")
  return { ok: true }
}

/**
 * "Message Safeguarding Officer" (spec section 14/15): if the officer is
 * an active, registered Ovalball user, opens/creates the canonical
 * conversation and returns its id for the caller to navigate to. If not
 * (pending/never invited), falls back to the canonical email dispatcher --
 * the UI must clearly say a real Ovalball conversation was NOT created in
 * that case (spec section 15's own explicit instruction).
 */
export type MessageOfficerResult =
  | { ok: true; mode: "ovalball"; conversationId: string }
  | { ok: true; mode: "email" }
  | { ok: false; error: string }

export async function messageSafeguardingOfficer(
  clubId: string,
  officerId: string,
  clubName: string,
  senderName: string,
  officerContactEmail: string,
  body: string
): Promise<MessageOfficerResult> {
  const supabase = await createClient()

  const { data, error } = await supabase
    .rpc("start_or_get_safeguarding_officer_conversation", { p_club_id: clubId, p_officer_id: officerId, p_first_message: body })
    .single()

  if (!error && data) {
    revalidatePath("/club/settings/safeguarding")
    return { ok: true, mode: "ovalball", conversationId: data.conversation_id }
  }

  // Officer is not an active registered user yet (or any other resolver
  // rejection) -- email fallback. This does not pretend an Ovalball
  // conversation exists (spec section 15).
  await dispatchEmailEvent({ type: "safeguarding_officer_message", to: officerContactEmail, data: { clubName, senderName, body } })
  return { ok: true, mode: "email" }
}

export async function sendSafeguardingOfficerMessage(conversationId: string, body: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("send_safeguarding_officer_message", { p_conversation_id: conversationId, p_body: body })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/club/settings/safeguarding/messages/${conversationId}`)
  return { ok: true }
}
