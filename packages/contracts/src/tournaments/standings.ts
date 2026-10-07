import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"

/**
 * A TOURNAMENT TABLE, AS ANYBODY ENTITLED TO SEE IT SEES IT.
 *
 * A thin typed wrapper over `get_tournament_tables`. There is deliberately NO arithmetic here and no
 * sorting: the server calculates the standings from confirmed results and orders them by the
 * organiser's own tie-breakers, and a second implementation in TypeScript would be a second answer to
 * the same question. The helpers below format what the server decided; they never decide it.
 *
 * WHAT A CLIENT CANNOT SEE THROUGH THIS READ: a submitted score waiting for the other side, a
 * contested one, a proposed change to an agreed one, and every note attached to any of them. Those
 * come from the results overview, which checks who is asking. A table is for everybody the tournament's
 * `results_visibility` allows, so it carries only what is settled.
 */

export type TieBreaker =
  | "points_difference"
  | "points_for"
  | "points_against"
  | "head_to_head"
  | "wins"

export interface StandingsPoints {
  win: number
  draw: number
  loss: number
  losingBonus: number
  /** How close a defeat has to be, in points, to earn the losing bonus. */
  losingBonusMargin: number
  /**
   * CONFIGURABLE BUT NOT APPLIED, and the screen says so rather than quietly dropping it. Awarding a
   * try bonus needs TRIES SCORED, and no Ovalball surface records tries for any game -- 24 points
   * might be four tries and two conversions or three tries, two conversions and three penalties, and
   * nothing in the database can tell the difference.
   */
  tryBonus: number
}

export interface StandingsRow {
  /** The server's own position, after competition points, the tie-breakers and the neutral fallback. */
  position: number
  participantId: string
  clubName: string
  /** The canonical team name. Never a naming convention invented for this screen. */
  label: string
  /** A storage path, resolved to a URL by the caller through the canonical club-logo helper. */
  crestPath: string | null
  isHost: boolean
  played: number
  won: number
  drawn: number
  lost: number
  pointsFor: number
  pointsAgainst: number
  pointsDifference: number
  /** Competition points, from the plan's own scoring system. */
  points: number
}

export interface RecentResultSide {
  clubName: string
  label: string
  crestPath: string | null
  score: number | null
}

export interface RecentResult {
  id: string
  date: string
  startTime: string | null
  round: number | null
  sideA: RecentResultSide
  sideB: RecentResultSide
}

export interface StandingsTable {
  id: string
  name: string
  rows: StandingsRow[]
  /** Settled results only, newest first. A contested score is not a result. */
  recentResults: RecentResult[]
  confirmedCount: number
  scheduledCount: number
}

export interface TournamentStandings {
  tournamentId: string
  tournamentName: string
  ageGroup: string
  /** False where no plan has been published -- which is not the same as a table on which nobody scored. */
  published: boolean
  /** True where the reader may see the competition but not its results. */
  restricted?: boolean
  format: string | null
  points: StandingsPoints
  tieBreakers: TieBreaker[]
  tables: StandingsTable[]
}

export async function readTournamentStandings(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  ageGroup: string
): Promise<TournamentStandings | null> {
  const { data, error } = await supabase.rpc("get_tournament_tables", {
    p_tournament_id: tournamentId,
    p_age_group: ageGroup,
  })
  if (error) throw error
  return (data as unknown as TournamentStandings | null) ?? null
}

/**
 * IS THIS FORMAT ONE A TABLE MEANS ANYTHING IN.
 *
 * ROUND ROBIN is the format whose whole point is a table: everybody plays everybody, and the standings
 * ARE the competition. TRI-FIXTURE is a round robin of exactly three sides -- the same structure with a
 * smaller number, and the generator draws it with the same pairing rule -- so it has a table too.
 *
 * A KNOCKOUT has a bracket and no table. A SWISS re-pairs every round against sides on the same score,
 * which is a standings-driven format but not this standings implementation. A HYBRID's group stage is
 * this implementation exactly -- round robin tables whose standings decide who goes through (20270724)
 * -- so it has a table as well as its knockout stage. Drawing an empty table on a format without one
 * would invent a competition structure the organiser did not choose, so the Tables tab does not appear.
 *
 * It takes the format as the DATABASE spells it, because that is the one authority for what a
 * tournament is.
 */
