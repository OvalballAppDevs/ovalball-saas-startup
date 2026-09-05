"use server"

import { revalidatePath } from "next/cache"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { toPublicAddChildError, toPublicPlayerAccountInviteError } from "@/lib/errors/public-error"
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

  const { data: invitation } = await supabase.from("player_account_invitations").select("token").eq("id", invitationId).maybeSingle()
  if (invitation?.token) {
    const siteUrl = getSiteUrl()
    await dispatchEmailEvent({
      type: "player_account_invitation",
      to: email,
      data: { playerFirstName, inviteLink: `${siteUrl}/player-invite/${invitation.token}` },
    })
  }

  revalidatePath("/parent/children")
  return { ok: true }
}
