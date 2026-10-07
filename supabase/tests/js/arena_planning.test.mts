import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

import {
  accessibilityLabel,
  activityLabel,
  activityTitle,
  arenaFocus,
  operationalState,
  usesEstate,
  weekDayCard,
  cateringRows,
  dayCountsLine,
  eventCateringLine,
  filterActivities,
  filterCounts,
  fixtureCateringLine,
  needLines,
  needsAllocation,
  needsAllocationAt,
  pitchRows,
  placeLine,
  previewChanges,
  previewSummaryLines,
  readinessHeadline,
  readinessLines,
  resourceStateAt,
  roomRows,
  roomsPhrase,
  spokenTime,
  timeRange,
  timelineGroups,
  weekDayLines,
  weekAttention,
  type AllocationPreview,
  type ArenaDay,
  type ArenaEvent,
  type ArenaFixture,
  type ArenaTraining,
} from "../../../packages/contracts/src/arena"

/**
 * ARENA, PRESENTED -- the permanent pins for what Arena's screens say about a day the server projected.
 *
 * The server's engine decides every fact (when a pitch is held, what clashes, what is known about
 * catering); these pins hold the words and arrangement: VoiceOver hears kind, place and time; unknown
 * attendance is never zero; readiness is facts, never a score; a block on the timeline is its warm-up,
 * play and clearing; and the Arena screens read only the Arena projections.
 */

const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const team = (ageGroup: string, gender = "mixed") => ({ id: `t-${ageGroup}`, displayName: `Under ${ageGroup.slice(1)}`, category: "youth", ageGroup, gender, squadDesignation: null, rugbyCode: "union", alias: null })

const fixture = (over: Partial<ArenaFixture> = {}): ArenaFixture => ({
  kind: "FIXTURE", id: "f1", home: true, title: "Under 9 Mixed v Bolton RFC", team: team("U9"), opponentName: "Bolton RFC", date: "2026-10-10",
  kickoff: "11:00", playMinutes: 80, status: "Booked", meetTime: null, kickoffProposed: false, requiresOpponentAgreement: true,
  venueId: "v1", venueName: "Ovalball UAT Ground", pitchId: "p1", pitchName: "Pitch 1", homeRoomId: "r1", awayRoomId: "r2", officialsRoomId: null,
  noChangingRooms: false,
  pitchWindow: { from: "10:30", playFrom: "11:00", playUntil: "12:20", until: "12:40" },
  roomWindow: { from: "10:00", awayFrom: "10:00", until: "12:50", turnaroundUntil: "13:05" },
  fit: { footprint: "half", areaM2: 1800, basis: "REGULATION", source: "RFU Regulation 15 Appendix 3 maximum 60m x 30m" },
  locks: [], autoAllocated: [], needs: [], time: { owner: "FIXTURE", editable: true, reason: null },
  catering: { required: true, visible: true, total: 26, parts: [{ side: "home", attending: 12 }, { side: "away", attending: 14 }], sidesNotCounted: [], basis: "" },
  ...over,
})

const training = (over: Partial<ArenaTraining> = {}): ArenaTraining => ({
  kind: "TRAINING", id: "s1", title: "Under 12 Boys training", team: team("U12", "boys"), groupLabel: null, date: "2026-10-10", start: "10:00", end: "11:00",
  venueId: "v1", venueName: "Ovalball UAT Ground", pitchId: null, pitchName: null, roomId: null, needsRoom: false, roomRequest: null, locks: [], autoAllocated: [], source: "MANUAL", needs: ["PITCH"],
  time: { owner: "TRAINING", editable: true, reason: null }, ...over,
})

const event = (over: Partial<ArenaEvent> = {}): ArenaEvent => ({
  kind: "EVENT", id: "e1", title: "Christmas Party", status: "SCHEDULED", eventType: "SOCIAL", start: "18:00", end: "22:00", allDay: false, multiDay: false,
  locationKind: "VENUE", venueId: "v1", venueName: "Ovalball UAT Ground", externalName: null, locationDetail: "Clubhouse", pitchIds: [],
  coverImagePath: null, coverStockKey: null, time: { owner: "EVENT", editable: false, reason: "Times are set in the event." },
  catering: { required: true, visible: true, expected: 60, counts: { players: 0, staff: 0, members: 40, familyAndGuests: 20, externalGuests: 0, total: 60, dietary: { vegetarian: 8, vegan: 3 }, otherNotes: 4 } },
  ...over,
})

