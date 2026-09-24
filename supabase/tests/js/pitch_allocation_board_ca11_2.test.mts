import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  AUTO_SCROLL_EDGE, END_MINUTES, LANE_GAP, LANE_HEIGHT, PX_PER_SLOT, SLOT_COUNT, SLOT_MINUTES, START_MINUTES,
  autoScrollVelocity, boardHeight, hourMarks, laneRows, minutesToTime, minutesToX, timelineWidth, widthForMinutes, xToSnappedMinutes, yToLaneRow,
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

const pitch = (id: string, laneCount = 1, active = true): PitchOption => ({ id, displayName: id.toUpperCase(), active, venueId: "v1", sizeCategory: "full", laneCount })
const fixture = (id: string, pitchId: string | null, kickoffTime: string | null, duration = 50): AllocationFixture => ({
  fixtureId: id, homeTeamId: "t" + id, homeTeamLabel: "Under 12 Boys", opponentLabel: "Them", category: "youth", ageGroup: "U12", gender: "boys", status: "Planned",
  kickoffDate: "2026-10-03", kickoffTime, venueId: "v1", pitchId, durationMinutes: duration, durationConfidence: "confirmed", requiredPitchSize: "full", requiresOpponentAgreement: false,
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
  assert.deepEqual(hourMarks().map((m) => m.label), ["8am", "9am", "10am", "11am", "12pm", "1pm", "2pm", "3pm", "4pm", "5pm", "6pm", "7pm", "8pm", "9pm", "10pm"])
})

test("time and pixels round-trip at both scales, and a finger position snaps to a slot inside the day", () => {
  for (const scale of ["compact", "comfortable"] as const) {
    assert.equal(timelineWidth(scale), SLOT_COUNT * PX_PER_SLOT[scale])
    assert.equal(minutesToX(START_MINUTES, scale), 0)
    assert.equal(minutesToX(14 * 60, scale), 24 * PX_PER_SLOT[scale])
    assert.equal(widthForMinutes(75, scale), 5 * PX_PER_SLOT[scale])
    for (const m of [480, 495, 600, 615, 1350, 1365]) assert.equal(xToSnappedMinutes(minutesToX(m, scale), scale), m, `${scale} ${m}`)
    // between two slots: nearest wins, never an off-grid time
    const px = PX_PER_SLOT[scale]
    assert.equal(xToSnappedMinutes(px * 0.4, scale), START_MINUTES)
    assert.equal(xToSnappedMinutes(px * 0.6, scale), START_MINUTES + SLOT_MINUTES)
    // clamped to the day: never before 08:00, never a kick-off at or after 23:00
    assert.equal(xToSnappedMinutes(-500, scale), START_MINUTES)
    assert.equal(xToSnappedMinutes(1e6, scale), END_MINUTES - SLOT_MINUTES)
    assert.equal(minutesToTime(xToSnappedMinutes(1e6, scale)), "22:45")
  }
  assert.ok(PX_PER_SLOT.comfortable > PX_PER_SLOT.compact, "comfortable is the larger scale")
  assert.equal(minutesToTime(9 * 60 + 5), "09:05")
})

// ------------------------------------------------------------------ lanes

