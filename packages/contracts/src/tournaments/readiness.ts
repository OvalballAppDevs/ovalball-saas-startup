import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

type Client = SupabaseClient<Database>

/**
 * WHAT A PLAN NEEDS NEXT, AND WHY -- as the SERVER answers it.
 *
 * `internal.tournament_plan_readiness` (20270720) is the one calculation behind Planning's Review, the
 * Generated Draft Plan, the Generate button and the Publish button. Generate and Publish raise its first
 * blocker word for word, so nothing here re-derives a rule: these functions only arrange the server's
 * answer into something an organiser can act on.
 *
 * A BLOCKER STOPS SOMETHING; a warning does not. Each carries the stage it stops (`generate` or
 * `publish`) and an `action` -- the route that fixes it -- so the screen can always answer "what do I
 * do next?" rather than sending the organiser back round the wizard.
 */

export type ReadinessStage = "CONFIGURING" | "DRAFT_GENERATED" | "PUBLISHED" | "IN_PROGRESS" | "COMPLETED"

/** Where a blocker's fix lives. */
export type ReadinessAction =
  | "teams"
  | "days"
  | "tables"
  | "qualifiers"
  | "rounds"
  | "draw"
  | "draw_update"
  | "pitches"
  | "schedule"
  | "edit_schedule"
  | "schedule_settings"
  | "venue"
  | "generate"
  | "regenerate"
  | "none"

export interface ReadinessItem {
  code: string
  stage?: "generate" | "publish"
  action: ReadinessAction
  message: string
  count?: number
}

export interface PlanReadiness {
  stage: ReadinessStage
  format: string
  publicationState: "DRAFT" | "PUBLISHED" | "SUPERSEDED"
  hasResults: boolean
  gameCount: number
  consistency: {
    competing: number
    placed: number
    newSides: number
    departedSides: number
    games: number
    fixturesOutOfDate: boolean
  }
  readyToGenerate: boolean
  readyToPublish: boolean
  canRegenerate: boolean
  canSchedule: boolean
  /** Clashes and games on unreserved pitches involving this competition (20270736). */
  conflictCount?: number
  blockers: ReadinessItem[]
  warnings: ReadinessItem[]
}

export async function readPlanReadiness(supabase: Client, planId: string): Promise<PlanReadiness> {
  const { data, error } = await supabase.rpc("get_tournament_plan_readiness", { p_plan_id: planId })
  if (error) throw error
  return data as unknown as PlanReadiness
}

/**
 * Gives the generated games kick-off times and pitches from the reserved pitches, without re-pairing.
 * Games the organiser placed by hand stay where they are unless `keepHandPlaced` is false (20270736).
 */
export async function scheduleTournamentPlan(supabase: Client, planId: string, keepHandPlaced = true): Promise<PlanReadiness> {
  const { data, error } = await supabase.rpc("schedule_tournament_plan", { p_plan_id: planId, p_keep_hand_placed: keepHandPlaced })
  if (error) throw error
  return data as unknown as PlanReadiness
}

export async function publishTournamentPlan(supabase: Client, planId: string): Promise<void> {
  const { error } = await supabase.rpc("publish_tournament_plan", { p_plan_id: planId })
  if (error) throw error
}

/** Brings a knockout draw up to date with the competition's sides; everybody drawn keeps their seed. */
export async function updateDrawMembership(supabase: Client, planId: string): Promise<void> {
  const { error } = await supabase.rpc("update_tournament_draw_membership", { p_plan_id: planId })
  if (error) throw error
}

/**
 * Reserves a pitch for the tournament, saying how the organiser has marked it out for the day: 1-4 games
 * at once, or nothing for the club's own layout (owner's rule, 20270736).
 */
export async function reserveTournamentPitch(
  supabase: Client,
  input: { tournamentId: string; pitchId: string; day: string; startTime: string; endTime: string; playingAreas?: number | null }
): Promise<void> {
  const { error } = await supabase.rpc("reserve_tournament_pitch", {
    p_tournament_id: input.tournamentId,
    p_pitch_id: input.pitchId,
    p_reserved_on: input.day,
    p_start_time: input.startTime,
    p_end_time: input.endTime,
    ...(input.playingAreas ? { p_playing_areas: input.playingAreas } : {}),
  })
  if (error) throw error
}

export async function releaseTournamentPitch(supabase: Client, reservationId: string): Promise<void> {
  const { error } = await supabase.rpc("release_tournament_pitch", { p_reservation_id: reservationId })
  if (error) throw error
}

/**
 * THE HEADLINE. One sentence, derived from the stage and whether anything stands in the way.
 */
