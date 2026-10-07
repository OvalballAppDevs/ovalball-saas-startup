import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { test } from "node:test"

import {
  byTime,
  conflictsFor,
  continueGoesToPlan,
  deletePlanSheet,
  moveProblem,
  planningCard,
  scheduleConflicts,
  unplaced,
  type PlanSchedule,
  type PlanSummary,
  type ScheduleGame,
  type SchedulePitch,
  type ScheduleMove,
} from "../../../../packages/contracts/src/tournaments/schedule.ts"
import { primaryReadinessAction, READINESS_ACTION_LABEL, type PlanReadiness } from "../../../../packages/contracts/src/tournaments/readiness.ts"
import { routeForIntent } from "../links/destinations.ts"

/*
 * A TOURNAMENT PLAN IS EDITED, NOT REBUILT (20270736) -- the phone's half.
 *
 * The clash rules live in the database (`internal.tournament_schedule_conflicts`), which refuses a move
 * and holds publication; supabase/tests/tournament_plan_editing.sql proves that against the real planner.
 * The phone runs the same arithmetic so a staged move says whether it works BEFORE it is saved, and these
 * cases pin that it says what the server says, in the server's words -- the same owner's cases, the
 * same sentences.
 */

const DAY = "2026-10-25" // the Bolton Festival, a Sunday

// A full-size pitch is 100m x 70m of field of play; the RFU U10 pitch is 60m x 35m, the U12 60m x 43m.
const FULL = 7000
const U10 = 60 * 35
const U12 = 60 * 43

const whole = (id: string, name: string): SchedulePitch => ({
  pitchId: id, name, areas: 1, areaM2: FULL, layout: "full_only",
  reservations: [{ date: DAY, startTime: "09:00", endTime: "13:00", playingAreas: 1, markedByOrganiser: false }],
})
const halves = (id: string, name: string): SchedulePitch => ({
  ...whole(id, name), areas: 2, layout: "two_halves",
  reservations: [{ date: DAY, startTime: "09:00", endTime: "13:00", playingAreas: 2, markedByOrganiser: false }],
})
/** The owner's rule: the organiser marks a pitch out for the day, whatever the club's own layout. */
const markedFor = (n: number, pitch: SchedulePitch): SchedulePitch => ({
  ...pitch, reservations: (pitch.reservations ?? []).map((r) => ({ ...r, playingAreas: n, markedByOrganiser: true })),
})

const side = (id: string, club: string) => ({ participantId: id, clubName: club, crestPath: null, label: "U10", isHost: false })

function game(id: string, a: string, b: string, at: string | null, pitchId: string | null, extra: Partial<ScheduleGame> = {}): ScheduleGame {
  return {
    id, kind: "game", gameId: id, placeId: null, round: 1, tableId: "t", tableName: "Table A",
    stageRound: null, isThirdPlace: false, roundLabel: null, roundSubject: null, roundWhole: null,
    sideA: side(a, a), sideB: side(b, b), date: at ? DAY : null, startTime: at, durationMinutes: 20,
    pitchId, pitchName: null, placedByHand: false, isHistory: false, status: "SCHEDULED", resultStatus: "none",
    sideAScore: null, sideBScore: null, ...extra,
  }
}

function plan(games: ScheduleGame[], pitches: SchedulePitch[], extra: Partial<PlanSchedule> = {}): PlanSchedule {
  return {
    planId: "plan", tournamentId: "t", tournamentName: "Bolton Festival", ageGroup: "U10", format: "round_robin",
    publicationState: "PUBLISHED", publishedAt: null, gameDurationMinutes: 20, changeoverMinutes: 5,
    dayStartTime: "09:00", dayEndTime: "13:00", maxDurationMinutes: 30, gameAreaM2: U10,
    days: [DAY], pitches, games, others: [], conflicts: [], readiness: null, ...extra,
  }
}