test("pitches are rows: a two-lane pitch is two rows, an inactive pitch is none, and a vertical position maps to exactly one lane", () => {
  const rows = laneRows([{ id: "p1", lanes: 1, active: true }, { id: "p2", lanes: 2, active: true }, { id: "p3", lanes: 1, active: false }])
  assert.deepEqual(rows.map((r) => [r.pitchId, r.laneIndex]), [["p1", 0], ["p2", 0], ["p2", 1]])
  assert.equal(rows[1].top, LANE_HEIGHT + LANE_GAP)
  assert.equal(boardHeight(rows), 3 * (LANE_HEIGHT + LANE_GAP) - LANE_GAP)
  assert.equal(boardHeight([]), 0)
  assert.equal(yToLaneRow(0, rows)?.pitchId, "p1")
  assert.equal(yToLaneRow(LANE_HEIGHT + LANE_GAP - 1, rows)?.pitchId, "p1", "the gap below a lane still belongs to it")
  assert.equal(yToLaneRow(LANE_HEIGHT + LANE_GAP, rows)?.laneIndex, 0)
  assert.equal(yToLaneRow(LANE_HEIGHT + LANE_GAP, rows)?.pitchId, "p2")
  assert.equal(yToLaneRow(2 * (LANE_HEIGHT + LANE_GAP) + 5, rows)?.laneIndex, 1)
  assert.equal(yToLaneRow(-1, rows), null, "above every lane is nowhere")
  assert.equal(yToLaneRow(boardHeight(rows) + LANE_GAP, rows), null, "below every lane is nowhere")
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
  assert.equal(w.start, 13 * 60 + 40)
  assert.equal(w.playStart, 14 * 60)
  assert.equal(w.playEnd, 15 * 60)
  assert.equal(w.end, 15 * 60 + 10)
  const noDuration = fixtureOccupiedWindow(fixture("b", "p1", "14:00:00", null as unknown as number), { warmUpMinutes: 0, packUpMinutes: 0 })
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
  const board = boardOf([fixture("a", "p1", "10:00:00")], [fixture("b", null, null)], [pitch("p1"), pitch("p2", 2)])
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

test("Save is one canonical operation per staged fixture, in staging order: place through the schedule RPC, clear through the pitch RPC", () => {
  let pending = stageMove(new Map(), "b", "p1", "12:00:00")
  pending = stageRemoval(pending, "a")
  pending = stageMove(pending, "c", "p2", "09:15:00")
  assert.deepEqual(savePayload(pending), [
    { fixtureId: "b", op: "place", pitchId: "p1", kickoffTime: "12:00:00" },
    { fixtureId: "a", op: "clear" },
    { fixtureId: "c", op: "place", pitchId: "p2", kickoffTime: "09:15:00" },
  ])
  const ops = code("packages/contracts/src/pitch-allocation/operations.ts")
  assert.match(ops, /rpc\("update_fixture_schedule"/, "placing uses the canonical schedule RPC")
  assert.match(ops, /p_source: "PITCH_ALLOCATION"/, "and is audited as a pitch allocation")
  assert.match(ops, /rpc\("update_fixture_pitch"/, "clearing uses the canonical single-fixture RPC")
  const screen = code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx"))
  assert.match(screen, /await readPitchAllocationCapabilities\(supabase, clubId\)\n\s+setCaps\(allowed\)\n\s+if \(!allowed\.manage\)/, "Save re-asks the server for authority before the first write")
  assert.match(screen, /item\.op === "place" \? await allocateFixtureOnPitch\(supabase, clubId, fixtureId, \{ pitchId: item\.pitchId, kickoffTime: item\.kickoffTime \}\) : await clearFixturePitch\(supabase, fixtureId\)/, "each staged change is one shared operation")
  assert.match(screen, /remaining\.delete\(fixtureId\)/, "a saved change leaves staging; a failed one stays")
  assert.match(screen, /could not be saved and/, "partial failure is reported honestly")
  assert.match(screen, /Save Changes \(\$\{pending\.size\}\)/)
  assert.match(screen, /beforeRemove/, "leaving with staged changes asks first")
  assert.doesNotMatch(screen, /fixture\.fixture\.edit|fixture\.result\.record|CLUB_ADMIN|role ===|roleLabel/, "the screen infers authority from the wrong thing")
  assert.match(screen, /allocateFixtureOnPitch|clearFixturePitch/, "the screen writes only through the shared operations")
  assert.doesNotMatch(screen, /\.from\("fixtures"\)|\.rpc\(/, "the screen never writes a fixture directly")
})

test("Auto Allocate and Recalculate All keep the website's enablement and proposal semantics", () => {
  const screen = code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx"))
  assert.match(screen, /label="Auto Allocate"[^\n]*disabled=\{isDirty \|\| draft\.unallocated\.length === 0\}/, "Auto Allocate: not while dirty, not with nothing to allocate")
  assert.match(screen, /label="Recalculate All"[^\n]*disabled=\{isDirty \|\| summary\?\.total === 0\}/, "Recalculate All: not while dirty, not with no fixtures")
  assert.match(screen, /createAllocationProposal\(supabase, clubId, dateIso, session\.user\.id, recalculateAll\)/, "both go through the shared proposal operation")
  assert.match(screen, /conflictSeverity !== "hard"/, "hard-blocked proposal items are never staged")
  assert.match(screen, /discardAllocationProposal\(supabase, clubId, proposal\.id\)/, "a reviewed proposal is discarded once staged, as on the website")
})

// ------------------------------------------------------------------ the gesture is native, the authority is the server's

test("the board is a native gesture surface, read-only without the manage key, and never writes on a gesture", () => {
  const board = code(join(MOBILE, "src/pitch-allocation/board.tsx"))
  assert.match(board, /Gesture\.Pan\(\)[\s\S]*?\.enabled\(canManage\)[\s\S]*?\.activateAfterLongPress\(/, "press-and-hold lifts; nothing is grabbable without manage")
  assert.match(board, /useSharedValue|useAnimatedStyle/, "the finger drives the UI thread")
  assert.match(board, /runOnJS\(/, "React hears from the gesture on the JS thread only when asked")
  assert.match(board, /xToSnappedMinutes\(/, "drops snap to the canonical slot")
  assert.match(board, /yToLaneRow\(/, "lanes decide the pitch")
  assert.match(board, /autoScrollVelocity\(/, "the board scrolls for a finger near an edge")
  assert.match(board, /reduceMotion \?/, "Reduce Motion is honoured")
  assert.match(board, /accessibilityLabel=/, "blocks describe themselves to VoiceOver")
  assert.match(board, /press and hold to move/i, "and say how to move them")
  assert.doesNotMatch(board, /\bsupabase\b|\.rpc\(/, "the board never talks to the server; it only stages")
  const sheets = code(join(MOBILE, "src/pitch-allocation/sheets.tsx"))
  assert.match(sheets, /export function MoveSheet/, "an accessible non-drag move exists")
  assert.match(sheets, /onStage\(/, "and it stages through the same model")
  assert.match(sheets, /minuteInterval=\{15\}/, "the native time picker steps by the canonical slot")
  assert.match(sheets, /Remove from Pitch/, "removal from a pitch is a visible control")
  assert.doesNotMatch(sheets, /\bsupabase\b|\.rpc\(/, "the sheets never talk to the server either")
  const haptics = code(join(MOBILE, "src/pitch-allocation/haptics.ts"))
  assert.match(haptics, /Platform\.OS === "ios" || Platform\.OS === "android"/, "haptics are a no-op off native")
  const appLayout = code(join(MOBILE, "app/_layout.tsx"))
  assert.match(appLayout, /GestureHandlerRootView/, "the gesture root wraps the app")
})

test("a change on one client is what the other client reads: both project the same board from the same package", () => {
  const webData = code("app/(app)/calendar/pitch-allocation/data.ts")
  assert.match(webData, /getPitchAllocationBoard|@ovalball\/contracts\/pitch-allocation/, "the website reads the shared board")
  const screen = code(join(MOBILE, "app/(tabs)/admin/pitch-allocation/index.tsx"))
  assert.match(screen, /getPitchAllocationBoard\(supabase, clubId, day\)/, "the phone reads the shared board")
  assert.equal(fixtureById(boardOf([fixture("a", "p1", "10:00:00")], [], [pitch("p1")]), "a")?.fixtureId, "a")
  assert.equal(fixtureById(boardOf([], [], [pitch("p1")]), "zz"), null)
})
