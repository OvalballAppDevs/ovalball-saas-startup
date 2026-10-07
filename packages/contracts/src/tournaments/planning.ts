import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { TieResolution } from "./knockout"
import type { SwissBye, SwissUpcomingRound } from "./swiss"
import type { PlanReadiness } from "./readiness"
import type { TieBreaker } from "./standings"

export type { TieBreaker }

/**
 * TOURNAMENT PLANNING, AS ONE COMPETITION'S ORGANISER SEES IT.
 *
 * A plan belongs to a COMPETITION -- one tournament, one age group -- because that is the unit that
 * has its own sides, its own tables, its own days and its own settings. A festival running U12 and U16
 * has two plans over one tournament.
 *
 * NOTHING HERE DECIDES ANYTHING. Every write goes through a governed RPC that re-checks
 * `tournament.tournament.manage`, and the pairing rule lives in the database so that generating a
 * draft and previewing one cannot produce different answers.
 */

export type PlanPublicationState = "DRAFT" | "PUBLISHED" | "SUPERSEDED"



export interface PlanSide {
  participantId: string
  clubName: string
  /** Storage path, resolved by the caller through the canonical club-logo helper. */
  crestPath: string | null
  /** The canonical team name, or a recorded club's competition and alias. */
  label: string
  isHost: boolean
  onOvalball: boolean
  /** added | accepted | external_recorded compete; pending (awaiting a reply) and declined do not. */
  status?: string
  /** Whether this side is in the draw, as the server decides it (20270720). */
  competes?: boolean
}

export interface PlanTable {
  id: string
  name: string
  sortOrder: number
  /** Participant ids, in the organiser's own order. */
  sides: string[]
}

export interface PlanDefaults {
  gameDurationMinutes: number
  changeoverMinutes: number
  dayStartTime: string
  dayEndTime: string
  /** Where the duration came from -- "RFU Regulation 15 (U12)" or "Ovalball default". Shown, never hidden. */
  durationSource: string
}

export interface TournamentPlan {
  id: string
  publicationState: PlanPublicationState
  version: number
  publishedAt: string | null
  gameDurationMinutes: number
  changeoverMinutes: number
  dayStartTime: string
  dayEndTime: string
  pointsWin: number
  pointsDraw: number
  pointsLoss: number
  pointsTryBonus: number
  pointsLosingBonus: number
  /** The days THIS competition plays, always a subset of the tournament's range. */
  days: string[]
  tables: PlanTable[]
  /** How many games the current draft holds. Zero until Generate is pressed. */
  gameCount: number
  /**
   * THE KNOCKOUT HALF OF THE PLAN. Null on a round robin, which has no draw to configure. Planning's
   * Settings step must open on these rather than on its own defaults: it saves what its controls hold,
   * so a step that cannot read them overwrites them.
   */
  drawMethod: "random" | "seeded" | "manual" | null
  tieResolution: TieResolution | null
  extraTimeMinutes: number | null
  thirdPlacePlayoff: boolean | null
  /** A Hybrid's seam: how many sides from each table go through to the knockout stage (1-4). */
  qualifiersPerTable?: number | null
  /** Which day each knockout round is played on. Empty until the organiser assigns them. */
  roundDays: { round: number; day: string }[]
  /**
   * WHETHER THIS COMPETITION KEEPS A TABLE, as the server resolves it. A Round Robin does; a knockout
   * never does; a Tri-Fixture does only when the organiser has asked for one, because three sides
   * sharing a morning is not necessarily a competition anybody is winning.
   */
  standingsEnabled: boolean
  /**
   * What the organiser actually chose, as opposed to what the format does by default. Null is "not
   * asked yet", which is a different fact from "no" -- the control shows the default until they touch
   * it, and stops following the default once they have.
   */
  standingsChoice: boolean | null
  /**
   * How many sides this format allows, where it constrains its field at all. 3 for a Tri-Fixture, null
   * for every format that does not care. The Teams step says so before an organiser builds a field
   * that generation will refuse.
   */
  fieldSize: number | null
  /** What the plan needs next, and why -- the one answer Generate and Publish also enforce. */
  readiness: PlanReadiness | null
}

