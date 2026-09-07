"use server"

import { revalidatePath } from "next/cache"

import { sendEmailEvent } from "@/lib/email/send"
import { toPublicAddChildError, toPublicGuardianRequestError, toPublicPlayerAccountInviteError } from "@/lib/errors/public-error"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

export type AddChildResult =
  | { ok: true; result: "created_pending_team" | "created_needs_club_review" | "under_review" | "already_linked"; playerId: string | null; ageGrade: string; schoolYear: number | null }
  | { ok: false; error: string }

/**
 * The Parent-initiated self-service entry point. Every value that matters
 * (age grade, duplicate detection, team routing) is resolved server-side
 * inside add_child_for_guardian -- this action only ever forwards the raw
 * name/DOB/club/rugby_code the Parent typed and returns whatever the RPC
 * decided, never calculating anything itself.
 */
export async function addChild(firstName: string, surname: string, dateOfBirth: string, clubId: string, rugbyCode: string): Promise<AddChildResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("add_child_for_guardian", { p_first_name: firstName, p_surname: surname, p_date_of_birth: dateOfBirth, p_club_id: clubId, p_rugby_code: rugbyCode })
    .single()
  if (error || !data) {
    if (error) console.error("add_child_for_guardian failed:", error)
    return { ok: false, error: error ? toPublicAddChildError(error) : "We couldn't add this child right now. Please sign out and back in, then try again." }
  }

  revalidatePath("/parent/children")
  return {
    ok: true,
    result: data.result as "created_pending_team" | "created_needs_club_review" | "under_review" | "already_linked",
    playerId: data.player_id,
    ageGrade: data.age_grade,
    schoolYear: data.school_year,
  }
}

export type ClubSearchResult = { id: string; name: string; rugbyCode: string }

export async function searchClubs(query: string): Promise<ClubSearchResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const supabase = await createClient()
  const { data } = await supabase.from("clubs").select("id, club_directory!inner(name, rugby_code)").eq("status", "active").ilike("club_directory.name", `%${trimmed}%`).limit(10)
  return (data ?? []).map((c) => ({
    id: c.id,
    name: (c.club_directory as unknown as { name: string; rugby_code: string }).name,
    rugbyCode: (c.club_directory as unknown as { name: string; rugby_code: string }).rugby_code,
  }))
}

export type InvitePlayerAccountResult = { ok: true } | { ok: false; error: string }

export async function invitePlayerAccount(playerId: string, playerFirstName: string, email: string): Promise<InvitePlayerAccountResult> {
  const supabase = await createClient()
  const { data: invitationId, error } = await supabase.rpc("invite_player_account", { p_player_id: playerId, p_email: email })
  if (error || !invitationId) {
    if (error) console.error("invite_player_account failed:", error)
    return { ok: false, error: error ? toPublicPlayerAccountInviteError(error) : "We couldn't send this invitation right now. Please try again." }
  }

  const { data: invitation } = await supabase
    .from("player_account_invitations")
    .select("token")
    .eq("id", invitationId)
    .maybeSingle()
  if (invitation?.token) {
    await sendEmailEvent({
      supabase,
      eventKey: "player_account_invitation",
      idempotencyKey: `player_account_invitation:${invitationId}`,
      recipient: { kind: "player_account_invitation", invitationId },
      data: { playerFirstName, inviteToken: invitation.token },
    })
  }

  revalidatePath("/parent/children")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// The first-child path
// ---------------------------------------------------------------------------

export type RequestChildLinkResult =
  | { ok: true; status: "PENDING" | "ALREADY_LINKED" }
  | { ok: false; error: string }

/**
 * Submitted when a parent has no trusted relationship with the club yet, so
 * add_child_for_guardian's invite-only guard would refuse them -- which, for
 * a brand-new parent, is every time until their first child exists.
 *
 * This creates an APPLICATION, not a relationship. Nothing is granted here:
 * no player is created, no guardian row appears, and the parent sees
 * "Pending verification" until a human with real authority decides.
 *
 * The result is deliberately identical whether or not the server privately
 * matched an existing child. Returning anything richer would let an
 * unverified applicant confirm that a specific child exists in Ovalball by
 * guessing a name and a birthday.
 */
export async function requestChildLink(
  firstName: string,
  surname: string,
  dateOfBirth: string,
  clubId: string,
  rugbyCode: string
): Promise<RequestChildLinkResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("request_child_link", {
      p_first_name: firstName,
      p_surname: surname,
      p_date_of_birth: dateOfBirth,
      p_club_id: clubId,
      p_rugby_code: rugbyCode,
    })
    .single()
  if (error || !data) {
    if (error) console.error("request_child_link failed:", error)
    return { ok: false, error: error ? toPublicAddChildError(error) : "We couldn't submit this request right now. Please try again." }
  }
  revalidatePath("/parent/children")
  return { ok: true, status: data.status === "ALREADY_LINKED" ? "ALREADY_LINKED" : "PENDING" }
}

