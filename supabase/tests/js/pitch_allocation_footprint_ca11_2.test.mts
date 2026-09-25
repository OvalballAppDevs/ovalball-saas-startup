import { test } from "node:test"
import assert from "node:assert/strict"

import {
  DEFAULT_SCHEDULING_POLICY, autoAllocate, detectConflicts, detectResourceConflicts, footprintBudgetExceeded, footprintLabel, footprintUnits, matchFootprintFor, pitchCapacityUnits,
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

const pitch = (id: string, overrides: Partial<PitchOption> = {}): PitchOption => ({ id, displayName: id, active: true, venueId: "v1", sizeCategory: "full", laneCount: 1, ...overrides })
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

test("a pitch's own capacity budget comes from its EXISTING size_category, unclassified pitches return null rather than a guessed number", () => {
  assert.equal(pitchCapacityUnits("full"), 4)
  assert.equal(pitchCapacityUnits("reduced"), 2)
  assert.equal(pitchCapacityUnits("mini"), 1)
  assert.equal(pitchCapacityUnits(null), null)
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
  const pitches = [pitch("p1", { sizeCategory: "full", laneCount: 2 })]
  const fixtures = [
    fixture({ fixtureId: "u10", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U10", requiredPitchSize: "reduced" }),
    fixture({ fixtureId: "u12", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U12", requiredPitchSize: "reduced" }),
  ]
  const conflicts = detectConflicts(fixtures, pitches)
  assert.equal(conflicts.length, 0, "two reduced (half) matches sum to exactly the full pitch's 4-unit budget -- no conflict")
})

test("CASE B -- an older/full-pitch match blocks a younger match on the same pitch: CONFLICT", () => {
  const pitches = [pitch("p1", { sizeCategory: "full", laneCount: 2 })]
  const fixtures = [
    fixture({ fixtureId: "u16", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U16", requiredPitchSize: "full" }),
    fixture({ fixtureId: "u10", pitchId: "p1", kickoffTime: "09:00", ageGroup: "U10", requiredPitchSize: "reduced" }),
  ]
  const conflicts = detectConflicts(fixtures, pitches)
  assert.ok(conflicts.some((c) => c.fixtureId === "u10"), "the full-pitch match consumes the whole budget -- the younger match overlapping it is flagged")
  assert.match(conflicts.find((c) => c.fixtureId === "u10")!.reason, /physical space is already committed/)
})

test("CASE D -- the owner's own worked example: a full-pitch match already on the pitch (09:00-10:30) blocks training arriving mid-match (09:30-10:30) on the same pitch: CONFLICT", () => {
  const pitches = [pitch("p1", { sizeCategory: "full", laneCount: 2 })]
  const fixtures = [fixture({ fixtureId: "u16", pitchId: "p1", kickoffTime: "09:00", durationMinutes: 90, requiredPitchSize: "full" })]
  const sessions = [{ trainingSessionId: "t1", teamLabel: "U10", venueId: "v1", pitchId: "p1", sessionDate: "2026-10-11", startTime: "09:30", durationMinutes: 60, status: "PLANNED" as const, source: "MANUAL" as const }]
  const { trainingConflicts } = detectResourceConflicts(fixtures, sessions, pitches)
  assert.ok(trainingConflicts.some((c) => c.trainingSessionId === "t1"), "training arriving while the full-pitch match already occupies the pitch is flagged -- unchanged, existing fixture-vs-training exclusivity, regardless of the fixture's own footprint")
})

test("CASE G -- Auto Allocate refuses to place a full-pitch match onto a pitch already partly occupied by a compatible smaller match", () => {
  const pitches = [pitch("p1", { sizeCategory: "full", laneCount: 2 })]
  const existingBookings = [{ pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40, footprint: "half" as const }]
  const candidate = fixture({ fixtureId: "u16", requiredPitchSize: "full", durationMinutes: 40 })
  const { placements } = autoAllocate([candidate], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  assert.notEqual(placements[0].kickoffTime, "09:00", "the full-pitch candidate is never proposed into the same window as an existing half-pitch booking")
})

test("CASE H -- Auto Allocate uses available capacity rather than declaring the pitch unavailable, when the remaining budget is compatible", () => {
  const pitches = [pitch("p1", { sizeCategory: "full", laneCount: 2 })]
  const existingBookings = [{ pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40, footprint: "half" as const }]
  const candidate = fixture({ fixtureId: "u10", requiredPitchSize: "reduced", durationMinutes: 40 })
  const { placements } = autoAllocate([candidate], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  assert.equal(placements[0].pitchId, "p1", "a compatible reduced-size candidate is placed on the SAME already-half-occupied pitch rather than reported unavailable")
  assert.equal(placements[0].kickoffTime, "09:00", "sharing the exact same window a half-pitch budget of 2+2=4 units allows")
})

// ------------------------------------------------------------------ backward compatibility: unclassified pitches are untouched

test("a pitch with NO size_category set falls back to the pre-existing laneCount-only behaviour exactly -- this pass never guesses a budget for an unclassified pitch", () => {
  const pitches = [pitch("p1", { sizeCategory: null, laneCount: 2 })]
  // Two FULL-size fixtures: under the new footprint-aware check this would conflict outright (4+4>4),
  // but with sizeCategory unset the footprint check is inert and only the raw laneCount(2) headcount
  // governs -- exactly today's behaviour, unclassified pitches get zero regression from this pass.
  const fixtures = [
    fixture({ fixtureId: "a", pitchId: "p1", kickoffTime: "09:00", requiredPitchSize: "full" }),
    fixture({ fixtureId: "b", pitchId: "p1", kickoffTime: "09:00", requiredPitchSize: "full" }),
  ]
  const conflicts = detectConflicts(fixtures, pitches)
  assert.equal(conflicts.length, 0, "unclassified pitch: laneCount=2 allows 2 concurrent fixtures regardless of size, unchanged from before this pass")
})

test("Section 42 -- an unresolved footprint (League, or an unseeded age group) fails conservative in Auto Allocate, never silently treated as fitting", () => {
  const pitches = [pitch("p1", { sizeCategory: "full", laneCount: 2 })]
  const existingBookings = [{ pitchId: "p1", start: 9 * 60, end: 9 * 60 + 40, footprint: "quarter" as const }]
  // requiredPitchSize null (e.g. a League fixture with no seeded rule) -> matchFootprintFor gives null -> treated as consuming the WHOLE pitch.
  const candidate = fixture({ fixtureId: "league-u12", requiredPitchSize: null, durationMinutes: 40 })
  const { placements } = autoAllocate([candidate], pitches, DEFAULT_SCHEDULING_POLICY, SUNDAY, existingBookings)
  assert.notEqual(placements[0].kickoffTime, "09:00", "an unresolved-footprint candidate is never proposed alongside an existing booking, even a small one, because its own size is unknown")
})
