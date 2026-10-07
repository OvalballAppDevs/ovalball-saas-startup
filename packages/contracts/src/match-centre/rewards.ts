import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * REWARDS & RECOGNITION -- the match community model, read for the Match Centre (`get_match_rewards`).
 *
 * Four awards in one framework: Parents' Player of the Match (a poll of the side's families, one vote per
 * child, opening at kick-off), Coaches' Player of the Match and the Beast Award (chosen by the side's
 * coaches and staff), and Opposition Player of the Match (chosen by the other side). Configuration is club
 * default then team override; the server decides who may do what, and this module only asks.
 */

export type AwardCategoryKey = "FAMILY_OR_SELF_PLAYER" | "COACHES_PLAYER" | "OPPOSITION_PLAYER" | "WORK_ETHIC"
export type AwardState = "OPENS_AT_KICKOFF" | "NOT_STARTED" | "OPEN" | "DECIDED" | "CANCELLED"

export interface MatchAward {
  side: "home" | "away"
  teamId: string
  categoryKey: AwardCategoryKey
  electorate: "FAMILY_OR_SELF" | "TEAM_COACHES" | "OPPOSITION_COACHES"
  name: string
  description: string
  awardId: string | null
  state: AwardState
  outcome: "WINNER" | "TIE" | "NO_VOTES" | null
  winner: { playerId: string; firstName: string; displayName: string | null } | null
  decidedAt: string | null
  votingClosesAt: string | null
  /** The children (or, in adult rugby, the player) whose vote this viewer may cast, and what each chose. */
  voteEntitlements: { playerId: string; firstName: string; myVotePlayerId: string | null }[]
  canGive: boolean
  canOpen: boolean
  canClose: boolean
  /** Staff only, once closed. Never shown to the wider team. */
  totalVotes: number | null
}

export interface MatchRewards {
  fixtureId: string
  kickedOff: boolean
  awards: MatchAward[]
}

export async function readMatchRewards(supabase: Client, fixtureId: string): Promise<MatchRewards> {
  const { data, error } = await supabase.rpc("get_match_rewards", { p_fixture_id: fixtureId })
  if (error) throw error
  return data as unknown as MatchRewards
}

/** The names an entitled person may choose between, and nothing else about them. */
export async function readRecognitionSquad(supabase: Client, fixtureId: string, teamId: string): Promise<{ playerId: string; name: string }[]> {
  const { data, error } = await supabase.rpc("get_match_recognition_squad", { p_fixture_id: fixtureId, p_team_id: teamId })
  if (error) throw error
  return (data ?? []).map((r) => ({ playerId: r.player_id, name: r.display_name ?? "Player" }))
}

export async function giveMatchAward(supabase: Client, input: { fixtureId: string; teamId: string; categoryKey: AwardCategoryKey; playerId: string }): Promise<void> {
  const { error } = await supabase.rpc("give_match_award", {
    p_fixture_id: input.fixtureId,
    p_team_id: input.teamId,
    p_category_key: input.categoryKey,
    p_player_id: input.playerId,
  })
  if (error) throw error
}

export async function castMatchAwardVote(supabase: Client, input: { awardId: string; playerId: string; forPlayerId: string }): Promise<void> {
  const { error } = await supabase.rpc("cast_match_award_vote", {
    p_award_id: input.awardId,
    p_player_id: input.playerId,
    p_for_player_id: input.forPlayerId,
  })
  if (error) throw error
}

export async function openMatchAward(supabase: Client, input: { fixtureId: string; teamId: string; categoryKey: AwardCategoryKey }): Promise<void> {
  const { error } = await supabase.rpc("open_match_award", { p_fixture_id: input.fixtureId, p_team_id: input.teamId, p_category_key: input.categoryKey })
  if (error) throw error
}

export async function closeMatchAward(supabase: Client, awardId: string): Promise<void> {
  const { error } = await supabase.rpc("close_match_award", { p_award_id: awardId })
  if (error) throw error
}

/** A player's CURRENT recognition: what they won at their side's last match, until the side plays again. */
export interface PlayerRecognition {
  playerId: string
  categoryKey: AwardCategoryKey
  awardName: string
  fixtureId: string
  awardedAt: string | null
}

export async function readPlayerRecognition(supabase: Client, playerIds: string[]): Promise<Map<string, PlayerRecognition[]>> {
  const out = new Map<string, PlayerRecognition[]>()
  const ids = Array.from(new Set(playerIds)).filter(Boolean)
  if (ids.length === 0) return out
  const { data, error } = await supabase.rpc("get_player_recognition", { p_player_ids: ids })
  if (error) throw error
  for (const r of data ?? []) {
    const list = out.get(r.player_id) ?? []
    list.push({ playerId: r.player_id, categoryKey: r.category_key as AwardCategoryKey, awardName: r.award_name, fixtureId: r.fixture_id, awardedAt: r.awarded_at })
    out.set(r.player_id, list)
  }
  return out
}

/** What the award section says about one award, in words. */
export function awardStateLine(a: MatchAward): string {
  switch (a.state) {
    case "CANCELLED":
      return "The match was cancelled."
    case "OPENS_AT_KICKOFF":
      return a.electorate === "FAMILY_OR_SELF" ? "Voting opens after kick-off" : "Chosen after kick-off"
    case "NOT_STARTED":
      return a.electorate === "FAMILY_OR_SELF" ? "Voting has not opened yet" : "Not chosen yet"
    case "OPEN":
      return "Voting open now"
    case "DECIDED":
      if (a.outcome === "WINNER" && a.winner) return a.winner.displayName ?? a.winner.firstName
      if (a.outcome === "TIE") return "A tie -- no single winner"
      return "No votes were cast"
  }
}
