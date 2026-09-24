"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"
import {
  applySeasonHandover as applySeasonHandoverShared,
  askGuardianForPlayingInformation as askGuardianShared,
  clearPlayerPlacement as clearPlayerPlacementShared,
  createNextSeasonGroup,
  decideMixedBoundary,
  decideTeamProposal,
  markGraduatingPlayerLeft as markGraduatingPlayerLeftShared,
  placeGraduatingPlayer as placeGraduatingPlayerShared,
  planMissingPlacementTeam as planMissingPlacementTeamShared,
  prepareHandover,
  readPlacementOptions,
  resolveGroupFlag,
  setPlayerPlacement as setPlayerPlacementShared,
  setPlayerPlannedPlacement as setPlayerPlannedPlacementShared,
  undoTeamDecision,
  unplanHandoverTeam as unplanHandoverTeamShared,
  type PlacementOption,
  type PlacementVerdict,
  type TeamDecisionAction,
} from "@ovalball/contracts/club/handover"

/**
 * THE SEASON HANDOVER'S SERVER ACTIONS, ON THE WEB (CA-M11.1).
 *
 * Every action is a thin caller of the shared contract (`@ovalball/contracts/club/handover`), which
 * wraps the one canonical RPC each operation has -- the same wrapper the phone calls. Nothing here
 * decides anything: the SECURITY DEFINER functions judge the authority, the destination, the movement
 * rules and the revision, and an action adds no permission of its own and cannot become a way around
 * one. What is left on this side is Next.js's own concern: revalidating the paths a decision touches.
 */
export type RolloverActionResult = { ok: true } | { ok: false; error: string }
export type RolloverProposalAction = TeamDecisionAction
export type { PlacementOption, PlacementVerdict }

function messageOf(cause: unknown, fallback: string): string {
  const m = (cause as { message?: string } | null)?.message
  return m && m.trim() ? m : fallback
}

/** generate_rollover_proposal is read-only against real teams -- it only ever writes to the two proposal tables, never mutates a team. */
export async function generateRolloverProposal(clubId: string, rugbyCode: "union" | "league", toSeasonId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  try {
    await prepareHandover(supabase, clubId, rugbyCode, toSeasonId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not prepare the handover.") }
  }
  revalidatePath("/club/rollover")
  return { ok: true }
}

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
  try {
    await decideTeamProposal(supabase, { proposalId, action, ageGroup, squadDesignation, foldReason, gender })
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not record this decision.") }
  }
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
  try {
    const result = await decideMixedBoundary(supabase, { proposalId, createGirlsTeam, boysSquadDesignation, girlsSquadDesignation })
    revalidatePath("/club/rollover")
    return { ok: true, boysTeamId: result.boysTeamId, girlsTeamId: result.girlsTeamId }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not record this decision.") }
  }
}

export async function resolveRolloverGroupFlag(flagId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  try {
    await resolveGroupFlag(supabase, flagId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not mark this flag resolved.") }
  }
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
  try {
    await placeGraduatingPlayerShared(supabase, queueId, targetTeamId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not place this player.") }
  }
  revalidatePath("/club/rollover")
  return { ok: true }
}

export async function markGraduatingPlayerLeft(queueId: string): Promise<GraduationActionResult> {
  const supabase = await createClient()
  try {
    await markGraduatingPlayerLeftShared(supabase, queueId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not record that this player has left.") }
  }
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
  try {
    const newGroupId = await createNextSeasonGroup(supabase, { sourceGroupId, toSeasonId, teamIds, alias })
    revalidatePath("/club/rollover")
    return { ok: true, newGroupId }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not create the next-season Mini-Rugby Group.") }
  }
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

/** Real canonical teams for this club, code and target season. Never free text. */
export async function loadPlacementOptions(proposalId: string): Promise<PlacementOption[]> {
  const supabase = await createClient()
  try {
    return await readPlacementOptions(supabase, proposalId)
  } catch {
    return []
  }
}

export type PlacementResult = { ok: true; verdict: PlacementVerdict } | { ok: false; error: string }

/**
 * Records the club's chosen placement and returns the server's verdict. The
 * verdict is authoritative -- the board displays it, it does not decide it.
 */
export async function setPlayerPlacement(proposalId: string, targetTeamId: string): Promise<PlacementResult> {
  const supabase = await createClient()
  try {
    const verdict = await setPlayerPlacementShared(supabase, proposalId, targetTeamId)
    revalidatePath("/club/rollover")
    return { ok: true, verdict }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "The placement could not be recorded.") }
  }
}

/** Puts a player's placement back to whatever the club's decisions say it should be. */
export async function clearPlayerPlacement(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  try {
    await clearPlayerPlacementShared(supabase, proposalId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not undo this placement.") }
  }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/** Chooses a team the club has decided to run but which does not exist yet. */
export async function setPlayerPlannedPlacement(proposalId: string, plannedId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  try {
    await setPlayerPlannedPlacementShared(supabase, proposalId, plannedId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "The placement could not be recorded.") }
  }
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
  try {
    await planMissingPlacementTeamShared(supabase, proposalId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not plan this team.") }
  }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/** Withdraws a team the club had decided to run. Only possible before Apply. */
export async function unplanHandoverTeam(plannedId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  try {
    await unplanHandoverTeamShared(supabase, plannedId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not withdraw this team.") }
  }
  revalidatePath("/club/rollover")
  return { ok: true }
}

/** Returns a team decision to undecided. Possible because deciding mutates nothing. */
export async function undoRolloverTeamDecision(proposalId: string): Promise<RolloverActionResult> {
  const supabase = await createClient()
  try {
    await undoTeamDecision(supabase, proposalId)
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not undo this decision.") }
  }
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
  try {
    const outcome = await applySeasonHandoverShared(supabase, rolloverId, expectedRevision)
    revalidatePath("/club/rollover")
    revalidatePath("/teams")
    revalidatePath("/dashboard")
    return { ok: true, ...outcome }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "The handover did not report a result.") }
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
  try {
    return { ok: true, sent: await askGuardianShared(supabase, playerId) }
  } catch (cause) {
    return { ok: false, error: messageOf(cause, "Could not send the request.") }
  }
}
