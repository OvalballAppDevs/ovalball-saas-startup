import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  AUTO_SCROLL_EDGE, END_MINUTES, LANE_GAP, LANE_WIDTH, MIN_LANE_WIDTH, PX_PER_SLOT, SLOT_COUNT, SLOT_MINUTES, START_MINUTES,
  autoScrollVelocity, boardWidth, heightForMinutes, laneColumns, laneWidthFor, minutesToTime, minutesToY, timeMarks, timelineHeight, xToLaneColumn, yToSnappedMinutes,
} from "../../../apps/mobile/src/pitch-allocation/geometry"
import { draftBoard, fixtureById, isNoOp, placementPreview, savePayload, stageMove, stageRemoval, unstage } from "../../../apps/mobile/src/pitch-allocation/staging"
import { DEFAULT_SCHEDULING_POLICY, detectConflicts, fixtureOccupiedWindow, type AllocationFixture, type PitchAllocationBoard, type PitchOption } from "../../../packages/contracts/src/pitch-allocation"

/**
 * CA-M11.2 -- PITCH ALLOCATION NATIVE INTERACTION PARITY.
 *
 * The phone's board is a direct-manipulation surface over the SAME engine as the website: the same
 * fifteen-minute slots over the same day, the same occupied window (warm-up + match + pack-up), the
 * same conflict detectors, the same staged-then-saved model and the same canonical operations. These
 * pins are the domain of that board -- the parts a finger cannot be trusted to get right on its own.
 */
const MOBILE = "apps/mobile"
const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const pitch = (id: string, laneCount = 1, active = true): PitchOption => ({
  id, displayName: id.toUpperCase(), active, venueId: "v1",
  physicalSizeCategory: "full", customLengthM: null, customWidthM: null,
  layout: laneCount >= 4 ? "four_quarters" : laneCount >= 2 ? "two_halves" : "full_only",
  laneCount,
})
const fixture = (id: string, pitchId: string | null, kickoffTime: string | null, duration = 50, requiredPitchSize: AllocationFixture["requiredPitchSize"] = "full"): AllocationFixture => ({
  fixtureId: id, homeTeamId: "t" + id, homeTeamLabel: "Under 12 Boys", opponentLabel: "Them", category: "youth", ageGroup: "U12", gender: "boys", status: "Planned",
  kickoffDate: "2026-10-03", kickoffTime, venueId: "v1", pitchId, durationMinutes: duration, durationConfidence: "confirmed", requiredPitchSize, requiresOpponentAgreement: false,
  isSharedGroup: false, schedulingGroupId: null, awaySchedulingGroupId: null, effectiveHomeTeamIds: ["t" + id], effectiveAwayTeamIds: [],
})
function boardOf(fixtures: AllocationFixture[], unallocated: AllocationFixture[], pitches: PitchOption[], buffers = { warmUpMinutes: 15, packUpMinutes: 10 }): PitchAllocationBoard {
  const policy = { ...DEFAULT_SCHEDULING_POLICY, ...buffers }
  return {
    fixtures, unallocated, pitches, policy, conflicts: detectConflicts(fixtures, pitches, policy), rugbyCode: "union", tournaments: [], tournamentConflicts: [],
    trainingSessions: [], trainingConflicts: [], fixtureConflictsFromTraining: [], clubEvents: [], bufferSource: "club",
  }
}

// ------------------------------------------------------------------ the day and its slots