const move = (startTime: string, pitchId: string, durationMinutes = 20): ScheduleMove => ({ date: DAY, startTime, pitchId, durationMinutes })

// ---------------------------------------------------------------- the owner's cases

test("eight teams on four pitches: four games at the same kick-off are accepted", () => {
  const pitches = [whole("p1", "Pitch 1"), whole("p2", "Pitch 2"), whole("p3", "Pitch 3"), whole("p4", "Pitch 4")]
  const s = plan(
    [game("g1", "A", "B", "09:00", "p1"), game("g2", "C", "D", "09:00", "p2"), game("g3", "E", "F", "09:00", "p3"), game("g4", "G", "H", "09:00", "p4")],
    pitches
  )
  assert.deepEqual(scheduleConflicts(s), [], "several games may share a kick-off on different pitches")
  const at = byTime(s)
  assert.equal(at[0]!.kickoffs.length, 1)
  assert.equal(at[0]!.kickoffs[0]!.games.length, 4, "one kick-off, four games beside it")
  assert.deepEqual(at[0]!.kickoffs[0]!.games.map((g) => g.pitchId), ["p1", "p2", "p3", "p4"], "in pitch order")
})

test("two games on one whole pitch at once is refused, in the server's sentence", () => {
  const s = plan([game("g1", "A", "B", "09:00", "p1"), game("g2", "C", "D", "09:00", "p2")], [whole("p1", "Pitch 1"), whole("p2", "Pitch 2")])
  const staged = new Map([["g2", move("09:00", "p1")]])
  const clashes = conflictsFor(scheduleConflicts(s, staged), "g2")
  assert.equal(clashes[0]?.code, "PITCH_CLASH")
  assert.equal(clashes[0]?.message, "Pitch 1 has two games at 09:00, but it takes one game at a time.")
})

test("the same team on two pitches at 09:00 is refused, naming the team", () => {
  const s = plan([game("g1", "Blackburn RUFC", "B", "09:00", "p1"), game("g2", "Blackburn RUFC", "D", "09:25", "p2")], [whole("p1", "Pitch 1"), whole("p2", "Pitch 2")])
  const clashes = conflictsFor(scheduleConflicts(s, new Map([["g2", move("09:00", "p2")]])), "g2")
  assert.equal(clashes[0]?.code, "SIDE_CLASH")
  assert.equal(clashes[0]?.message, "Blackburn RUFC U10 is scheduled in two games at 09:00.")
})

test("a pitch marked out as two halves takes two games, and refuses a third", () => {
  const s = plan(
    [game("g1", "A", "B", "09:50", "p2"), game("g2", "C", "D", "09:50", "p2"), game("g3", "E", "F", "10:15", "p1")],
    [whole("p1", "Pitch 1"), halves("p2", "Pitch 2")]
  )
  assert.deepEqual(scheduleConflicts(s), [], "two U10 games on a pitch of two halves")
  const third = conflictsFor(scheduleConflicts(s, new Map([["g3", move("09:50", "p2")]])), "g3")
  assert.equal(third[0]?.message, "Pitch 2 has three games at 09:50, but it is marked out for two.")
})

test("the owner's rule: a full-size pitch the organiser marks out for three takes three U10 games at once", () => {
  const pitch = markedFor(3, whole("p1", "Pitch 1"))
  const s = plan([game("g1", "A", "B", "10:15", "p1"), game("g2", "C", "D", "10:15", "p1"), game("g3", "E", "F", "10:15", "p1"), game("g4", "G", "H", "11:00", "p1")], [pitch])
  assert.deepEqual(scheduleConflicts(s), [], "three U10 pitches (60m x 35m) fit a full-size pitch")
  const fourth = conflictsFor(scheduleConflicts(s, new Map([["g4", move("10:15", "p1")]])), "g4")
  assert.equal(fourth[0]?.message, "Pitch 1 has four games at 10:15, but it is marked out for three.")
  assert.equal(pitch.areas, 1, "the club's own layout is untouched -- the marking is the tournament's")
})