export type CancelRequestResult = { ok: true } | { ok: false; error: string }

export async function cancelChildLinkRequest(requestId: string): Promise<CancelRequestResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cancel_guardian_link_request", { p_request_id: requestId })
  if (error) {
    console.error("cancel_guardian_link_request failed:", error)
    return { ok: false, error: "We couldn't withdraw this request right now. Please try again." }
  }
  revalidatePath("/parent/children")
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Another parent or guardian
// ---------------------------------------------------------------------------

export type AddGuardianResult =
  | { ok: true; status: "PENDING" | "ALREADY_LINKED" }
  | { ok: false; error: string }

/**
 * Proposes a second adult for a child this guardian already holds. Uses the
 * same controlled model as the first-child path: a PENDING request that
 * grants nothing, approved by an existing guardian or an authorized Club
 * Admin.
 *
 * If the person already has an Ovalball account the request attaches to it,
 * so we never create a second person record for somebody who is already
 * here; if they do not, the row carries their email for the canonical
 * invitation flow.
 */
export async function addAnotherGuardian(playerId: string, email: string): Promise<AddGuardianResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("request_additional_guardian", { p_player_id: playerId, p_email: email }).single()
  if (error || !data) {
    if (error) console.error("request_additional_guardian failed:", error)
    return { ok: false, error: error ? toPublicGuardianRequestError(error) : "We couldn't send this request right now. Please try again." }
  }
  revalidatePath("/parent/children")
  return { ok: true, status: data.status === "ALREADY_LINKED" ? "ALREADY_LINKED" : "PENDING" }
}

// ---------------------------------------------------------------------------
// A child's own picture
// ---------------------------------------------------------------------------

export type SetAvatarResult = { ok: true } | { ok: false; error: string }

/**
 * Uploads a picture into the PRIVATE player-avatars bucket and records the
 * path. The bucket's own policies re-check that this caller may act for this
 * child, so a crafted call cannot write into another child's folder -- the
 * path is derived here from the player id rather than accepted from anyone.
 */
export async function setChildAvatar(playerId: string, file: File): Promise<SetAvatarResult> {
  const supabase = await createClient()
  if (!file || file.size === 0) return { ok: false, error: "Choose a picture to upload." }
  if (file.size > 5 * 1024 * 1024) return { ok: false, error: "That picture is larger than 5MB. Please choose a smaller one." }
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : file.type === "image/jpeg" ? "jpg" : null
  if (!ext) return { ok: false, error: "Pictures must be a PNG, JPEG or WebP image." }

  const path = `${playerId}/avatar-${Date.now()}.${ext}`
  const { error: uploadError } = await supabase.storage.from("player-avatars").upload(path, file, { contentType: file.type, upsert: true })
  if (uploadError) {
    console.error("player avatar upload failed:", uploadError)
    return { ok: false, error: "We couldn't upload that picture. Please try again." }
  }
  const { error } = await supabase.rpc("set_player_avatar", { p_player_id: playerId, p_storage_path: path })
  if (error) {
    console.error("set_player_avatar failed:", error)
    return { ok: false, error: "We couldn't save that picture. Please try again." }
  }
  revalidatePath("/parent/children")
  return { ok: true }
}

export async function removeChildAvatar(playerId: string): Promise<SetAvatarResult> {
  const supabase = await createClient()
  // The RPC treats an empty string as "no picture" (it nullifies blanks),
  // which keeps the generated non-null parameter type honest.
  const { error } = await supabase.rpc("set_player_avatar", { p_player_id: playerId, p_storage_path: "" })
  if (error) {
    console.error("set_player_avatar (clear) failed:", error)
    return { ok: false, error: "We couldn't remove that picture. Please try again." }
  }
  revalidatePath("/parent/children")
  return { ok: true }
}
