import type { SupabaseClient } from "@supabase/supabase-js"

import type { Database } from "../database"
import type { PlanPublicationState } from "./planning"
import type { PlanReadiness } from "./readiness"

type Client = SupabaseClient<Database>

/**
 * A TOURNAMENT PLAN AS A SCHEDULE -- what View Plan reads and Edit Plan changes (20270736).
 *
 * ONE PLANNER. The plan is still `tournament_plans` and its games are still `tournament_games` and
 * `tournament_bracket_pairings`; this module only reads them as a schedule and sends a set of moves back
 * through the one governed write, `save_tournament_plan_schedule`. Nothing here decides who plays whom.
 *
 * THE CLASH RULES LIVE IN THE DATABASE (`internal.tournament_schedule_conflicts`), which refuses a move and
 * holds publication. `scheduleConflicts` below is the same arithmetic run on the phone so a staged move can
 * say whether it works BEFORE it is saved -- the pitch-allocation board's "conflicts before drop". It
 * produces the server's sentences word for word, and the server stays the authority: a move the phone
 * thinks is fine and the server refuses is refused, with the server's words.
 *
 *   - Several games may share a kick-off on DIFFERENT pitches. That is a festival.
 *   - A pitch takes as many games at once as the ORGANISER has marked it out for that day (1-4 playing
 *     areas on its reservation; the club's own layout is only the default) -- owner's rule, 2026-10-03 --
 *     and each game must fit one area: its RFU pitch (U10 60m x 35m, U12 60m x 43m, where Ovalball holds
 *     the size with its source) within the pitch's ground shared by the areas. A full-size pitch marked
 *     out for three takes three U10 games, but no U12 game fits a third of it.
 *   - The next game on a pitch waits for the changeover after the last one.
 *   - A team is in one game at a time.
 *   - A knockout or Swiss round starts once the round before it has finished.
 *   - A game is played on a pitch the tournament has reserved for that time.
 *
 * Across every competition of the tournament: U10 and U12 on Pitch 1 at 09:30 is one pitch.
 */

// ------------------------------------------------------------------ the read

export interface ScheduleSide {
  participantId: string
  clubName: string
  crestPath: string | null
  label: string
  isHost: boolean
}

export interface ScheduleGame {
  /** The game's id, or a knockout place's id while its sides are not yet known. */
  id: string
  kind: "game" | "place"
  gameId: string | null
  placeId: string | null
  round: number | null
  gamePosition?: number | null
  tableId: string | null
  tableName: string | null
  /** A knockout or Swiss round (a hybrid's group stage is 0); null where rounds are not ordered. */
  stageRound: number | null
  isThirdPlace: boolean
  /** "Final", "Semi Final", "Round 2" -- the competition's own name for this game's round. */
  roundLabel: string | null
  /** "The Final", "A Semi Final" -- how a round-order clash names this game. */
  roundSubject: string | null
  /** "the Semi Finals", "Round 1", "the group stage" -- how a round-order clash names this game's round. */
  roundWhole: string | null
  sideA: ScheduleSide | null
  sideB: ScheduleSide | null
  date: string | null
  /** "HH:MM", or null while the game has no kick-off. */
  startTime: string | null
  durationMinutes: number
  pitchId: string | null
  pitchName: string | null
  /** The organiser chose this day, kick-off and pitch: Schedule Games leaves it where it is. */
  placedByHand: boolean
  /** It has a result: its time and pitch are history and it does not move. */
  isHistory: boolean
  status: string
  resultStatus: string
  sideAScore: number | null
  sideBScore: number | null
}

export interface ScheduleReservation {
  id?: string
  date: string
  startTime: string
  endTime: string
  /** How many games the pitch takes at once during this reservation: the organiser's marking, or the club's layout. */
  playingAreas?: number
  /** Whether the organiser marked it out for the tournament (otherwise it is the club's own layout). */
  markedByOrganiser?: boolean
}

export interface SchedulePitch {
  pitchId: string
  name: string
  /** The club's own layout -- how many games it takes at once when the organiser has not said otherwise. */
  areas: number
  /** Its ground, in square metres of field of play (a full-size pitch is 100m x 70m). */
  areaM2: number
  layout: "full_only" | "two_halves" | "four_quarters" | string
  reservations: ScheduleReservation[] | null
}