/**
 * WHAT A FORMAT PROMISES ABOUT THE SIZE OF ITS FIELD, said to the organiser before they build one.
 *
 * It is a sentence rather than a validation message, because it appears while the field is still being
 * assembled -- "A Tri-Fixture is exactly 3 teams" is guidance at two sides and a diagnosis at five, and
 * the organiser should meet it as the former.
 */
export function fieldSizeGuidance(fieldSize: number | null, sideCount: number): string | null {
  if (fieldSize === null) return null
  if (sideCount === fieldSize) return null
  const have = `${sideCount} ${sideCount === 1 ? "team" : "teams"}`
  return sideCount < fieldSize
    ? `A Tri-Fixture is exactly ${fieldSize} teams, each playing the other two. This competition has ${have}.`
    : `A Tri-Fixture is exactly ${fieldSize} teams. This competition has ${have}, so some will need to be removed or entered as their own competition.`
}

export interface TournamentPlanContext {
  tournamentId: string
  tournamentName: string
  ageGroup: string
  format: string
  swissRounds: number | null
  venueName: string | null
  /** The tournament's own range. Planning selects from it and never changes it. */
  tournamentStartsOn: string
  tournamentEndsOn: string
  /** Every competition the tournament runs, so Planning can offer the age-group context. */
  ageGroups: string[]
  sides: PlanSide[]
  defaults: PlanDefaults
  pitchesReserved: number
  /**
   * WHICH SCORING RULES OVALBALL CAN ACTUALLY APPLY, and why not where it cannot. The SERVER decides
   * this, because "can this be calculated" is a fact about the data model rather than about a screen
   * -- and the day tries are recorded, the try bonus becomes live everywhere at once rather than
   * wherever somebody remembers to delete a hardcoded `disabled`.
   */
  scoringRules: ScoringRules | null
  /** How close a defeat has to be, in points, to earn the losing bonus. The RFU figure by default. */
  losingBonusMargin: number | null
  /**
   * THE ORGANISER'S OWN TIE-BREAK ORDER, applied after competition points. A property of the
   * COMPETITION, not of a table: Table A and Table B are ordered by the same rules, and a table
   * carrying its own copy is an invitation to make them differ.
   */
  tieBreakers: TieBreaker[] | null
  /** Null until the organiser starts planning this competition. */
  plan: TournamentPlan | null
}

export interface ScoringRule {
  value: number
  available: boolean
  /** Shown beside a rule Ovalball cannot apply. Never invented on the device. */
  unavailableReason?: string
  /** The losing bonus carries its own threshold. */
  margin?: number
}

export interface ScoringRules {
  win: ScoringRule
  draw: ScoringRule
  loss: ScoringRule
  losingBonus: ScoringRule
  /**
   * NOT AVAILABLE, and that is a fact rather than an oversight. Awarding a try bonus needs TRIES
   * SCORED, and no Ovalball surface records tries for any game -- 24 points might be four tries and
   * two conversions or three tries, two conversions and three penalties. Inferring it would put a
   * point on a table that nobody scored, so the control is disabled against the reason rather than
   * accepting a number the app then quietly drops.
   */
  tryBonus: ScoringRule
}

export const TIE_BREAKERS: { key: TieBreaker; label: string; hint: string }[] = [
  { key: "points_difference", label: "Points Difference", hint: "Points scored minus points conceded" },
  { key: "points_for", label: "Points Scored", hint: "Most points scored" },
  { key: "points_against", label: "Points Conceded", hint: "Fewest points conceded" },
  { key: "head_to_head", label: "Head to Head", hint: "How the level sides did against each other" },
  { key: "wins", label: "Wins", hint: "Most games won" },
]

export async function readTournamentPlan(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  ageGroup: string
): Promise<TournamentPlanContext | null> {
  const { data, error } = await supabase.rpc("get_tournament_plan", {
    p_tournament_id: tournamentId,
    p_age_group: ageGroup,
  })
  if (error) throw error
  if (!data) return null
  return data as unknown as TournamentPlanContext
}

