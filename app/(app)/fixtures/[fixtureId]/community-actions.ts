"use server"

import { revalidatePath } from "next/cache"

import { createClient } from "@/lib/supabase/server"

/**
 * CONVERGENCE STEP 11 -- the community writes.
 *
 * Each one is a thin call onto the RPC that owns the decision. Nothing here checks eligibility,
 * because the function being called already refuses; re-checking in the action would produce a
 * second, quieter answer that could drift from the first.
 */

export type CommunityWriteResult = { ok: true } | { ok: false; message: string }

function fail(error: { code?: string; message: string }): CommunityWriteResult {
  // A refusal is the product speaking, so it is shown as written. Anything else is a fault and is
  // not leaked to the page.
  if (error.code === "42501" || error.code === "P0001" || error.code === "P0002") {
    return { ok: false, message: error.message }
  }
  return { ok: false, message: "That could not be saved. Please try again." }
}

export async function castAwardVote(fixtureId: string, awardId: string, playerId: string): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("cast_match_award_vote", { p_award_id: awardId, p_player_id: playerId })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function withdrawAwardVote(fixtureId: string, awardId: string): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("withdraw_match_award_vote", { p_award_id: awardId })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function openAward(fixtureId: string, teamId: string, categoryKey: string): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("open_match_award", {
    p_fixture_id: fixtureId,
    p_team_id: teamId,
    p_category_key: categoryKey,
  })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function closeAward(fixtureId: string, awardId: string): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("close_match_award", { p_award_id: awardId })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function giveKudos(
  fixtureId: string,
  teamId: string,
  recipientPlayerId: string,
  kudosKey: string
): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("give_match_kudos", {
    p_fixture_id: fixtureId,
    p_team_id: teamId,
    p_recipient_player_id: recipientPlayerId,
    p_kudos_key: kudosKey,
  })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

export async function removeKudos(
  fixtureId: string,
  teamId: string,
  recipientPlayerId: string,
  kudosKey: string
): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("remove_match_kudos", {
    p_fixture_id: fixtureId,
    p_team_id: teamId,
    p_recipient_player_id: recipientPlayerId,
    p_kudos_key: kudosKey,
  })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

/**
 * A team saying which awards it runs, and what it calls them. The name is display only: the server
 * stores it beside the canonical category and nothing resolves off it.
 */
export async function setTeamAwardCategory(
  fixtureId: string,
  teamId: string,
  categoryKey: string,
  enabled: boolean,
  displayNameOverride: string | null
): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("set_team_award_category", {
    p_team_id: teamId,
    p_category_key: categoryKey,
    p_enabled: enabled,
    p_display_name_override: displayNameOverride ?? undefined,
  })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}

/** A giver taking their own recognition back. Nobody else's is reachable from here. */
export async function withdrawKudos(fixtureId: string, recipientPlayerId: string): Promise<CommunityWriteResult> {
  const supabase = await createClient()
  const { error } = await supabase.rpc("withdraw_match_kudos", {
    p_fixture_id: fixtureId,
    p_recipient_player_id: recipientPlayerId,
  })
  if (error) return fail(error)
  revalidatePath(`/fixtures/${fixtureId}`)
  return { ok: true }
}
