import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import type { ArenaDay, ArenaFixture, ArenaRoom, ArenaTraining } from "@ovalball/contracts/arena"

import { EMPTY_PLAN, stage, toArenaChanges } from "../../../apps/mobile/src/arena/planner/plan"
import { occupancyFor, pitchClash, plannedNeeds, readOccupancy, recommendTrainingRoom, roomDemand, roomFit, trainingWindow } from "../../../apps/mobile/src/arena/planner/rules"
import { sampleAutoAllocate, scenarioDay } from "../../../apps/mobile/src/arena/planner/scenarios"

/**
 * THE CONNECTED PLANNER -- Pitches and Changing Rooms as one plan (the owner's brief of 2026-10-04 and the rules
 * decided with it): training shares a pitch without limit and is never a clash for it; a session needs a changing
 * room only when its team asked; one team per room, a session holding its room for the session itself and the
 * room's turnaround; a session's start moves on the plan like a kick-off; the rooms still wanted are the Changing
 * Rooms board's demand; and the made-up Thursday proves all of it on the club's own estate.
 */

const MOBILE = "apps/mobile"
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const team = (displayName: string, ageGroup: string, gender = "boys") => ({ id: displayName, displayName, category: "youth", ageGroup, gender, squadDesignation: null, rugbyCode: "union", alias: null })
const TIME = { owner: "TRAINING", editable: true, reason: null } as const
const session = (id: string, name: string, age: string, over: Partial<ArenaTraining> = {}): ArenaTraining => ({
  kind: "TRAINING", id, title: `${name} training`, team: team(name, age), groupLabel: null, date: "2026-10-22", start: "18:00", end: "19:00",
  venueId: "main", venueName: "Main Ground", pitchId: "p2", pitchName: "Pitch 2", roomId: null, needsRoom: false, roomRequest: null,
  locks: [], autoAllocated: [], source: "AUTOMATIC_PLAN", needs: [], time: TIME, ...over,
})
const match = (over: Partial<ArenaFixture> = {}): ArenaFixture => ({
  kind: "FIXTURE", id: "f1", home: true, title: "Under 16 Boys v Burnley", team: team("Under 16 Boys", "U16"), opponentName: "Burnley RUFC", date: "2026-10-22",
  kickoff: "19:15", playMinutes: 70, status: "Booked", meetTime: null, kickoffProposed: false, requiresOpponentAgreement: false,
  venueId: "main", venueName: "Main Ground", pitchId: "p4", pitchName: "Smith Field", homeRoomId: "r1", awayRoomId: "r2", officialsRoomId: "ro", noChangingRooms: false,
  pitchWindow: null, roomWindow: null, fit: { footprint: "full", areaM2: 7000, basis: "REGULATION", source: "" }, locks: [], autoAllocated: [], needs: [], catering: null,
  time: { owner: "FIXTURE", editable: true, reason: null }, ...over,
})
const pitch = (id: string, name: string, lanes = 1, venueId = "main") => ({ id, venueId, name, active: true, size: "full", layout: lanes === 2 ? "two_halves" : "full_only", lanes, customLengthM: null, customWidthM: null, areaM2: 7000, sortOrder: Number(id.slice(1)) || 9, coverImagePath: null, coverStockKey: null })
const room = (id: string, name: string, sortOrder: number, roomType: ArenaRoom["roomType"] = "full_size", venueId = "main", active = true): ArenaRoom => ({ id, venueId, name, roomType, active, sortOrder, coverImagePath: null, coverStockKey: null })
const POLICY = { warmUp: 45, packUp: 15, turnaround: 15, roomAccess: 60, roomRelease: 30, roomTurnaround: 15, bufferSource: "club", roomSource: "club", autoAllocateHomeFixtures: false } as const