/** A game of another competition, or an older hand-made game, already on these pitches. */
export interface ScheduleOther {
  unitId: string
  ageGroup: string
  date: string
  startTime: string
  endTime: string
  occupiedUntil: string
  pitchId: string | null
  /** How much ground one of its games needs, in square metres. */
  gameAreaM2: number
  sideIds: string[]
  isHistory: boolean
}

export type ConflictCode = "PITCH_CLASH" | "PITCH_TOO_SMALL" | "PITCH_TURNAROUND" | "SIDE_CLASH" | "ROUND_ORDER" | "PITCH_NOT_RESERVED"

export interface ScheduleConflict {
  code: ConflictCode
  unitIds: string[]
  pitchId: string | null
  date: string
  at: string
  message: string
}

export interface PlanSchedule {
  planId: string
  tournamentId: string
  tournamentName: string
  ageGroup: string
  format: string | null
  publicationState: PlanPublicationState
  publishedAt: string | null
  gameDurationMinutes: number
  changeoverMinutes: number
  dayStartTime: string
  dayEndTime: string
  /** The age grade's own limit: two halves of the regulation length. Null where none is recorded. */
  maxDurationMinutes: number | null
  /** How much ground one game of this competition needs, in square metres: its RFU pitch where sourced. */
  gameAreaM2: number
  days: string[]
  pitches: SchedulePitch[]
  games: ScheduleGame[]
  others: ScheduleOther[]
  conflicts: ScheduleConflict[]
  readiness: PlanReadiness | null
}

export async function readPlanSchedule(supabase: Client, planId: string): Promise<PlanSchedule | null> {
  const { data, error } = await supabase.rpc("get_tournament_plan_schedule", { p_plan_id: planId })
  if (error) throw error
  return (data as unknown as PlanSchedule) ?? null
}

// ------------------------------------------------------------------ the writes

/** Where one game (or knockout place) is to be: a day, a kick-off, a pitch, and its own length. */
export interface ScheduleMove {
  date: string
  startTime: string
  pitchId: string
  durationMinutes: number
}

/** A set of staged moves, keyed by the game's (or place's) id. */
export type StagedMoves = ReadonlyMap<string, ScheduleMove>

/**
 * SAVE CHANGES: every staged move in ONE write, validated by the server as one arrangement -- so two games
 * can swap places -- and, once the plan is published, each team in a moved game is told once.
 */
export async function savePlanSchedule(
  supabase: Client,
  schedule: Pick<PlanSchedule, "planId" | "games">,
  staged: StagedMoves
): Promise<{ changed: number; readiness: PlanReadiness }> {
  const byId = new Map(schedule.games.map((g) => [g.id, g]))
  const changes = [...staged.entries()].map(([id, m]) => {
    const g = byId.get(id)
    const target = g?.kind === "place" ? { placeId: g.placeId ?? id } : { gameId: g?.gameId ?? id }
    return { ...target, date: m.date, startTime: m.startTime, pitchId: m.pitchId, durationMinutes: g?.kind === "place" ? undefined : m.durationMinutes }
  })
  const { data, error } = await supabase.rpc("save_tournament_plan_schedule", {
    p_plan_id: schedule.planId,
    p_changes: changes as unknown as Database["public"]["Functions"]["save_tournament_plan_schedule"]["Args"]["p_changes"],
  })
  if (error) throw error
  return data as unknown as { changed: number; readiness: PlanReadiness }
}

/**
 * SCHEDULE GAMES: Ovalball places every game it may. By default the games an organiser placed by hand
 * stay where they are; `keepHandPlaced: false` places those again too -- the confirmation says so first.
 */
export async function scheduleTournamentPlanGames(supabase: Client, planId: string, keepHandPlaced = true): Promise<PlanReadiness> {
  const { data, error } = await supabase.rpc("schedule_tournament_plan", { p_plan_id: planId, p_keep_hand_placed: keepHandPlaced })
  if (error) throw error
  return data as unknown as PlanReadiness
}

/**
 * DELETE PLAN: the competition goes back to "not planned". Its games, their times and pitches, its tables
 * and settings go; its teams stay entered and the tournament's pitches stay reserved. Refused by the
 * server while any game has a result.
 */
