import type { RulesOfPlayRow, RulesRow, WelfareRow } from "./rugby-hub-data"

/** Renders a structured regulatory fact value in human-readable form without collapsing its actual semantics -- a RANGE stays a range, a DURATION keeps its unit. */
export function formatRulesValue(row: RulesRow): string {
  switch (row.value_type) {
    case "INTEGER":
      return row.value_integer != null ? `${row.value_integer}${row.value_unit ? ` ${row.value_unit}` : ""}` : "—"
    case "RANGE":
      return row.value_range_min != null && row.value_range_max != null ? `${row.value_range_min}–${row.value_range_max}${row.value_unit ? ` ${row.value_unit}` : ""}` : "—"
    case "DURATION":
      return row.value_duration_minutes != null ? `${row.value_duration_minutes} minutes${row.fact_type === "MATCH_DURATION" ? " per half" : ""}` : "—"
    case "DISTANCE":
      return row.value_distance_metres != null ? `${row.value_distance_metres} metres` : "—"
    case "DECIMAL":
      return row.value_decimal != null ? `${row.value_decimal}${row.value_unit ? ` ${row.value_unit}` : ""}` : "—"
    case "ENUM":
      return row.value_enum ?? "—"
    case "BOOLEAN":
      return row.value_boolean === true ? "Yes" : row.value_boolean === false ? "No" : "—"
    case "TEXT":
      return row.value_text ?? "—"
    default:
      return "—"
  }
}

export const RULES_SECTION_LABELS: Record<string, string> = {
  OVERVIEW: "Overview",
  KEY_RULES: "Key Rules",
  MATCH_FORMAT: "Match Format",
  PLAYER_COUNT: "Player Numbers",
  PITCH: "Pitch",
  BALL: "Ball Size",
  SCRUM: "Scrum",
  LINEOUT: "Lineout",
  KICKING: "Kicking",
  RESTART: "Restarts",
  SAFETY: "Contact / Tackle",
  SCORING: "Scoring",
  ADVANTAGE: "Advantage",
  OFFSIDE: "Offside",
  TACKLE_BREAKDOWN: "Tackle & Breakdown",
  FOUL_PLAY: "Foul Play",
  SANCTIONS: "Sanctions",
  TOUCH_AND_RESTART: "Touch & Restart",
  VIDEO_REVIEW: "Video Review",
  OTHER: "Other Variations",
}

export const SAFEGUARDING_SECTION_LABELS: Record<string, string> = {
  OVERVIEW: "Overview",
  SAFEGUARDING: "Safeguarding Overview",
  REPORTING: "Raising a Concern",
  SOURCES: "Official Resources",
  OTHER: "Other",
}

export const WELFARE_SECTION_LABELS: Record<string, string> = {
  EMERGENCY: "Emergency Signs",
  MEDICAL_ASSESSMENT: "Medical Assessment",
  SAFETY: "Remove From Play",
  RETURN_TO_PLAY: "Return to Play",
  CONCUSSION: "Concussion Guidance",
  OVERVIEW: "Overview",
  OTHER: "Other",
}

export function labelForObligation(level: string | null): { label: string; tone: "mandatory" | "recommended" | "informational" } | null {
  if (!level) return null
  switch (level) {
    case "MANDATORY":
    case "REQUIRED":
      return { label: "Official rule", tone: "mandatory" }
    case "RECOMMENDED":
    case "ADVISORY":
      return { label: "Guidance", tone: "recommended" }
    case "INFORMATIONAL":
      return { label: "Information", tone: "informational" }
    default:
      return null
  }
}

/**
 * PITCH_LENGTH/PITCH_WIDTH are two separate facts -- grouped by fact_type
 * here into one combined "Pitch" presentation rather than two disconnected
 * cards, mirroring the same grouping SP3's own Stage 6 UAT found necessary.
 */
export function groupPitchDimensions(rows: RulesRow[]): { length: RulesRow | null; width: RulesRow | null; rest: RulesRow[] } {
  const length = rows.find((r) => r.fact_type === "PITCH_LENGTH") ?? null
  const width = rows.find((r) => r.fact_type === "PITCH_WIDTH") ?? null
  const rest = rows.filter((r) => r.fact_type !== "PITCH_LENGTH" && r.fact_type !== "PITCH_WIDTH")
  return { length, width, rest }
}

export function formatWelfareValue(row: WelfareRow): string {
  if (row.value_text) return row.value_text
  if (row.value_integer != null) return `${row.value_integer}${row.value_unit ? ` ${row.value_unit}` : ""}`
  return "—"
}

// ---------------------------------------------------------------------
// THE AGE-GRADE RULES OF PLAY (RH-M0.2)
//
// A Rule of Play's section is the fact's own category (`fact_type`, with the
// pitch dimensions folded into PITCH). These are the governing body's
// categories, not Ovalball's -- the labels here only put a human name on
// them and fix the order a page walks them in. Both clients render from
// this one list, so a category added to the register appears on both.
// ---------------------------------------------------------------------