function dayOf(activities: (ArenaFixture | ArenaTraining)[]): ArenaDay {
  const base = {
    club: { id: "c", name: "Club", rugbyCode: "union", logoPath: null, timezone: "Europe/London" }, date: "2026-10-22", canManage: true, policy: POLICY,
    venues: [
      { id: "main", name: "Main Ground", isDefault: true, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: true },
      { id: "second", name: "Second Ground", isDefault: false, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: false },
    ],
    // The UAT club's own estate, by name, so the made-up days land where they would on the real board.
    pitches: [pitch("p1", "Pitch 1"), pitch("p2", "Pitch 2", 2), pitch("p3", "Pitch 3"), pitch("p4", "Smith Field"), pitch("p5", "Wilson Playing Field"), pitch("p9", "Main Pitch", 1, "second")],
    rooms: [room("ro", "Officials Room", 1, "match_officials"), room("r1", "Home Dressing Room", 2), room("r2", "Visitors Room", 3), room("r3", "Changing Room 3", 4), room("r4", "Changing Room 4", 5, "full_size", "main", false), room("r5", "Changing Room 5", 6), room("rs", "Home Changing Room", 1, "full_size", "second")],
    activities, occupancy: [], conflicts: [], readiness: {},
  } as unknown as ArenaDay
  const occupancy = activities.flatMap((a) => occupancyFor(a, { pitchId: a.pitchId, kickoff: a.kind === "FIXTURE" ? a.kickoff : a.start, homeRoomId: a.kind === "FIXTURE" ? a.homeRoomId : a.roomId, awayRoomId: a.kind === "FIXTURE" ? a.awayRoomId : null, officialsRoomId: a.kind === "FIXTURE" ? a.officialsRoomId : null }, POLICY as ArenaDay["policy"]))
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  return { ...base, occupancy: occupancy.map((o) => ({ ...o, from: hhmm(o.from), playFrom: hhmm(o.playFrom), playUntil: hhmm(o.playUntil), until: hhmm(o.until), turnaroundUntil: hhmm(o.turnaroundUntil) })) } as ArenaDay
}

// ------------------------------------------------------------------ pitches: sharing is not a clash

test("four training groups on one pitch at once is sharing, never a clash -- the owner's 'no limit'", () => {
  const groups = [session("t1", "Under 12 Boys", "U12"), session("t2", "Under 13 Boys", "U13"), session("t3", "Under 14 Girls", "U14"), session("t4", "Under 10 Mixed", "U10")]
  const day = dayOf(groups)
  const draft = readOccupancy(day)
  for (const g of groups) assert.equal(pitchClash(day, draft, g, "p2", null), null, `${g.title} may share Pitch 2`)
  // A fifth group joins them: still nothing to refuse.
  const fifth = session("t5", "Under 15 Boys", "U15", { pitchId: null })
  assert.equal(pitchClash(day, draft, fifth, "p2", 18 * 60), null, "there is no training capacity to exceed")
})

test("a match still holds its whole pitch against training, warm-up to clearing -- said in a short, local refusal", () => {
  const u16g = session("t6", "Under 16 Girls", "U16", { pitchId: "p4", start: "17:15", end: "18:15" })
  const day = dayOf([match(), u16g])
  const draft = readOccupancy(day)
  assert.equal(pitchClash(day, draft, u16g, "p4", 17 * 60 + 15), null, "17:15-18:15 ends before the 18:30 warm-up")
  const moved = pitchClash(day, draft, u16g, "p4", 17 * 60 + 45)
  assert.ok(moved && moved.code === "PITCH_IN_USE", "moved to 17:45 it runs into the warm-up")
  assert.match(moved!.short.title, /^Smith Field unavailable$/)
  assert.match(moved!.short.reason, /until 20:40/, "and says until when the match holds it")
})

test("moving a session's start keeps its length: the time moves on the plan like a kick-off", () => {
  const u12 = session("t1", "Under 12 Boys", "U12", { start: "18:00", end: "19:15" })
  assert.deepEqual(trainingWindow(u12, 18 * 60 + 30), { from: 1110, playFrom: 1110, playUntil: 1185, until: 1185, turnaroundUntil: 1185 })
  const plan = stage(EMPTY_PLAN, u12, { kickoff: "18:30", pitchId: "p3", venueId: "main" }, "MANUAL")
  const [change] = toArenaChanges(plan)
  assert.deepEqual(change.set, { kickoff: "18:30", pitchId: "p3" }, "the start and the pitch go to Save together")
  assert.deepEqual(change.expected, { kickoff: "18:00", pitchId: "p2" }, "each with what it was when it was read")
})