export async function deleteTournamentPlan(
  supabase: Client,
  planId: string
): Promise<{ ageGroup: string; deletedGames: number; wasPublished: boolean }> {
  const { data, error } = await supabase.rpc("delete_tournament_plan", { p_plan_id: planId })
  if (error) throw error
  return data as unknown as { ageGroup: string; deletedGames: number; wasPublished: boolean }
}

/**
 * CHANGE THE TABLES. A published plan's games were built from its tables, so changing them is refused
 * (hint TOURNAMENT_TABLES_REPLACE_GAMES) until `replaceGames` confirms the games are to be regenerated.
 */
export async function setPlanTables(
  supabase: Client,
  planId: string,
  tables: { name: string; sides: string[] }[],
  replaceGames = false
): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_plan_tables", {
    p_plan_id: planId,
    p_tables: tables as unknown as Database["public"]["Functions"]["set_tournament_plan_tables"]["Args"]["p_tables"],
    p_replace_games: replaceGames,
  })
  if (error) throw error
}

// ------------------------------------------------------------------ the Planning tab

/** Where one competition's planning has got to -- read without creating anything. */
export interface PlanSummary {
  ageGroup: string
  planId: string | null
  publicationState: PlanPublicationState | null
  format: string | null
  publishedAt: string | null
  updatedAt: string | null
  gameCount: number
  placeCount: number
  scheduledCount: number
  resultCount: number
  conflictCount: number
  firstDay: string | null
  lastDay: string | null
}

export async function readPlanSummaries(supabase: Client, tournamentId: string): Promise<PlanSummary[]> {
  const { data, error } = await supabase.rpc("get_tournament_plan_summaries", { p_tournament_id: tournamentId })
  if (error) throw error
  return (data as unknown as PlanSummary[]) ?? []
}

/** What a Planning control does. The screen maps each to its one route. */
export type PlanningIntent = "plan" | "continue" | "view" | "edit" | "tables" | "delete"

export interface PlanningControl {
  intent: PlanningIntent
  label: string
}

export interface PlanningCard {
  kind: "none" | "draft" | "published"
  /** A status, so sentence case. */
  status: string
  pill: string
  body: string
  /** One line that needs the organiser, when something does. */
  attention: string | null
  primary: PlanningControl
  secondary: PlanningControl[]
  /** Delete Plan / Delete Draft -- present in every planned state; the sheet explains when it cannot. */
  remove: PlanningControl | null
}

const games = (n: number) => `${n} ${n === 1 ? "game" : "games"}`

/**
 * THE PLANNING TAB, DECIDED BY WHERE THE PLAN IS.
 *
 *   NO PLAN    Plan Tournament.
 *   DRAFT      Continue Planning (the plan itself once games exist, the setup before) and Delete Draft.
 *   PUBLISHED  View Plan, Edit Plan, Edit Tables and Delete Plan.
 *
 * Opening the first-time wizard is never the way to look at, or change, a plan that already exists.
 */
export function planningCard(summary: PlanSummary | null | undefined): PlanningCard {
  if (!summary || !summary.planId) {
    return {
      kind: "none",
      status: "No plan yet",
      pill: "Not Planned",
      body: "Planning sets the days, tables and settings, then generates the games with kick-off times and pitches. Nobody else sees anything until you publish.",
      attention: null,
      primary: { intent: "plan", label: "Plan Tournament" },
      secondary: [],
      remove: null,
    }
  }
  const total = summary.gameCount + summary.placeCount
  const placed = summary.scheduledCount
  const attention =
    summary.conflictCount > 0
      ? `${summary.conflictCount} ${summary.conflictCount === 1 ? "clash needs" : "clashes need"} changing before ${summary.publicationState === "PUBLISHED" ? "the teams can rely on this schedule" : "this can be published"}.`
      : summary.gameCount > 0 && placed < summary.gameCount
        ? `${summary.gameCount - placed} of ${games(summary.gameCount)} ${summary.gameCount - placed === 1 ? "has" : "have"} no kick-off time or pitch yet.`
        : null

  if (summary.publicationState === "PUBLISHED") {
    const hasTables = summary.format !== "knockout"
    return {
      kind: "published",
      status: summary.resultCount > 0 ? "Published, under way" : "Published",
      pill: summary.resultCount > 0 ? "In Progress" : "Published",
      body: `${games(total)} published to participating teams, players and parents. Changes you save are sent to the teams they affect.`,
      attention,
      primary: { intent: "view", label: "View Plan" },
      secondary: [{ intent: "edit", label: "Edit Plan" }, ...(hasTables ? [{ intent: "tables" as const, label: "Edit Tables" }] : [])],
      remove: { intent: "delete", label: "Delete Plan" },
    }
  }

  return {
    kind: "draft",
    status: total === 0 ? "Draft, not generated yet" : "Draft",
    pill: "Draft",
    body:
      total === 0
        ? "Your days, tables and settings are saved. No games have been generated yet."
        : `${games(total)} generated, ${placed} with a kick-off time and a pitch. Only your club can see them until you publish.`,
    attention,
    primary: { intent: "continue", label: "Continue Planning" },
    secondary: [],
    remove: { intent: "delete", label: "Delete Draft" },
  }
}