test("each game must fit one of the areas: a U12 pitch is not a third of a full-size pitch, a U10 pitch is not a quarter", () => {
  const u12 = plan([game("g1", "A", "B", "10:15", "p1")], [markedFor(3, whole("p1", "Pitch 1"))], { ageGroup: "U12", gameAreaM2: U12 })
  assert.equal(scheduleConflicts(u12)[0]?.message,
    "Pitch 1 is marked out for three games at 10:15, and a U12 game needs more room than one of those areas. Mark it out for fewer games, or move this one.")
  assert.deepEqual(scheduleConflicts(plan(u12.games, [markedFor(2, whole("p1", "Pitch 1"))], { ageGroup: "U12", gameAreaM2: U12 })), [], "but it is half of one")
  const quarters = plan([game("g1", "A", "B", "10:15", "p1")], [markedFor(4, whole("p1", "Pitch 1"))])
  assert.match(scheduleConflicts(quarters)[0]?.message ?? "", /^Pitch 1 is marked out for four games at 10:15, and a U10 game needs more room/)
})

test("U10 and U12 on the same pitch is one pitch: another competition's game is a clash too", () => {
  const s = plan([game("g1", "A", "B", "10:00", "p1")], [whole("p1", "Pitch 1")], {
    others: [{ unitId: "u12", ageGroup: "U12", date: DAY, startTime: "09:30", endTime: "10:10", occupiedUntil: "10:15", pitchId: "p1", gameAreaM2: U12, sideIds: ["X", "Y"], isHistory: false }],
  })
  const clashes = conflictsFor(scheduleConflicts(s), "g1")
  assert.equal(clashes[0]?.message, "Pitch 1 has two games at 10:00, but it takes one game at a time.")
})

test("the next game waits for the changeover", () => {
  const s = plan([game("g1", "A", "B", "09:00", "p1"), game("g2", "C", "D", "09:20", "p1")], [whole("p1", "Pitch 1")])
  const clashes = conflictsFor(scheduleConflicts(s), "g2")
  assert.equal(clashes[0]?.code, "PITCH_TURNAROUND")
  assert.equal(clashes[0]?.message, "Pitch 1 needs 5 minutes between games: a game finishes at 09:20 and the next kicks off at 09:20.")
})

test("a pitch too small for the grade, and a pitch the tournament has not reserved", () => {
  const small: SchedulePitch = { ...whole("ps", "Pitch S"), areaM2: 30 * 20 }
  const s = plan([game("g1", "A", "B", "09:00", "ps"), game("g2", "C", "D", "13:30", "p1")], [small, whole("p1", "Pitch 1")])
  const all = scheduleConflicts(s)
  assert.equal(conflictsFor(all, "g1")[0]?.message, "Pitch S is too small for a U10 game. Move it to a bigger pitch.")
  assert.equal(conflictsFor(all, "g2")[0]?.message, "Pitch 1 is not reserved for this tournament from 13:30 to 13:50 on Sun 25 Oct.")
})

test("a knockout round starts once the round before it has finished", () => {
  const semi = game("s1", "A", "B", "09:00", "p1", { stageRound: 1, roundSubject: "A Semi Final", roundWhole: "the Semi Finals" })
  const final: ScheduleGame = { ...game("f", "", "", "09:05", "p2", { stageRound: 2, roundSubject: "The Final", roundWhole: "the Final" }), kind: "place", gameId: null, placeId: "f", sideA: null, sideB: null }
  const s = plan([semi, final], [whole("p1", "Pitch 1"), whole("p2", "Pitch 2")])
  assert.equal(conflictsFor(scheduleConflicts(s), "f")[0]?.message,
    "The Final cannot kick off at 09:05: the last game of the Semi Finals ends at 09:20. A round starts once the round before it has finished.")
})