/**
 * WHAT THE PLANNING TAB SAYS BEFORE ANYTHING ELSE.
 *
 * Three states, and the control changes with them: an organiser who has already generated a draft is
 * not offered "Start Planning" as though nothing had happened.
 */
export type PlanStatus =
  | { kind: "none"; title: string; body: string; cta: string }
  | { kind: "draft"; title: string; body: string; cta: string }
  | { kind: "published"; title: string; body: string; cta: string }

export function planStatus(plan: TournamentPlan | null): PlanStatus {
  if (!plan) {
    return {
      kind: "none",
      title: "No plan created yet",
      body: "Once you've confirmed the teams and settings, you can start generating fixtures.",
      cta: "Start Planning",
    }
  }
  if (plan.publicationState === "PUBLISHED") {
    return {
      kind: "published",
      title: "Plan published",
      body:
        plan.gameCount === 1
          ? "1 game is published to participating teams, players and parents."
          : `${plan.gameCount} games are published to participating teams, players and parents.`,
      cta: "View Plan",
    }
  }
  return {
    kind: "draft",
    title: "Planning in progress",
    body:
      plan.gameCount === 0
        ? "Your settings are saved. Nothing has been generated yet."
        : `${plan.gameCount} ${plan.gameCount === 1 ? "game has" : "games have"} been generated. Only you can see them until you publish.`,
    cta: "Continue Planning",
  }
}

/**
 * HOW MANY GAMES A ROUND ROBIN PRODUCES: every side in a table plays every other once, so a table of
 * n gives n(n-1)/2 -- 3 sides 3 games, 4 sides 6, 5 sides 10. A table of one produces none, which is a
 * real answer rather than an error: a side with nobody to play has no games.
 *
 * This is for TELLING the organiser what to expect. The games themselves are generated in the database
 * from the same rule, so there is one implementation of the pairing and this is only arithmetic.
 */
export function roundRobinGameCount(sidesPerTable: number[]): number {
  return sidesPerTable.reduce((total, n) => total + (n * (n - 1)) / 2, 0)
}

/**
 * HOW MANY TABLES ARE EVEN POSSIBLE, and what each would hold.
 *
 * A table needs at least two sides to produce a game, so eight sides can make at most four tables.
 * Offering six would let an organiser build a configuration that cannot generate anything.
 */
export function maxTables(sideCount: number): number {
  return Math.max(1, Math.floor(sideCount / 2))
}

/**
 * The suggested split: as even as the arithmetic allows, with the remainder spread one per table from
 * the first. Eleven sides across three tables is 4 / 4 / 3 rather than 5 / 3 / 3.
 */
export function suggestedTableSizes(sideCount: number, tableCount: number): number[] {
  const n = Math.max(1, tableCount)
  const base = Math.floor(sideCount / n)
  const remainder = sideCount % n
  return Array.from({ length: n }, (_, i) => base + (i < remainder ? 1 : 0))
}

/** "With 8 teams and 2 tables, Ovalball suggests 4 teams per table." */
export function tableGuidance(sideCount: number, tableCount: number): string {
  const sizes = suggestedTableSizes(sideCount, tableCount)
  const even = sizes.every((s) => s === sizes[0])
  const teams = `${sideCount} ${sideCount === 1 ? "team" : "teams"}`
  const tables = `${tableCount} ${tableCount === 1 ? "table" : "tables"}`
  if (even) {
    return `With ${teams} and ${tables}, each table will contain ${sizes[0]} ${sizes[0] === 1 ? "team" : "teams"}. You can adjust the number of teams in each table below.`
  }
  return `With ${teams} and ${tables}, Ovalball suggests ${sizes.join(", ")}. You can adjust the number of teams in each table below.`
}

/** Default names, the ones the organiser may then rename to anything they like. */
export function defaultTableName(index: number): string {
  return `Table ${String.fromCharCode(65 + index)}`
}