/** Where Continue Planning goes: the setup until there are games, the plan itself once there are. */
export function continueGoesToPlan(summary: PlanSummary): boolean {
  return summary.gameCount + summary.placeCount > 0
}

/** The Delete sheet's words: what goes, what stays, who is told -- or why it cannot happen. */
export function deletePlanSheet(summary: PlanSummary): { title: string; body: string; confirm: string | null } {
  if (summary.resultCount > 0) {
    return {
      title: "This Plan Cannot Be Deleted",
      body: `${summary.resultCount === 1 ? "1 game" : `${summary.resultCount} games`} in the ${summary.ageGroup} plan ${summary.resultCount === 1 ? "has a result" : "have results"}. Deleting the plan would delete ${summary.resultCount === 1 ? "it" : "them"}, so it stays. Results are only cleared deliberately, with a reason.`,
      confirm: null,
    }
  }
  const total = summary.gameCount + summary.placeCount
  const what = total > 0 ? `its ${games(total)}, their kick-off times and pitches, its tables and settings` : "its days, tables and settings"
  if (summary.publicationState === "PUBLISHED") {
    return {
      title: "Delete Plan?",
      body: `This withdraws the published ${summary.ageGroup} schedule: ${what}. The teams stay entered and the tournament's pitches stay reserved. Every participating team is told the schedule has been withdrawn.`,
      confirm: "Delete Plan",
    }
  }
  return {
    title: "Delete Draft?",
    body: `This deletes the ${summary.ageGroup} draft: ${what}. The teams stay entered and the tournament's pitches stay reserved. Nobody else has seen this draft.`,
    confirm: "Delete Draft",
  }
}

// ------------------------------------------------------------------ time

/** "09:50" -> 590. */
export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.slice(0, 5).split(":").map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