test("the board's day and slot size are the website's: 08:00 to 23:00 in fifteen-minute slots", () => {
  const web = code("app/(app)/calendar/pitch-allocation/pitch-allocation-board.tsx")
  const webStart = Number(web.match(/const START_MINUTES = (\d+) \* 60/)![1]) * 60
  const webEnd = Number(web.match(/const END_MINUTES = (\d+) \* 60/)![1]) * 60
  const webSlot = Number(web.match(/const SLOT_MINUTES = (\d+)/)![1])
  assert.equal(START_MINUTES, webStart)
  assert.equal(END_MINUTES, webEnd)
  assert.equal(SLOT_MINUTES, webSlot)
  assert.equal(SLOT_COUNT, 60)
  // THE TIME AXIS RUNS DOWN THE LEFT (Arena pass: "TIME | PITCH 1 | PITCH 2", never times across the top): every
  // quarter from 08:00, the hours always printed, the quarters too where a slot is tall enough to read.
  const marks = timeMarks("comfortable")
  assert.equal(marks.length, SLOT_COUNT)
  assert.deepEqual(marks.slice(0, 5).map((m) => m.label), ["08:00", "08:15", "08:30", "08:45", "09:00"])
  assert.deepEqual(marks.filter((m) => m.hour).map((m) => m.label), ["08:00", "09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00", "19:00", "20:00", "21:00", "22:00"])
  assert.ok(marks.every((m) => m.labelled), "a comfortable slot is tall enough to print every quarter")
  assert.ok(timeMarks("compact").filter((m) => m.labelled).every((m) => m.hour), "a compact slot prints the hours alone")
})

test("time and points round-trip down the board at both scales, and a finger position snaps to a slot inside the day", () => {
  for (const scale of ["compact", "comfortable"] as const) {
    assert.equal(timelineHeight(scale), SLOT_COUNT * PX_PER_SLOT[scale])
    assert.equal(minutesToY(START_MINUTES, scale), 0)
    assert.equal(minutesToY(14 * 60, scale), 24 * PX_PER_SLOT[scale])
    assert.equal(heightForMinutes(75, scale), 5 * PX_PER_SLOT[scale])
    for (const m of [480, 495, 600, 615, 1350, 1365]) assert.equal(yToSnappedMinutes(minutesToY(m, scale), scale), m, `${scale} ${m}`)
    // between two slots: nearest wins, never an off-grid time
    const px = PX_PER_SLOT[scale]
    assert.equal(yToSnappedMinutes(px * 0.4, scale), START_MINUTES)
    assert.equal(yToSnappedMinutes(px * 0.6, scale), START_MINUTES + SLOT_MINUTES)
    // clamped to the day: never before 08:00, never a kick-off at or after 23:00
    assert.equal(yToSnappedMinutes(-500, scale), START_MINUTES)
    assert.equal(yToSnappedMinutes(1e6, scale), END_MINUTES - SLOT_MINUTES)
    assert.equal(minutesToTime(yToSnappedMinutes(1e6, scale)), "22:45")
  }
  assert.ok(PX_PER_SLOT.comfortable > PX_PER_SLOT.compact, "comfortable is the larger scale")
  assert.equal(minutesToTime(9 * 60 + 5), "09:05")
})

// ------------------------------------------------------------------ lanes

test("a single-lane pitch is drawn at the full lane width, one column, with a horizontal position mapping to it", () => {
  // PITCHES RUN ACROSS THE TOP (Arena pass): a pitch is a column, and a finger's x decides it.
  const cols = laneColumns([{ id: "p1", lanes: 1, active: true }, { id: "p3", lanes: 1, active: false }])
  assert.deepEqual(cols.map((c) => [c.pitchId, c.laneIndex]), [["p1", 0]])
  assert.equal(cols[0].width, LANE_WIDTH)
  assert.equal(boardWidth(cols), LANE_WIDTH)
  assert.equal(boardWidth([]), 0)
  assert.equal(xToLaneColumn(0, cols)?.pitchId, "p1")
  assert.equal(xToLaneColumn(LANE_WIDTH + LANE_GAP - 1, cols)?.pitchId, "p1", "the gap beside a lane still belongs to it")
  assert.equal(xToLaneColumn(-1, cols), null, "left of every lane is nowhere")
  assert.equal(xToLaneColumn(LANE_WIDTH + LANE_GAP, cols), null, "right of every lane is nowhere")
})

