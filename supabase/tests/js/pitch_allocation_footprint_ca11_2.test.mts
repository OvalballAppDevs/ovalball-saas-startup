import { test } from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_SCHEDULING_POLICY, autoAllocate, detectConflicts, detectResourceConflicts, footprintBudgetExceeded, footprintLabel, footprintUnits, layoutAreaCount, layoutLabel, matchFootprintFor,
  physicalSizeCategoryLabel, pitchCapacityUnits, pitchConfigurationSummary, pitchPhysicalSizeUnits, pitchSuitable,
  type AllocationFixture, type PitchOption,
} from "../../../packages/contracts/src/pitch-allocation"

/**
 * PITCH CAPACITY / FOOTPRINT CORRECTION (CA-M11.2).
 *
 * The bug this fixes: "same pitch, overlapping time" used to mean CONFLICT regardless of how much of
 * the pitch either activity actually needed -- a U10 match and a U12 match sharing one pitch were
 * treated exactly like two full-size adult matches sharing it, purely on headcount against the pitch's
 * declared laneCount. These pins are the corrected domain model: how much physical footprint a match
 * requires (from the SAME canonical fixture_scheduling_rules data Pitch Allocation already resolves
 * duration and minimum pitch size from -- never a second, invented source), and the unit-budget
 * arithmetic that replaces a pure headcount check in detectConflicts/autoAllocate/detectResourceConflicts.
 *
 * WHAT THIS DOES NOT CLAIM. Without a persisted pitch-subdivision-capability and per-reservation zone
 * schema (proposed, not applied -- docs/mobile/CA_M11_2_PITCH_CAPACITY_MIGRATION_PROPOSAL.md), this
 * cannot distinguish "Half A" from "Half B", so it cannot catch two reservations both wanting the exact
 * same declared half. It CAN and does catch every case where the TOTAL requested footprint exceeds
 * what the pitch is declared to hold -- which is never a false negative for the case that matters most,
 * a full-pitch fixture blocking everything else.
 */

const pitch = (id: string, overrides: Partial<PitchOption> = {}): PitchOption => ({
  id, displayName: id, active: true, venueId: "v1",
  physicalSizeCategory: "full", customLengthM: null, customWidthM: null, layout: "full_only", laneCount: 1,
  ...overrides,
})
function fixture(overrides: Partial<AllocationFixture> & Pick<AllocationFixture, "fixtureId">): AllocationFixture {
  return {
    homeTeamId: "team-1", homeTeamLabel: "Under 12 Boys", opponentLabel: "Opponent", category: "youth", ageGroup: "U12", gender: null, status: "Booked",
    kickoffDate: "2026-10-11", kickoffTime: null, venueId: "v1", pitchId: null, durationMinutes: 40, durationConfidence: "confirmed", requiredPitchSize: "reduced",
    requiresOpponentAgreement: false, isSharedGroup: false, schedulingGroupId: null, awaySchedulingGroupId: null, effectiveHomeTeamIds: ["team-1"], effectiveAwayTeamIds: [],
    ...overrides,
  }
}
const SUNDAY = "2026-10-11" // a Sunday, so the weekend youth window (09:00-13:00) applies

// ------------------------------------------------------------------ the footprint resolver itself

test("a match's required footprint is derived from the SAME canonical requiredPitchSize, never a second source, with honest confidence per tier", () => {
  assert.deepEqual(matchFootprintFor("full"), { footprint: "full", confidence: "confirmed" }, "full pitch requirement -- RFU Reg 15 Appendices 7-9 / World Rugby Law 1")
  assert.deepEqual(matchFootprintFor("reduced"), { footprint: "half", confidence: "confirmed" }, "reduced pitch requirement -- the foundation migration's own seed comment: RFU Appendix 6, 'half a full-size pitch'")
  assert.deepEqual(matchFootprintFor("mini"), { footprint: "quarter", confidence: "unresolved" }, "mini pitch requirement -- a reasoned inference from RFU's stated dimensions, not an explicit governing-body 'quarter' statement, so flagged unresolved")
  assert.deepEqual(matchFootprintFor(null), { footprint: null, confidence: null }, "no rule resolved (e.g. Rugby League, unseeded) -- never invented")
})

test("footprint hierarchy: FULL contains HALF contains QUARTER, expressed as quarter-pitch units", () => {
  assert.equal(footprintUnits("full"), 4)
  assert.equal(footprintUnits("half"), 2)
  assert.equal(footprintUnits("quarter"), 1)
  assert.ok(footprintUnits("full") > footprintUnits("half") && footprintUnits("half") > footprintUnits("quarter"))
})