/** 590 -> "09:50". Held at the end of the day rather than wrapping past midnight, as the server does. */
export function fromMinutes(minutes: number): string {
  const m = Math.max(0, Math.min(minutes, 23 * 60 + 59))
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "Sat 25 Oct" -- the server's own 'FMDy FMDD Mon'. */
export function shortDay(iso: string): string {
  const [y, mo, d] = iso.split("-").map(Number)
  if (!y || !mo || !d) return iso
  return `${DAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()]} ${d} ${MONTHS[mo - 1]}`
}

export function countWord(n: number): string {
  return ["", "one", "two", "three", "four", "five", "six"][n] ?? String(n)
}

// ------------------------------------------------------------------ the clash engine

interface Unit {
  unitId: string
  mine: boolean
  ageGroup: string
  date: string
  start: number
  end: number
  occupiedUntil: number
  pitchId: string | null
  gameArea: number
  sideIds: string[]
  isHistory: boolean
  stageRound: number | null
  isThird: boolean
  roundSubject: string | null
  roundWhole: string | null
}

/** Where a game now is: its staged move if it has one, otherwise where the server has it. */
export function placementOf(game: ScheduleGame, staged: StagedMoves): { date: string | null; startTime: string | null; pitchId: string | null; durationMinutes: number } {
  const m = staged.get(game.id)
  if (m) return { date: m.date, startTime: m.startTime, pitchId: m.pitchId, durationMinutes: m.durationMinutes }
  return { date: game.date, startTime: game.startTime, pitchId: game.pitchId, durationMinutes: game.durationMinutes }
}

function unitsOf(schedule: PlanSchedule, staged: StagedMoves): Unit[] {
  const units: Unit[] = []
  for (const g of schedule.games) {
    if (g.status === "CANCELLED") continue
    const p = placementOf(g, staged)
    if (!p.date || !p.startTime) continue
    const start = toMinutes(p.startTime)
    const duration = g.kind === "place" ? schedule.gameDurationMinutes : p.durationMinutes
    units.push({
      unitId: g.id,
      mine: true,
      ageGroup: schedule.ageGroup,
      date: p.date,
      start,
      end: Math.min(start + duration, 23 * 60 + 59),
      occupiedUntil: Math.min(start + duration + schedule.changeoverMinutes, 23 * 60 + 59),
      pitchId: p.pitchId,
      gameArea: schedule.gameAreaM2,
      sideIds: [g.sideA?.participantId, g.sideB?.participantId].filter((x): x is string => !!x),
      isHistory: g.isHistory,
      stageRound: g.stageRound,
      isThird: g.isThirdPlace,
      roundSubject: g.roundSubject,
      roundWhole: g.roundWhole,
    })
  }
  for (const o of schedule.others) {
    units.push({
      unitId: o.unitId,
      mine: false,
      ageGroup: o.ageGroup,
      date: o.date,
      start: toMinutes(o.startTime),
      end: toMinutes(o.endTime),
      occupiedUntil: toMinutes(o.occupiedUntil),
      pitchId: o.pitchId,
      gameArea: o.gameAreaM2,
      sideIds: o.sideIds,
      isHistory: o.isHistory,
      stageRound: null,
      isThird: false,
      roundSubject: null,
      roundWhole: null,
    })
  }
  return units
}

/** Reservations that meet are one window, so a game played across 11:00 is covered by 09:00-11:00 + 11:00-13:00. */
export function pitchCovers(pitch: SchedulePitch | undefined, date: string, from: number, until: number): boolean {
  if (!pitch || until <= from) return false
  const windows = (pitch.reservations ?? [])
    .filter((r) => r.date === date)
    .map((r) => [toMinutes(r.startTime), toMinutes(r.endTime)] as const)
    .sort((a, b) => a[0] - b[0])
  let reach = from
  for (const [s, e] of windows) {
    if (s <= reach && e > reach) reach = e
    if (reach >= until) return true
  }
  return reach >= until
}

/**
 * HOW A PITCH IS MARKED OUT AT A MOMENT: the organiser's playing areas for the reservation covering it,
 * otherwise the club's own layout -- `internal.tournament_pitch_areas_at`.
 */
export function areasAt(pitch: SchedulePitch | undefined, date: string, minutes: number): number {
  if (!pitch) return 1
  const covering = (pitch.reservations ?? [])
    .filter((r) => r.date === date && r.markedByOrganiser !== false && r.playingAreas != null
      && toMinutes(r.startTime) <= minutes && minutes < toMinutes(r.endTime))
    .sort((a, b) => toMinutes(b.startTime) - toMinutes(a.startTime))[0]
  return covering?.playingAreas ?? pitch.areas ?? 1
}

/** Which clash to name first when one change makes several -- the server's own ranking. */
export function conflictRank(code: ConflictCode): number {
  return { SIDE_CLASH: 1, ROUND_ORDER: 2, PITCH_TOO_SMALL: 3, PITCH_CLASH: 4, PITCH_TURNAROUND: 5, PITCH_NOT_RESERVED: 6 }[code]
}

/**
 * EVERY CLASH IN THE ARRANGEMENT, with the staged moves applied -- the same rules and the same sentences
 * as `internal.tournament_schedule_conflicts`. Only clashes that involve this competition are returned;
 * a clash made only of games that already have results is not, because nothing can fix it.
 */
export function scheduleConflicts(schedule: PlanSchedule, staged: StagedMoves = new Map()): ScheduleConflict[] {
  const units = unitsOf(schedule, staged)
  const pitches = new Map(schedule.pitches.map((p) => [p.pitchId, p]))
  const sides = new Map<string, ScheduleSide>()
  for (const g of schedule.games) {
    if (g.sideA) sides.set(g.sideA.participantId, g.sideA)
    if (g.sideB) sides.set(g.sideB.participantId, g.sideB)
  }
  const out: ScheduleConflict[] = []
  const hhmm = fromMinutes

  // ---- pitches: each kick-off on each pitch, once
  const kickoffs = new Map<string, { pitchId: string; date: string; at: number }>()
  for (const u of units) if (u.pitchId) kickoffs.set(`${u.pitchId}|${u.date}|${u.start}`, { pitchId: u.pitchId, date: u.date, at: u.start })
  for (const k of kickoffs.values()) {
    const pitch = pitches.get(k.pitchId)
    if (!pitch) continue
    const here = units.filter((b) => b.pitchId === k.pitchId && b.date === k.date && b.start <= k.at && k.at < b.occupiedUntil)
    if (here.length === 0 || here.every((b) => b.isHistory)) continue
    const areas = Math.max(1, areasAt(pitch, k.date, k.at))
    const playing = here.filter((b) => k.at < b.end)
    const finished = here.filter((b) => b.end <= k.at)
    const biggest = [...playing].sort((a, b) => b.gameArea - a.gameArea || a.start - b.start)[0]
    let code: ConflictCode | null = null
    if (biggest && biggest.gameArea > pitch.areaM2 / areas + 0.001) code = "PITCH_TOO_SMALL"
    else if (playing.length > areas) code = "PITCH_CLASH"
    else if (here.length > areas) code = "PITCH_TURNAROUND"
    if (!code) continue
    let message: string
    if (code === "PITCH_TOO_SMALL") {
      message = areas <= 1
        ? `${pitch.name} is too small for a ${biggest?.ageGroup ?? schedule.ageGroup} game. Move it to a bigger pitch.`
        : `${pitch.name} is marked out for ${countWord(areas)} games at ${hhmm(k.at)}, and a ${biggest?.ageGroup ?? schedule.ageGroup} game needs more room than one of those areas. Mark it out for fewer games, or move this one.`
    } else if (code === "PITCH_CLASH") {
      message = areas <= 1
        ? `${pitch.name} has ${countWord(playing.length)} games at ${hhmm(k.at)}, but it takes one game at a time.`
        : `${pitch.name} has ${countWord(playing.length)} games at ${hhmm(k.at)}, but it is marked out for ${countWord(areas)}.`
    } else {
      const finishedAt = Math.max(...finished.map((b) => b.end))
      const turnaround = Math.max(...finished.map((b) => b.occupiedUntil - b.end))
      message = `${pitch.name} needs ${turnaround} minutes between games: a game finishes at ${hhmm(finishedAt)} and the next kicks off at ${hhmm(k.at)}.`
    }
    out.push({ code, unitIds: here.map((b) => b.unitId), pitchId: k.pitchId, date: k.date, at: hhmm(k.at), message })
  }

  // ---- teams: one game at a time
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i]!
      const b = units[j]!
      if (a.date !== b.date || a.isHistory && b.isHistory) continue
      if (!(a.start < b.end && b.start < a.end)) continue
      const shared = a.sideIds.find((s) => b.sideIds.includes(s))
      if (!shared) continue
      const side = sides.get(shared)
      const who = side ? `${side.clubName} ${side.label}` : "A team"
      const first = Math.min(a.start, b.start)
      const second = Math.max(a.start, b.start)
      out.push({
        code: "SIDE_CLASH",
        unitIds: [a.unitId, b.unitId],
        pitchId: null,
        date: a.date,
        at: hhmm(second),
        message: a.start === b.start
          ? `${who} is scheduled in two games at ${hhmm(a.start)}.`
          : `${who} is scheduled in two games at once, at ${hhmm(first)} and ${hhmm(second)}.`,
      })
    }
  }

  // ---- rounds in order
  const stamp = (date: string, minutes: number) => `${date}T${hhmm(minutes)}`
  for (const b of units) {
    if (b.stageRound === null || !b.mine) continue
    const before = units.filter((a) => a.mine && a.stageRound !== null && a.stageRound < b.stageRound! && stamp(b.date, b.start) < stamp(a.date, a.end))
    if (before.length === 0) continue
    if (b.isHistory && before.every((a) => a.isHistory)) continue
    const blocking = [...before].sort((x, y) => (stamp(y.date, y.end) < stamp(x.date, x.end) ? -1 : 1))[0]!
    out.push({
      code: "ROUND_ORDER",
      unitIds: [b.unitId, blocking.unitId],
      pitchId: null,
      date: b.date,
      at: hhmm(b.start),
      message: `${b.roundSubject ?? "This game"} cannot kick off at ${hhmm(b.start)}: the last game of ${blocking.roundWhole ?? "the round before"} ends at ${hhmm(blocking.end)}. A round starts once the round before it has finished.`,
    })
  }

  // ---- reserved pitches
  for (const u of units) {
    if (!u.pitchId || u.isHistory) continue
    if (pitchCovers(pitches.get(u.pitchId), u.date, u.start, u.end)) continue
    out.push({
      code: "PITCH_NOT_RESERVED",
      unitIds: [u.unitId],
      pitchId: u.pitchId,
      date: u.date,
      at: hhmm(u.start),
      message: `${pitches.get(u.pitchId)?.name ?? "That pitch"} is not reserved for this tournament from ${hhmm(u.start)} to ${hhmm(u.end)} on ${shortDay(u.date)}.`,
    })
  }

  const mine = new Set(units.filter((u) => u.mine).map((u) => u.unitId))
  return out
    .filter((c) => c.unitIds.some((id) => mine.has(id)))
    .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : x.at < y.at ? -1 : x.at > y.at ? 1 : conflictRank(x.code) - conflictRank(y.code)))
}

