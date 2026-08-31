"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type TeamActionResult = { ok: true } | { ok: false; error: string }

export interface UpdateTeamInput {
  teamId: string
  displayName: string
  category: "senior" | "youth"
  ageGroup: string | null
  squadDesignation: string | null
  gender: "mens" | "womens" | "mixed" | null
}

/** teams_update_admin (is_site_admin() or is_club_admin(club_id)) is the real boundary. */
export async function updateTeam(input: UpdateTeamInput): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase
    .from("teams")
    .update({
      display_name: input.displayName,
      category: input.category,
      age_group: input.ageGroup,
      squad_designation: input.squadDesignation,
      gender: input.gender,
    })
    .eq("id", input.teamId)

  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Another team already has this exact category/age group/squad designation." }
    }
    return { ok: false, error: error.message }
  }
  revalidatePath(`/teams/${input.teamId}`)
  revalidatePath("/teams")
  return { ok: true }
}

/**
 * Archive/reactivate, never delete -- fixtures, messages, and past
 * assignments all reference teams.id and must survive (brief: "do NOT
 * hard-delete a team that already has fixtures/messages/assignments/
 * history"). There is no delete UI or action for teams at all; archiving
 * (active=false) is the only "removal" this app offers.
 */
export async function setTeamActive(teamId: string, active: boolean): Promise<TeamActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.from("teams").update({ active }).eq("id", teamId)
  if (error) return { ok: false, error: error.message }
  revalidatePath(`/teams/${teamId}`)
  revalidatePath("/teams")
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