/**
 * SPREAD SIDES ACROSS TABLES, PRESERVING EVERY ONE OF THEM.
 *
 * Deterministic given the order it is handed: shuffling is the CALLER'S decision, so that returning to
 * the Tables step never silently redraws an allocation the organiser has already accepted. Once
 * generated, the allocation is explicit draft state.
 */
export function distribute(sides: string[], sizes: number[]): string[][] {
  const out: string[][] = []
  let i = 0
  for (const size of sizes) {
    out.push(sides.slice(i, i + size))
    i += size
  }
  // Anything left over by an under-specified split joins the last table rather than disappearing.
  if (i < sides.length && out.length > 0) out[out.length - 1]!.push(...sides.slice(i))
  return out
}

/**
 * A SHUFFLE THAT KEEPS EVERYBODY. Fisher-Yates over a copy: the result is a permutation, so no side is
 * lost and none is duplicated -- which is asserted permanently, because a randomiser that drops a team
 * loses them from the festival rather than from a list.
 */
export function shuffled<T>(items: T[], random: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1))
    const a = out[i]!
    out[i] = out[j]!
    out[j] = a
  }
  return out
}

/** Whether this arrangement can be generated from, and why not when it cannot. */
export function tableProblem(tables: { name: string; sides: string[] }[], sideCount: number): string | null {
  // A DUPLICATE IS REPORTED BEFORE A COUNT, because it is the more useful of the two sentences. Four
  // teams with one of them in two tables also fails the count, and "5 are placed" when the competition
  // has 4 teams tells an organiser something they cannot act on.
  const seen = new Set<string>()
  for (const t of tables) {
    for (const s of t.sides) {
      if (seen.has(s)) return "A team can only be in one table."
      seen.add(s)
    }
  }
  const placed = tables.reduce((n, t) => n + t.sides.length, 0)
  if (placed !== sideCount) {
    return `All ${sideCount} teams must be in a table. ${placed} ${placed === 1 ? "is" : "are"} placed.`
  }
  const empty = tables.filter((t) => t.sides.length < 2)
  if (empty.length > 0) {
    return `${empty.map((t) => t.name).join(", ")} ${empty.length === 1 ? "needs" : "need"} at least 2 teams to play a game.`
  }
  return null
}

/**
 * THE GENERATED DRAFT, AS THE ORGANISER READS IT BACK.
 *
 * Generation used to end at a number -- "12 games have been created" -- and a number is not a plan.
 * The organiser has to be able to SEE who is playing whom, in which table, in which round, and at what
 * time, before any of it is worth publishing. These are the real rows in `tournament_games`, read back
 * from the database rather than re-derived on the phone: what is drawn is what exists.
 *
 * A TIME THAT IS NOT DECIDED IS NULL, and the screen says so in words. The alternative -- showing the
 * first kick-off because it is the likeliest -- is the kind of plausible invention that gets a side
 * standing on the wrong pitch at nine in the morning.
 */
export interface DraftGameSide {
  participantId: string
  clubName: string
  crestPath: string | null
  label: string
}

export interface DraftGame {
  /** Null in a preview: nothing has been created, so nothing has an id. */
  id: string | null
  round: number | null
  date: string | null
  /** "10:25:00", or null when no pitch time has been assigned yet. */
  startTime: string | null
  durationMinutes: number | null
  pitchName: string | null
  sideA: DraftGameSide
  sideB: DraftGameSide
}

export interface DraftRound {
  round: number
  games: DraftGame[]
}

export interface DraftTableGroup {
  id: string
  name: string
  /** Who is in this table. A round's pairings mean nothing without it. */
  sides: (DraftGameSide & { isHost: boolean })[]
  rounds: DraftRound[]
}

export interface TournamentPlanDraft {
  tournamentId: string
  tournamentName: string
  ageGroup: string
  venueName: string | null
  /**
   * The competition's shape. A knockout's games carry no table, so a draft screen that only knows how
   * to group by table would read a generated knockout as an empty round robin.
   */
  format: string | null
  /** True when this is what generation WOULD produce. Nothing has been created. */
  preview: boolean
  plan: {
    id: string
    publicationState: PlanPublicationState
    version: number
    publishedAt: string | null
    gameDurationMinutes: number
    days: string[]
    gameCount: number
    /** How many of those games have a kick-off time, and a pitch. Counted at the source. */
    scheduledCount: number
    pitchedCount: number
    readiness: PlanReadiness | null
  } | null
  tables: DraftTableGroup[]
  /** A Swiss round's reserved kick-off, before anybody is paired into it (20270725). */
  upcomingRounds?: SwissUpcomingRound[]
  /** Who sits out each Swiss round, awarded a win. */
  byes?: SwissBye[]
}