test("concurrent bookings on one pitch share its column as narrower lanes, never a full column each", () => {
  // one lane costs the full width; two or three lanes on the SAME pitch cost much less than a naive 2x or 3x.
  assert.equal(laneWidthFor(1), LANE_WIDTH)
  assert.ok(laneWidthFor(2) < LANE_WIDTH, "a shared lane is narrower than a lane alone")
  assert.ok(laneWidthFor(3) < laneWidthFor(2), "three sharing are narrower still than two sharing")
  assert.ok(laneWidthFor(2) * 2 < LANE_WIDTH * 2, "two compacted lanes cost less than two full lanes")
  assert.ok(laneWidthFor(3) * 3 < LANE_WIDTH * 3, "three compacted lanes cost less than three full lanes")
  assert.ok(laneWidthFor(4) >= MIN_LANE_WIDTH, "even the most compact lane stays readable")

  const cols = laneColumns([{ id: "p1", lanes: 1, active: true }, { id: "p2", lanes: 3, active: true }])
  assert.deepEqual(cols.map((c) => [c.pitchId, c.laneIndex]), [["p1", 0], ["p2", 0], ["p2", 1], ["p2", 2]])
  assert.equal(cols[0].width, LANE_WIDTH, "a pitch with only one booking is unaffected by another pitch's compacting")
  for (const c of cols.slice(1)) assert.equal(c.width, laneWidthFor(3), "every lane sharing one pitch is the same compact width")
  // p2's three lanes sit close together, not each separated by the full between-pitch gap
  const internalGap = cols[2].left - (cols[1].left + cols[1].width)
  const betweenPitchGap = cols[1].left - (cols[0].left + cols[0].width)
  assert.ok(internalGap < betweenPitchGap, "lanes sharing a pitch sit closer together than two different pitches do")
  assert.equal(betweenPitchGap, LANE_GAP, "the gap between DIFFERENT pitches is still the full gap")
  // hit-testing resolves correctly across variable-width columns, including the compact ones
  assert.equal(xToLaneColumn(cols[0].left, cols)?.pitchId, "p1")
  assert.equal(xToLaneColumn(cols[1].left, cols)?.laneIndex, 0)
  assert.equal(xToLaneColumn(cols[2].left, cols)?.laneIndex, 1)
  assert.equal(xToLaneColumn(cols[3].left, cols)?.laneIndex, 2)
  assert.equal(xToLaneColumn(cols[3].left + cols[3].width + LANE_GAP - 1, cols)?.laneIndex, 2, "the gap after the LAST lane of a pitch still belongs to it")
  assert.equal(boardWidth(cols), cols[3].left + cols[3].width)
})

test("auto-scroll only near an edge, faster the closer the finger", () => {
  assert.equal(autoScrollVelocity(200, 400), 0)
  assert.ok(autoScrollVelocity(10, 400) < autoScrollVelocity(40, 400) && autoScrollVelocity(40, 400) < 0, "near the leading edge scrolls backwards, harder when closer")
  assert.ok(autoScrollVelocity(390, 400) > autoScrollVelocity(360, 400) && autoScrollVelocity(360, 400) > 0, "near the trailing edge scrolls forwards")
  assert.equal(autoScrollVelocity(AUTO_SCROLL_EDGE, 400), 0)
})

// ------------------------------------------------------------------ the occupied window is the shared engine's