/** The clashes one game is part of, the most useful first -- what its row and its sheet say. */
export function conflictsFor(conflicts: ScheduleConflict[], unitId: string): ScheduleConflict[] {
  return conflicts
    .filter((c) => c.unitIds.includes(unitId))
    .sort((x, y) => conflictRank(x.code) - conflictRank(y.code) || (x.at < y.at ? -1 : 1))
}

/**
 * WHAT IS WRONG WITH A MOVE BEFORE IT IS EVEN A CLASH -- the server's own refusals, in its own words:
 * a played game, a day the competition does not play, a time outside its hours, a length the age grade
 * does not allow, a pitch the tournament has not reserved.
 */
export function moveProblem(schedule: PlanSchedule, game: ScheduleGame, move: ScheduleMove): string | null {
  if (game.isHistory) return "This game already has a result, so its time and pitch are history and cannot be moved."
  const duration = game.kind === "place" ? schedule.gameDurationMinutes : move.durationMinutes
  if (!move.date || !move.startTime || !move.pitchId) return "A game needs a day, a kick-off time and a pitch."
  if (duration < 1 || duration > 240) return "A game lasts between 1 and 240 minutes."
  if (schedule.maxDurationMinutes !== null && duration > schedule.maxDurationMinutes) {
    return `A ${schedule.ageGroup} game may be at most ${schedule.maxDurationMinutes} minutes under the age-grade regulations.`
  }
  if (!schedule.days.includes(move.date)) return "That day is not one of this competition's playing days."
  const start = toMinutes(move.startTime)
  const end = start + duration
  if (end > 24 * 60) return "A game cannot run past midnight."
  if (start < toMinutes(schedule.dayStartTime) || end > toMinutes(schedule.dayEndTime)) {
    return `That is outside this competition's playing hours (${schedule.dayStartTime.slice(0, 5)}-${schedule.dayEndTime.slice(0, 5)}). Choose a time inside them, or change the playing hours.`
  }
  const pitch = schedule.pitches.find((p) => p.pitchId === move.pitchId)
  if (!pitchCovers(pitch, move.date, start, end)) {
    return `${pitch?.name ?? "That pitch"} is not reserved for this tournament from ${fromMinutes(start)} to ${fromMinutes(end)} on that day. Reserve it first, or choose another pitch or time.`
  }
  return null
}

