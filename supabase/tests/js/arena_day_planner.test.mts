import { test } from "node:test"
import assert from "node:assert/strict"

import { activityLabel, type ArenaDay, type ArenaFixture, type ArenaTraining } from "@ovalball/contracts/arena"

import { EMPTY_PLAN, planCounts, plannedParts, stage, toArenaChanges, unstage, withoutAuto } from "../../../apps/mobile/src/arena/planner/plan"
import { draftOccupancy, fixturePitchWindow, fixtureRoomWindow, pitchClash, plannedNeeds, recommendRooms } from "../../../apps/mobile/src/arena/planner/rules"

// ---------------------------------------------------------------------------------------------- a small day
const team = (displayName: string, ageGroup: string) => ({ id: displayName, displayName, category: "senior", ageGroup, gender: "female", squadDesignation: null, rugbyCode: "union", alias: null })
const fixture = (over: Partial<ArenaFixture>): ArenaFixture => ({
  kind: "FIXTURE", id: "f1", home: true, title: "Women's 1st v Sedgley Park", team: team("Women's 1st Team", "Senior"), opponentName: "Sedgley Park",
  date: "2026-10-25", kickoff: "14:00", playMinutes: 80, status: "Scheduled", meetTime: null, kickoffProposed: false, requiresOpponentAgreement: false,
  venueId: "main", venueName: "Main Ground", pitchId: null, pitchName: null, homeRoomId: null, awayRoomId: null, officialsRoomId: null, noChangingRooms: false,
  pitchWindow: null, roomWindow: null, fit: { footprint: "full", areaM2: 7000, basis: "REGULATION", source: "" }, locks: [], autoAllocated: [], needs: ["PITCH", "ROOMS"], catering: null,
  ...over,
} as ArenaFixture)
const training = (over: Partial<ArenaTraining>): ArenaTraining => ({
  kind: "TRAINING", id: "t1", title: "U12 Training", team: team("Under 12 Boys", "U12"), groupLabel: null, date: "2026-10-25", start: "13:00", end: "14:30",
  venueId: "main", venueName: "Main Ground", pitchId: "p3", pitchName: "Pitch 3", locks: [], autoAllocated: [], source: "MANUAL", needs: [],
  ...over,
} as ArenaTraining)
const occ = (o: Record<string, unknown>) => ({ parentId: null, role: null, footprint: null, areas: null, locked: false, playFrom: o.from, playUntil: o.until, turnaroundUntil: o.until, ...o })
const pitch = (id: string, name: string, size: string, lanes: number, active = true) => ({ id, venueId: "main", name, active, size, layout: lanes === 2 ? "two_halves" : "full_only", lanes, customLengthM: null, customWidthM: null, areaM2: 7000, sortOrder: 0, coverImagePath: null, coverStockKey: null })
const room = (id: string, name: string, sortOrder: number, roomType = "full_size") => ({ id, venueId: "main", name, roomType, active: true, sortOrder, coverImagePath: null, coverStockKey: null })

const women = fixture({})
const u12 = training({})
const day = {
  date: "2026-10-25",
  canManage: true,
  policy: { warmUp: 15, packUp: 15, turnaround: 15, roomAccess: 30, roomRelease: 30, roomTurnaround: 10, bufferSource: "platform", roomSource: "club", autoAllocateHomeFixtures: false },
  venues: [{ id: "main", name: "Main Ground", isDefault: true, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: true }],
  pitches: [pitch("p1", "Pitch 1", "full", 1), pitch("p2", "Pitch 2", "full", 2), pitch("p3", "Pitch 3", "full", 1), pitch("p4", "Pitch 4", "half", 1), pitch("p5", "Pitch 5", "full", 1, false)],
  rooms: [room("r1", "Home Changing Room", 0), room("r2", "Visitors' Changing Room", 1), room("r3", "Room 3", 2), room("ro", "Officials", 3, "match_officials")],
  activities: [women, u12],
  occupancy: [
    occ({ activityType: "TOURNAMENT", activityId: "res1", parentId: "tour", label: "Bolton Festival", resourceType: "PITCH", resourceId: "p1", from: "09:00", until: "15:00", areas: 2, locked: true }),
    occ({ activityType: "TRAINING", activityId: "t1", label: "Under 12 Boys training", resourceType: "PITCH", resourceId: "p3", from: "13:00", until: "14:30" }),
    occ({ activityType: "FIXTURE", activityId: "f9", label: "Men's 1st v Fylde", resourceType: "PITCH", resourceId: "p2", from: "13:45", playFrom: "14:00", playUntil: "15:20", until: "15:35", footprint: "half" }),
    occ({ activityType: "EVENT", activityId: "e1", label: "Family Fun Day", resourceType: "PITCH", resourceId: "p4", from: "15:00", until: "19:00" }),
    occ({ activityType: "FIXTURE", activityId: "f9", label: "Men's 1st v Fylde", resourceType: "ROOM", resourceId: "r1", role: "HOME", from: "13:30", playFrom: "14:00", playUntil: "15:20", until: "15:50", turnaroundUntil: "16:00" }),
  ],
  conflicts: [],
  readiness: {},
} as unknown as ArenaDay

