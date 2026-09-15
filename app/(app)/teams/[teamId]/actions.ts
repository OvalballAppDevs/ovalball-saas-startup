"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type TeamActionResult = { ok: true } | { ok: false; error: string }

/**
 * Section 23-25: a team's canonical age/category/gender/squad identity is
 * no longer editable from this page at all (the old updateTeam() + the
 * "Which team is this?" radio-grid it drove have been removed entirely --
 * that identity now only ever changes through Season Rollover). What
 * remains editable here is purely a club-specific DISPLAY alias for a B/C
 * squad (Section 26-30) -- set_team_alias/clear_team_alias are the real
 * boundary (club.teams.manage or site.team_catalogue.manage), and never
 * touch category/age_group/gender/squad_designation themselves.
 */
export async function setTeamAlias(teamId: string, alias: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_team_alias", { p_team_id: teamId, p_alias: alias })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
  revalidatePath("/calendar")
  return { ok: true }
}

export async function clearTeamAlias(teamId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("clear_team_alias", { p_team_id: teamId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
  revalidatePath("/calendar")
  return { ok: true }
}

/**
 * Fold/reactivate, never delete -- fixtures, messages, and past
 * assignments all reference teams.id and must survive. fold_team() is the
 * real boundary: it requires a reason, cancels every future active
 * fixture the team owns (retaining the record), notifies real activated
 * opponents, and writes a full audit_log entry -- a plain active=false
 * toggle would silently leave those consequences undone.
 */
export type FoldTeamResult = { ok: true; fixturesAffected: number } | { ok: false; error: string }

export async function foldTeam(teamId: string, reason: string): Promise<FoldTeamResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("fold_team", { p_team_id: teamId, p_reason: reason })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
  revalidatePath("/calendar")
  revalidatePath("/admin/fixtures")
  return { ok: true, fixturesAffected: data ?? 0 }
}

export async function reactivateTeam(teamId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reactivate_team", { p_team_id: teamId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
  return { ok: true }
}

/**
 * A real activated opponent gets a fresh, reviewable fixture_request
 * (never a silent reinstatement); an external/unresolved opponent
 * restores directly since there is nobody in-app to approve. Either way
 * request_fixture_restoration() runs a real conflict check first.
 */
export async function requestFixtureRestoration(teamId: string, fixtureId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("request_fixture_restoration", { p_fixture_id: fixtureId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/calendar")
  revalidatePath("/admin/fixtures")
  return { ok: true }
}

/**
 * Assigns (or re-assigns) an existing club member to this team. A different
 * choice for someone already on the team replaces what they had rather than
 * adding to it. set_team_access is the boundary (this club's Club Admin or a
 * Full Site Admin); it never creates a person, only gives an existing member
 * a team role.
 */
export type AssignTeamMemberResult = { ok: true; teamPermissionId: string } | { ok: false; error: string }

export async function assignTeamMember(
  teamId: string,
  membershipId: string,
  permission: "team_admin" | "coach" | "manager"
): Promise<AssignTeamMemberResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_team_access", {
    p_membership_id: membershipId,
    p_team_id: teamId,
    p_permission: permission,
  })
  if (error || !data) return { ok: false, error: error?.message ?? "Could not assign." }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true, teamPermissionId: data }
}

/** remove_team_access is the boundary: it ends the person's roles on this team. */
export async function removeTeamMember(teamId: string, teamPermissionId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_team_access", { p_team_permission_id: teamPermissionId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true }
}

/**
 * TEAM ROSTER
 *
 * A player who has stopped playing is archived, never removed: fixtures,
 * attendance and selection history all reference the membership row, and a
 * player who stopped in March still played in February.
 * archive_player_team_membership/restore_player_team_membership check
 * team.manage on THIS team (or club.teams.manage on its club), so a coach
 * assigned to the team can keep their own roster straight without holding a
 * club-wide role.
 */
export async function archivePlayerMembership(teamId: string, membershipId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("archive_player_team_membership", { p_membership_id: membershipId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true }
}

export async function restorePlayerMembership(teamId: string, membershipId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("restore_player_team_membership", { p_membership_id: membershipId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true }
}

/**
 * Requests to join this team. approve_pending_team_membership and
 * reject_pending_team_membership already existed as the real decision
 * boundary -- they simply had no team-facing entry point, so a coach had
 * nowhere to see that somebody was waiting.
 */
export async function approveTeamJoinRequest(teamId: string, membershipId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("approve_pending_team_membership", { p_membership_id: membershipId })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true }
}

export async function declineTeamJoinRequest(teamId: string, membershipId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("reject_pending_team_membership", {
    p_membership_id: membershipId,
    p_reason: "Declined from Team People.",
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true }
}
