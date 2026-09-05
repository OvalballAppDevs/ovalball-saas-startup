"use server"

import { revalidatePath } from "next/cache"

import { dispatchEmailEvent } from "@/lib/email/dispatch"
import { createClient } from "@/lib/supabase/server"
import { getSiteUrl } from "@/lib/site-url"

export type RemoveGuardianResult = { ok: true; orphaned: boolean } | { ok: false; error: string }

/**
 * Club Admin only (remove_guardian_relationship's own boundary is
 * club.guardians.manage -- never granted to Team staff). A reason is
 * mandatory server-side too; this never lets the UI skip it. `orphaned`
 * tells the caller whether this removal left the player with zero active
 * guardians, so the UI can surface a high-impact safeguarding warning --
 * the player is already fail-closed (guardian_permission_effective denies
 * everything with zero guardians) regardless of whether the warning is shown.
 */
export async function removeGuardian(guardianId: string, reason: string): Promise<RemoveGuardianResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("remove_guardian_relationship", { p_guardian_id: guardianId, p_reason: reason }).single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not remove this guardian." }
  revalidatePath("/club/settings/guardians")
  return { ok: true, orphaned: data.orphaned }
}

export type ReplacementInviteResult = { ok: true; inviteLink: string } | { ok: false; error: string }

/**
 * Replacement is via invitation, never a direct attach --
 * send_replacement_guardian_invitation() marks the invitation as bound to
 * this exact existing player (replacement_for_player_id), so the
 * acceptance flow links the accepting Guardian to THIS player rather than
 * creating a new one.
 */
export async function sendReplacementGuardianInvite(
  playerId: string,
  teamId: string,
  clubName: string,
  teamName: string,
  email: string
): Promise<ReplacementInviteResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("send_replacement_guardian_invitation", { p_player_id: playerId, p_team_id: teamId, p_invited_email: email.trim() })
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the invitation." }

  const siteUrl = getSiteUrl()
  const inviteLink = `${siteUrl}/guardian-invite/${data.token}`

  await dispatchEmailEvent({
    type: "guardian_invitation",
    to: email,
    data: { clubName, teamName, inviteLink },
  })

  revalidatePath("/club/settings/guardians")
  return { ok: true, inviteLink }
}

export type ResolveDuplicateResult = { ok: true } | { ok: false; error: string }

export async function resolveDuplicateAsExisting(reviewId: string): Promise<ResolveDuplicateResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolve_player_duplicate_review_as_existing", { p_review_id: reviewId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/guardians")
  return { ok: true }
}

export async function resolveDuplicateAsNew(reviewId: string): Promise<ResolveDuplicateResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolve_player_duplicate_review_as_new", { p_review_id: reviewId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/guardians")
  return { ok: true }
}

export type PendingMembershipActionResult = { ok: true } | { ok: false; error: string }

/**
 * Approving a self-service Add-a-Child join -- authorization is enforced
 * server-side by approve_pending_team_membership itself (team.roster.manage
 * / club.roster.manage), never by this page merely being reachable.
 */
export async function approvePendingTeamMembership(membershipId: string): Promise<PendingMembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_pending_team_membership", { p_membership_id: membershipId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/guardians")
  return { ok: true }
}

export async function rejectPendingTeamMembership(membershipId: string, reason: string): Promise<PendingMembershipActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reject_pending_team_membership", { p_membership_id: membershipId, p_reason: reason })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/settings/guardians")
  return { ok: true }
}
