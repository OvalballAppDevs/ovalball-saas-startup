import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { PlanReadiness } from "./readiness"

type Client = SupabaseClient<Database>

/**
 * A SWISS PAIRS EACH ROUND FROM THE TABLE (20270725).
 *
 * One table -- the round robin's scoring, tie-breakers and standings -- whose games are made a round at
 * a time. Round 1 is drawn at random; every later round pairs the table top down with no rematch, the
 * moment the round before it is settled. Every round's kick-off times are reserved at Generate. With an
 * odd field the lowest-ranked side without a bye sits out, once at most, and is awarded a win. All of it
 * is the server's: these functions only ask.
 */

/** The most rounds a field can play without two sides meeting twice -- the server's own rule, for the stepper's range. */
export function swissRoundLimit(sides: number): number {
  if (sides < 2) return 0
  return sides % 2 === 0 ? sides - 1 : sides
}

/** Saves how many rounds are played, and returns the plan's readiness afterwards. */
export async function setSwissRounds(supabase: Client, planId: string, rounds: number): Promise<PlanReadiness> {
  const { data, error } = await supabase.rpc("set_tournament_swiss_settings", { p_plan_id: planId, p_rounds: rounds })
  if (error) throw error
  return data as unknown as PlanReadiness
}

/** Two sides change places in the round about to start. Refused into a rematch, a second bye, or a started round. */
export async function swapSwissSides(supabase: Client, planId: string, first: string, second: string): Promise<void> {
  const { error } = await supabase.rpc("swap_tournament_swiss_sides", { p_plan_id: planId, p_first: first, p_second: second })
  if (error) throw error
}

export interface SwissBye {
  round: number
  participantId: string
  clubName: string
}

export interface SwissUpcomingRound {
  round: number
  date: string | null
  startTime: string | null
  pitchName: string | null
  places: number
}
