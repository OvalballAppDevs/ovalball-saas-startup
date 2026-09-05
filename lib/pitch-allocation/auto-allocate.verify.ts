import { autoAllocate, detectConflicts, partitionAllocation } from "./auto-allocate"
import { DEFAULT_SCHEDULING_POLICY, type AllocationFixture, type PitchOption } from "./types"

/** Run with `npx tsx lib/pitch-allocation/auto-allocate.verify.ts`. Permanent regression coverage for the deterministic auto-allocation algorithm (Overnight Master Pass, Calendar Pitch Allocation, Section 74). */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`)
  if (ok) pass++
  else fail++
}
function checkTrue(name: string, cond: boolean) {
  console.log(`${cond ? "PASS" : "FAIL"}: ${name}`)
  if (cond) pass++
  else fail++
}

function fixture(overrides: Partial<AllocationFixture> & Pick<AllocationFixture, "fixtureId">): AllocationFixture {
  return {
    homeTeamId: "team-1",
    homeTeamLabel: "U12",
    opponentLabel: "Opponent",
    category: "youth",
    ageGroup: "U12",
    gender: null,
    status: "Booked",
    kickoffDate: "2026-10-11",
    kickoffTime: null,
    venueId: null,
    pitchId: null,
    durationMinutes: 40,
    durationConfidence: "confirmed",
    requiredPitchSize: "reduced",
    requiresOpponentAgreement: false,
    isSharedGroup: false,
    schedulingGroupId: null,
    awaySchedulingGroupId: null,
    effectiveHomeTeamIds: ["team-1"],
    effectiveAwayTeamIds: [],
    ...overrides,
  }
}
function pitch(overrides: Partial<PitchOption> & Pick<PitchOption, "id">): PitchOption {
  return { displayName: overrides.id, active: true, venueId: null, sizeCategory: "full", laneCount: 1, ...overrides }
}

// A Sunday, so weekend youth window applies (09:00-13:00 default policy).
const SUNDAY = "2026-10-11"

// 1. Single fixture places within the preferred window on a suitable pitch.
{
  const { placements, conflicts } = autoAllocate([fixture({ fixtureId: "f1" })], [pitch({ id: "p1", sizeCategory: "reduced" })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue("1. Single fixture placed", placements[0].pitchId === "p1" && placements[0].kickoffTime !== null)
  checkTrue("1b. Placed kickoff within weekend youth window (09:00-13:00)", placements[0].kickoffTime! >= "09:00" && placements[0].kickoffTime! <= "13:00")
  check("1c. No conflicts for a single clean placement", conflicts.length, 0)
}

// 2. Two fixtures needing the same pitch type get different, non-overlapping slots.
{
  const { placements } = autoAllocate(
    [fixture({ fixtureId: "f1" }), fixture({ fixtureId: "f2" })],
    [pitch({ id: "p1", sizeCategory: "reduced" })],
    DEFAULT_SCHEDULING_POLICY,
    SUNDAY
  )
  const times = placements.map((p) => p.kickoffTime).sort()
  checkTrue("2. Two fixtures on one pitch get different times", times[0] !== times[1] && times.every((t) => t !== null))
}

// 3. Mini-only fixture never placed on a full-size-only pitch, even if it's the only pitch.
{
  const { placements, conflicts } = autoAllocate(
    [fixture({ fixtureId: "f1", requiredPitchSize: "mini" })],
    [pitch({ id: "p1", sizeCategory: "full" })],
    DEFAULT_SCHEDULING_POLICY,
    SUNDAY
  )
  checkTrue("3. Mini fixture left unallocated rather than placed on a full-only pitch", placements[0].pitchId === null)
  checkTrue("3b. Hard conflict recorded with a real reason", conflicts.length === 1 && conflicts[0].severity === "hard")
}

// 4. Full-size fixture correctly rejects a mini-only pitch.
{
  const { placements } = autoAllocate([fixture({ fixtureId: "f1", requiredPitchSize: "full" })], [pitch({ id: "p1", sizeCategory: "mini" })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue("4. Full-size fixture not placed on a mini-only pitch", placements[0].pitchId === null)
}

// 5. Reduced fixture CAN use a full pitch (a bigger pitch is always safe for a smaller-format game).
{
  const { placements } = autoAllocate([fixture({ fixtureId: "f1", requiredPitchSize: "reduced" })], [pitch({ id: "p1", sizeCategory: "full" })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue("5. Reduced-size fixture placed on a full-size pitch", placements[0].pitchId === "p1")
}

// 6. Inactive pitch never receives an allocation.
{
  const { placements } = autoAllocate([fixture({ fixtureId: "f1", requiredPitchSize: "full" })], [pitch({ id: "p1", sizeCategory: "full", active: false })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue("6. Inactive pitch never allocated", placements[0].pitchId === null)
}

// 7. Cancelled fixture is excluded entirely -- never occupies pitch time (Section 46).
{
  const { placements } = autoAllocate([fixture({ fixtureId: "f1", status: "Cancelled" })], [pitch({ id: "p1", sizeCategory: "full" })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  check("7. Cancelled fixture produces zero placements", placements.length, 0)
}

// 8. Existing bookings (already-applied allocations) block a new proposal
// from double-booking the same pitch/time. Since Section 32-36, a mini/
// junior fixture whose whole morning+early-afternoon window (09:00-13:00)
// is genuinely blocked now falls through to the last-resort band (from
// 13:00) rather than being left unallocated -- but ONLY with an explicit
// warning conflict attached, never silently.
{
  const { placements, conflicts } = autoAllocate(
    [fixture({ fixtureId: "f1", requiredPitchSize: "full", durationMinutes: 40 })],
    [pitch({ id: "p1", sizeCategory: "full" })],
    DEFAULT_SCHEDULING_POLICY,
    SUNDAY,
    [{ pitchId: "p1", start: 9 * 60, end: 13 * 60 }] // pitch fully booked all morning+early-afternoon
  )
  checkTrue("8. Existing booking blocking the whole morning/early-afternoon window is not double-booked", placements[0].pitchId === "p1" && placements[0].kickoffTime! >= "13:00")
  checkTrue("8b. That last-resort placement carries an explicit warning conflict, never a silent late slot", conflicts.some((c) => c.fixtureId === "f1" && c.severity === "warning"))
}

// 9. Duration respected: a longer fixture consumes more of the window, leaving less room for a second fixture.
{
  const { placements } = autoAllocate(
    [fixture({ fixtureId: "f1", durationMinutes: 200 }), fixture({ fixtureId: "f2", durationMinutes: 200 })],
    [pitch({ id: "p1", sizeCategory: "reduced" })],
    DEFAULT_SCHEDULING_POLICY,
    SUNDAY
  )
  // Weekend youth window is 09:00-13:00 = 240 minutes; two 200-minute fixtures cannot both fit.
  const placedCount = placements.filter((p) => p.pitchId !== null).length
  check("9. Duration-aware capacity -- only one of two long fixtures fits the window", placedCount, 1)
}

// 10. Deterministic: running the same input twice produces the identical plan.
{
  const fixtures = [fixture({ fixtureId: "f1" }), fixture({ fixtureId: "f2" }), fixture({ fixtureId: "f3", requiredPitchSize: "full" })]
  const pitches = [pitch({ id: "p1", sizeCategory: "reduced" }), pitch({ id: "p2", sizeCategory: "full" })]
  const run1 = autoAllocate(fixtures, pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY)
  const run2 = autoAllocate(fixtures, pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY)
  check("10. Deterministic -- identical input produces identical output", run1.placements, run2.placements)
}

// 11. Weekday policy: a Monday fixture is windowed from the club's weekday-earliest-kickoff default (18:00), not the weekend youth window.
{
  const MONDAY = "2026-10-12"
  const { placements } = autoAllocate([fixture({ fixtureId: "f1", kickoffDate: MONDAY })], [pitch({ id: "p1", sizeCategory: "reduced" })], DEFAULT_SCHEDULING_POLICY, MONDAY)
  checkTrue("11. Weekday fixture placed at/after the 18:00 policy default, not the weekend morning window", placements[0].kickoffTime !== null && placements[0].kickoffTime! >= "18:00")
}

// 12. Senior category prefers the afternoon window even on a weekend.
// ageGroup explicitly cleared -- a real senior team's ageGroup is never
// "U12" (the fixture() helper's default); age, where genuinely present,
// takes priority over category (Section 32-36), so this override must be
// realistic for what it's testing, not rely on the helper's youth default.
{
  const { placements } = autoAllocate([fixture({ fixtureId: "f1", category: "senior", ageGroup: null, requiredPitchSize: "full" })], [pitch({ id: "p1", sizeCategory: "full" })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue("12. Senior fixture placed within the afternoon window (13:00-17:30)", placements[0].kickoffTime! >= "13:00" && placements[0].kickoffTime! <= "17:30")
}

// 12b. Age takes priority over category: a fixture explicitly tagged U16
// (mini/junior band, Section 32) still gets the morning-first treatment
// even if something else on the row were ever mislabelled "senior" --
// this is the exact bug (a real youth fixture landing on an adult-style
// late slot) the age-priority rule exists to prevent.
{
  const { placements, conflicts } = autoAllocate([fixture({ fixtureId: "f1", category: "senior", ageGroup: "U16", requiredPitchSize: "full" })], [pitch({ id: "p1", sizeCategory: "full" })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue("12b. A U16-tagged fixture is treated as mini/junior (morning-first) regardless of a stray category value", placements[0].kickoffTime! >= "09:00" && placements[0].kickoffTime! <= "12:00")
  checkTrue("12c. No warning conflict when the morning band itself succeeds", !conflicts.some((c) => c.fixtureId === "f1"))
}

// detectConflicts: an already-placed board.
{
  const placed = [
    fixture({ fixtureId: "f1", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40, homeTeamLabel: "U12", opponentLabel: "Rossendale U12" }),
    fixture({ fixtureId: "f2", pitchId: "p1", kickoffTime: "10:20", durationMinutes: 40, homeTeamLabel: "U13", opponentLabel: "Rossendale U13" }), // overlaps f1
  ]
  const conflicts = detectConflicts(placed, [pitch({ id: "p1", sizeCategory: "full" })])
  checkTrue("13. detectConflicts finds the real pitch/time overlap", conflicts.some((c) => c.fixtureId === "f2" && c.severity === "hard"))
}
{
  const placed = [fixture({ fixtureId: "f1", pitchId: "p1", kickoffTime: "10:00", requiredPitchSize: "full" })]
  const conflicts = detectConflicts(placed, [pitch({ id: "p1", sizeCategory: "mini" })])
  checkTrue("14. detectConflicts flags a fixture placed on a too-small pitch", conflicts.some((c) => c.fixtureId === "f1" && c.severity === "hard"))
}

// 15. Section 31-40: autoAllocate must not place a new fixture during an
// existing fixture's warm-up/pack-up buffer, even though their bare play
// windows (10:00-10:40 vs 10:40-11:20) don't literally touch.
{
  const bufferedPolicy = { ...DEFAULT_SCHEDULING_POLICY, warmUpMinutes: 15, packUpMinutes: 15, turnaroundMinutes: 0 }
  const existingBookings = [{ pitchId: "p1", start: 10 * 60 - 15, end: 10 * 60 + 40 + 15 }] // 09:45-10:55 real occupied window
  const { placements } = autoAllocate(
    [fixture({ fixtureId: "f2", kickoffDate: SUNDAY, requiredPitchSize: "reduced" })],
    [pitch({ id: "p1", sizeCategory: "reduced" })],
    bufferedPolicy,
    SUNDAY,
    existingBookings
  )
  checkTrue(
    "15. autoAllocate skips a slot that would land inside another fixture's warm-up/pack-up buffer",
    placements[0].kickoffTime === null || placements[0].kickoffTime! >= "10:55"
  )
}

// 16. Section 31-40: detectConflicts flags two placed fixtures whose bare
// play windows don't overlap but whose warm-up/pack-up buffers do.
{
  const placed = [
    fixture({ fixtureId: "f1", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40, homeTeamLabel: "U12", opponentLabel: "Rossendale U12" }),
    fixture({ fixtureId: "f2", pitchId: "p1", kickoffTime: "10:45", durationMinutes: 40, homeTeamLabel: "U13", opponentLabel: "Rossendale U13" }), // 5 min after f1 ends -- fine with no buffer, a conflict with a 15-min pack-up
  ]
  const noBufferConflicts = detectConflicts(placed, [pitch({ id: "p1", sizeCategory: "full" })], { warmUpMinutes: 0, packUpMinutes: 0 })
  const bufferedConflicts = detectConflicts(placed, [pitch({ id: "p1", sizeCategory: "full" })], { warmUpMinutes: 0, packUpMinutes: 15 })
  checkTrue("16a. No buffer configured -- back-to-back fixtures 5 minutes apart are not flagged", !noBufferConflicts.some((c) => c.fixtureId === "f2"))
  checkTrue("16b. 15-minute pack-up configured -- the same two fixtures ARE flagged", bufferedConflicts.some((c) => c.fixtureId === "f2" && c.severity === "hard"))
}

// 17. Section 41-47: a lane_count=2 pitch places TWO overlapping fixtures at the same time, not sequentially.
{
  const fixtures = [fixture({ fixtureId: "f1" }), fixture({ fixtureId: "f2" })]
  const { placements } = autoAllocate(fixtures, [pitch({ id: "p1", laneCount: 2 })], DEFAULT_SCHEDULING_POLICY, SUNDAY)
  checkTrue(
    "17. Two fixtures both placed on the SAME pitch at the SAME time when lane_count=2",
    placements[0].pitchId === "p1" && placements[1].pitchId === "p1" && placements[0].kickoffTime === placements[1].kickoffTime
  )
}

// 18. Section 41-47: a lane_count=2 pitch still rejects a THIRD simultaneous fixture -- capacity is a real ceiling, not unlimited.
{
  const existingBookings = [
    { pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40 },
    { pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40 },
  ]
  const { placements } = autoAllocate([fixture({ fixtureId: "f3" })], [pitch({ id: "p1", laneCount: 2 })], DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  checkTrue("18. A third overlapping fixture is NOT placed in the same slot once lane_count=2 is already full", placements[0].kickoffTime !== "09:00")
}

// 19. Section 41-47: detectConflicts does not flag two genuinely-concurrent fixtures on a lane_count=2 pitch.
{
  const placed = [
    fixture({ fixtureId: "f1", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40, homeTeamLabel: "U7", opponentLabel: "Rossendale U7" }),
    fixture({ fixtureId: "f2", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40, homeTeamLabel: "U8", opponentLabel: "Rossendale U8" }),
  ]
  const conflicts = detectConflicts(placed, [pitch({ id: "p1", laneCount: 2 })])
  checkTrue("19a. Two simultaneous fixtures on a lane_count=2 pitch are NOT conflicts", conflicts.length === 0)
  const conflictsAtCapacity1 = detectConflicts(placed, [pitch({ id: "p1", laneCount: 1 })])
  checkTrue("19b. The SAME two fixtures ARE conflicts once the pitch only has lane_count=1", conflictsAtCapacity1.some((c) => c.fixtureId === "f2"))
}

// 20. Section 41-47: detectConflicts flags a THIRD fixture exceeding a lane_count=2 pitch's real capacity.
{
  const placed = [
    fixture({ fixtureId: "f1", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40 }),
    fixture({ fixtureId: "f2", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40 }),
    fixture({ fixtureId: "f3", pitchId: "p1", kickoffTime: "10:00", durationMinutes: 40 }),
  ]
  const conflicts = detectConflicts(placed, [pitch({ id: "p1", laneCount: 2 })])
  checkTrue("20. A third simultaneous fixture beyond lane_count=2 IS flagged", conflicts.some((c) => c.fixtureId === "f3"))
}

// 21. Section 71-73: partitionAllocation's allocated/unallocated split must
// be exhaustive and disjoint -- every eligible fixture ends up in EXACTLY
// one of the two arrays, covering pitch-only, time-only, both, and
// neither set, so the board can never silently drop or duplicate a fixture.
{
  const fixtures = [
    fixture({ fixtureId: "f1", pitchId: "p1", kickoffTime: "10:00" }), // both set -- allocated
    fixture({ fixtureId: "f2", pitchId: null, kickoffTime: null }), // neither set -- unallocated
    fixture({ fixtureId: "f3", pitchId: "p1", kickoffTime: null }), // pitch only -- unallocated
    fixture({ fixtureId: "f4", pitchId: null, kickoffTime: "11:00" }), // time only -- unallocated
  ]
  const { allocated, unallocated } = partitionAllocation(fixtures)
  check(
    "21a. Allocated ∪ Unallocated covers every input fixture exactly once, no missing or duplicate IDs",
    [...allocated, ...unallocated]
      .map((f) => f.fixtureId)
      .sort()
      .join(","),
    fixtures
      .map((f) => f.fixtureId)
      .sort()
      .join(",")
  )
  check("21b. Only the fully-set fixture counts as allocated", allocated.map((f) => f.fixtureId).join(","), "f1")
  check("21c. Every partially- or un-set fixture counts as unallocated", unallocated.map((f) => f.fixtureId).sort().join(","), "f2,f3,f4")
}

// 22. Section 37's exact weekend scenario: a representative mix of
// mini/junior and adult fixtures, generous pitch capacity. Every U6-U16
// fixture lands in the morning-preferred band; every senior/adult fixture
// lands in the afternoon-preferred band. No fixture is silently placed
// late.
{
  const miniJunior = [
    fixture({ fixtureId: "u8", ageGroup: "U8", requiredPitchSize: "mini" }),
    fixture({ fixtureId: "u10", ageGroup: "U10", requiredPitchSize: "mini" }),
    fixture({ fixtureId: "u12", ageGroup: "U12", requiredPitchSize: "reduced" }),
    fixture({ fixtureId: "u14", ageGroup: "U14", requiredPitchSize: "reduced" }),
    fixture({ fixtureId: "u16", ageGroup: "U16", requiredPitchSize: "full" }),
    fixture({ fixtureId: "girls_u14", ageGroup: "U14", requiredPitchSize: "reduced" }),
  ]
  const adult = [
    fixture({ fixtureId: "junior_colts", category: "colts", ageGroup: null, requiredPitchSize: "full" }),
    fixture({ fixtureId: "womens_1st", category: "senior", ageGroup: null, requiredPitchSize: "full" }),
    fixture({ fixtureId: "mens_1st", category: "senior", ageGroup: null, requiredPitchSize: "full" }),
  ]
  const pitches = [
    pitch({ id: "mini1", sizeCategory: "mini" }),
    pitch({ id: "mini2", sizeCategory: "mini" }),
    pitch({ id: "reduced1", sizeCategory: "reduced" }),
    pitch({ id: "reduced2", sizeCategory: "reduced" }),
    pitch({ id: "full1", sizeCategory: "full" }),
    pitch({ id: "full2", sizeCategory: "full" }),
    pitch({ id: "full3", sizeCategory: "full" }),
  ]
  const { placements, conflicts } = autoAllocate([...miniJunior, ...adult], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY)
  const byId = new Map(placements.map((p) => [p.fixtureId, p]))

  const allMiniJuniorMorning = miniJunior.every((f) => {
    const p = byId.get(f.fixtureId)
    return p?.kickoffTime !== null && p!.kickoffTime! >= "09:00" && p!.kickoffTime! <= "12:00"
  })
  checkTrue("22a. Every U6-U16 fixture lands in the morning-preferred band with generous capacity", allMiniJuniorMorning)

  const allAdultAfternoon = adult.every((f) => {
    const p = byId.get(f.fixtureId)
    return p?.kickoffTime !== null && p!.kickoffTime! >= "13:00" && p!.kickoffTime! <= "17:30"
  })
  checkTrue("22b. Every Colts/Senior/Women's fixture lands in the afternoon-preferred band", allAdultAfternoon)

  checkTrue("22c. No warning conflicts at all when generous capacity exists everywhere", conflicts.length === 0)
}

// 23. Constrain morning capacity: only ONE mini pitch, and exactly enough
// room in the 09:00-12:00 morning band for THREE 45-minute fixtures back
// to back (45 play + 15 turnaround = 60 min each, tiling the 180-minute
// band exactly) -- a 4th must overflow into the early-afternoon fallback
// band (12:00-13:00), never straight to the late last-resort band while
// that nearer fallback is still free.
{
  const fixtures = [
    fixture({ fixtureId: "u8a", ageGroup: "U8", requiredPitchSize: "mini", durationMinutes: 45 }),
    fixture({ fixtureId: "u8b", ageGroup: "U8", requiredPitchSize: "mini", durationMinutes: 45 }),
    fixture({ fixtureId: "u8c", ageGroup: "U8", requiredPitchSize: "mini", durationMinutes: 45 }),
    fixture({ fixtureId: "u8d", ageGroup: "U8", requiredPitchSize: "mini", durationMinutes: 45 }),
  ]
  const pitches = [pitch({ id: "mini1", sizeCategory: "mini" })]
  const { placements, conflicts } = autoAllocate(fixtures, pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY)
  const times = placements.map((p) => p.kickoffTime).sort()
  checkTrue("23a. Three fixtures fill the morning band exactly (09:00, 10:00, 11:00)", times.slice(0, 3).join(",") === "09:00,10:00,11:00")
  checkTrue("23b. The 4th overflows to the early-afternoon fallback band (12:00), not the late last-resort band", times[3] === "12:00")
  checkTrue("23c. Early-afternoon fallback (band 1) is NOT flagged as a warning -- only the late last-resort band (2) is", conflicts.length === 0)
}

// 24. Constrain morning AND early-afternoon capacity fully -- only then
// does a mini/junior fixture overflow into the late last-resort band, and
// only then does it carry an explicit warning conflict.
{
  const fixtures = [fixture({ fixtureId: "u8", ageGroup: "U8", requiredPitchSize: "mini", durationMinutes: 40 })]
  const pitches = [pitch({ id: "mini1", sizeCategory: "mini" })]
  const existingBookings = [{ pitchId: "mini1", start: 9 * 60, end: 13 * 60 }]
  const { placements, conflicts } = autoAllocate(fixtures, pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  checkTrue("24a. Once morning + early-afternoon are both exhausted, the fixture is placed in the late band rather than left unallocated", placements[0].pitchId === "mini1" && placements[0].kickoffTime! >= "13:00")
  checkTrue("24b. That late-band placement is explicitly flagged as a warning conflict -- never a silent late kickoff", conflicts.some((c) => c.fixtureId === "u8" && c.severity === "warning"))
}

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
