"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type RolloverActionResult = { ok: true } | { ok: false; error: string }

/** generate_rollover_proposal is read-only against real teams -- it only ever writes to the two proposal tables, never mutates a team. */
export async function generateRolloverProposal(clubId: string, rugbyCode: "union" | "league", toSeasonId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("generate_rollover_proposal", {
    p_club_id: clubId,
    p_rugby_code: rugbyCode,
    p_to_season_id: toSeasonId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

export type RolloverProposalAction = "confirm" | "adjust" | "fold" | "defer" | "graduate"

/** confirm_rollover_team_proposal is the ONLY path that mutates a real team's age_group -- nothing becomes canonical until this is called. */
export async function confirmRolloverTeamProposal(
  proposalId: string,
  action: RolloverProposalAction,
  ageGroup: string | null,
  squadDesignation: string | null,
  foldReason: string | null,
  gender: "boys" | "girls" | null = null
): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("confirm_rollover_team_proposal", {
    p_proposal_id: proposalId,
    p_action: action,
    p_age_group: ageGroup ?? undefined,
    p_squad_designation: squadDesignation ?? undefined,
    p_fold_reason: foldReason ?? undefined,
    p_gender: gender ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  revalidatePath("/teams")
  return { ok: true }
}

export type ConfirmMixedBoundaryResult = { ok: true; boysTeamId: string; girlsTeamId: string | null } | { ok: false; error: string }

/**
 * confirm_mixed_boundary_rollover is the ONLY path that resolves a U11
 * Mixed -> U12 structural transition. p_createGirlsTeam has no default on
 * either side of this call -- the UI must not be able to submit without an
 * explicit choice.
 */
export async function confirmMixedBoundaryRollover(
  proposalId: string,
  createGirlsTeam: boolean,
  boysSquadDesignation: string | null,
  girlsSquadDesignation: string | null
): Promise<ConfirmMixedBoundaryResult> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .rpc("confirm_mixed_boundary_rollover", {
      p_proposal_id: proposalId,
      p_create_girls_team: createGirlsTeam,
      p_boys_squad_designation: boysSquadDesignation ?? undefined,
      p_girls_squad_designation: girlsSquadDesignation ?? undefined,
    })
    .single()
  if (error || !data) return { ok: false, error: error?.message ?? "Could not confirm this rollover." }
  revalidatePath("/club/rollover")
  revalidatePath("/teams")
  return { ok: true, boysTeamId: data.boys_team_id, girlsTeamId: data.girls_team_id }
}

export async function resolveRolloverGroupFlag(flagId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("resolve_rollover_group_flag", { p_flag_id: flagId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

export type GraduationActionResult = { ok: true } | { ok: false; error: string }

/**
 * place_graduating_player enforces the real governing-body-approval
 * gate server-side (Section 28) -- an under-18 placement onto a senior
 * team without an approved dispensation on file fails here with a
 * specific, actionable error, which the UI surfaces verbatim rather
 * than a generic failure message.
 */
export async function placeGraduatingPlayer(queueId: string, targetTeamId: string): Promise<GraduationActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("place_graduating_player", { p_queue_id: queueId, p_target_team_id: targetTeamId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

export async function markGraduatingPlayerLeft(queueId: string): Promise<GraduationActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("mark_graduating_player_left", { p_queue_id: queueId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

export type CreateNextSeasonGroupResult = { ok: true; newGroupId: string } | { ok: false; error: string }

/**
 * create_next_season_scheduling_group always creates a NEW group_id
 * for the target season -- the historical group named by sourceGroupId
 * is never mutated. teamIds lets the same action serve both "same
 * composition" (pass the historical group's own team ids) and "edit
 * composition then create" (pass a caller-edited set) wizard paths.
 */
export async function createNextSeasonSchedulingGroup(
  sourceGroupId: string,
  toSeasonId: string,
  teamIds: string[],
  alias: string | null
): Promise<CreateNextSeasonGroupResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("create_next_season_scheduling_group", {
    p_source_group_id: sourceGroupId,
    p_to_season_id: toSeasonId,
    p_team_ids: teamIds,
    p_alias: alias ?? undefined,
  })
  if (error || !data) return { ok: false, error: error?.message ?? "Could not create the next-season Mini-Rugby Group." }
  revalidatePath("/club/rollover")
  return { ok: true, newGroupId: data }
}

/* ---------------------------------------------------------------------------
 * Player handover proposals.
 *
 * These consume age_grade_rollover_player_proposals, the rows prepare already
 * generates. There is no second proposal source, no handover-specific
 * dispensation domain, and no placement rule that lives in the UI: the server
 * classifies a squad change against an age-grade change, runs the canonical
 * movement resolver for the latter, and refuses anything it will not allow.
 * ------------------------------------------------------------------------ */

export interface PlacementOption {
  teamId: string
  /** The team as it will be in the season being decided, not as it is called today. */
  displayName: string
  ageGroup: string | null
  squadDesignation: string | null
  isNormal: boolean
  isSelected: boolean
}

/** Real canonical teams for this club, code and target season. Never free text. */
export async function loadPlacementOptions(proposalId: string): Promise<PlacementOption[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("rollover_placement_options", { p_proposal_id: proposalId })
  return (data ?? []).map((o) => ({
    teamId: o.team_id,
    displayName: o.display_name,
    ageGroup: o.age_group,
    squadDesignation: o.squad_designation,
    isNormal: o.is_normal,
    isSelected: o.is_selected,
  }))
}

export interface PlacementVerdict {
  overrideKind: "SAME_AGE_SQUAD" | "AGE_GRADE_CHANGE" | null
  movementRequirement: "permitted" | "team_approval_only" | "external_approval_required" | "not_permitted" | null
  reviewState: "READY" | "NEEDS_ATTENTION" | "BLOCKED"
  reason: string | null
  dispensationRequired: boolean
}

export type PlacementResult = { ok: true; verdict: PlacementVerdict } | { ok: false; error: string }

/**
 * Records the club's chosen placement and returns the server's verdict. The
 * verdict is authoritative -- the board displays it, it does not decide it.
 */
export async function setPlayerPlacement(proposalId: string, targetTeamId: string): Promise<PlacementResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("set_rollover_player_placement", {
    p_proposal_id: proposalId,
    p_target_team_id: targetTeamId,
  })
  if (error) return { ok: false, error: error.message }
  const row = (data ?? [])[0]
  if (!row) return { ok: false, error: "The placement could not be recorded." }
  revalidatePath("/club/rollover")
  return {
    ok: true,
    verdict: {
      overrideKind: row.override_kind as PlacementVerdict["overrideKind"],
      movementRequirement: row.movement_requirement as PlacementVerdict["movementRequirement"],
      reviewState: row.review_state as PlacementVerdict["reviewState"],
      reason: row.reason,
      dispensationRequired: row.dispensation_required,
    },
  }
}

/** Moves the membership. Refused server-side while the review is unresolved. */
export async function applyPlayerPlacement(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("apply_rollover_player_placement", { p_proposal_id: proposalId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/**
 * Adds the team a player normally belongs in when the club does not run it,
 * carrying the source squad's staff across. Offered, never automatic.
 */
export async function addMissingPlacementTeam(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("provision_missing_placement_team", { p_proposal_id: proposalId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}