// ------------------------------------------------------------------ rooms: requested per team, one team per room

test("a session needs a changing room only when its team asked for one", () => {
  const asked = session("t2", "Under 13 Boys", "U13", { needsRoom: true, roomRequest: "PLAN" })
  const notAsked = session("t1", "Under 12 Boys", "U12")
  const day = dayOf([asked, notAsked])
  assert.deepEqual(plannedNeeds(day, EMPTY_PLAN, asked), ["ROOMS"])
  assert.deepEqual(plannedNeeds(day, EMPTY_PLAN, notAsked), [])
  assert.deepEqual(roomDemand(day, EMPTY_PLAN, asked), ["TRAINING"], "it is room demand on the Changing Rooms board")
  assert.deepEqual(roomDemand(day, EMPTY_PLAN, notAsked), [])
  const placed = stage(EMPTY_PLAN, asked, { homeRoomId: "r3" }, "MANUAL")
  assert.deepEqual(roomDemand(day, placed, asked), [], "given a room in the plan, it leaves the demand before Save")
})

test("a session holds its room for the session itself, then the club's room turnaround", () => {
  const u13 = session("t2", "Under 13 Boys", "U13", { needsRoom: true, roomId: "r3" })
  const rows = occupancyFor(u13, { pitchId: "p2", kickoff: "18:00", homeRoomId: "r3", awayRoomId: null, officialsRoomId: null }, POLICY as ArenaDay["policy"])
  const roomRow = rows.find((r) => r.resourceType === "ROOM")!
  assert.deepEqual([roomRow.role, roomRow.from, roomRow.until, roomRow.turnaroundUntil], ["TRAINING", 18 * 60, 19 * 60, 19 * 60 + 15])
})

test("one team per room: taken, being turned round, the other side of the same match, the officials' room, another venue -- each refused in words", () => {
  const u13 = session("t2", "Under 13 Boys", "U13", { needsRoom: true, roomId: "r3" })
  const u14g = session("t3", "Under 14 Girls", "U14", { needsRoom: true, gender: undefined } as Partial<ArenaTraining>)
  const later = session("t7", "Men's 1st Team", "Senior", { start: "19:05", end: "20:30", needsRoom: true, pitchId: "p1" })
  const day = dayOf([u13, u14g, later, match()])
  const draft = readOccupancy(day)
  assert.equal(roomFit(day, draft, EMPTY_PLAN, u14g, "TRAINING", "r3")?.code, "ROOM_IN_USE", "two groups never share a room")
  assert.equal(roomFit(day, draft, EMPTY_PLAN, later, "TRAINING", "r3")?.code, "ROOM_TURNAROUND", "and the next waits for the turnaround")
  assert.equal(roomFit(day, draft, EMPTY_PLAN, u14g, "TRAINING", "ro")?.code, "ROOM_UNSUITED", "the officials' room is not a team room")
  assert.equal(roomFit(day, draft, EMPTY_PLAN, u14g, "TRAINING", "rs")?.code, "ROOM_ELSEWHERE", "a room at another venue does not follow the team there")
  assert.equal(roomFit(day, draft, EMPTY_PLAN, match(), "AWAY", "r1")?.code, "ROOM_IN_USE", "a match's visitors never share its home side's room")
  assert.equal(roomFit(day, draft, EMPTY_PLAN, u14g, "TRAINING", "r5"), null, "a free team room at its venue fits")
})