/** The pitches reserved on a day, each with the windows it is reserved for -- what the sheet offers. */
export function pitchesOnDay(schedule: PlanSchedule, date: string): (SchedulePitch & { windows: ScheduleReservation[] })[] {
  return schedule.pitches
    .map((p) => ({ ...p, windows: (p.reservations ?? []).filter((r) => r.date === date) }))
    .filter((p) => p.windows.length > 0)
}

/**
 * "3 games at once" -- how a pitch is marked out on a day, where it takes more than one game; nothing for
 * a pitch used whole, and nothing when its reservations that day are marked out differently.
 */
export function pitchAreasNote(pitch: SchedulePitch, date?: string | null): string | null {
  const rows = (pitch.reservations ?? []).filter((r) => !date || r.date === date)
  const values = new Set(rows.map((r) => r.playingAreas ?? pitch.areas ?? 1))
  const n = rows.length === 0 ? pitch.areas ?? 1 : values.size === 1 ? [...values][0]! : null
  return n && n > 1 ? `${n} games at once` : null
}

/** "Two halves", for a pitch the club itself marks out for more than one game; nothing for a whole pitch. */
export function pitchLayoutNote(pitch: Pick<SchedulePitch, "areas">): string | null {
  if (pitch.areas === 2) return "Two halves"
  if (pitch.areas === 4) return "Four quarters"
  return null
}