/**
 * WHETHER THIS COMPETITION KEEPS A TABLE. One call, one authority; nothing works it out from the
 * format, because the format is only the default and the organiser's answer outranks it.
 */
export async function setPlanStandings(
  supabase: SupabaseClient<Database>,
  planId: string,
  enabled: boolean
): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_plan_standings", {
    p_plan_id: planId,
    p_enabled: enabled,
  })
  if (error) throw error
}

export async function readTournamentPlanDraft(
  supabase: SupabaseClient<Database>,
  tournamentId: string,
  ageGroup: string,
  preview = false
): Promise<TournamentPlanDraft | null> {
  const { data, error } = await supabase.rpc("get_tournament_plan_draft", {
    p_tournament_id: tournamentId,
    p_age_group: ageGroup,
    p_preview: preview,
  })
  if (error) throw error
  if (!data) return null
  return data as unknown as TournamentPlanDraft
}

/**
 * WHAT A GAME'S TIME AND PLACE SAY, in the three states that actually occur.
 *
 * NOT "TBC". A time that has not been worked out yet and a time nobody will ever set look the same to
 * an organiser reading "TBC", and only one of them is their job to fix.
 */
export function gameWhen(game: DraftGame): string {
  return game.startTime ? game.startTime.slice(0, 5) : "Time not assigned"
}

export function gameWhere(game: DraftGame): string {
  return game.pitchName ?? "Pitch not assigned"
}

/**
 * HOW FINISHED THIS DRAFT IS, in one sentence, from counts the database did.
 *
 * It names what is MISSING rather than congratulating the organiser on what is present, because the
 * missing part is the only part that needs them.
 */
export function draftCompleteness(plan: NonNullable<TournamentPlanDraft["plan"]>): string {
  if (plan.gameCount === 0) return "No games have been generated yet."
  const unplaced = plan.gameCount - plan.scheduledCount
  if (unplaced === 0 && plan.pitchedCount === plan.gameCount) {
    return `All ${plan.gameCount} games have a time and a pitch.`
  }
  if (plan.scheduledCount === 0) {
    return `${plan.gameCount} ${plan.gameCount === 1 ? "game" : "games"} drawn. No times or pitches yet. Reserve pitches for the playing days, then schedule the games.`
  }
  return `${plan.scheduledCount} of ${plan.gameCount} games have a time and a pitch. ${unplaced} still ${unplaced === 1 ? "needs" : "need"} one.`
}

/**
 * WHAT REGENERATING WOULD THROW AWAY, said plainly enough to decide on.
 *
 * A generic "are you sure?" teaches people to press Yes. This names the cost, and it is only alarming
 * when there is something to be alarmed about: twelve machine-made pairings are nothing, the four an
 * organiser spent the morning placing are not.
 */
export interface RegenerationCost {
  publicationState: PlanPublicationState
  gameCount: number
  placedCount: number
  /** Games the organiser placed by hand (20270736) -- the part of a regeneration worth naming. */
  handPlacedCount?: number
  recordedResultCount: number
}