test("Ovalball's room for a session: the team's preference first, never one taken, and otherwise exactly why not", () => {
  const u13 = session("t2", "Under 13 Boys", "U13", { needsRoom: true, roomId: "r3" })
  const u16g = session("t6", "Under 16 Girls", "U16", { needsRoom: true })
  const day = dayOf([u13, u16g])
  const draft = readOccupancy(day)
  assert.equal(recommendTrainingRoom(day, draft, u16g, "main", 18 * 60, ["r5"]).roomId, "r5", "the preferred room first")
  assert.notEqual(recommendTrainingRoom(day, draft, u16g, "main", 18 * 60, ["r3"]).roomId, "r3", "never a room another team holds")
  // Every team room at the venue taken at 18:00 by somebody (r3 by U13, the rest made up here): nothing to give.
  const taken = (id: string) => ({ ...draft[0], activityId: `x-${id}`, activityType: "TRAINING" as const, resourceType: "ROOM" as const, resourceId: id, role: "TRAINING" as const, from: 18 * 60, playFrom: 18 * 60, playUntil: 19 * 60, until: 19 * 60, turnaroundUntil: 19 * 60 + 15 })
  const none = recommendTrainingRoom(day, [...draft, taken("r1"), taken("r2"), taken("r5")], session("t9", "Under 15 Boys", "U15", { needsRoom: true }), "main", 18 * 60, [])
  assert.equal(none.roomId, null)
  assert.match(none.note ?? "", /^Every suitable room at Main Ground is taken 18:00–19:00\.$/)
})

// ------------------------------------------------------------------ the made-up Thursday proves it on the club's estate

/** The club's real estate, as the UAT club has it (names only matter to the scenario). */
function realThursday(): ArenaDay {
  return dayOf([])
}

test("the made-up Thursday: four groups at 18:00, three sharing a pitch, one waiting for a pitch, room requests, an unavailable room, a room clash and an evening match", () => {
  const real = realThursday()
  const renamed = { ...real, pitches: real.pitches.map((p) => ({ ...p })), rooms: real.rooms.map((r) => ({ ...r, active: true })) }
  const day = scenarioDay(renamed as ArenaDay, "thursday")
  const sessions = day.activities.filter((a): a is ArenaTraining => a.kind === "TRAINING")
  const atSix = sessions.filter((s) => s.start === "18:00")
  assert.ok(atSix.length >= 4, "at least four teams train at the same time")
  const onPitch2 = atSix.filter((s) => s.pitchName === "Pitch 2")
  assert.ok(onPitch2.length >= 2, "at least two share one pitch")
  assert.ok(atSix.some((s) => s.pitchId && s.pitchName !== "Pitch 2"), "and another trains on another pitch")
  assert.ok(sessions.some((s) => s.needs.includes("PITCH")), "a session still needs a pitch")
  assert.ok(sessions.some((s) => s.needsRoom && s.roomRequest === "PLAN") && sessions.some((s) => s.needsRoom && s.roomRequest === "SESSION"), "rooms are asked for by a plan and by a session")
  assert.ok(sessions.some((s) => s.needs.includes("ROOMS")), "a request still waits for a room")
  assert.ok(day.rooms.some((r) => !r.active), "a room is switched off")
  assert.ok(day.conflicts.some((c) => c.resourceType === "ROOM" && c.code === "ROOM_IN_USE"), "a changing room clash is there to resolve")
  assert.ok(!day.conflicts.some((c) => c.resourceType === "PITCH"), "and the sharing on Pitch 2 is not a clash")
  const game = day.activities.find((a): a is ArenaFixture => a.kind === "FIXTURE")!
  assert.ok(game.homeRoomId && game.awayRoomId && game.officialsRoomId, "the evening match has home, away and officials rooms")
  assert.equal(game.time.editable, false, "and its kick-off is the competition's")
  assert.ok(day.activities.some((a) => a.kind === "EVENT" && a.pitchIds.length > 0), "a facility hold blocks a pitch")
  assert.ok(game.locks.length > 0 && sessions.some((s) => s.locks.length > 0), "locks are on the day")
})