export function formatHasStandings(format: string | null | undefined): boolean {
  return format === "round_robin" || format === "tri_fixture" || format === "hybrid"
}

/**
 * WHAT "LIVE" MEANS ON A TABLE, AND WHAT IT DOES NOT.
 *
 * It means the table is a PROJECTION that moves on its own as results are agreed -- nobody maintains
 * it, nobody publishes it, and it is already right. It does NOT mean a game is in progress: Ovalball
 * does not know that, and a pill claiming it would be guessing.
 *
 * So it is shown while a competition still has games to play, and stops once every game is settled --
 * at which point the table is not live, it is FINAL, which is a more useful thing to be told.
 */
export type TableStatus = "awaiting" | "live" | "complete"

export function tableStatus(table: StandingsTable): TableStatus {
  if (table.scheduledCount === 0) return "awaiting"
  if (table.confirmedCount === 0) return "awaiting"
  return table.confirmedCount >= table.scheduledCount ? "complete" : "live"
}

export function tableStatusLabel(status: TableStatus): string {
  switch (status) {
    case "live":
      return "Live"
    case "complete":
      return "Final"
    case "awaiting":
      return "No results yet"
  }
}

/**
 * THE LINE UNDER A TABLE THAT EXPLAINS ITS ARITHMETIC.
 *
 * An organiser who set 4 points for a win and a losing bonus should be able to read that back off the
 * screen rather than trust it. The try bonus is named as NOT COUNTED where one is configured, because
 * silently ignoring a number somebody typed is how a club loses an afternoon arguing about a table.
 */
export function pointsExplanation(points: StandingsPoints): string {
  const parts = [`${points.win} for a win`, `${points.draw} for a draw`]
  if (points.loss !== 0) parts.push(`${points.loss} for a loss`)
  if (points.losingBonus !== 0) {
    parts.push(`${points.losingBonus} for losing by ${points.losingBonusMargin} or fewer`)
  }
  let line = parts.join(", ") + "."
  if (points.tryBonus !== 0) {
    line += ` The try bonus of ${points.tryBonus} is not counted, because tries are not recorded.`
  }
  return line
}

const TIE_BREAKER_NAMES: Record<TieBreaker, string> = {
  points_difference: "points difference",
  points_for: "points scored",
  points_against: "points conceded",
  head_to_head: "head to head",
  wins: "wins",
}

/**
 * HOW THE TABLE WAS ORDERED, in the organiser's own order.
 *
 * Ovalball has no canonical sporting tie-break, so this is configuration rather than a hidden default
 * -- and a table that will not say how it was ordered is a table somebody will dispute.
 */
export function tieBreakerExplanation(tieBreakers: TieBreaker[]): string {
  if (tieBreakers.length === 0) {
    return "Sides level on points are shown level, in name order."
  }
  const names = tieBreakers.map((t) => TIE_BREAKER_NAMES[t] ?? t)
  const listed =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} then ${names[names.length - 1]}`
  return `Level on points is settled by ${listed}.`
}

export function tieBreakerName(tieBreaker: TieBreaker): string {
  return TIE_BREAKER_NAMES[tieBreaker] ?? tieBreaker
}

/** "24 - 12", or an en dash where a side has no score. Never a zero standing in for no result. */
export function resultScoreLine(result: RecentResult): string {
  const a = result.sideA.score
  const b = result.sideB.score
  if (a === null || b === null) return "—"
  return `${a} - ${b}`
}
