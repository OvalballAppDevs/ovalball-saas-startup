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

/**
 * Records what should happen to a team next season. Since the staged commit
 * model this changes NO live team: the club's teams are untouched until
 * applySeasonHandover runs, which is what makes "nothing changes until you
 * apply the handover" literally true and undo possible.
 */
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
 * The only path that resolves a U11 Mixed -> U12 structural transition.
 * createGirlsTeam has no default on either side of this call -- the UI must not
 * be able to submit without an explicit choice. The Girls team is PLANNED here
 * and created at Apply, so girlsTeamId is null until the handover has run.
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
  if (error || !data) return { ok: false, error: error?.message ?? "Could not record this decision." }
  revalidatePath("/club/rollover")
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
  /** Null for a team the club has decided to run but which does not exist yet. */
  teamId: string | null
  plannedId: string | null
  /** The team as it will be in the season being decided, not as it is called today. */
  displayName: string
  ageGroup: string | null
  squadDesignation: string | null
  isNormal: boolean
  isSelected: boolean
  isPlanned: boolean
}

/** Real canonical teams for this club, code and target season. Never free text. */
export async function loadPlacementOptions(proposalId: string): Promise<PlacementOption[]> {
  const supabase = await createClient()
  const { data } = await supabase.rpc("rollover_placement_options", { p_proposal_id: proposalId })
  return (data ?? []).map((o) => ({
    teamId: o.team_id,
    plannedId: o.planned_id,
    displayName: o.display_name,
    ageGroup: o.age_group,
    squadDesignation: o.squad_designation,
    isNormal: o.is_normal,
    isSelected: o.is_selected,
    isPlanned: o.is_planned,
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

/** Puts a player's placement back to whatever the club's decisions say it should be. */
export async function clearPlayerPlacement(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("clear_rollover_player_placement", { p_proposal_id: proposalId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/** Chooses a team the club has decided to run but which does not exist yet. */
export async function setPlayerPlannedPlacement(proposalId: string, plannedId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_rollover_player_planned_placement", {
    p_proposal_id: proposalId,
    p_planned_id: plannedId,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/**
 * Records that the club will run the team a player normally belongs in. It is
 * NOT created here: next season's U12 cannot be stood up while this season's
 * U12 still holds that identity, and it only lets go of it when the handover
 * runs. The real team, and its staff, arrive inside Apply.
 */
export async function planMissingPlacementTeam(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("plan_missing_placement_team", { p_proposal_id: proposalId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/** Withdraws a team the club had decided to run. Only possible before Apply. */
export async function unplanHandoverTeam(plannedId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("unplan_handover_team", { p_planned_id: plannedId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/** Returns a team decision to undecided. Possible because deciding mutates nothing. */
export async function undoRolloverTeamDecision(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("undo_rollover_team_decision", { p_proposal_id: proposalId })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/rollover")
  revalidatePath("/teams")
  return { ok: true }
}

export type ApplyHandoverResult =
  | { ok: true; alreadyApplied: boolean; teamsProgressed: number; teamsFolded: number; teamsGraduated: number; teamsCreated: number; teamsReactivated: number; playersMoved: number; playersHeld: number }
  | { ok: false; error: string }

/**
 * The single mutation boundary. One server-side transaction revalidates every
 * decision against live state and then carries the whole handover out -- the
 * browser never sequences a season transition one request at a time.
 *
 * expectedRevision is what the reviewer had in front of them. If someone else
 * changed a decision in the meantime the server refuses rather than applying
 * something nobody reviewed.
 */
export async function applySeasonHandover(rolloverId: string, expectedRevision: number | null): Promise<ApplyHandoverResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("apply_season_handover", {
    p_rollover_id: rolloverId,
    p_expected_revision: expectedRevision ?? undefined,
  })
  if (error) return { ok: false, error: error.message }
  const row = (data ?? [])[0]
  if (!row) return { ok: false, error: "The handover did not report a result." }
  revalidatePath("/club/rollover")
  revalidatePath("/teams")
  revalidatePath("/dashboard")
  return {
    ok: true,
    alreadyApplied: row.already_applied,
    teamsProgressed: row.teams_progressed,
    teamsFolded: row.teams_folded,
    teamsGraduated: row.teams_graduated,
    teamsCreated: row.teams_created,
    teamsReactivated: row.teams_reactivated,
    playersMoved: row.players_moved,
    playersHeld: row.players_held,
  }
}

export type AskGuardianResult = { ok: true; sent: number } | { ok: false; error: string }

/**
 * A club asking a player's guardians for missing playing information.
 *
 * The whole of the club's authority here is to ask. Recording the answer
 * belongs to the guardian or the adult player, and the server enforces that
 * separately -- this action cannot write anything about the child.
 */
export async function askGuardianForPlayingInformation(playerId: string): Promise<AskGuardianResult> {
  const supabase = await createClient()
  const { data, error } = await supabase.rpc("request_player_playing_pathway", { p_player_id: playerId })
  if (error) return { ok: false, error: error.message }
  return { ok: true, sent: data ?? 0 }
}