const day = (activities: ArenaDay["activities"], over: Partial<ArenaDay> = {}): ArenaDay => ({
  club: { id: "c", name: "Ovalball UAT RUFC", rugbyCode: "union", logoPath: null, timezone: "Europe/London" },
  date: "2026-10-10", canManage: true,
  policy: { warmUp: 30, packUp: 20, turnaround: 15, roomAccess: 60, roomRelease: 30, roomTurnaround: 15, bufferSource: "club", roomSource: "platform", autoAllocateHomeFixtures: false },
  venues: [{ id: "v1", name: "Ovalball UAT Ground", isDefault: true, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: true },
           { id: "v2", name: "Training Ground", isDefault: false, address: null, postcode: null, coverImagePath: null, coverStockKey: null, changingRoomsAvailable: true, cateringAvailable: false }],
  pitches: [
    { id: "p1", venueId: "v1", name: "Pitch 1", active: true, size: "full", layout: "full_only", lanes: 1, customLengthM: null, customWidthM: null, areaM2: 7000, sortOrder: 1, coverImagePath: null, coverStockKey: null },
    { id: "p2", venueId: "v2", name: "Pitch 2", active: true, size: "full", layout: "two_halves", lanes: 2, customLengthM: null, customWidthM: null, areaM2: 7000, sortOrder: 2, coverImagePath: null, coverStockKey: null },
  ],
  rooms: [
    { id: "r1", venueId: "v1", name: "Room 1", roomType: "full_size", active: true, sortOrder: 1, coverImagePath: null, coverStockKey: null },
    { id: "r2", venueId: "v1", name: "Room 2", roomType: "full_size", active: true, sortOrder: 2, coverImagePath: null, coverStockKey: null },
  ],
  activities,
  occupancy: [
    { activityType: "FIXTURE", activityId: "f1", parentId: null, label: "Under 9 Mixed v Bolton RFC", resourceType: "PITCH", resourceId: "p1", role: null, from: "10:30", playFrom: "11:00", playUntil: "12:20", until: "12:40", turnaroundUntil: "12:55", footprint: "half", areas: null, locked: false },
    { activityType: "FIXTURE", activityId: "f1", parentId: null, label: "Under 9 Mixed v Bolton RFC", resourceType: "ROOM", resourceId: "r1", role: "HOME", from: "10:00", playFrom: "11:00", playUntil: "12:20", until: "12:50", turnaroundUntil: "13:05", footprint: null, areas: null, locked: true },
  ],
  conflicts: [],
  readiness: { state: "NEEDS_ATTENTION", activities: 3, homeGames: 1, awayGames: 0, training: 1, tournaments: 0, events: 1, needsAllocation: 1, pitchConflicts: 0, roomConflicts: 1, tournamentConflicts: 0, warnings: 0, cateringKnown: 86, cateringIncomplete: 0 },
  ...over,
})

// ------------------------------------------------------------------ what VoiceOver hears

test("a clock time is spoken the way a person says it", () => {
  assert.equal(spokenTime("10:30"), "ten thirty AM")
  assert.equal(spokenTime("12:40"), "twelve forty PM")
  assert.equal(spokenTime("09:00"), "nine AM")
  assert.equal(spokenTime("14:05"), "two oh five PM")
  assert.equal(spokenTime("00:15"), "twelve fifteen AM")
  assert.equal(spokenTime(null), "no time yet")
})

test("an activity tells VoiceOver its kind, its place and its whole occupancy -- never colour alone", () => {
  const d = day([fixture()])
  // Spoken, a team is its display name; the compact "U9" is only for the eye.
  assert.equal(accessibilityLabel(d, fixture()), "Under 9 versus Bolton RFC, home fixture, Pitch 1, occupancy ten thirty AM to twelve forty PM.")
  assert.match(accessibilityLabel(d, training()), /^Under 12 training, pitch not allocated, ten AM to eleven AM, needs allocation\.$/)
  // Named on its own (a detail or Allocate sheet), an activity carries the team's display name in Title Case.
  assert.equal(activityTitle(fixture()), "Under 9 v Bolton RFC")
  assert.equal(activityTitle(training()), "Under 12 Training")
  assert.equal(activityTitle(fixture({ home: false })), "Under 9 at Bolton RFC")
  const clashing = day([fixture()], { conflicts: [{ key: "k", code: "PITCH_IN_USE", severity: "hard", resourceType: "PITCH", resourceId: "p1", at: "10:30", activityIds: ["f1"], message: "m" }] })
  assert.match(accessibilityLabel(clashing, fixture()), /one clash\.$/)
})

// ------------------------------------------------------------------ words for the day

test("labels are the compact team form against the visitors; an away fixture says where", () => {
  assert.equal(activityLabel(fixture()), "U9 v Bolton RFC")
  assert.equal(activityLabel(fixture({ home: false, opponentName: "Bury RFC", team: team("U14", "boys") })), "U14 at Bury RFC")
  assert.equal(activityLabel(training()), "U12 Training")
  assert.equal(timeRange(fixture()), "11:00–12:20")
  assert.equal(timeRange(event({ allDay: true })), "All day")
  assert.equal(roomsPhrase("Room 1", "Room 2"), "Rooms 1 & 2")
  assert.equal(roomsPhrase("Home Dressing Room", "Visitors Room"), "Home Dressing Room & Visitors Room")
})