test("a pitch's own capacity budget comes from its configured physical_size_category -- every pitch has one (default full), never a null/guessed number", () => {
  assert.equal(pitchCapacityUnits(pitch("p1", { physicalSizeCategory: "full" })), 4)
  assert.equal(pitchCapacityUnits(pitch("p1", { physicalSizeCategory: "three_quarter" })), 3)
  assert.equal(pitchCapacityUnits(pitch("p1", { physicalSizeCategory: "half" })), 2)
  // Custom: proportional AREA against the standard full-size reference (100m x 70m = 7000 sqm) --
  // deliberately plain proportional arithmetic on the club's own entered numbers, not a lookup against
  // a specific age-grade's official dimensions (footprint.ts's own documented limitation: this never
  // claims governing-body precision for a custom pitch). A real U8-dimensioned pitch (RFU Reg 15
  // Appendix 2, 45m x 22m = 990 sqm, ~14% of the reference area) computes to exactly 1 unit.
  assert.equal(pitchPhysicalSizeUnits({ physicalSizeCategory: "custom", customLengthM: 45, customWidthM: 22 }), 1)
  // A custom pitch dimensioned at exactly HALF the reference area (70m x 50m = 3500 sqm) computes to
  // exactly 2 units, matching the half tier.
  assert.equal(pitchPhysicalSizeUnits({ physicalSizeCategory: "custom", customLengthM: 70, customWidthM: 50 }), 2)
})

test("PHYSICAL SIZE and LAYOUT are independent (owner's own Section 8 pin) -- capacity units come from size alone, area count comes from layout alone", () => {
  assert.equal(layoutAreaCount("full_only"), 1)
  assert.equal(layoutAreaCount("two_halves"), 2)
  assert.equal(layoutAreaCount("four_quarters"), 4)
  // Full size + Full only = capacity 1 (budget 4, areas 1)
  assert.equal(pitchCapacityUnits(pitch("p1", { physicalSizeCategory: "full", layout: "full_only" })), 4)
  // Half size + Full only = capacity 1 (budget 2, areas 1) -- half size does NOT automatically mean capacity 2
  assert.equal(pitchCapacityUnits(pitch("p1", { physicalSizeCategory: "half", layout: "full_only" })), 2)
  assert.equal(layoutAreaCount(pitch("p1", { physicalSizeCategory: "half", layout: "full_only" }).layout), 1)
})

test("physicalSizeCategoryLabel/layoutLabel/pitchConfigurationSummary give the human-readable words Grounds & Pitches shows, never a raw enum value", () => {
  assert.equal(physicalSizeCategoryLabel("full"), "Full size")
  assert.equal(physicalSizeCategoryLabel("three_quarter"), "3/4 size")
  assert.equal(physicalSizeCategoryLabel("half"), "Half size")
  assert.equal(physicalSizeCategoryLabel("custom"), "Custom size")
  assert.equal(layoutLabel("full_only"), "Whole pitch only")
  assert.equal(layoutLabel("two_halves"), "Two halves")
  assert.equal(layoutLabel("four_quarters"), "Four quarters")
  assert.equal(pitchConfigurationSummary({ physicalSizeCategory: "full", layout: "full_only" }), "Full size · Whole pitch only")
  assert.equal(pitchConfigurationSummary({ physicalSizeCategory: "full", layout: "two_halves" }), "Full size · Splits into 2 areas (two halves)")
})

test("pitchSuitable: a smaller physical pitch rejects a match that needs more room than it has (Section 22's own example)", () => {
  const halfSizePitch = pitch("p1", { physicalSizeCategory: "half" })
  assert.equal(pitchSuitable(halfSizePitch, "full"), false, "a half-size physical pitch cannot host a match requiring the full pitch")
  assert.equal(pitchSuitable(halfSizePitch, "reduced"), true, "a half-size pitch exactly fits a match requiring half-pitch room")
  assert.equal(pitchSuitable(halfSizePitch, "mini"), true, "a half-size pitch comfortably exceeds a match requiring only quarter-pitch room")
  const fullSizePitch = pitch("p1", { physicalSizeCategory: "full" })
  assert.equal(pitchSuitable(fullSizePitch, "full"), true)
  assert.equal(pitchSuitable(fullSizePitch, "mini"), true, "a bigger pitch is always safe for a smaller-format game")
  assert.equal(pitchSuitable(pitch("p1", { active: false }), "mini"), false, "an inactive pitch is never suitable, whatever its size")
})