export function regenerationWarning(cost: RegenerationCost): string {
  if (cost.gameCount === 0) return "This will draw the fixtures for every table."
  const parts = [
    `This replaces all ${cost.gameCount} generated ${cost.gameCount === 1 ? "game" : "games"}.`,
  ]
  if (cost.recordedResultCount > 0) {
    parts.push(
      `${cost.recordedResultCount} ${cost.recordedResultCount === 1 ? "game has" : "games have"} a recorded result, which will be lost.`
    )
  } else if ((cost.handPlacedCount ?? 0) > 0) {
    // THE ORGANISER'S OWN WORK, named as theirs: these are the games somebody placed by hand, and
    // regenerating makes new pairings, so their places go with them.
    const n = cost.handPlacedCount ?? 0
    parts.push(`${n === 1 ? "1 game you placed" : `${n} games you placed`} by hand will lose ${n === 1 ? "its" : "their"} time and pitch.`)
  } else if (cost.placedCount > 0) {
    // NOT "a time you set" when nobody has set one: every placed game was placed by the scheduler, and
    // telling an organiser they are about to lose their own work when they have not done any is the
    // kind of warning that gets ignored the day it matters.
    parts.push(
      `${cost.placedCount === cost.gameCount ? "Their" : `${cost.placedCount} of their`} times and pitches will be drawn again.`
    )
  }
  if (cost.publicationState === "PUBLISHED" && cost.recordedResultCount === 0) {
    parts.push("The plan is published, so every team is told the schedule has been regenerated.")
  }
  return parts.join(" ")
}

export async function readRegenerationCost(
  supabase: SupabaseClient<Database>,
  planId: string
): Promise<RegenerationCost> {
  const { data, error } = await supabase.rpc("tournament_plan_regeneration_cost", { p_plan_id: planId })
  if (error) throw error
  return data as unknown as RegenerationCost
}

/**
 * THE DRAFT, REGROUPED BY THE DAY IT IS PLAYED ON.
 *
 * A competition that runs across a weekend is not one list with a date stamped on each row. An
 * organiser reading Sunday morning needs Sunday, and a table's rounds legitimately straddle the two:
 * Rounds 1 and 2 on the Saturday, Round 3 on the Sunday, with the same four sides throughout.
 *
 * So the hierarchy gains a level at the top and loses nothing below it --
 *
 *     DAY  ->  TABLE  ->  ROUND  ->  GAMES
 *
 * A table appears under a day only if it plays that day, and carries its full membership each time,
 * because "Round 3: Burnley v Wigan" on the Sunday page means nothing without the table it belongs to.
 *
 * A SINGLE-DAY PLAN GETS NO DAY LEVEL AT ALL. `draftDays` returns one unnamed group, and the screen
 * draws the tables directly: repeating "Saturday 7 Nov" above every table on a one-day festival is
 * chrome that says nothing.
 *
 * GAMES WITH NO DATE ARE NOT INVENTED INTO ONE. They collect under a null day, which the screen names
 * honestly, exactly as an unassigned time and pitch are named.
 */
export interface DraftDayGroup {
  /** The ISO day, or null for games that have not been placed on one. */
  date: string | null
  tables: DraftTableGroup[]
}

export function draftDays(draft: TournamentPlanDraft): DraftDayGroup[] {
  const dates = new Set<string | null>()
  for (const table of draft.tables) {
    for (const round of table.rounds) {
      for (const game of round.games) dates.add(game.date ?? null)
    }
  }

  // ONE GROUP WHEN THERE IS ONE DAY -- or none at all, which is a preview before anything is placed.
  if (dates.size <= 1) {
    return [{ date: [...dates][0] ?? null, tables: draft.tables }]
  }

  const ordered = [...dates].sort((a, b) => {
    if (a === null) return 1 // undated games sit after the days that are decided
    if (b === null) return -1
    return a < b ? -1 : a > b ? 1 : 0
  })

  return ordered.map((date) => ({
    date,
    tables: draft.tables
      .map((table) => ({
        ...table,
        rounds: table.rounds
          .map((round) => ({ ...round, games: round.games.filter((g) => (g.date ?? null) === date) }))
          .filter((round) => round.games.length > 0),
      }))
      .filter((table) => table.rounds.length > 0),
  }))
}

/** "Saturday 7 November" -- the day's own name, for a heading that separates one day from the next. */
export function draftDayLabel(date: string | null): string {
  if (!date) return "Day not assigned"
  const [y, m, d] = date.split("-").map(Number)
  if (!y || !m || !d) return date
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
  const months = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"]
  return `${days[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${d} ${months[m - 1]}`
}