test("a clash made only of games with results is history: nothing can fix it, so it is not reported", () => {
  const played = { isHistory: true, resultStatus: "final" }
  const s = plan([game("g1", "A", "B", "09:00", "p1", played), game("g2", "C", "D", "09:00", "p1", played)], [whole("p1", "Pitch 1")])
  assert.deepEqual(scheduleConflicts(s), [])
})

// ---------------------------------------------------------------- the owner's own edit

test("09:50 Pitch 2 to 10:15 Pitch 1 on the Bolton Festival: refused alone, valid with the 10:15 game moved on", () => {
  // The live Bolton Festival's U10 schedule, as published.
  const s = plan([
    game("r1a", "Blackburn", "Clitheroe", "09:00", "p1"), game("r1b", "Bolton", "UAT", "09:00", "p2"),
    game("r2a", "Clitheroe", "UAT", "09:25", "p1"), game("r2b", "Blackburn", "Wigan", "09:25", "p2"),
    game("r3a", "UAT", "Wigan", "09:50", "p1"), game("r3b", "Clitheroe", "Bolton", "09:50", "p2"),
    game("r4a", "Wigan", "Bolton", "10:15", "p1"), game("r4b", "UAT", "Blackburn", "10:15", "p2"),
    game("r5a", "Bolton", "Blackburn", "10:40", "p1"), game("r5b", "Wigan", "Clitheroe", "10:40", "p2"),
  ], [whole("p1", "Pitch 1"), halves("p2", "Pitch 2")])
  assert.deepEqual(scheduleConflicts(s), [], "the published schedule is clean")

  const alone = new Map([["r3b", move("10:15", "p1")]])
  const refused = conflictsFor(scheduleConflicts(s, alone), "r3b")
  assert.equal(refused[0]?.message, "Bolton U10 is scheduled in two games at 10:15.", "the team first: another pitch would not cure it")
  assert.ok(refused.some((c) => c.message === "Pitch 1 has two games at 10:15, but it takes one game at a time."))

  const together = new Map([["r3b", move("10:15", "p1")], ["r4a", move("11:05", "p1")]])
  assert.deepEqual(scheduleConflicts(s, together), [], "one arrangement, validated as a whole")
  const moved = byTime(s, together)[0]!.kickoffs.find((k) => k.at === "10:15")!
  assert.deepEqual(moved.games.map((g) => g.id), ["r3b", "r4b"], "10:15 now reads Clitheroe v Bolton on Pitch 1, UAT v Blackburn on Pitch 2")
})

test("a move is checked for what the server refuses before it is ever a clash", () => {
  const s = plan([game("g1", "A", "B", "09:00", "p1")], [whole("p1", "Pitch 1")])
  const g = s.games[0]!
  assert.equal(moveProblem(s, g, move("12:50", "p1")), "That is outside this competition's playing hours (09:00-13:00). Choose a time inside them, or change the playing hours.")
  assert.equal(moveProblem(s, g, { ...move("10:00", "p1"), date: "2026-10-26" }), "That day is not one of this competition's playing days.")
  assert.equal(moveProblem(s, g, move("10:00", "p1", 35)), "A U10 game may be at most 30 minutes under the age-grade regulations.")
  assert.equal(moveProblem(s, { ...g, isHistory: true }, move("10:00", "p1")), "This game already has a result, so its time and pitch are history and cannot be moved.")
  const unreserved = plan(s.games, [{ ...whole("p1", "Pitch 1"), reservations: [{ date: DAY, startTime: "09:00", endTime: "10:00", playingAreas: 1 }] }])
  assert.equal(moveProblem(unreserved, g, move("10:00", "p1")), "Pitch 1 is not reserved for this tournament from 10:00 to 10:20 on that day. Reserve it first, or choose another pitch or time.")
  assert.equal(moveProblem(s, g, move("10:00", "p1")), null)
})

