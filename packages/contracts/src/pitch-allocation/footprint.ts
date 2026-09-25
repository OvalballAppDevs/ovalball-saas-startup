/**
 * PHYSICAL PITCH FOOTPRINT -- how much of a physical pitch an activity actually needs (CA-M11.2
 * pitch-capacity correction, extended by the Grounds & Pitches capacity-configuration pass).
 *
 * THE BUG THIS ANSWERS. `detectConflicts`/`autoAllocate` used to treat "same pitch, overlapping
 * time" as a pure headcount question against a pitch's declared `laneCount` -- a U10 match and a
 * U12 match sharing a pitch were exactly as much a "conflict" as two full-size adult matches sharing
 * it, because neither the fixture's own required SIZE nor the pitch's own declared SIZE entered the
 * calculation at all. A club that legitimately marks out a full-size pitch as two mini-rugby halves
 * had no way to tell Ovalball that.
 *
 * TWO DISTINCT PITCH CONCEPTS, KEPT DISTINCT (`club_pitches.physical_size_category` /
 * `.layout`, set through `set_club_pitch_configuration`, both clients' Grounds & Pitches editor):
 *   A. PHYSICAL SIZE (`PhysicalSizeCategory`) -- what the pitch IS: full / three-quarter / half /
 *      custom-dimensioned. A half-size pitch is its own physical resource, never "half of another
 *      pitch".
 *   B. LAYOUT (`PitchLayout`) -- how the club has chosen to USE it concurrently: whole pitch only,
 *      or split into two halves / four quarters. Independent of physical size: a half-size pitch used
 *      whole, and a full-size pitch split into two halves, are different configurations that happen
 *      to give the SAME per-area footprint (see `pitchCapacityUnits`) -- collapsing them into one
 *      field was the exact mistake the owner's brief warned against.
 *
 * WHAT THIS DOES NOT DO. Even with physical size and layout both configured, this cannot tell "Half
 * A" from "Half B" as a real, persisted, nameable zone a reservation is assigned to -- there is no
 * per-reservation zone_id (that would be a further schema step, deliberately not taken here: the
 * owner's brief authorised the SIZE/LAYOUT configuration, not a full named-zone assignment model).
 * What it CAN do honestly is a UNIT-BUDGET check: does the TOTAL footprint every concurrent
 * reservation on a pitch requires exceed what the pitch's configured physical size and layout
 * together allow. That is never a false negative in the case that matters most (a FULL-footprint
 * fixture always exceeds any remaining budget the instant anything else overlaps it, and a
 * `full_only` layout always rejects a second concurrent booking outright, regardless of size).
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

/** What a physical pitch IS -- Grounds & Pitches' own "Pitch Size" field. `club_pitches.physical_size_category`. */
export type PhysicalSizeCategory = "full" | "three_quarter" | "half" | "custom"

/** How the club has chosen to USE that physical pitch concurrently -- Grounds & Pitches' own "How can
 * this pitch be used?" field. `club_pitches.layout`. Deliberately three options, not arbitrary
 * halves/thirds/quarters combinations -- see this file's header comment and the migration's own. */
export type PitchLayout = "full_only" | "two_halves" | "four_quarters"

export function physicalSizeCategoryLabel(category: PhysicalSizeCategory): string {
  if (category === "full") return "Full size"
  if (category === "three_quarter") return "3/4 size"
  if (category === "half") return "Half size"
  return "Custom size"
}

export function layoutLabel(layout: PitchLayout): string {
  if (layout === "two_halves") return "Two halves"
  if (layout === "four_quarters") return "Four quarters"
  return "Whole pitch only"
}

/** How many discrete concurrent areas a layout gives -- Grounds & Pitches' own "Maximum simultaneous
 * areas". The SAME number `club_pitches.lane_count` is generated from, at the database level. */
export function layoutAreaCount(layout: PitchLayout): number {
  if (layout === "two_halves") return 2
  if (layout === "four_quarters") return 4
  return 1
}

const CUSTOM_REFERENCE_AREA_SQM = 100 * 70 // the same full-size reference (RFU Reg 15 Appendix 9 / World Rugby Law 1) footprint.ts already uses for "full"

/**
 * A physical pitch's own total budget, in quarter-pitch units -- full=4, three_quarter=3, half=2, and
 * for a custom-dimensioned pitch, the SAME units scaled proportionally by area against the standard
 * full-size reference (100m x 70m), rounded to the nearest whole unit and clamped to the 1-4 range
 * every other tier uses. This is plain proportional arithmetic on the club's own entered numbers --
 * never an invented governing-body precision (Section 24's own instruction): a custom pitch is never
 * compared against a specific age-grade's exact required dimensions, only measured as a fraction of a
 * standard full-size pitch's area.
 *
 * PHYSICAL SIZE alone -- NOT combined with layout. This is "how much room the whole physical pitch
 * has", used both for whole-pitch suitability (`pitchSuitable`, below) and as the total budget a set
 * of concurrent reservations must fit inside (`footprintBudgetExceeded`) regardless of how many areas
 * the club has chosen to split it into.
 */
export function pitchPhysicalSizeUnits(pitch: Pick<PitchOption, "physicalSizeCategory" | "customLengthM" | "customWidthM">): number {
  if (pitch.physicalSizeCategory === "full") return FOOTPRINT_UNITS.full
  if (pitch.physicalSizeCategory === "three_quarter") return 3
  if (pitch.physicalSizeCategory === "half") return FOOTPRINT_UNITS.half
  if (pitch.customLengthM && pitch.customWidthM) {
    const ratio = (pitch.customLengthM * pitch.customWidthM) / CUSTOM_REFERENCE_AREA_SQM
    return Math.min(4, Math.max(1, Math.round(ratio * 4)))
  }
  // custom selected with no dimensions recorded cannot actually be saved (club_pitches_custom_
  // dimensions_check rejects it), so this is unreachable in practice -- permissive, never a
  // fabricated block, matching pitchSuitable's own "unclassified either side" precedent below.
  return FOOTPRINT_UNITS.full
}

/** A pitch's own total physical budget, in quarter-pitch units. `pitchPhysicalSizeUnits` under a
 * clearer name at this call boundary -- the total budget a set of concurrent reservations must fit
 * inside is exactly the pitch's own physical size, independent of how many areas its layout splits
 * that size into. */
export function pitchCapacityUnits(pitch: Pick<PitchOption, "physicalSizeCategory" | "customLengthM" | "customWidthM">): number {
  return pitchPhysicalSizeUnits(pitch)
}

/** Section 11's compact pitch-list summary: "Full size / Splits into 2 halves / Active" -- one line,
 * no opened record required. */
export function pitchConfigurationSummary(pitch: Pick<PitchOption, "physicalSizeCategory" | "layout">): string {
  const sizeLabel = physicalSizeCategoryLabel(pitch.physicalSizeCategory)
  const usageLabel = pitch.layout === "full_only" ? "Whole pitch only" : `Splits into ${layoutAreaCount(pitch.layout)} areas (${layoutLabel(pitch.layout).toLowerCase()})`
  return `${sizeLabel} · ${usageLabel}`
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