test("every planning day is there to try: quiet, training night, match day, tournament, event and the large club", () => {
  const real = realThursday()
  for (const key of ["quiet", "training", "matchday", "tournament", "event", "large"] as const) {
    const day = scenarioDay(real, key)
    assert.ok(day.activities.length > 0, `${key} has something on`)
  }
  const large = scenarioDay(real, "large")
  assert.equal(large.venues.length, 2)
  assert.equal(large.pitches.length, 12)
  assert.ok(large.rooms.length >= 8)
  assert.ok(large.activities.length >= 20)
  assert.ok(large.activities.filter((a) => (a.kind === "FIXTURE" || a.kind === "TRAINING") && a.needs.length > 0).length >= 4, "with work still waiting")
  assert.ok(scenarioDay(real, "tournament").activities.some((a) => a.kind === "TOURNAMENT" && a.reservations.length >= 2), "a tournament reserves several pitches")
  assert.ok(scenarioDay(real, "matchday").activities.filter((a) => a.kind === "FIXTURE").length >= 4, "match day has several home games")
})

test("the sample Auto Allocate makes the Thursday work across pitches and rooms, and says exactly what it could not", () => {
  const day = scenarioDay(realThursday(), "thursday")
  const preview = sampleAutoAllocate(day)
  const u15 = preview.items.find((i) => i.title.startsWith("Under 15 Boys"))!
  assert.ok(u15.proposed.pitchId, "the group waiting for a pitch is given one")
  assert.ok(preview.items.some((i) => i.changes.includes("ROOMS")), "rooms are proposed with the pitches, one proposal")
  for (const i of preview.items.filter((x) => x.outcome === "UNRESOLVED")) {
    assert.match(i.explanation.join(" "), /needs (a|an|home and away) .*changing room|needs a changing room|still needs one/, "what is left is said in words, never a code")
  }
})

// ------------------------------------------------------------------ one plan, two boards

test("the Changing Rooms board is the same plan as the Pitches board: it stages through the planner and saves nothing itself", () => {
  const rooms = code(join(MOBILE, "src/arena/planner/room-board.tsx"))
  const screen = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  assert.match(screen, /<RoomBoard[\s\S]{0,120}planner=\{planner\}/, "the rooms board is given the one planner")
  assert.match(screen, /<PitchBoard[\s\S]{0,120}planner=\{planner\}/, "as the pitches board is")
  assert.match(rooms, /planner\.assignRoom\(/, "a room given on the board is staged in the plan")
  assert.doesNotMatch(rooms, /\bsupabase\b|\.rpc\(|applyArenaAllocation|\.save\(/, "the board never writes; Save is the one bar's")
  assert.doesNotMatch(screen, /ResourceTimetable/, "the old read-only room timetable is gone")
  assert.match(rooms, /roomClashAt\(/, "a refusal comes from the planner's rules, one team per room")
  assert.match(rooms, /Needs a Room/, "the demand tray says what still needs a room")
})

test("sharing reads as sharing: one block with how many and who, opened out to move one team; a clash is the only red", () => {
  const board = code(join(MOBILE, "src/arena/planner/pitch-board.tsx"))
  assert.match(board, /`Training · \$\{n\} teams`/, "the number sharing is said first")
  assert.match(board, /names\.join\(" · "\)/, "and who they are")
  assert.match(board, /borderColor: clash \? colour\.danger/, "red only for a real clash")
  assert.match(board, /onToggle\(g\.pitchId\)/, "tapping opens it out, one column per group")
})

test("a time moves only where its owner lets Arena move it, and otherwise the board says where it is changed", () => {
  const board = code(join(MOBILE, "src/arena/planner/pitch-board.tsx"))
  const kit = code(join(MOBILE, "src/arena/planner/board-kit.tsx"))
  assert.match(board, /useLift\(canManage, reduceMotion, !b\.a\.time\.editable,/, "a card whose time is not this person's to move keeps its time")
  assert.match(board, /const movesTime = activity\.time\.editable && fixedMinutes === null/, "the drop's time follows the finger only when the time may move")
  assert.match(board, /action: \{ label: centreWord\(activity\), a: activity \}/, "a refused time change offers the fixture or the session")
  assert.match(kit, /accessibilityLabel=\{action\.label\}/, "as a real button")
})