// ---------------------------------------------------------------------------------------------- the plan
test("a change holds only what it alters, and what each part was when it was read", () => {
  const plan = stage(EMPTY_PLAN, women, { pitchId: "p3", venueId: "main" }, "MANUAL")
  const change = plan.get("FIXTURE:f1")!
  assert.deepEqual(change.set, { pitchId: "p3" }, "the venue it already had is no change")
  assert.deepEqual(change.expected, { pitchId: null })
  assert.equal(change.origin, "MANUAL")
  assert.deepEqual(plannedParts(plan, women).pitchId, "p3")
})

test("putting a part back where it was takes it out of the plan; a change with nothing left is gone", () => {
  let plan = stage(EMPTY_PLAN, women, { pitchId: "p3", homeRoomId: "r1" }, "MANUAL")
  plan = stage(plan, women, { pitchId: null }, "MANUAL")
  assert.deepEqual(plan.get("FIXTURE:f1")!.set, { homeRoomId: "r1" })
  plan = stage(plan, women, { homeRoomId: null }, "MANUAL")
  assert.equal(plan.size, 0)
})

// UPDATED (connected planner, 2026-10-05): a session is now planned by its pitch, its start and -- when its team
// asked for one -- its changing room (the owner's rules). Its start still belongs to the Training Centre: the plan
// carries it, and Save moves it only through override_training_session (pinned in arena_planning.sql TR13-TR17).
// A match's away and officials rooms are still nothing a session has.
test("a session is planned by its pitch, its start and its own changing room -- never a match's away or officials room", () => {
  const plan = stage(EMPTY_PLAN, u12, { pitchId: "p4", kickoff: "09:00", homeRoomId: "r1", awayRoomId: "r2", officialsRoomId: "r3" }, "MANUAL")
  assert.deepEqual(plan.get("TRAINING:t1")!.set, { pitchId: "p4", kickoff: "09:00", homeRoomId: "r1" })
})

test("Auto Allocate's proposal stays automatic until a person touches it; Discard leaves a person's changes", () => {
  let plan = stage(EMPTY_PLAN, women, { pitchId: "p3", homeRoomId: "r1" }, "AUTO", ["Pitch 1 was reserved, so Pitch 3."])
  plan = stage(plan, u12, { pitchId: "p4" }, "MANUAL")
  assert.deepEqual(planCounts(plan), { total: 2, manual: 1, auto: 1 })
  assert.deepEqual(withoutAuto(plan).size, 1)
  plan = stage(plan, women, { awayRoomId: "r2" }, "MANUAL")
  assert.equal(plan.get("FIXTURE:f1")!.origin, "MANUAL", "a person who alters a proposal has taken it over")
  assert.deepEqual(plan.get("FIXTURE:f1")!.notes, ["Pitch 1 was reserved, so Pitch 3."], "and keeps its explanation")
  assert.equal(unstage(plan, "FIXTURE:f1").size, 1)
})

test("Save sends every change with what it expects and whose decision it is", () => {
  const plan = stage(stage(EMPTY_PLAN, women, { pitchId: "p3", kickoff: "14:30" }, "AUTO"), u12, { pitchId: "p4" }, "MANUAL")
  assert.deepEqual(toArenaChanges(plan), [
    { kind: "FIXTURE", id: "f1", expected: { pitchId: null, kickoff: "14:00" }, set: { pitchId: "p3", kickoff: "14:30" }, source: "AUTO" },
    { kind: "TRAINING", id: "t1", expected: { pitchId: "p3" }, set: { pitchId: "p4" }, source: "MANUAL" },
  ])
})

// ---------------------------------------------------------------------------------------------- the rules
test("the occupancy windows are the server's: warm-up to clearing the pitch; rooms from access or the meet", () => {
  assert.deepEqual(fixturePitchWindow(14 * 60, 80, day.policy), { from: 825, playFrom: 840, playUntil: 920, until: 935, turnaroundUntil: 950 })
  assert.equal(fixtureRoomWindow(14 * 60, 80, null, "HOME", day.policy).from, 810, "access 30 minutes before kick-off")
  assert.equal(fixtureRoomWindow(14 * 60, 80, 12 * 60 + 45, "HOME", day.policy).from, 765, "the home side from its earlier meet time")
  assert.equal(fixtureRoomWindow(14 * 60, 80, 12 * 60 + 45, "AWAY", day.policy).from, 810, "the visitors from access")
})