/** HOW A RESERVED PITCH IS MARKED OUT FOR THE TOURNAMENT -- the organiser's (1-4), or null for the club's layout. */
export async function setTournamentPitchAreas(supabase: Client, reservationId: string, playingAreas: number | null): Promise<void> {
  const { error } = await supabase.rpc("set_tournament_pitch_areas", {
    p_reservation_id: reservationId,
    p_playing_areas: playingAreas as number,
  })
  if (error) throw error
}

// ------------------------------------------------------------------ the view

export interface KickoffGroup {
  at: string
  games: ScheduleGame[]
}

export interface ScheduleDay {
  date: string | null
  kickoffs: KickoffGroup[]
}

/**
 * BY TIME: day, then kick-off, then the games at it, by pitch. What an organiser on the touchline is
 * holding: "at 10:15, who is on which pitch". Games with no day, kick-off or pitch are left out here and
 * listed apart as not yet placed, rather than invented into a slot.
 */
export function byTime(schedule: PlanSchedule, staged: StagedMoves = new Map(), pitchFilter: string | null = null): ScheduleDay[] {
  const days = new Map<string, Map<string, ScheduleGame[]>>()
  for (const g of schedule.games) {
    const p = placementOf(g, staged)
    if (!p.date || !p.startTime || !p.pitchId) continue
    if (pitchFilter && p.pitchId !== pitchFilter) continue
    const day = days.get(p.date) ?? new Map<string, ScheduleGame[]>()
    const list = day.get(p.startTime) ?? []
    list.push(g)
    day.set(p.startTime, list)
    days.set(p.date, day)
  }
  const pitchOrder = new Map(schedule.pitches.map((p, i) => [p.pitchId, i]))
  return [...days.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([date, kick]) => ({
      date,
      kickoffs: [...kick.entries()]
        .sort(([a], [b]) => toMinutes(a) - toMinutes(b))
        .map(([at, list]) => ({
          at,
          games: list.sort((x, y) => (pitchOrder.get(placementOf(x, staged).pitchId ?? "") ?? 99) - (pitchOrder.get(placementOf(y, staged).pitchId ?? "") ?? 99)),
        })),
    }))
}

/** The games still without a day, a kick-off or a pitch. */
export function unplaced(schedule: PlanSchedule, staged: StagedMoves = new Map()): ScheduleGame[] {
  return schedule.games.filter((g) => {
    const p = placementOf(g, staged)
    return !p.date || !p.startTime || !p.pitchId
  })
}

/** "Round 3 · Table A", "Semi Final", "Round 2" -- where a game sits in its competition. */
export function gameContext(game: ScheduleGame, format: string | null): string {
  if (game.roundLabel) return game.roundLabel
  const round = game.round ? `${format === "tri_fixture" ? "Game" : "Round"} ${game.round}` : null
  return [round, game.tableName].filter(Boolean).join(" · ")
}

/** Who plays, in words -- a knockout place says it is waiting for its sides. */
export function gameTitle(game: ScheduleGame): string {
  if (!game.sideA || !game.sideB) return `${game.roundLabel ?? "Knockout game"}, sides to be decided`
  return `${game.sideA.clubName} v ${game.sideB.clubName}`
}