test("reservations that meet are one window", () => {
  const split: SchedulePitch = { ...whole("p1", "Pitch 1"), reservations: [{ date: DAY, startTime: "09:00", endTime: "11:00", playingAreas: 1 }, { date: DAY, startTime: "11:00", endTime: "13:00", playingAreas: 1 }] }
  const s = plan([game("g1", "A", "B", "10:50", "p1")], [split])
  assert.deepEqual(scheduleConflicts(s), [], "a game played across 11:00 is covered")
})

test("a game with no kick-off is listed as not yet placed, never invented into a slot", () => {
  const s = plan([game("g1", "A", "B", null, null), game("g2", "C", "D", "09:00", "p1")], [whole("p1", "Pitch 1")])
  assert.deepEqual(unplaced(s).map((g) => g.id), ["g1"])
  assert.equal(byTime(s)[0]!.kickoffs.length, 1)
  assert.deepEqual(unplaced(s, new Map([["g1", move("09:25", "p1")]])), [], "placing it by hand takes it off the list")
})

// ---------------------------------------------------------------- the Planning tab

const summary = (extra: Partial<PlanSummary>): PlanSummary => ({
  ageGroup: "U10", planId: "plan", publicationState: "DRAFT", format: "round_robin", publishedAt: null, updatedAt: null,
  gameCount: 10, placeCount: 0, scheduledCount: 10, resultCount: 0, conflictCount: 0, firstDay: DAY, lastDay: DAY, ...extra,
})

test("NO PLAN offers Plan Tournament and nothing else", () => {
  const card = planningCard(summary({ planId: null, publicationState: null, gameCount: 0, scheduledCount: 0 }))
  assert.equal(card.kind, "none")
  assert.deepEqual([card.primary.label, card.secondary.length, card.remove], ["Plan Tournament", 0, null])
})

test("DRAFT offers Continue Planning and Delete Draft; Continue goes to the plan once it has games", () => {
  const card = planningCard(summary({}))
  assert.deepEqual([card.kind, card.primary.label, card.remove?.label], ["draft", "Continue Planning", "Delete Draft"])
  assert.equal(continueGoesToPlan(summary({})), true, "a generated draft continues on the plan itself")
  assert.equal(continueGoesToPlan(summary({ gameCount: 0, scheduledCount: 0 })), false, "an empty draft continues the setup")
})

test("PUBLISHED offers View Plan first, then Edit Plan, Edit Tables and Delete Plan", () => {
  const card = planningCard(summary({ publicationState: "PUBLISHED" }))
  assert.deepEqual([card.primary.intent, card.primary.label], ["view", "View Plan"])
  assert.deepEqual(card.secondary.map((c) => c.label), ["Edit Plan", "Edit Tables"])
  assert.equal(card.remove?.label, "Delete Plan")
  assert.deepEqual(planningCard(summary({ publicationState: "PUBLISHED", format: "knockout" })).secondary.map((c) => c.label), ["Edit Plan"], "a knockout has a draw, not tables")
  assert.match(planningCard(summary({ publicationState: "PUBLISHED", conflictCount: 2 })).attention ?? "", /^2 clashes need changing/)
})

