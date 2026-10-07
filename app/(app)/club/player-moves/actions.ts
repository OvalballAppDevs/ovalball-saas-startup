"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

export type PlayerMoveActionResult = { ok: true } | { ok: false; error: string }

export async function requestCallUp(
  fixtureId: string,
  playerId: string,
  sourceTeamId: string,
  targetTeamId: string,
  eligibilityRuleReference: string
): Promise<PlayerMoveActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("request_player_call_up", {
    p_fixture_id: fixtureId,
    p_player_id: playerId,
    p_source_team_id: sourceTeamId,
    p_target_team_id: targetTeamId,
    p_eligibility_rule_reference: eligibilityRuleReference,
  })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/player-moves")
  return { ok: true }
}

export type CallUpDecisionAction = "approve" | "reject" | "revoke"

export async function decideCallUp(callUpId: string, action: CallUpDecisionAction, reason: string | null): Promise<PlayerMoveActionResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("decide_player_call_up", { p_call_up_id: callUpId, p_action: action, p_reason: reason ?? undefined })
  if (error) return { ok: false, error: error.message }
  revalidatePath("/club/player-moves")
  return { ok: true }
}

// Dispensations are asked for, decided, withdrawn and revoked through app/(app)/dispensations/actions.ts --
// the one workflow's website actions over the shared contract (20270742000000).