test("a place line names every unallocated part, and an event at the clubhouse holds no pitch", () => {
  const d = day([])
  assert.equal(placeLine(d, fixture()), "Pitch 1 · Rooms 1 & 2")
  assert.equal(placeLine(d, fixture({ pitchId: null, pitchName: null, needs: ["PITCH", "ROOMS"], homeRoomId: null, awayRoomId: null })), "Pitch not allocated · Rooms not allocated")
  assert.equal(placeLine(d, training()), "Pitch not allocated")
  assert.equal(placeLine(d, event()), "Clubhouse")
  assert.equal(placeLine(d, event({ pitchIds: ["p1"] })), "Pitch 1")
  assert.deepEqual(needLines(d, fixture({ awayRoomId: null, needs: ["ROOMS"] })), ["Away room — Not allocated"])
})

test("needs allocation lists home fixtures and sessions missing something, never an away fixture", () => {
  const list = needsAllocation([fixture({ id: "a", needs: ["PITCH"] }), fixture({ id: "b", home: false, needs: ["PITCH"] }), training(), event()])
  assert.deepEqual(list.map((a) => a.id), ["s1", "a"])
})

// ------------------------------------------------------------------ catering is never zero for unknown

test("catering that Ovalball cannot count is unavailable, never zero", () => {
  assert.equal(fixtureCateringLine(fixture()), "Catering · 26 attending")
  assert.equal(fixtureCateringLine(fixture({ catering: { required: true, visible: true, total: 22, parts: [{ side: "home", attending: 22 }], sidesNotCounted: ["away"] } })), "Catering · 22 attending so far · away attendance not available")
  // Nobody marked attending yet, with a side Ovalball cannot count: no "0+", no bare zero standing for the unknown.
  const none = fixtureCateringLine(fixture({ catering: { required: true, visible: true, total: 0, parts: [{ side: "home", attending: 0 }], sidesNotCounted: ["away"] } }))
  assert.equal(none, "Catering · 0 attending so far · away attendance not available")
  assert.doesNotMatch(none ?? "", /\d\+/)
  assert.equal(eventCateringLine(event({ catering: { required: true, visible: true, expected: 0, counts: { players: 0, staff: 0, members: 0, familyAndGuests: 0, externalGuests: 0, total: 0, dietary: {}, otherNotes: 0 } } })), "Catering · nobody confirmed yet")
  assert.equal(eventCateringLine(event()), "Catering · 60 expected")
  assert.equal(fixtureCateringLine(fixture({ catering: { required: true, visible: false } })), "Catering required")
  assert.equal(fixtureCateringLine(fixture({ catering: { required: false, visible: true, total: 0 } })), "Catering not required")
  const rows = cateringRows(day([
    fixture(),
    fixture({ id: "f2", catering: { required: true, visible: true, total: 22, parts: [{ side: "home", attending: 22 }], sidesNotCounted: ["away"] } }),
    event(),
  ]))
  assert.equal(rows.totalKnown, 26 + 22 + 60)
  assert.equal(rows.incomplete, 1)
  assert.equal(rows.rows.find((r) => r.id === "f2")?.detail, "22 home · Away attendance not available")
  assert.equal(rows.rows.find((r) => r.id === "e1")?.dietary, "3 vegan · 8 vegetarian · 4 with a note")
  assert.doesNotMatch(JSON.stringify(rows), /Twelve|Fourteen/, "counts only, never a name")
})

// ------------------------------------------------------------------ readiness is facts

test("readiness is the day's facts, never a score", () => {
  const r = day([]).readiness
  assert.equal(readinessHeadline(r), "Needs Attention")
  assert.deepEqual(readinessLines(r), ["1 needs allocation", "1 changing-room clash"])
  assert.equal(dayCountsLine(r), "3 activities · 1 home game · 1 training · 1 event")
  assert.equal(readinessHeadline({ ...r, state: "READY" }), "Ready")
  assert.doesNotMatch(dayCountsLine(r), /%|score/i)
})

// ------------------------------------------------------------------ the timeline

test("a fixture's block is warm-up, play and clearing the pitch; a room's use is in use then turnaround", () => {
  const d = day([fixture(), training(), event()])
  const pitch = pitchRows(d, null).find((r) => r.resourceId === "p1")!
  const block = pitch.blocks[0]
  assert.deepEqual(block.segments.map((s) => s.phase), ["WARM_UP", "PLAY", "CLEAR"])
  assert.equal(block.from, 630)
  assert.equal(block.until, 760)
  assert.equal(block.label, "U9 v Bolton RFC")
  const room = roomRows(d, null).find((r) => r.resourceId === "r1")!
  assert.deepEqual(room.blocks[0].segments.map((s) => s.phase), ["IN_USE", "TURNAROUND"])
  assert.equal(room.blocks[0].label, "U9 v Bolton RFC · Home")
  assert.equal(room.blocks[0].locked, true)
  assert.equal(resourceStateAt(room, 11 * 60), "IN_USE")
  assert.equal(resourceStateAt(room, 12 * 60 + 55), "TURNAROUND")
  assert.equal(resourceStateAt(room, 14 * 60), "FREE")
  assert.equal(resourceStateAt(room, 11 * 60, false), "UNAVAILABLE")
})

