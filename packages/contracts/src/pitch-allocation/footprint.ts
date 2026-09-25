/**
 * PHYSICAL PITCH FOOTPRINT -- how much of a physical pitch an activity actually needs (CA-M11.2
 * pitch-capacity correction).
 *
 * THE BUG THIS ANSWERS. `detectConflicts`/`autoAllocate` used to treat "same pitch, overlapping
 * time" as a pure headcount question against a pitch's declared `laneCount` -- a U10 match and a
 * U12 match sharing a pitch were exactly as much a "conflict" as two full-size adult matches sharing
 * it, because neither the fixture's own required SIZE nor the pitch's own declared SIZE entered the
 * calculation at all. A club that legitimately marks out a full-size pitch as two mini-rugby halves
 * had no way to tell Ovalball that, and no way for the two halves to be recognised as compatible.
 *
 * WHAT THIS DOES NOT DO. It cannot yet tell "Half A" from "Half B" -- there is no persisted
 * zone/subdivision-capability schema (see docs/mobile/CA_M11_2_PITCH_CAPACITY_MIGRATION_PROPOSAL.md,
 * intentionally not applied this pass per the STOP rule on schema-changing work). What it CAN do
 * honestly, using data that already exists, is a UNIT-BUDGET check: does the TOTAL footprint every
 * concurrent reservation on a pitch requires exceed what that physical pitch is declared to hold.
 * That is a real, meaningful correction -- it is never a false negative in the case that matters most
 * (a FULL-pitch fixture always exceeds any remaining budget the instant anything else overlaps it) --
 * but it cannot detect a layout-incompatible combination (e.g. two reservations both wanting the exact
 * same declared half). That gap is real and is exactly why the migration proposal exists.
 */

import type { AllocationFixture, PitchOption } from "./types"

/** The three footprints this pass supports -- FULL contains HALF contains QUARTER (Section 38's
 * hierarchy), expressed here as their relative size in quarter-pitch units so a pitch's total budget
 * and a set of concurrent reservations' total demand can be compared with plain arithmetic. */
export type PitchFootprint = "full" | "half" | "quarter"

const FOOTPRINT_UNITS: Record<PitchFootprint, number> = { full: 4, half: 2, quarter: 1 }

export function footprintUnits(footprint: PitchFootprint): number {
  return FOOTPRINT_UNITS[footprint]
}

export function footprintLabel(footprint: PitchFootprint | null): string | null {
  if (footprint === "full") return "Full Pitch"
  if (footprint === "half") return "Half Pitch"
  if (footprint === "quarter") return "Quarter Pitch"
  return null
}

/**
 * A pitch's own total physical budget, in the same quarter-pitch units, from its EXISTING
 * `size_category` (mini/reduced/full -- the one canonical pitch-size fact Ovalball already has,
 * `club_pitches.size_category`). Null when the club has never classified the pitch: this pass never
 * guesses a budget for an unclassified pitch, so the caller must fall back to the pre-existing
 * raw-`laneCount` behaviour (unchanged) rather than invent a number here.
 */
export function pitchCapacityUnits(sizeCategory: PitchOption["sizeCategory"]): number | null {
  if (sizeCategory === "full") return FOOTPRINT_UNITS.full
  if (sizeCategory === "reduced") return FOOTPRINT_UNITS.half
  if (sizeCategory === "mini") return FOOTPRINT_UNITS.quarter
  return null
}

/**
 * A match's own required footprint, derived from the SAME canonical `fixture_scheduling_rules` row
 * that already resolves its required pitch SIZE CATEGORY (`AllocationFixture.requiredPitchSize`) --
 * never a second, independent source of truth for the same fact.
 *
 * CONFIDENCE IS NOT UNIFORM, AND IS CARRIED THROUGH RATHER THAN FLATTENED.
 *   full -> full footprint: CONFIRMED. `min_pitch_size_category='full'` rows are sourced directly
 *     from RFU Regulation 15 Appendices 7-9 / World Rugby Law 1 (90x60m and up).
 *   reduced -> half footprint: CONFIRMED. The foundation migration's own seed comment describes the
 *     U12 reduced pitch (RFU Appendix 6, 60x43m) as "half a full-size pitch" in so many words -- this
 *     is not this pass's own inference, it is what the migration that introduced the category already
 *     recorded as the reasoning.
 *   mini -> quarter footprint: UNRESOLVED. No governing-body source says "a quarter" outright. It is
 *     this pass's own reasoned inference from the RFU appendices' own stated maximum dimensions (U7
 *     20x12m, U8 45x22m against reduced's 60x43m and full's ~100x70m -- meaningfully smaller than a
 *     half in both directions). Treated as real for board presentation and for Auto Allocate's
 *     unit-budget arithmetic, but never presented as equally certain as the other two -- see
 *     `footprintConfidence` callers, which must surface "unresolved" distinctly (Section 43's own
 *     instruction: useful reasons, not a flattened certainty).
 *   null (League, or any age_group with no seeded rule) -> null footprint, null confidence. Ovalball
 *     has NO seeded League age-grade pitch-size data (audited: zero `rugby_code='league'` rows exist
 *     in `fixture_scheduling_rules`, and no League source material exists in
 *     docs/rugby-hub/sources/) -- this is not a gap this pass invents an answer for.
 */
export function matchFootprintFor(requiredPitchSize: AllocationFixture["requiredPitchSize"]): { footprint: PitchFootprint | null; confidence: "confirmed" | "unresolved" | null } {
  if (requiredPitchSize === "full") return { footprint: "full", confidence: "confirmed" }
  if (requiredPitchSize === "reduced") return { footprint: "half", confidence: "confirmed" }
  if (requiredPitchSize === "mini") return { footprint: "quarter", confidence: "unresolved" }
  return { footprint: null, confidence: null }
}

/**
 * Whether a set of CONCURRENT reservations' combined footprint exceeds a pitch's declared budget.
 *
 * UNKNOWN FAILS CONSERVATIVE (Section 42): a reservation with no resolvable footprint (`null` --
 * League, or an unseeded age group) is treated as consuming the WHOLE pitch, never as free/ignorable.
 * This is deliberate: an automatic process (Auto Allocate, a drag-drop conflict check) must never
 * reason "I don't know how big this is, so it probably fits" -- the one FULL-fixture-always-blocks
 * case this whole correction exists to fix depends on the same conservative direction.
 */
export function footprintBudgetExceeded(activeFootprints: (PitchFootprint | null)[], capacityUnits: number): boolean {
  const consumed = activeFootprints.reduce((sum, f) => sum + (f ? footprintUnits(f) : FOOTPRINT_UNITS.full), 0)
  return consumed > capacityUnits
}

/** Section 22/23/24: the activity-type label every reservation card must show. Canonical
 * classification, not inferred from the presence/absence of an opponent. */
export type ActivityType = "MATCH" | "TRAINING" | "CLUB EVENT"
