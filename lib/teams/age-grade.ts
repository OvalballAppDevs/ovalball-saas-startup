import type { SupabaseClient } from "@supabase/supabase-js"

import type { AgeGradeStatus } from "@ovalball/contracts/team/age-grade"

import type { Database } from "@/types/database.types"

/**
 * CONVERGENCE STEP 12 -- the age-grade answer, read where the job is.
 *
 * The canonical resolvers have carried this answer since the regulatory work landed; what was
 * missing was anybody asking. Both readers return a STATUS and a SENTENCE and never a date of
 * birth, an age or anything medical: a coach's job needs to know that something needs attention,
 * not the evidence behind it.
 */

// One vocabulary for both apps: the phone reads the same words from the shared contract.
export { AGE_GRADE_STATUS_LABEL, ageGradeStatusLabel } from "@ovalball/contracts/team/age-grade"
export type { AgeGradeStatus } from "@ovalball/contracts/team/age-grade"

export interface TeamAgeGradeAttention {
  playerId: string
  displayName: string
  status: AgeGradeStatus
  detail: string
}

export interface MyPlayerAgeGradeStatus {
  teamId: string
  teamName: string
  status: AgeGradeStatus
  detail: string
}

/**
 * Staff-facing. Returns only the players who need attention, so an ordinary week is an empty list
 * rather than a roster to read through. An unauthorised viewer gets an error from the server, which
 * is absence here: the section simply does not render.
 */
export async function loadTeamAgeGradeAttention(
  supabase: SupabaseClient<Database>,
  teamId: string
): Promise<TeamAgeGradeAttention[]> {
  const { data, error } = await supabase.rpc("team_age_grade_attention", { p_team_id: teamId })
  if (error || !data) return []
  return data.map((r) => ({
    playerId: r.player_id,
    displayName: r.display_name ?? "",
    status: r.status as AgeGradeStatus,
    detail: r.detail,
  }))
}

/** Family-facing: this viewer's own player, across the teams that player is actually in. */
export async function loadMyPlayerAgeGradeStatus(
  supabase: SupabaseClient<Database>,
  playerId: string
): Promise<MyPlayerAgeGradeStatus[]> {
  const { data, error } = await supabase.rpc("my_player_age_grade_status", { p_player_id: playerId })
  if (error || !data) return []
  return data.map((r) => ({
    teamId: r.team_id,
    teamName: r.team_name ?? "",
    status: r.status as AgeGradeStatus,
    detail: r.detail,
  }))
}