test("Arena Home leads with what matters: today at the club, or the next day something is -- never an away-only day", () => {
  const hub = (today: ArenaDay["activities"], next: ArenaDay | null) => ({ today: "2026-10-10", todayAtTheClub: { ...day(today), activities: today }, next }) as never
  const away = fixture({ id: "away", home: false, venueName: null })
  assert.equal(usesEstate(away), false)
  assert.equal(usesEstate(fixture()), true)
  assert.equal(usesEstate(training()), true)
  // Today has only an away fixture: Arena looks ahead.
  const nextDay = { ...day([training()]), date: "2026-10-14" }
  assert.deepEqual(arenaFocus(hub([away], nextDay)), { date: "2026-10-14", isToday: false, day: nextDay })
  assert.equal(arenaFocus(hub([fixture()], nextDay))!.isToday, true)
  assert.equal(arenaFocus(hub([], null)), null)
  // An away fixture's place is said once: "Away · Vale of Lune RUFC", never "Away · Away · …".
  assert.equal(placeLine(day([away]), away), "Bolton RFC")
  assert.equal(placeLine(day([away]), { ...away, venueName: "Avenue Road" }), "Avenue Road", "the host's ground when it is known")
})

test("the day's state is facts a Club Admin acts on: what needs allocating, rooms outstanding, clashes, catering -- or planned", () => {
  const needing = fixture({ id: "n1", needs: ["PITCH", "ROOMS"], pitchId: null, homeRoomId: null, awayRoomId: null })
  const st = operationalState(day([needing, training({ needs: [] }), event()]))
  assert.equal(st.ready, false)
  assert.deepEqual(st.facts, ["1 activity needs allocating", "2 changing rooms outstanding", "1 clash to resolve", "2 catering requirements"])
  const planned = operationalState(day([fixture(), event()], { readiness: { ...day([]).readiness, roomConflicts: 0, needsAllocation: 0 } }))
  assert.equal(planned.ready, true)
  assert.match(planned.summary, /1 home fixture/)
})

test("a day of the week strip says its one thing by name, or what it holds, and what needs doing in words", () => {
  const base = { date: "2026-10-12", homeGames: 0, awayGames: 0, training: 0, tournaments: 0, pitchesReserved: 0, events: 0, needsAllocation: 0, conflicts: 0 }
  assert.deepEqual(weekDayCard(base), { lines: ["Nothing booked"], attention: [] })
  assert.deepEqual(weekDayCard({ ...base, training: 1, single: { kind: "TRAINING", team: team("U12", "boys"), title: null, time: "18:00" } }).lines, ["U12 Training", "18:00"])
  assert.deepEqual(weekDayCard({ ...base, homeGames: 4, needsAllocation: 1 }), { lines: ["4 Home"], attention: ["1 Unallocated"] })
  assert.deepEqual(weekDayCard({ ...base, tournaments: 1, pitchesReserved: 6, single: { kind: "TOURNAMENT", title: "Bolton Festival", time: "09:00", pitches: 6 } }).lines, ["Bolton Festival", "6 Pitches"])
})

test("a ground filter shows that ground's pitches and activities; multiple grounds are first-class", () => {
  const d = day([fixture(), training({ id: "s2", venueId: "v2", pitchId: "p2", needs: [] }), event()])
  assert.deepEqual(pitchRows(d, "v2").map((r) => r.name), ["Pitch 2"])
  assert.match(pitchRows(d, "v2")[0].subtitle, /2 at once/)
  // Every venue at once: grouped under each ground's name, the home ground first -- never one mixed list.
  const reversed = { ...d, pitches: [...d.pitches].reverse().map((p) => ({ ...p, sortOrder: p.id === "p2" ? 0 : 5 })) }
  assert.deepEqual(timelineGroups(pitchRows(reversed, null)).map((g) => [g.venueName, g.rows.map((r) => r.name)]), [["Ovalball UAT Ground", ["Pitch 1"]], ["Training Ground", ["Pitch 2"]]])
  assert.equal(timelineGroups(pitchRows(d, "v2")).length, 1)
  assert.deepEqual(filterActivities(d, "ALL", "v2").map((a) => a.id), ["s2"])
  const counts = filterCounts(d, null)
  assert.equal(counts.ALL, 3)
  assert.equal(counts.GAMES, 1)
  assert.equal(counts.EVENTS, 1)
  assert.equal(counts.UNALLOCATED, 0)
})