test("footprintLabel gives the human-readable words the board and detail sheet show, never an internal enum value", () => {
  assert.equal(footprintLabel("full"), "Full Pitch")
  assert.equal(footprintLabel("half"), "Half Pitch")
  assert.equal(footprintLabel("quarter"), "Quarter Pitch")
  assert.equal(footprintLabel(null), null)
})

test("footprintBudgetExceeded: two halves fit a full budget exactly, a third does not; an unknown footprint fails conservative, never treated as free room", () => {
  assert.equal(footprintBudgetExceeded(["half", "half"], 4), false, "2+2=4 units exactly fills a full pitch's 4-unit budget -- not exceeded")
  assert.equal(footprintBudgetExceeded(["half", "half", "quarter"], 4), true, "2+2+1=5 exceeds a 4-unit budget")
  assert.equal(footprintBudgetExceeded(["full", "quarter"], 4), true, "Section 38: FULL alone (4 units) already exhausts the budget -- anything else overlapping it exceeds")
  assert.equal(footprintBudgetExceeded([null], 4), false, "one unresolved-footprint reservation ALONE on a full pitch legitimately consumes the whole budget, same as a full match alone -- not itself exceeding")
  assert.equal(footprintBudgetExceeded(["quarter", null], 4), true, "Section 42: once ANYTHING else overlaps an unresolved-footprint reservation, the conservative whole-pitch treatment makes the combination exceed -- unknown is never treated as leaving free room for something else")
  assert.equal(footprintBudgetExceeded([], 4), false, "nothing active consumes nothing")
})

// ------------------------------------------------------------------ Union rules across the real age-grade spread (Section 34)

test("Union match footprint across mini/junior/older-youth/adult, from the real seeded fixture_scheduling_rules categories", () => {
  // These mirror the ACTUAL seeded rows in supabase/migrations/20260924700000_pitch_allocation_foundation.sql
  // (audited, not invented): U6-U8 -> mini, U9-U12 -> reduced, U13+/Colts/adult -> full.
  const cases: [AllocationFixture["requiredPitchSize"], "full" | "half" | "quarter"][] = [
    ["mini", "quarter"], // U6-U8
    ["reduced", "half"], // U9-U12
    ["full", "full"], // U13-U17, Colts, adult
  ]
  for (const [requiredPitchSize, expected] of cases) {
    assert.equal(matchFootprintFor(requiredPitchSize).footprint, expected, `Union ${requiredPitchSize} -> ${expected}`)
  }
})

test("League match footprint resolves to null/unresolved -- Ovalball has NO seeded League age-grade pitch-size data, and this pass does not invent any", () => {
  // fixture_scheduling_rules has zero rugby_code='league' rows (audited); board.ts's resolveRule()
  // therefore already returns requiredPitchSize: null for any League fixture -- matchFootprintFor
  // inherits that honesty for free rather than guessing a League-specific mapping.
  assert.deepEqual(matchFootprintFor(null), { footprint: null, confidence: null })
})

// ------------------------------------------------------------------ Case A/B/D/G/H from the owner's test matrix

