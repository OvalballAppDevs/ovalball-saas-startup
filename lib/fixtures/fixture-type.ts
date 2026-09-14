/**
 * FIXTURE TYPE: WHAT PEOPLE CHOOSE, AND WHAT IS STORED.
 *
 * The database already classifies a fixture (fixtures.game_type:
 * Friendly, League Fixture, Cup Fixture, Scheduled Match). Nothing new is
 * stored and no competition called "Friendly" is invented. This is the one
 * place that says how those values are offered to a person:
 *
 *   Friendly    -> Friendly          (the default; no competition)
 *   League      -> League Fixture    (a competition applies)
 *   Cup         -> Cup Fixture       (a competition applies)
 *   Other       -> Scheduled Match
 *   Tournament  -> not a fixture type: it opens Tournament Centre, because a
 *                  tournament is its own model, never a fixture row.
 *
 * An unset game_type has always displayed as Friendly, and still does.
 */

export type StoredGameType = "Friendly" | "League Fixture" | "Cup Fixture" | "Scheduled Match"

export interface FixtureTypeOption {
  label: "Friendly" | "League" | "Cup" | "Other"
  value: StoredGameType
  competitionApplies: boolean
}

export const FIXTURE_TYPE_OPTIONS: FixtureTypeOption[] = [
  { label: "Friendly", value: "Friendly", competitionApplies: false },
  { label: "League", value: "League Fixture", competitionApplies: true },
  { label: "Cup", value: "Cup Fixture", competitionApplies: true },
  { label: "Other", value: "Scheduled Match", competitionApplies: false },
]

export function fixtureTypeLabel(stored: string | null | undefined): FixtureTypeOption["label"] {
  return FIXTURE_TYPE_OPTIONS.find((o) => o.value === stored)?.label ?? "Friendly"
}

/** Reads a person's word ("league", "Cup", "friendly") or a stored value back to the stored value. */
export function parseFixtureType(raw: string | null | undefined): StoredGameType | null {
  const v = (raw ?? "").trim().toLowerCase()
  if (!v) return null
  const byLabel = FIXTURE_TYPE_OPTIONS.find((o) => o.label.toLowerCase() === v || o.value.toLowerCase() === v)
  return byLabel?.value ?? null
}

export function competitionApplies(stored: string | null | undefined): boolean {
  return FIXTURE_TYPE_OPTIONS.find((o) => o.value === stored)?.competitionApplies ?? false
}
