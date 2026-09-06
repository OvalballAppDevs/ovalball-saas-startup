"use server"

import { revalidatePath } from "next/cache"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

export type ActionResult = { ok: true } | { ok: false; error: string }

/**
 * The authoritative dispatch context for one officer assignment.
 *
 * EVERY outbound safeguarding email destination is resolved here, from the
 * assignment row, and never from an argument. The browser may say which
 * assignment to act on -- it may not say where the resulting email goes,
 * what the club is called, or who is sending. Those were previously
 * parameters, which made "email an invitation token or an arbitrary message
 * body to an address of my choosing" a property of the endpoint rather than
 * of the data.
 *
 * The read runs under the caller's own session, so RLS on
 * club_safeguarding_officers decides whether they may see this assignment
 * at all. That is the boundary; the RPCs below re-check their own
 * capability on top of it.
 */
async function resolveOfficerDispatch(officerId: string) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false as const, error: "You must be signed in." }

  const { data: officer, error: officerError } = await supabase
    .from("club_safeguarding_officers")
    .select("id, club_id, contact_email, contact_name, status, user_id")
    .eq("id", officerId)
    .maybeSingle()

  if (officerError) {
    console.error("resolveOfficerDispatch officer read failed:", officerError.message)
    return { ok: false as const, error: "That Safeguarding Officer record could not be read." }
  }
  if (!officer) return { ok: false as const, error: "That Safeguarding Officer record could not be found." }

  // Club name resolved separately rather than as a nested embed: the embed
  // depends on PostgREST relationship detection across two hops and on RLS
  // for both, and a failure there is indistinguishable from "no such
  // officer". A plain second read fails loudly for its own reason.
  const { data: club } = await supabase
    .from("clubs")
    .select("slug, club_directory(name)")
    .eq("id", officer.club_id)
    .maybeSingle()
  const clubName = club?.club_directory?.name ?? club?.slug ?? "your club"

  const { data: profile } = await supabase
    .from("profiles")
    .select("first_name, surname")
    .eq("id", user.id)
    .maybeSingle()
  const senderName = [profile?.first_name, profile?.surname].filter(Boolean).join(" ") || "A club administrator"

  return {
    ok: true as const,
    supabase,
    clubId: officer.club_id,
    clubName,
    contactEmail: officer.contact_email,
    senderName,
  }
}

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
export async function inviteSafeguardingOfficer(officerId: string): Promise<{ ok: true; inviteLink: string } | { ok: false; error: string }> {
  const ctx = await resolveOfficerDispatch(officerId)
  if (!ctx.ok) return ctx

  const { data, error } = await ctx.supabase.rpc("invite_safeguarding_officer", { p_officer_id: officerId }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the invitation." }

  const inviteLink = `${getSiteUrl()}/invite/safeguarding-officer/${data.token}`
  await dispatchEmailEvent({
    type: "safeguarding_officer_invitation",
    to: ctx.contactEmail,
    data: { clubName: ctx.clubName, inviteLink },
  })

  revalidatePath("/club/settings/safeguarding")
  return { ok: true, inviteLink }
}

export async function resendSafeguardingOfficerInvitation(officerId: string): Promise<{ ok: true; inviteLink: string } | { ok: false; error: string }> {
  const ctx = await resolveOfficerDispatch(officerId)
  if (!ctx.ok) return ctx

  const { data, error } = await ctx.supabase.rpc("resend_safeguarding_officer_invitation", { p_officer_id: officerId }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not resend the invitation." }

  const inviteLink = `${getSiteUrl()}/invite/safeguarding-officer/${data.token}`
  await dispatchEmailEvent({
    type: "safeguarding_officer_invitation",
    to: ctx.contactEmail,
    data: { clubName: ctx.clubName, inviteLink },
  })

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

export async function messageSafeguardingOfficer(officerId: string, body: string): Promise<MessageOfficerResult> {
  if (!body.trim()) return { ok: false, error: "Write a message first." }

  const ctx = await resolveOfficerDispatch(officerId)
  if (!ctx.ok) return ctx

  const { data, error } = await ctx.supabase
    .rpc("start_or_get_safeguarding_officer_conversation", {
      p_club_id: ctx.clubId,
      p_officer_id: officerId,
      p_first_message: body,
    })
    .single()

  if (!error && data) {
    revalidatePath("/club/settings/safeguarding")
    return { ok: true, mode: "ovalball", conversationId: data.conversation_id }
  }

  // ONLY 22023 means "this club has no active, registered officer to message
  // on Ovalball" -- the one condition the email fallback exists for.
  //
  // Every other error, 42501 above all, means the caller had no business
  // here. Treating them alike is what made this an open relay: an
  // unauthorized caller got a refusal from the database, the refusal was
  // swallowed, and the server then emailed their text to an address they
  // chose and told them it had worked. Now a refusal is returned as a
  // refusal, and the fallback destination is the assignment's own recorded
  // contact, resolved server-side.
  if (error && error.code !== "22023") {
    return { ok: false, error: "You are not authorized to message this club's Safeguarding Officer." }
  }

  await dispatchEmailEvent({
    type: "safeguarding_officer_message",
    to: ctx.contactEmail,
    data: { clubName: ctx.clubName, senderName: ctx.senderName, body },
  })
  return { ok: true, mode: "email" }
}

export async function sendSafeguardingOfficerMessage(conversationId: string, body: string): Promise<ActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("send_safeguarding_officer_message", { p_conversation_id: conversationId, p_body: body })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/club/settings/safeguarding/messages/${conversationId}`)
  return { ok: true }
}
