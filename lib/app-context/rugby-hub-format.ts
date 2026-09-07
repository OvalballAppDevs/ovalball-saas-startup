import type { RulesRow, WelfareRow } from "./rugby-hub-data"

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
  PITCH: "Pitch",
  SCRUM: "Scrum",
  LINEOUT: "Lineout",
  SAFETY: "Contact / Tackle",
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
  SAFETY: "Remove From Play",
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