test("a drop is checked against what is really there, in one human sentence", () => {
  const draft = draftOccupancy(day, EMPTY_PLAN)
  assert.equal(pitchClash(day, draft, women, "p1", 14 * 60)?.message, "Pitch 1 is reserved for Bolton Festival 09:00–15:00.")
  assert.equal(pitchClash(day, draft, women, "p3", 14 * 60)?.code, "PITCH_IN_USE", "a match and a training session on one pitch")
  assert.equal(pitchClash(day, draft, women, "p4", 14 * 60)?.message, `Pitch 4 is too small for ${activityLabel(women)}: it needs a full-size pitch.`)
  assert.equal(pitchClash(day, draft, women, "p5", 14 * 60)?.message, "Pitch 5 is switched off.")
  // DAY / PITCHES REFINEMENT: "space", not "room", on a pitch -- "room" read as a changing room beside them.
  assert.equal(pitchClash(day, draft, women, "p2", 14 * 60)?.message, "Pitch 2 has no space for another game at 13:45: together they need more of the pitch than it has.",
    "two games at once, but a full-size match and a half-pitch one need more than the pitch")
  assert.equal(pitchClash(day, draft, fixture({ id: "f2", fit: { footprint: "half", areaM2: 3500, basis: "CATEGORY", source: "" } }), "p2", 14 * 60), null, "two half-pitch games share a pitch marked out for two")
  assert.equal(pitchClash(day, draft, women, "p3", 16 * 60), null, "after the session the pitch is free")
})