test("what needs allocating at one ground is the same set the List and the board's queue show -- never the whole day's", () => {
  // A fixture at the main ground still needing rooms, a session with no ground yet, and one at the second ground.
  const main = fixture({ id: "f-main", needs: ["ROOMS"], awayRoomId: null })
  const nowhere = training({ id: "s-none", venueId: null, venueName: null, pitchId: null, needs: ["VENUE", "PITCH"] })
  const second = training({ id: "s-v2", venueId: "v2", venueName: "Training Ground", pitchId: null, needs: ["PITCH"] })
  const d = day([main, nowhere, second])
  assert.deepEqual(needsAllocationAt(d, null).map((a) => a.id).sort(), ["f-main", "s-none", "s-v2"])
  // Filtered to the second ground, the main ground's fixture is not listed; something with no ground yet is,
  // because it could go to any ground.
  assert.deepEqual(needsAllocationAt(d, "v2").map((a) => a.id).sort(), ["s-none", "s-v2"])
  assert.deepEqual(needsAllocationAt(d, "v1").map((a) => a.id).sort(), ["f-main", "s-none"])
  // The Unallocated chip counts the same set, so the two can never disagree on one screen.
  assert.equal(filterCounts(d, "v2").UNALLOCATED, needsAllocationAt(d, "v2").length)
  assert.equal(filterCounts(d, "v1").UNALLOCATED, needsAllocationAt(d, "v1").length)
})

// ------------------------------------------------------------------ automatic allocation

test("a proposal is summarised in outcomes and changes, and Apply sends only what changes, each with what it expects", () => {
  const preview: AllocationPreview = {
    date: "2026-10-10", venueId: null, rerun: false,
    items: [
      { kind: "FIXTURE", id: "a", title: "A", teamId: null, window: "", current: { venueId: "v1", pitchId: null, homeRoomId: null, awayRoomId: null, officialsRoomId: null },
        proposed: { venueId: "v1", pitchId: "p1", homeRoomId: "r1", awayRoomId: "r2", officialsRoomId: null }, changes: ["PITCH", "ROOMS"], pitchOutcome: "FIRST_PREFERENCE", roomsOutcome: "AVAILABLE", outcome: "FIRST_PREFERENCE", explanation: [] },
      { kind: "TRAINING", id: "b", title: "B", teamId: null, window: "", current: { venueId: "v1", pitchId: "p1", homeRoomId: null, awayRoomId: null, officialsRoomId: null },
        proposed: { venueId: "v1", pitchId: "p1", homeRoomId: null, awayRoomId: null, officialsRoomId: null }, changes: [], pitchOutcome: "KEPT", roomsOutcome: null, outcome: "UNCHANGED", explanation: [] },
    ],
    summary: { firstPreferences: 1, alternatives: 0, noPreference: 0, unresolved: 0, unchanged: 1, pitchChanges: 1, kickoffProposals: 0, roomChanges: 1, venueChanges: 0 },
  }
  assert.deepEqual(previewSummaryLines(preview), { outcomes: "1 first preference", changes: "1 pitch change · 1 room change · 1 unchanged" })
  const changes = previewChanges(preview)
  assert.equal(changes.length, 1)
  assert.deepEqual(changes[0].expected, preview.items[0].current, "Apply is told what the plan read, so a stale plan is refused")
})

test("Plan Your Week says each day in counts and names what needs attention", () => {
  assert.deepEqual(weekDayLines({ date: "2026-10-10", homeGames: 5, awayGames: 0, training: 0, tournaments: 0, pitchesReserved: 0, events: 0, needsAllocation: 1, conflicts: 0 }), ["5 home fixtures", "1 unallocated"])
  assert.deepEqual(weekDayLines({ date: "2026-10-11", homeGames: 0, awayGames: 0, training: 0, tournaments: 1, pitchesReserved: 4, events: 0, needsAllocation: 0, conflicts: 0 }), ["Tournament · 4 pitches reserved"])
  assert.deepEqual(weekDayLines({ date: "2026-10-13", homeGames: 0, awayGames: 0, training: 3, tournaments: 0, pitchesReserved: 0, events: 0, needsAllocation: 0, conflicts: 0 }), ["3 training sessions"])
})

test("Arena Home's Need Attention is the strip's own rule added up, never a second definition", () => {
  const day = (date: string, needsAllocation: number, conflicts: number) => ({ date, homeGames: 1, awayGames: 0, training: 1, tournaments: 0, pitchesReserved: 0, events: 0, needsAllocation, conflicts })
  // Nothing to allocate and no clash anywhere: nothing needs anybody, so Home falls back to Upcoming.
  assert.deepEqual(weekAttention([day("2026-10-04", 0, 0), day("2026-10-05", 0, 0)]), { count: 0, needsAllocation: 0, conflicts: 0, firstDate: null })
  // Two days need someone: their unallocated activities and clashes are counted, and the first such day is the one opened.
  assert.deepEqual(weekAttention([day("2026-10-04", 0, 0), day("2026-10-06", 2, 0), day("2026-10-08", 1, 1)]), { count: 4, needsAllocation: 3, conflicts: 1, firstDate: "2026-10-06" })
})