export function readinessHeadline(r: PlanReadiness): { tone: "ready" | "attention" | "published" | "live"; title: string } {
  if (r.stage === "COMPLETED") return { tone: "published", title: "Competition complete" }
  if (r.stage === "IN_PROGRESS") return { tone: "live", title: "In progress" }
  if (r.stage === "PUBLISHED") {
    return r.blockers.length > 0 ? { tone: "attention", title: "Published, needs attention" } : { tone: "published", title: "Published" }
  }
  if (r.stage === "CONFIGURING") {
    return r.readyToGenerate ? { tone: "ready", title: "Ready to generate" } : { tone: "attention", title: "Needs attention" }
  }
  return r.readyToPublish ? { tone: "ready", title: "Ready to publish" } : { tone: "attention", title: "Needs attention" }
}

/**
 * THE CHECKLIST: the things that are already right, said as ticks, beside the things that are not.
 * Ticks are only drawn for facts the server confirmed -- an organiser should never see a green tick
 * for something nobody checked.
 */
export function readinessChecklist(r: PlanReadiness): { ok: boolean; text: string }[] {
  const items: { ok: boolean; text: string }[] = []
  const has = (code: string) => r.blockers.some((b) => b.code === code)
  const games = r.gameCount
  if (games > 0) {
    const untimed = r.blockers.find((b) => b.code === "UNSCHEDULED")?.count ?? 0
    items.push({ ok: untimed === 0, text: untimed === 0 ? `${games}/${games} games have kick-off times` : `${games - untimed}/${games} games have kick-off times` })
    // A kick-off without a pitch is a blocker since 20270736 (a warning before it).
    const unpitched = (r.blockers.find((b) => b.code === "NO_PITCH") ?? r.warnings.find((w) => w.code === "NO_PITCH"))?.count ?? 0
    if (untimed === 0) items.push({ ok: unpitched === 0, text: unpitched === 0 ? `${games}/${games} games have pitches` : `${games - unpitched}/${games} games have pitches` })
    items.push({ ok: !has("FIXTURES_OUT_OF_DATE"), text: has("FIXTURES_OUT_OF_DATE") ? "Fixtures are out of date" : "Every team plays the games its competition makes" })
    if (untimed === 0) {
      const clashes = (r.blockers.find((b) => b.code === "CLASH")?.count ?? 0) + (r.blockers.find((b) => b.code === "PITCH_NOT_RESERVED")?.count ?? 0)
      items.push({ ok: clashes === 0, text: clashes === 0 ? "No pitch or team is double-booked" : `${clashes} ${clashes === 1 ? "clash needs" : "clashes need"} changing` })
    }
  } else {
    items.push({ ok: r.consistency.competing >= 2, text: `${r.consistency.competing} ${r.consistency.competing === 1 ? "team" : "teams"} in this competition` })
  }
  if (!r.warnings.some((w) => w.code === "NO_VENUE")) items.push({ ok: true, text: "Tournament venue confirmed" })
  return items
}

/**
 * THE ONE THING TO DO NEXT -- the button the screen leads with. Derived from the first blocker that
 * has a route, so a plan with a stale team list is sent to reconcile it, not to publish.
 */
export function primaryReadinessAction(r: PlanReadiness): ReadinessAction | "publish" | null {
  // Playing hours before scheduling: scheduling into a window that cannot hold the rounds only fails.
  // Clashes after scheduling: there is no point arranging games by hand that the scheduler has not placed.
  const order: ReadinessAction[] = ["draw_update", "teams", "days", "tables", "qualifiers", "rounds", "draw", "regenerate", "pitches", "schedule_settings", "schedule", "edit_schedule", "generate"]
  for (const a of order) {
    if (r.blockers.some((b) => b.action === a)) return a
  }
  if (r.readyToPublish) return "publish"
  return null
}

/** What each route is called on a button. Title Case: these are controls. */
export const READINESS_ACTION_LABEL: Record<ReadinessAction | "publish", string> = {
  teams: "Review Teams",
  days: "Choose Playing Days",
  tables: "Arrange Tables",
  qualifiers: "Choose Qualifiers",
  rounds: "Choose Rounds",
  draw: "Make the Draw",
  draw_update: "Update the Draw",
  pitches: "Reserve Pitches",
  schedule: "Complete Scheduling",
  edit_schedule: "Edit Plan",
  schedule_settings: "Review Playing Hours",
  venue: "Choose a Venue",
  generate: "Generate Fixtures",
  regenerate: "Regenerate Fixtures",
  none: "",
  publish: "Publish Fixtures",
}

/**
 * MOVES ONE GAME -- its day, kick-off and pitch, never its sides or score. The server refuses a played
 * game, a non-playing day, a time outside the playing hours, an unreserved pitch and a side clash, each
 * in words; once the plan is published both sides are told (20270721).
 */
export async function setTournamentGameSchedule(
  supabase: Client,
  input: { gameId: string; day: string; startTime: string; pitchId: string }
): Promise<PlanReadiness> {
  const { data, error } = await supabase.rpc("set_tournament_game_schedule", {
    p_game_id: input.gameId,
    p_game_date: input.day,
    p_start_time: input.startTime,
    p_pitch_id: input.pitchId,
  })
  if (error) throw error
  return data as unknown as PlanReadiness
}