test("training never clashes with training, but cannot sit inside a match's warm-up", () => {
  const draft = draftOccupancy(day, EMPTY_PLAN)
  const other = training({ id: "t2", start: "13:30", end: "14:30", pitchId: null })
  assert.equal(pitchClash(day, draft, other, "p3", null), null)
  assert.match(pitchClash(day, draft, other, "p2", null)?.message ?? "", /^Pitch 2 is in use by Men's 1st v Fylde 13:45–15:35/)
})

test("a staged move is part of the day the next drop is checked against", () => {
  const plan = stage(EMPTY_PLAN, women, { pitchId: "p3", kickoff: "16:00" }, "MANUAL")
  const draft = draftOccupancy(day, plan)
  const late = fixture({ id: "f3", kickoff: "16:30" })
  assert.equal(pitchClash(day, draft, late, "p3", 16 * 60 + 30)?.message, "Pitch 3 is already in use at 16:15.", "from its warm-up, not its kick-off")
})

test("rooms go with the pitch: the preferred room if free, never one room for both sides, the turnaround kept", () => {
  const draft = draftOccupancy(day, EMPTY_PLAN)
  const plain = recommendRooms(day, draft, women, "main", 14 * 60)
  assert.equal(plain.homeRoomId, "r2", "the Home Changing Room is in use by the Men's 1st until 15:50")
  assert.equal(plain.awayRoomId, "r3")
  const preferred = recommendRooms(day, draft, women, "main", 17 * 60, { home: ["r1"], away: ["r3"] })
  assert.deepEqual([preferred.homeRoomId, preferred.awayRoomId], ["r1", "r3"])
  const tight = recommendRooms(day, draft, women, "main", 16 * 60 + 25, { home: ["r1"], away: [] })
  assert.notEqual(tight.homeRoomId, "r1", "16:25 kick-off: home access 15:55 is inside the room's turnaround to 16:00")
  assert.equal(recommendRooms(day, draft, fixture({ noChangingRooms: true }), "main", 14 * 60).homeRoomId, null)
})

test("what still needs doing is the server's own rule, with the plan laid over it", () => {
  assert.deepEqual(plannedNeeds(day, EMPTY_PLAN, women), ["PITCH", "ROOMS"])
  const plan = stage(EMPTY_PLAN, women, { pitchId: "p3", homeRoomId: "r2", awayRoomId: "r3" }, "MANUAL")
  assert.deepEqual(plannedNeeds(day, plan, women), [], "allocated in the plan, it no longer reads as unallocated")
  assert.deepEqual(plannedNeeds(day, stage(EMPTY_PLAN, women, { pitchId: "p3", homeRoomId: "r2" }, "MANUAL"), women), ["ROOMS"], "a venue with two team rooms gives the visitors one")
  assert.deepEqual(plannedNeeds(day, EMPTY_PLAN, fixture({ noChangingRooms: true, pitchId: "p3" })), [], "a match that needs no rooms needs none")
  assert.deepEqual(plannedNeeds(day, EMPTY_PLAN, training({ pitchId: null })), ["PITCH"])
  assert.deepEqual(plannedNeeds(day, EMPTY_PLAN, fixture({ home: false, pitchId: null })), [], "an away fixture uses none of the club's facilities")
})

// ---------------------------------------------------------------------------------------------- the words
import { boardOpponent, displacements, lockedWords, proposalWords, saveWords } from "../../../apps/mobile/src/arena/planner/words"

test("saving the day's plan has one verb, said the same everywhere", () => {
  assert.deepEqual(saveWords(1, 0), { status: "1 unsaved change", action: "Save Change" })
  assert.deepEqual(saveWords(3, 0), { status: "3 unsaved changes", action: "Save 3 Changes" })
  assert.deepEqual(saveWords(3, 3), { status: "3 proposed changes", action: "Apply Plan" }, "Ovalball's own proposal is applied")
  assert.deepEqual(saveWords(3, 1), { status: "3 unsaved changes", action: "Save 3 Changes" }, "a person's change mixed in is saved, in the same words as any other")
})

test("Auto Allocate's result is said in a club administrator's words", () => {
  const preview = { summary: { firstPreferences: 2, alternatives: 1, noPreference: 0, unresolved: 1, unchanged: 6 } } as Parameters<typeof proposalWords>[0]
  assert.deepEqual(proposalWords(preview, 3), { title: "Ovalball proposed 3 changes", details: ["2 match your preferences", "1 uses the next available option", "1 issue remains"] })
  assert.equal(proposalWords({ summary: { firstPreferences: 0, alternatives: 0, noPreference: 0, unresolved: 0, unchanged: 9 } } as Parameters<typeof proposalWords>[0], 0).title, "Everything already has its place")
})

test("a lock says exactly what it holds; a club is named without the words every club shares", () => {
  assert.equal(lockedWords(["away_room", "home_room", "pitch"]), "the pitch, the home changing room and the away changing room")
  assert.equal(lockedWords(["pitch"]), "the pitch")
  assert.equal(boardOpponent("Sedgley Park Rugby Union Football Club"), "Sedgley Park")
  assert.equal(boardOpponent("Kendal RFC"), "Kendal")
  assert.equal(boardOpponent("Waterloo Football Club"), "Waterloo")
})

test("a refused drop is said briefly: what is unavailable, and the one reason that matters", () => {
  const draft = draftOccupancy(day, EMPTY_PLAN)
  const reserved = pitchClash(day, draft, women, "p1", 14 * 60)!
  assert.deepEqual(reserved.short, { title: "Pitch 1 reserved", reason: "Bolton Festival until 15:00" })
  assert.deepEqual(pitchClash(day, draft, women, "p4", 14 * 60)!.short, { title: "Pitch 4 too small", reason: "Needs a full-size pitch" })
  assert.deepEqual(pitchClash(day, draft, women, "p5", 14 * 60)!.short, { title: "Pitch 5 unavailable", reason: "Switched off" })
})

test("a proposal that takes a match's place from another says so, by name, instead of hiding it in a count", () => {
  // Women's 1st gets Changing Room 5 and 6; Girls U16, which had them, is left with none.
  const girls = fixture({ id: "f2", title: "Under 16 Girls v Wigan", homeRoomId: "r5", awayRoomId: "r6", pitchId: "p2", needs: [] })
  let plan = stage(EMPTY_PLAN, women, { pitchId: "p1", homeRoomId: "r5", awayRoomId: "r6" }, "AUTO")
  plan = stage(plan, girls, { homeRoomId: null, awayRoomId: null }, "AUTO")
  const taken = displacements(plan)
  assert.equal(taken.length, 1)
  assert.equal(taken[0].id, "f2")
  assert.equal(taken[0].loses, "rooms")
  assert.deepEqual(taken[0].to, [plan.get("FIXTURE:f1")!.label], "and to whom")
  const words = proposalWords({ summary: { firstPreferences: 0, alternatives: 1, noPreference: 0, unresolved: 1, unchanged: 8 } } as Parameters<typeof proposalWords>[0], 2, [{ label: "Girls U16 v Wigan", loses: "rooms" }])
  assert.deepEqual(words.details, ["1 uses the next available option", "Girls U16 v Wigan would lose its changing rooms"], "the trade is named, and is not counted again as a separate issue")
  assert.equal(proposalWords({ summary: { firstPreferences: 0, alternatives: 0, noPreference: 0, unresolved: 1, unchanged: 9 } } as Parameters<typeof proposalWords>[0], 0).title, "Ovalball couldn't place everything")
})