/** Display order and label for each Rules-of-Play category. Unknown categories sort last, labelled from their key. */
export const RULES_OF_PLAY_CATEGORIES: { key: string; label: string }[] = [
  { key: "PLAYER_COUNT", label: "Players" },
  { key: "PITCH", label: "Pitch" },
  { key: "BALL_SIZE", label: "Ball" },
  { key: "MATCH_DURATION", label: "Match Length" },
  { key: "MATCH_FORMAT", label: "Match Format" },
  { key: "CONTACT_RULE", label: "Contact" },
  { key: "TACKLE_CONTACT", label: "Tackle" },
  { key: "RESTART", label: "Restarts" },
  { key: "KICKING", label: "Kicking" },
  { key: "SCRUM_CONFIGURATION", label: "Scrum" },
  { key: "LINEOUT_CONFIGURATION", label: "Lineout" },
  { key: "SUBSTITUTION", label: "Substitutions" },
  { key: "PLAYING_ELIGIBILITY", label: "Eligibility" },
  { key: "PLAYING_UP_DOWN", label: "Playing Up or Down" },
  { key: "OTHER_AGE_VARIATION", label: "Other Variations" },
]

export const RULES_OF_PLAY_LABELS: Record<string, string> = Object.fromEntries(RULES_OF_PLAY_CATEGORIES.map((c) => [c.key, c.label]))

function humaniseKey(key: string): string {
  return key
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ")
}

export function rulesOfPlayCategoryLabel(sectionKey: string): string {
  return RULES_OF_PLAY_LABELS[sectionKey] ?? humaniseKey(sectionKey)
}

export interface RulesOfPlayGroup {
  key: string
  label: string
  rows: RulesOfPlayRow[]
}

/** Groups rows by category in the canonical display order. Rows arrive already ordered within a category by the server. */
export function groupRulesOfPlay(rows: RulesOfPlayRow[]): RulesOfPlayGroup[] {
  const order = new Map(RULES_OF_PLAY_CATEGORIES.map((c, i) => [c.key, i]))
  const groups = new Map<string, RulesOfPlayGroup>()
  for (const row of rows) {
    const key = row.section_key ?? "OTHER_AGE_VARIATION"
    let group = groups.get(key)
    if (!group) {
      group = { key, label: rulesOfPlayCategoryLabel(key), rows: [] }
      groups.set(key, group)
    }
    group.rows.push(row)
  }
  return Array.from(groups.values()).sort((a, b) => (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999) || a.key.localeCompare(b.key))
}

/**
 * How one Rule of Play reads on a card. A measured value (a count, a distance, a duration, a ball
 * size) is the headline and the governing body's explanation is the body; a rule stated in words
 * IS the body. The value's unit is never guessed: a duration is minutes, a distance is metres, and
 * "per half" is only said where the register says it (the notes do), never appended.
 */
export function presentRuleOfPlay(row: RulesOfPlayRow): { title: string; headline: string | null; body: string | null } {
  const title = row.display_title ?? rulesOfPlayCategoryLabel(row.section_key ?? "")
  switch (row.value_type) {
    case "INTEGER":
      return { title, headline: row.value_integer != null ? `${row.value_integer}${row.value_unit ? ` ${row.value_unit}` : ""}` : null, body: row.body }
    case "RANGE":
      return { title, headline: row.value_range_min != null && row.value_range_max != null ? `${row.value_range_min}–${row.value_range_max}${row.value_unit ? ` ${row.value_unit}` : ""}` : null, body: row.body }
    case "DURATION":
      return { title, headline: row.value_duration_minutes != null ? `${row.value_duration_minutes} minutes` : null, body: row.body }
    case "DISTANCE":
      return { title, headline: row.value_distance_metres != null ? `${row.value_distance_metres} metres` : null, body: row.body }
    case "DECIMAL":
      return { title, headline: row.value_decimal != null ? `${row.value_decimal}${row.value_unit ? ` ${row.value_unit}` : ""}` : null, body: row.body }
    case "ENUM":
      return { title, headline: row.value_enum ?? null, body: row.body }
    case "BOOLEAN":
      return { title, headline: row.value_boolean === true ? "Yes" : row.value_boolean === false ? "No" : null, body: row.body }
    case "TEXT":
    default:
      return { title, headline: null, body: [row.value_text, row.body].filter((t): t is string => !!t).join(" ") || null }
  }
}

/** Pitch length and width read as one line; the safety variation stays its own card. */
export function presentPitch(rows: RulesOfPlayRow[]): { headline: string | null; body: string | null; rest: RulesOfPlayRow[] } {
  const length = rows.find((r) => r.fact_type === "PITCH_LENGTH")
  const width = rows.find((r) => r.fact_type === "PITCH_WIDTH")
  const rest = rows.filter((r) => r.fact_type !== "PITCH_LENGTH" && r.fact_type !== "PITCH_WIDTH")
  if (!length && !width) return { headline: null, body: null, rest }
  const dim = (r: RulesOfPlayRow | undefined) => (r ? presentRuleOfPlay(r).headline : null)
  const headline = [length ? `Length: ${dim(length)}` : null, width ? `Width: ${dim(width)}` : null].filter(Boolean).join(" · ")
  const body = [length?.body, width?.body].filter((t): t is string => !!t).join(" ") || null
  return { headline, body, rest }
}