// ------------------------------------------------------------------ structure

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(tsx|ts)$/.test(e.name)) out.push(full)
  }
  return out
}

test("Arena's screens read the Arena projections only -- never tables, never a client-side estate", () => {
  const files = walk(join(MOBILE, "src/arena"))
  assert.ok(files.length >= 8, "the Arena screens exist")
  for (const f of files) {
    const src = code(f)
    assert.doesNotMatch(src, /\.from\("/, `${f} reads a table directly`)
    assert.doesNotMatch(src, /\.rpc\(/, `${f} calls an RPC directly instead of the shared contract`)
    assert.doesNotMatch(src, /role ===|CLUB_ADMIN|roleLabel/, `${f} decides authority from a role`)
    assert.doesNotMatch(src, /require\(["'][^"']+\.(jpg|jpeg|png|webp)["']\)/, `${f} bundles its own picture instead of the library's`)
  }
  const api = code("packages/contracts/src/arena/api.ts")
  for (const rpc of ["get_arena_hub", "get_arena_day", "get_arena_range", "get_arena_allocation_options", "preview_arena_allocation", "apply_arena_allocation", "set_arena_lock", "save_arena_settings", "get_arena_preferences", "save_facility_preferences"]) {
    assert.match(api, new RegExp(`rpc\\("${rpc}"`), `${rpc} is not the shared contract's`)
  }
  for (const f of walk("packages/contracts/src/arena")) assert.doesNotMatch(read(f), /from "react|from "next|server-only/, `${f} is not platform-neutral`)
})

test("Arena's chrome is the shared forest header; the hero honours Reduce Motion; Home opens Arena", () => {
  for (const f of ["src/arena/hub-screen.tsx", "src/arena/planning-screen.tsx", "src/arena/settings-screen.tsx", "src/arena/preferences-screens.tsx"]) {
    assert.match(code(join(MOBILE, f)), /<OvalballDetailHeader/, `${f} draws its own header`)
  }
  const hub = code(join(MOBILE, "src/arena/hub-screen.tsx"))
  assert.match(hub, /if \(reduceMotion\) \{ cancelAnimation\(drift\)/, "the hero's drift stops under Reduce Motion")
  assert.match(hub, /hasOwnPicture/, "a stand-in picture is marked as illustrative, a real one is not")
  // The approved Arena Hub mock-up: the header floats on the hero over a forest bar that only appears on scroll,
  // and the six ways in are one photographic card, never a list of white rows.
  assert.match(hub, /<OvalballDetailHeader[\s\S]{0,200}overlay=\{\{\s*backdrop:[\s\S]{0,160}surface\.forest/, "Arena Home's header is the shared one, floating on the hero")
  assert.match(hub, /<ArenaDestinationCard/, "Arena's six ways in are the one photographic destination card")
  // Home or away on a fixture row is Ovalball's lettered badge, never the word in a grey metadata line.
  assert.match(hub, /a\.kind === "FIXTURE"\s*\?\s*<HomeAwayBadge/, "a fixture row on Arena Home marks home or away with the H/A badge")
  assert.doesNotMatch(hub, /<EmptyState|<ErrorState/, "Arena Home's states are drawn on forest, not chalk cards dropped on a dark page")
  // THE ARENA PICTURE is the club's own estate first (primary venue, then its pitches), Ovalball's only when it
  // has none -- and only Ovalball's carries the Illustrative mark.
  assert.match(hub, /useArenaHeroPhoto\(/, "the banner's picture is chosen by the one Arena picture rule")
  assert.match(hub, /photo\?\.illustrative && <IllustrativeTag/, "only Ovalball's picture is marked Illustrative; a club photograph never is")
  assert.doesNotMatch(hub, /libraryAsset\("arena-estate-01"\)/, "the banner no longer hard-codes Ovalball's aerial over a club's own photograph")
  // There is one place a ground's picture is kept: the Arena photograph IS the primary venue's cover, written through
  // the venue's own governed contract -- never a second, Arena-only photo store.
  const settings = code(join(MOBILE, "src/arena/settings-screen.tsx"))
  assert.match(settings, /setVenueCover\(supabase, primary\.id/, "Arena Settings changes the primary venue's own cover")
  assert.match(settings, /uploadVenueCoverPhoto\(supabase, clubId, primary\.id/, "an upload goes through the venue's own governed path")
  assert.match(settings, /<MediaPickerSheet/, "the one media picker, not a second photo chooser")
  // THE FOURTH COUNT is operational by the strip's own rule, never a second definition of "needs attention".
  assert.match(hub, /weekAttention\(hub\.week\)/, "Need Attention is the week's own attention, added up")
  assert.match(hub, /label: "Need Attention"/)
  assert.match(hub, /label: "Upcoming"/)
  assert.match(code(join(MOBILE, "src/club/home.tsx")), /label="Arena"[^\n]*\/admin\/arena/)
  assert.match(code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx")), /\/admin\/arena\/planning/, "old Pitch Allocation links land on Arena Planning")
})

test("Arena Planning is ONE plan: a drag, the Allocate sheet and Auto Allocate all stage into it, and Save is the only write", () => {
  const screen = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  // CONNECTED PLANNER (2026-10-05): the Pitches and Changing Rooms boards share one kit (planner/board-kit.tsx) --
  // the lift, the headers, the state words -- so the board's pins read the board and its kit together.
  const board = code(join(MOBILE, "src/arena/planner/pitch-board.tsx")) + code(join(MOBILE, "src/arena/planner/board-kit.tsx"))
  const sheet = code(join(MOBILE, "src/arena/planner/allocation-sheet.tsx"))
  const sheets = code(join(MOBILE, "src/arena/sheets.tsx"))
  const planner = code(join(MOBILE, "src/arena/planner/use-day-planner.ts"))
  // One day, one read, one plan: the board draws from Arena's day, never a second board read of its own.
  assert.match(screen, /useDayPlanner\(\{ clubId, day,/, "the screen holds the day's one plan")
  assert.match(screen, /<PitchBoard[\s\S]{0,120}planner=\{planner\}/, "the Pitches board draws the plan")
  assert.doesNotMatch(screen, /PitchBoardPanel|FacilitiesView|\bAllocateSheet\b|AutoAllocateSheet/, "a retired second pipeline is back")
  assert.doesNotMatch(board, /getPitchAllocationBoard|\bsupabase\b|\.rpc\(/, "the board reads or writes on its own")
  // Every way of changing an allocation stages; none of them writes.
  assert.match(board, /planner\.place\(activity, p\.pitchId/, "a drop stages a move")
  assert.match(sheet, /planner\.setParts\(a, parts/, "the Allocate sheet stages the same parts")
  assert.match(planner, /stage\(next, a, \{ \.\.\.item\.proposed \}, "AUTO", item\.explanation\)/, "Auto Allocate's proposal is staged as its own")
  assert.doesNotMatch(sheet, /\bsupabase\b|applyArenaAllocation/, "the Allocate sheet writes")
  assert.doesNotMatch(sheets, /applyArenaAllocation|previewArenaAllocation/, "a sheet applies a plan of its own")
  const applies = walk(join(MOBILE, "src/arena")).filter((f) => /applyArenaAllocation\(/.test(code(f)))
  assert.deepEqual(applies.map((f) => f.replace(/^.*src\/arena\//, "")), ["planner/use-day-planner.ts"], "Save is the one apply")
  // An invalid drop is never silently accepted: it is refused, with the rule's own sentence.
  // DAY / PITCHES REFINEMENT: the refusal is short and local ("Not moved. Pitch 1 unavailable" / "In use until
  // 14:15") -- the rule's own short form, never the engine's code -- and VoiceOver hears it too.
  assert.match(board, /if \(p\.clash\) \{[\s\S]{0,240}haptic\.refuse\(\)[\s\S]{0,160}Not moved\. \$\{p\.clash\.short\.title\}/, "an invalid drop is refused and says why")
  assert.match(board, /say\(`Not moved\. \$\{p\.clash\.short\.title\}: \$\{p\.clash\.short\.reason\}\.`\)/, "and says so to VoiceOver")
  // Facilities is no longer a Planning mode; the board's own headers say what is free now.
  assert.doesNotMatch(code(join(MOBILE, "src/arena/planner/planning-toolbar.tsx")), /"facilities"/, "Facilities came back as a duplicate mode")
  assert.match(board, /(inUse|now) \? "In use" : "Free now"/, "today's pitch headers say what is free now")
  // A tournament's reservation is drawn; its internal games are the tournament's plan, not fixtures on the board.
  assert.match(board, /x\.activityType === "TOURNAMENT" \|\| x\.activityType === "EVENT"/)
  assert.doesNotMatch(board, /"TOURNAMENT_GAME"\s*\?|activityType === "TOURNAMENT_GAME" &&/, "a tournament's games are drawn as bookings")
  // Locks: shown on the block, explained in the sheet, and only Auto Allocate is bound by them.
  // DAY / PITCHES REFINEMENT: the lock says exactly what is locked -- never the whole allocation when only part is.
  // DAY / PITCHES CRITIQUE: the lock shows on the block for ANY lock (it once showed for a pitch lock only), and the
  // words say which parts are held.
  assert.match(board, /\{state\.locks\.length > 0 && <Lock /)
  assert.match(board, /Locked: \$\{lockedWords\(state\.locks\)\}/, "VoiceOver hears what is locked")
  assert.match(sheets, /Auto Allocate will leave \$\{lockedWords\(locks\)\} unchanged\./)
  assert.match(sheets, /It may still change \$\{lockedWords\(unlockedParts\)\}/, "and what it may still change")
  // Leaving with unsaved changes asks Save, Discard or Keep Editing.
  assert.match(screen, /beforeRemove/)
  assert.match(code(join(MOBILE, "src/arena/planner/plan-bar.tsx")), /label="Keep Editing"/)
  // Ordinary words: the engine's codes and "conflict" never reach the screen; Arena says "clash".
  for (const f of [board, sheet, sheets, code(join(MOBILE, "src/arena/planner/plan-bar.tsx"))]) {
    assert.doesNotMatch(f, /"[^"\n]*\bconflicts?\b[^"\n]*"|`[^`\n]*\bconflicts?\b[^`\n]*`/i, "the word conflict is shown to a person")
    assert.doesNotMatch(f, /<Text[^>]*>[^<]*\.code\b/, "an engine code is shown to a person")
  }
})

// UPDATED (connected planner, 2026-10-05): the single large-club stress day became a library of made-up days
// (Thursday training night, quiet day, training night, match day, tournament day, event day, large club) in
// planner/scenarios.ts, opened as ?scenario=<key> (or ?stress=1 for the large club). The guarantees pinned here
// are the same, now for every scenario: development only, in memory, never read from or written to the server.
test("the made-up planning days are development only, in memory, and can never be saved", () => {
  const screen = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  const scenarios = code(join(MOBILE, "src/arena/planner/scenarios.ts"))
  const planner = code(join(MOBILE, "src/arena/planner/use-day-planner.ts"))
  assert.match(screen, /const scenarioKey: ScenarioKey \| null = __DEV__ \? /, "only a development build opens a made-up day")
  assert.match(screen, /const sample = scenarioKey !== null/, "and a made-up day is the sample")
  assert.doesNotMatch(scenarios, /\bsupabase\b|\.rpc\(|\.from\(/, "the made-up days read and write nothing")
  for (const key of ["thursday", "quiet", "training", "matchday", "tournament", "event", "large"]) assert.match(scenarios, new RegExp(`key: "${key}"`), `the ${key} scenario exists`)
  assert.match(planner, /if \(sample\) \{\s+setProblem\([^)]*nothing can be saved[^)]*\)\s+return false\s+\}/, "Save refuses on a made-up day, before any write")
  assert.match(planner, /sample \? sample\.preview\(day\) : await previewArenaAllocation/, "and Auto Allocate shows a sample worked out on the phone, never asking the server about made-up activities")
  assert.match(screen, /canLock=\{day\.canManage && !sample\}/, "nor can a made-up allocation be locked")
  assert.match(screen, /const openCentre = \(a: ArenaActivity\) => \{ if \(!sample\) openActivity\(router, a\) \}/, "nor a made-up activity opened in a real centre")
})

test("Day / Pitches: the board is the screen -- one row of controls, Unallocated at its foot, Auto Allocate the easy button", () => {
  const toolbar = code(join(MOBILE, "src/arena/planner/planning-toolbar.tsx"))
  // CONNECTED PLANNER (2026-10-05): the Pitches and Changing Rooms boards share one kit (planner/board-kit.tsx) --
  // the lift, the headers, the state words -- so the board's pins read the board and its kit together.
  const board = code(join(MOBILE, "src/arena/planner/pitch-board.tsx")) + code(join(MOBILE, "src/arena/planner/board-kit.tsx"))
  // Day / Week / Month is a menu beside the venue, not a second segmented control stacked over the day's tabs.
  assert.equal((toolbar.match(/accessibilityRole="tablist"/g) ?? []).length, 1, "one row of tabs, never two stacked")
  assert.match(toolbar, /View: \$\{modeLabel\}\. Change to day, week or month/)
  // Auto Allocate is the primary action wherever something is waiting; a person's drag is the override.
  assert.match(board, /accessibilityLabel="Auto Allocate"[^\n]*\n[^\n]*backgroundColor: colour\.pitch600/, "Auto Allocate is the bright-green primary action")
  // Resolved is one quiet line, not a card.
  assert.match(board, /"All allocated · Nothing else planned" : "All allocated"/)
  // A block's state is its edge and a word, never a new colour: Unsaved, Auto, Rooms proposed, Needs rooms.
  for (const word of ['"Unsaved"', '"Auto"', '"Rooms proposed"', '"Needs rooms"']) assert.ok(board.includes(word), `${word} is said on the block`)
  // Every block can be moved without dragging: VoiceOver's own actions on each.
  assert.match(board, /\{ name: "allocate", label: "Allocate" \}, \{ name: "remove", label: "Remove from Pitch" \}/)
})