test("the block a finger drags is the whole reserved window: warm-up, match and pack-up from the shared occupancy", () => {
  const w = fixtureOccupiedWindow(fixture("a", "p1", "14:00:00", 60), { warmUpMinutes: 20, packUpMinutes: 10 })
  assert.ok(w, "a fixture with a kick-off has an occupied window")
  assert.equal(w.start, 13 * 60 + 40)
  assert.equal(w.playStart, 14 * 60)
  assert.equal(w.playEnd, 15 * 60)
  assert.equal(w.end, 15 * 60 + 10)
  const noDuration = fixtureOccupiedWindow(fixture("b", "p1", "14:00:00", null as unknown as number), { warmUpMinutes: 0, packUpMinutes: 0 })
  assert.ok(noDuration, "an unknown duration still has an occupied window")
  assert.equal(noDuration.playEnd - noDuration.playStart, 60, "an unknown duration reserves the website's default hour")
  for (const f of ["src/pitch-allocation/board.tsx", "src/pitch-allocation/sheets.tsx", "src/pitch-allocation/staging.ts", "src/pitch-allocation/model.ts", "app/(tabs)/admin/pitch-allocation/index.tsx"]) {
    assert.doesNotMatch(code(join(MOBILE, f)), /[-+]\s*(?:\w+\.)*(warmUpMinutes|packUpMinutes)\b/, `${f} recomputes the occupied window itself`)
  }
  assert.match(code(join(MOBILE, "src/pitch-allocation/board.tsx")), /fixtureOccupiedWindow\(/, "the board draws the shared window")
})

// ------------------------------------------------------------------ staging

test("a drop stages; staging is a pure map of one change per fixture; the last change wins; putting a fixture back where it was is no change", () => {
  const board = boardOf([fixture("a", "p1", "10:00:00")], [fixture("b", null, null)], [pitch("p1"), pitch("p2")])
  let pending = stageMove(new Map(), "a", "p2", "11:00:00")
  pending = stageMove(pending, "a", "p2", "11:30:00")
  assert.equal(pending.size, 1)
  assert.deepEqual(pending.get("a"), { pitchId: "p2", kickoffTime: "11:30:00" })
  assert.ok(isNoOp(board, "a", { pitchId: "p1", kickoffTime: "10:00:00" }))
  assert.ok(!isNoOp(board, "a", { pitchId: "p1", kickoffTime: "10:15:00" }))
  assert.ok(isNoOp(board, "b", { pitchId: null, kickoffTime: null }), "removing an unallocated fixture is nothing")
  assert.ok(!isNoOp(board, "a", { pitchId: null, kickoffTime: null }))
  assert.equal(unstage(pending, "a").size, 0)
  assert.equal(pending.size, 1, "staging never mutates the previous map")
})

test("the draft board lays staged moves and removals over the saved board, and conflicts follow the draft", () => {
  const board = boardOf([fixture("a", "p1", "10:00:00"), fixture("c", "p1", "12:00:00")], [fixture("b", null, null)], [pitch("p1"), pitch("p2")])
  assert.equal(board.conflicts.length, 0)
  // move an unallocated fixture onto a lane: it leaves the tray
  const placed = draftBoard(board, stageMove(new Map(), "b", "p2", "10:00:00"))
  assert.equal(placed.unallocated.length, 0)
  assert.equal(placed.fixtures.find((f) => f.fixtureId === "b")?.pitchId, "p2")
  // take an allocated fixture off its pitch: it joins the tray with no pitch, and its conflicts go with it
  const removed = draftBoard(board, stageRemoval(new Map(), "a"))
  assert.deepEqual(removed.fixtures.map((f) => f.fixtureId), ["c"])
  assert.deepEqual(removed.unallocated.map((f) => f.fixtureId).sort(), ["a", "b"])
  assert.equal(removed.unallocated.find((f) => f.fixtureId === "a")?.pitchId, null)
  // a clashing move shows as a clash in the draft, before anything is saved
  const clashing = draftBoard(board, stageMove(new Map(), "c", "p1", "10:30:00"))
  assert.ok(clashing.conflicts.some((k) => k.fixtureId === "c" && k.severity === "hard"), "the draft carries the shared engine's clash")
})

test("the ghost's conflict is asked of the shared detectors over the draft, before the drop", () => {
  // PITCH-CAPACITY CORRECTION (footprint.ts): "a" and "b" are reduced-size here -- two genuinely
  // full-size fixtures no longer share one physical pitch regardless of declared lane_count (Section
  // 38, "FULL consumes all subdivisions"; pinned directly in auto-allocate.verify.ts/6d), so the "a
  // two-lane pitch takes both" assertion below needs fixtures whose combined footprint (2+2=4 units)
  // genuinely fits pitch p2's declared full-size 4-unit budget, exactly as a real two-lane pitch would.
  const board = boardOf([fixture("a", "p1", "10:00:00", 50, "reduced")], [fixture("b", null, null, 50, "reduced")], [pitch("p1"), pitch("p2", 2)])
  assert.equal(placementPreview(board, new Map(), "b", "p1", "10:30:00")?.severity, "hard", "overlapping the warm-up/pack-up envelope on a single-lane pitch is a clash")
  assert.equal(placementPreview(board, new Map(), "b", "p1", "11:15:00"), null, "after a's pack-up (10:50 + 10) plus b's warm-up (15) it is clear")
  assert.equal(placementPreview(board, new Map(), "b", "p1", "11:00:00")?.severity, "hard", "b's warm-up would start inside a's pack-up")
  assert.equal(placementPreview(board, new Map(), "b", "p2", "10:00:00"), null, "a different pitch is clear")
  // the preview sees earlier staged moves, so two drags cannot clash with each other unnoticed
  const staged = stageMove(new Map(), "a", "p2", "10:00:00")
  assert.equal(placementPreview(board, staged, "b", "p1", "10:00:00"), null, "a has moved off p1 in the draft")
  assert.equal(placementPreview(board, staged, "b", "p2", "10:00:00"), null, "a two-lane pitch takes both")
  const stagedRemoval = stageRemoval(new Map(), "a")
  assert.equal(placementPreview(board, stagedRemoval, "b", "p1", "10:00:00"), null, "a staged removal frees the lane")
})

test("Save is ONE plan of every staged fixture, checked whole by the server and applied through the canonical writers", () => {
  // The staging model is unchanged: one change per fixture, in staging order.
  let pending = stageMove(new Map(), "b", "p1", "12:00:00")
  pending = stageRemoval(pending, "a")
  pending = stageMove(pending, "c", "p2", "09:15:00")
  assert.deepEqual(savePayload(pending), [
    { fixtureId: "b", op: "place", pitchId: "p1", kickoffTime: "12:00:00" },
    { fixtureId: "a", op: "clear" },
    { fixtureId: "c", op: "place", pitchId: "p2", kickoffTime: "09:15:00" },
  ])
  // The website's board still writes through the shared single-fixture operations.
  const ops = code("packages/contracts/src/pitch-allocation/operations.ts")
  assert.match(ops, /rpc\("update_fixture_schedule"/, "placing uses the canonical schedule RPC")
  assert.match(ops, /p_source: "PITCH_ALLOCATION"/, "and is audited as a pitch allocation")
  assert.match(ops, /rpc\("update_fixture_pitch"/, "clearing uses the canonical single-fixture RPC")
  // The phone's board (Arena Planning's Pitches view) sends the staged changes as one plan. ARENA PLANNING
  // REBUILD: the retired panel (src/arena/pitch-board-panel.tsx) re-read the capability pair before saving; the
  // day plan is checked by the server inside the same transaction instead (apply_arena_allocation refuses
  // without arena_can_manage before anything is written), which is the stronger form of the same guarantee.
  const planner = code(join(MOBILE, "src/arena/planner/use-day-planner.ts"))
  const plan = code(join(MOBILE, "src/arena/planner/plan.ts"))
  const bar = code(join(MOBILE, "src/arena/planner/plan-bar.tsx"))
  const screen = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  assert.match(read("supabase/migrations/20270738000000_arena_plans_the_estate.sql"), /function public\.apply_arena_allocation[\s\S]{0,2400}if not internal\.arena_can_manage\(p_club_id\) then\s+raise exception/, "Save is refused by the server, before the first write, without the manage key")
  assert.match(planner, /applyArenaAllocation\(supabase, clubId, day\.date, toArenaChanges\(plan\), "MANUAL"\)/, "every staged change is one plan through the Arena apply")
  assert.match(code(join(MOBILE, "src/arena/planner/use-day-planner.ts")), /stage\(p, a, \{ pitchId: null \}, "MANUAL"\)/, "a removal clears the pitch")
  assert.match(code(join(MOBILE, "src/arena/planner/use-day-planner.ts")), /const parts: PlanParts = \{ pitchId, \.\.\.\(kickoff !== undefined \? \{ kickoff: clock\(kickoff\) \} : \{\}\) \}/, "and a move sets pitch and kick-off")
  assert.match(bar, /Nothing was saved, and your changes are still staged/, "a refused plan changes nothing and keeps every staged change")
  assert.match(bar, /saveWords\(counts\.total, counts\.auto\)/)
  assert.match(code(join(MOBILE, "src/arena/planner/words.ts")), /action: total === 1 \? "Save Change" : `Save \$\{total\} Changes`/)
  assert.match(screen, /beforeRemove/, "leaving with staged changes asks first")
  for (const f of [planner, plan, bar, screen]) {
    assert.doesNotMatch(f, /fixture\.fixture\.edit|fixture\.result\.record|CLUB_ADMIN|role ===|roleLabel/, "the screen infers authority from the wrong thing")
    assert.doesNotMatch(f, /\.from\("fixtures"\)|\.rpc\(/, "the screen never writes a fixture directly")
  }
  // The server applies it through the Match Centre's and the schedule's own writers, in one transaction.
  const migration = read("supabase/migrations/20270738000000_arena_plans_the_estate.sql")
  assert.match(migration, /perform public\.update_fixture_schedule\(a\.id, f\.kickoff_date, v_kickoff, v_venue, v_pitch, null, 'ARENA'\)/)
  assert.match(migration, /perform public\.set_fixture_facilities\(a\.id, v_patch\)/)
  assert.match(migration, /perform internal\.refuse_new_arena_conflicts\(p_club_id, array\[p_date\], v_before, v_subjects\)/, "the finished plan is checked once by the engine")
})

test("Auto Allocate is the server's: previewed, explained, then applied -- Recalculate All is Re-run Auto Allocation", () => {
  // ARENA PLANNING REBUILD: the proposal is laid on the board as Auto Allocate's own unsaved changes and applied
  // with the day plan, each change carrying source AUTO (so a lock still binds it), instead of a separate sheet
  // that applied straight away.
  const sheets = code(join(MOBILE, "src/arena/sheets.tsx"))
  const planner = code(join(MOBILE, "src/arena/planner/use-day-planner.ts"))
  assert.match(planner, /previewArenaAllocation\(supabase, clubId, day\.date, \{ venueId, rerun \}\)/, "the proposal is calculated on the server, never on the phone")
  assert.match(planner, /stage\(next, a, \{ \.\.\.item\.proposed \}, "AUTO", item\.explanation\)/, "staged as Auto Allocate's own proposal")
  assert.match(code(join(MOBILE, "src/arena/planner/plan.ts")), /source: c\.origin/, "and applied with its own source")
  // DAY / PITCHES CRITIQUE: with nothing to apply, the sheet says so and offers Close -- never a disabled "Nothing
  // to Apply" button beside a "Discard" for changes that do not exist.
  assert.match(sheets, /\{nothing \? \(\s*<Button label="Close"/, "nothing to apply is said, not offered")
  assert.match(sheets, /Re-run Auto Allocation/)
  assert.match(sheets, /Recalculate unlocked allocations using current facility availability and team preferences/)
  const planning = code(join(MOBILE, "src/arena/planning-screen.tsx"))
  assert.match(planning, /day\.policy\.autoAllocateHomeFixtures/, "the club's own switch still opens a proposal as the day opens")
  assert.match(planning, /autoOfferedFor\.current === day\.date/, "once per day")
  const migration = read("supabase/migrations/20270738000000_arena_plans_the_estate.sql")
  assert.match(migration, /AUTOMATIC ALLOCATION, AS A PROPOSAL/)
  assert.match(migration, /Nothing is written\. Apply re-checks every part of it\./)
})

// ------------------------------------------------------------------ the gesture is native, the authority is the server's

test("the board is a native gesture surface, read-only without the manage key, and never writes on a gesture", () => {
  // ARENA PLANNING REBUILD: Arena Planning's Pitches view is src/arena/planner/pitch-board.tsx now; the same
  // pins, moved to the board that is on screen.
  // CONNECTED PLANNER (2026-10-05): the Pitches and Changing Rooms boards share one kit (planner/board-kit.tsx) --
  // the lift, the headers, the state words -- so the board's pins read the board and its kit together.
  const board = code(join(MOBILE, "src/arena/planner/pitch-board.tsx")) + code(join(MOBILE, "src/arena/planner/board-kit.tsx"))
  assert.match(board, /Gesture\.Pan\(\)[\s\S]*?\.enabled\(canManage\)[\s\S]*?\.activateAfterLongPress\(/, "press-and-hold lifts; nothing is grabbable without manage")
  assert.match(board, /useSharedValue|useAnimatedStyle/, "the finger drives the UI thread")
  assert.match(board, /runOnJS\(/, "React hears from the gesture on the JS thread only when asked")
  assert.match(board, /yToSnappedMinutes\(/, "drops snap to the canonical slot, down the time axis")
  assert.match(board, /xToLaneColumn\(/, "columns decide the pitch")
  assert.match(board, /TIME_AXIS_WIDTH/, "time runs down a frozen axis on the left")
  assert.match(board, /autoScrollVelocity\(/, "the board scrolls for a finger near an edge")
  assert.match(board, /reduceMotion \?/, "Reduce Motion is honoured")
  assert.match(board, /accessibilityLabel=/, "blocks describe themselves to VoiceOver")
  assert.match(board, /press and hold to move/i, "and say how to move them")
  assert.doesNotMatch(board, /\bsupabase\b|\.rpc\(/, "the board never talks to the server; it only stages")
  // The accessible non-drag move is the Allocate sheet: the same plan, as words.
  const sheet = code(join(MOBILE, "src/arena/planner/allocation-sheet.tsx"))
  assert.match(sheet, /export function AllocationSheet/, "an accessible non-drag move exists")
  assert.match(sheet, /planner\.setParts\(/, "and it stages through the same plan")
  assert.match(sheet, /minuteInterval=\{15\}/, "the native time picker steps by the canonical slot")
  assert.match(code(join(MOBILE, "src/arena/sheets.tsx")), /Remove from Pitch/, "removal from a pitch is a visible control")
  assert.doesNotMatch(sheet, /\bsupabase\b|\.rpc\(/, "the sheet never talks to the server either")
  const haptics = code(join(MOBILE, "src/pitch-allocation/haptics.ts"))
  assert.match(haptics, /Platform\.OS === "ios" || Platform\.OS === "android"/, "haptics are a no-op off native")
  const appLayout = code(join(MOBILE, "app/_layout.tsx"))
  assert.match(appLayout, /GestureHandlerRootView/, "the gesture root wraps the app")
})

test("a kick-off change on a shared fixture may be a proposal, not an application, and the sheet says so honestly", () => {
  const ops = code("packages/contracts/src/pitch-allocation/operations.ts")
  assert.match(ops, /kickoffProposed: result\?\.kickoff_proposed/, "the shared operation reads the server's own kickoff_proposed flag")
  // ARENA PLANNING REBUILD: the day plan reports proposals from the server's own kickoff_proposed and the
  // Allocate sheet says before the change that a shared fixture's kick-off goes to the other club to agree.
  const planner = code(join(MOBILE, "src/arena/planner/use-day-planner.ts"))
  assert.match(planner, /result\.kickoffProposed\?\.length/, "a kick-off that came back proposed, not applied, is counted")
  assert.match(planner, /sent to the other club to agree/, "and said, never shown as confirmed")
  const sheet = code(join(MOBILE, "src/arena/planner/allocation-sheet.tsx"))
  assert.match(sheet, /kickoffMoved && fixture\.requiresOpponentAgreement/, "the sheet knows when a new kick-off needs agreement")
  // DAY / PITCHES REFINEMENT: the same promise in fewer words ("is asked to agree the new kick-off. Until they do,
  // it stays at 14:30").
  assert.match(sheet, /is asked to agree the new kick-off\. Until they do, it stays at/, "and says the fixture keeps its time until it is agreed")
})

test("a change on one client is what the other client reads: both project the same board from the same package", () => {
  const webData = code("app/(app)/calendar/pitch-allocation/data.ts")
  assert.match(webData, /getPitchAllocationBoard|@ovalball\/contracts\/pitch-allocation/, "the website reads the shared board")
  // ARENA PLANNING REBUILD: the phone's Pitches view reads Arena's day (get_arena_day) from the shared contract,
  // the same canonical fixture, pitch and room columns the website's board reads -- one truth, two projections.
  assert.match(code(join(MOBILE, "src/arena/planning-screen.tsx")), /readArenaDay\(supabase, clubId, date\)/, "the phone reads the shared Arena day")
  assert.equal(fixtureById(boardOf([fixture("a", "p1", "10:00:00")], [], [pitch("p1")]), "a")?.fixtureId, "a")
  assert.equal(fixtureById(boardOf([], [], [pitch("p1")]), "zz"), null)
})
