import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { PlanReadiness } from "./readiness"

type Client = SupabaseClient<Database>

/**
 * A HYBRID IS GROUPS, THEN A KNOCKOUT (20270724).
 *
 * The group stage is the round robin's own tables, pairings, scheduler and standings; the knockout stage
 * is the knockout's own bracket, places and progression. The organiser's one new decision is the seam:
 * how many sides from each table go through. Qualifiers are crossed so table winners avoid each other
 * early -- 1st Table A v 2nd Table B -- and a place reads "1st Table A" until that table is decided.
 */

export interface HybridKnockoutPreview {
  qualifiersPerTable: number | null
  /** How many sides reach the knockout stage. */
  teams: number
  rounds: number
  /** The knockout stage's opening round, named as the bracket names it ("Semi Final"). */
  firstRound: string | null
  thirdPlacePlayoff?: boolean
  games: { game: number; sideA: string; sideB: string; bye: boolean }[]
}

/** Saves how many go through from each table, and returns the plan's readiness afterwards. */
export async function setHybridQualifiers(supabase: Client, planId: string, qualifiersPerTable: number): Promise<PlanReadiness> {
  const { data, error } = await supabase.rpc("set_tournament_hybrid_settings", {
    p_plan_id: planId,
    p_qualifiers_per_table: qualifiersPerTable,
  })
  if (error) throw error
  return data as unknown as PlanReadiness
}

/** What the knockout stage will be, from the server's own seeding rule -- never worked out on the phone. */
export async function readHybridKnockoutPreview(supabase: Client, planId: string): Promise<HybridKnockoutPreview> {
  const { data, error } = await supabase.rpc("get_hybrid_knockout_preview", { p_plan_id: planId })
  if (error) throw error
  return data as unknown as HybridKnockoutPreview
}
