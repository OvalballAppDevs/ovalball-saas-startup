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
 * Assigns (or re-assigns) an existing club member to this team with a
 * chosen permission -- upsert on (membership_id, team_id), so picking a
 * different permission for someone already on the team just changes it
 * rather than erroring or duplicating. team_permissions_insert_scoped /
 * update_scoped (is_site_admin() or is_club_admin) are the real boundary;
 * this never creates a new person/account, only a relationship between two
 * that already exist.
 */
export type AssignTeamMemberResult = { ok: true; teamPermissionId: string } | { ok: false; error: string }

export async function assignTeamMember(
  teamId: string,
  membershipId: string,
  permission: "team_admin" | "coach" | "manager" | "view_only"
): Promise<AssignTeamMemberResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in." }

  const { data, error } = await supabase
    .from("team_permissions")
    .upsert(
      { membership_id: membershipId, team_id: teamId, permission, created_by: user.id },
      { onConflict: "membership_id,team_id" }
    )
    .select("id")
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not assign." }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true, teamPermissionId: data.id }
}

/** team_permissions_delete_scoped (added this pass) is the real boundary. */
export async function removeTeamMember(teamId: string, teamPermissionId: string): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("team_permissions").delete().eq("id", teamPermissionId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/people")
  return { ok: true }
}
