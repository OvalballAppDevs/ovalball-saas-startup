/**
 * The one canonical rule for whether a Player must be treated as a
 * protected minor -- every consumer calls this instead of comparing
 * DOB or team names independently (Master Architecture Pass §6/§34).
 *
 * Primary rule: a known, valid date of birth always wins -- 18 years or
 * older at the effective date is "adult", otherwise "minor".
 *
 * Safety fallback (§5, §33): when DOB is missing or invalid, a Player
 * currently registered to ANY active youth team (U6-U17) or Junior
 * Colts is treated as youth-protected regardless -- this is a
 * safeguarding default, so it errs toward protection whenever there is
 * genuine ambiguity across several team memberships (§11: a player can
 * have more than one active team). Senior Colts and senior adult teams
 * NEVER infer age from the team name -- only DOB decides those, and an
 * unknown DOB there resolves to "unknown", never "adult".
 *
 * Deliberately keyed off canonical_team_types.category/age_group (the
 * controlled pathway metadata already on every team), never a team's
 * free-text display_name (§34) -- pass the canonical category/age_group
 * pair for every team the player currently holds an active
 * player_team_memberships row for.
 */

export type PlayerAgeState = "minor" | "adult" | "unknown_youth_protected" | "unknown"

export interface PlayerTeamCategory {
  category: "senior" | "youth" | "colts"
  ageGroup: string | null
}

const YOUTH_SAFETY_FALLBACK_AGE_GROUPS = new Set(["U6", "U7", "U8", "U9", "U10", "U11", "U12", "U13", "U14", "U15", "U16", "U17"])

function isYouthProtectedByTeam(teams: PlayerTeamCategory[]): boolean {
  return teams.some((t) => {
    if (t.category === "youth") return t.ageGroup === null || YOUTH_SAFETY_FALLBACK_AGE_GROUPS.has(t.ageGroup)
    if (t.category === "colts") return t.ageGroup === "JuniorColts"
    return false
  })
}

function isValidIsoDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
}

/** Whole years between dateOfBirth and effectiveDate, computed calendar-correctly (never a naive year subtraction -- Section 35). */
function ageInYears(dateOfBirth: string, effectiveDate: Date): number {
  const dob = new Date(`${dateOfBirth}T00:00:00Z`)
  let age = effectiveDate.getUTCFullYear() - dob.getUTCFullYear()
  const hasHadBirthdayThisYear =
    effectiveDate.getUTCMonth() > dob.getUTCMonth() ||
    (effectiveDate.getUTCMonth() === dob.getUTCMonth() && effectiveDate.getUTCDate() >= dob.getUTCDate())
  if (!hasHadBirthdayThisYear) age -= 1
  return age
}

export function resolvePlayerAgeState(dateOfBirth: string | null, activeTeams: PlayerTeamCategory[], effectiveDate: Date = new Date()): PlayerAgeState {
  if (dateOfBirth && isValidIsoDate(dateOfBirth)) {
    return ageInYears(dateOfBirth, effectiveDate) >= 18 ? "adult" : "minor"
  }
  return isYouthProtectedByTeam(activeTeams) ? "unknown_youth_protected" : "unknown"
}