test("Delete Plan says what goes, what stays and who is told -- and refuses once there is a result", () => {
  const draft = deletePlanSheet(summary({}))
  assert.equal(draft.confirm, "Delete Draft")
  assert.match(draft.body, /teams stay entered and the tournament's pitches stay reserved/)
  const published = deletePlanSheet(summary({ publicationState: "PUBLISHED" }))
  assert.match(published.body, /Every participating team is told the schedule has been withdrawn\./)
  const history = deletePlanSheet(summary({ publicationState: "PUBLISHED", resultCount: 3 }))
  assert.equal(history.confirm, null, "no button that would delete sporting history")
  assert.equal(history.title, "This Plan Cannot Be Deleted")
  assert.match(history.body, /^3 games in the U10 plan have results\./)
})

test("a clash, an unpitched kick-off and an unreserved pitch lead to Edit Plan", () => {
  const readiness = { stage: "DRAFT_GENERATED", publicationState: "DRAFT", readyToPublish: false, blockers: [{ code: "CLASH", stage: "publish", action: "edit_schedule", message: "x" }], warnings: [] } as unknown as PlanReadiness
  assert.equal(primaryReadinessAction(readiness), "edit_schedule")
  assert.equal(READINESS_ACTION_LABEL.edit_schedule, "Edit Plan")
})

// ---------------------------------------------------------------- the Calendar

test("a link about a day opens the Calendar on that day", () => {
  assert.deepEqual(routeForIntent({ kind: "CALENDAR", date: "2026-10-25" }), { pathname: "/calendar", params: { date: "2026-10-25" } })
  assert.deepEqual(routeForIntent({ kind: "CALENDAR", date: null }), { pathname: "/calendar" })
})

// ---------------------------------------------------------------- one planner (structural guards)

const code = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8")

test("View Plan and Edit Plan are the plan, never the first-time wizard", () => {
  const home = code("./planning-home.tsx")
  assert.match(home, /case "view": planScreen\(\); return/)
  assert.match(home, /case "edit": planScreen\("edit"\); return/)
  assert.match(home, /readPlanSummaries\(supabase/, "the tab reads where the plan is without starting one")
  assert.doesNotMatch(home, /start_tournament_plan/, "opening Planning creates nothing")
  const wizard = code("../../app/(tabs)/admin/tournaments/plan/[tournamentId].tsx")
  assert.match(wizard, /if \(!stepParam && \(ctx\?\.plan\?\.gameCount \?\? 0\) > 0\) \{\s*router\.replace\(\{ pathname: "\/admin\/tournaments\/plan\/draft\/\[tournamentId\]"/,
    "the old Plan Tournament route hands an existing plan to the plan screen instead of acting as a fresh plan")
  assert.match(wizard, /TOURNAMENT_TABLES_REPLACE_GAMES/, "a published plan's tables are changed only once the organiser confirms the games are replaced")
})

test("one way to move a game: the staged save, validated by the server as one arrangement", () => {
  const screen = code("../../app/(tabs)/admin/tournaments/plan/draft/[tournamentId].tsx")
  assert.match(screen, /savePlanSchedule\(supabase, schedule, staged\)/)
  assert.doesNotMatch(screen, /setTournamentGameSchedule|from\("tournament_games"\)\.update|from\("tournament_bracket_pairings"\)\.update/, "no second write path")
  assert.doesNotMatch(screen, /"Pitch \d/, "no pitch is named in code: every pitch comes from the canonical pitch rows")
  assert.match(screen, /scheduleConflicts\(schedule, staged\)/, "clashes are shown before saving, from the shared engine")
  const contract = code("../../../../packages/contracts/src/tournaments/schedule.ts")
  assert.match(contract, /rpc\("save_tournament_plan_schedule"/)
  const migration = code("../../../../supabase/migrations/20270736000000_a_tournament_plan_is_edited_not_rebuilt.sql")
  assert.match(migration, /'code', 'CLASH', 'stage', 'publish'/, "publication is held by the server, not the phone")
  assert.match(migration, /'code', 'NO_PITCH', 'stage', 'publish'/)
})

test("View Calendar opens the Calendar on the competition's own day, and the Calendar honours it", () => {
  const screen = code("../../app/(tabs)/admin/tournaments/plan/draft/[tournamentId].tsx")
  assert.match(screen, /pathname: "\/calendar", params: day \? \{ date: day/)
  const calendar = code("../../app/(tabs)/calendar/index.tsx")
  assert.match(calendar, /useLocalSearchParams<\{ date\?: string; at\?: string \}>/)
  assert.match(calendar, /setAnchor\(asked\)\s*\n\s*setOpenDay\(asked\)/)
})