test("CASE A -- two compatible younger matches share one classified pitch: NO CONFLICT", () => {
  const pitches = [pitch("p1", { layout: "two_halves", laneCount: 2 })]
  const fixtures = [
    fixture({ fixtureId: "u10", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U10", requiredPitchSize: "reduced" }),
    fixture({ fixtureId: "u12", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U12", requiredPitchSize: "reduced" }),
  ]
  const conflicts = detectConflicts(fixtures, pitches)
  assert.equal(conflicts.length, 0, "two reduced (half) matches sum to exactly the full pitch's 4-unit budget -- no conflict")
})

test("CASE B -- an older/full-pitch match blocks a younger match on the same pitch: CONFLICT", () => {
  const pitches = [pitch("p1", { layout: "two_halves", laneCount: 2 })]
  const fixtures = [
    fixture({ fixtureId: "u16", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U16", requiredPitchSize: "full" }),
    fixture({ fixtureId: "u10", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U10", requiredPitchSize: "reduced" }),
  ]
  const conflicts = detectConflicts(fixtures, pitches)
  assert.ok(conflicts.some((c) => c.fixtureId === "u10"), "the full-pitch match consumes the whole budget -- the younger match overlapping it is flagged")
  assert.match(conflicts.find((c) => c.fixtureId === "u10")!.reason, /physical space is already committed/)
})

test("CASE D -- the owner's own worked example: a full-pitch match already on the pitch (09:00-10:30) blocks training arriving mid-match (09:30-10:30) on the same pitch: CONFLICT", () => {
  const pitches = [pitch("p1", { layout: "two_halves", laneCount: 2 })]
  const fixtures = [fixture({ fixtureId: "u16", pitchId: "p1", kickoffTime: "09:00", durationMinutes: 90, requiredPitchSize: "full" })]
  const sessions = [{ trainingSessionId: "t1", teamLabel: "U10", venueId: "v1", pitchId: "p1", sessionDate: "2026-10-11", startTime: "09:30", durationMinutes: 60, status: "PLANNED" as const, source: "MANUAL" as const }]
  const { trainingConflicts } = detectResourceConflicts(fixtures, sessions, pitches)
  assert.ok(trainingConflicts.some((c) => c.trainingSessionId === "t1"), "training arriving while the full-pitch match already occupies the pitch is flagged -- unchanged, existing fixture-vs-training exclusivity, regardless of the fixture's own footprint")
})

test("CASE G -- Auto Allocate refuses to place a full-pitch match onto a pitch already partly occupied by a compatible smaller match", () => {
  const pitches = [pitch("p1", { layout: "two_halves", laneCount: 2 })]
  const existingBookings = [{ pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40, footprint: "half" as const }]
  const candidate = fixture({ fixtureId: "u16", requiredPitchSize: "full", durationMinutes: 40 })
  const { placements } = autoAllocate([candidate], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  assert.notEqual(placements[0].kickoffTime, "09:00", "the full-pitch candidate is never proposed into the same window as an existing half-pitch booking")
})

test("CASE H -- Auto Allocate uses available capacity rather than declaring the pitch unavailable, when the remaining budget is compatible", () => {
  const pitches = [pitch("p1", { layout: "two_halves", laneCount: 2 })]
  const existingBookings = [{ pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40, footprint: "half" as const }]
  const candidate = fixture({ fixtureId: "u10", requiredPitchSize: "reduced", durationMinutes: 40 })
  const { placements } = autoAllocate([candidate], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  assert.equal(placements[0].pitchId, "p1", "a compatible reduced-size candidate is placed on the SAME already-half-occupied pitch rather than reported unavailable")
  assert.equal(placements[0].kickoffTime, "09:00", "sharing the exact same window a half-pitch budget of 2+2=4 units allows")
})

// ------------------------------------------------------------------ backward compatibility: a never-configured pitch behaves exactly as before

test("a pitch nobody has ever configured defaults to full size, whole-pitch-only -- reproducing today's exactly-one-booking-at-a-time behaviour exactly, with zero product surface to set it before this pass", () => {
  const pitches = [pitch("p1")] // every field at its database default: physical_size_category='full', layout='full_only' -> lane_count=1
  const fixtures = [
    fixture({ fixtureId: "a", pitchId: "p1", kickoffTime: "09:00", requiredPitchSize: "reduced" }),
    fixture({ fixtureId: "b", pitchId: "p1", kickoffTime: "09:00", requiredPitchSize: "reduced" }),
  ]
  const conflicts = detectConflicts(fixtures, pitches)
  // Even two REDUCED (half-footprint) fixtures, which would comfortably fit a full pitch's 4-unit
  // budget, are still flagged: the default layout is full_only (lane_count=1), so a second concurrent
  // booking is rejected on capacity alone, before footprint arithmetic even matters -- exactly the
  // conservative default the owner required (Section 18: "conflict behaviour should remain
  // conservative until legitimate capacity is configured").
  assert.ok(conflicts.some((c) => c.fixtureId === "b"), "a never-configured pitch still allows only one booking at a time")
})

test("Section 42 -- an unresolved footprint (League, or an unseeded age group) fails conservative in Auto Allocate, never silently treated as fitting", () => {
  const pitches = [pitch("p1", { layout: "two_halves", laneCount: 2 })]
  const existingBookings = [{ pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40, footprint: "quarter" as const }]
  // requiredPitchSize null (e.g. a League fixture with no seeded rule) -> matchFootprintFor gives null -> treated as consuming the WHOLE pitch.
  const candidate = fixture({ fixtureId: "league-u12", requiredPitchSize: null, durationMinutes: 40 })
  const { placements } = autoAllocate([candidate], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  assert.notEqual(placements[0].kickoffTime, "09:00", "an unresolved-footprint candidate is never proposed alongside an existing booking, even a small one, because its own size is unknown")
})
