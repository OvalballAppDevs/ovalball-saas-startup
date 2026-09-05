/**
 * Age-grade fixture eligibility -- the single TS-side source of truth,
 * mirroring internal.teams_can_play_fixture() (20260831320000) exactly.
 * This copy exists purely for proactive UI filtering/suggestion (the
 * opponent resolver, CSV import review) so a user is never even offered
 * an invalid pairing to click on -- it is NOT the enforcement boundary.
 * The database trigger on public.fixtures is: it fires on every insert/
 * update regardless of which code path reaches it, so even a bug in this
 * file, or a direct REST/RPC call that never goes through this code at
 * all, still gets blocked at save time. Keep the two in sync by hand;
 * there is no way to share one implementation across Postgres and
 * TypeScript here without adding a runtime dependency neither side needs.
 */

export interface TeamEligibilityFields {
  rugbyCode: string
  category: string
  ageGroup: string | null
  teamNumber: number | null
  gender: string | null
}

/** U6/U7/U8 form one compatible tag-rugby band; every other age_group (including U9-U16) is its own strict band. */
export function ageFixtureBand(ageGroup: string | null): string | null {
  if (!ageGroup) return null
  return ["U6", "U7", "U8"].includes(ageGroup) ? "tag_u6_u8" : ageGroup
}

/** youth gender pathways collapse to a boolean: 'girls' is the one distinguishing value, everything else (null/'boys'/'mixed', and the historical 'mens'/'womens' values that predate the youth/senior split) is the same ordinary pathway -- mirrors internal.teams_can_play_fixture's own girls-only special case exactly, so a component never needs its own ad hoc string-equality gender check. */
function isGirlsPathway(gender: string | null): boolean {
  return gender === "girls"
}

/**
 * UI-level opposition-identity filter, shared by every "pick an age/gender
 * identity" surface (opponent-resolver.tsx's missing-team picker,
 * tournament-opposition-entry.tsx's override control, and anywhere else a
 * team/age override exists) -- never a per-surface copy that can drift.
 *
 * `mode: "strict"` (default) is deliberately STRICTER than
 * teamsCanPlayFixture's own same-age-band check for youth: offering a
 * cross-gender pairing in a picker is wrong regardless of what the server's
 * own final trigger would separately validate -- a Boys/Mixed host must
 * never be offered a Girls identity (at ANY age) here, and vice versa. This
 * is the correct mode for an ORDINARY 1-v-1 fixture, which the server-side
 * age-eligibility trigger will reject outside the same age band anyway.
 *
 * `mode: "tournament"` keeps the same gender/pathway separation (never
 * Girls for a Boys/Mixed host or vice versa) but does NOT restrict to the
 * host's own age band -- a tournament is explicitly allowed to invite a
 * different age group within the same pathway (with the caller responsible
 * for surfacing a confirmation when the choice differs from the host's own
 * identity, per tournament-opposition-entry.tsx).
 */
export function eligibleOppositionCanonicalTypes<T extends { category: string; ageGroup: string | null; gender: string | null }>(
  host: { category: string; ageGroup: string | null; gender: string | null },
  candidates: T[],
  mode: "strict" | "tournament" = "strict"
): T[] {
  return candidates.filter((c) => {
    if (c.category !== host.category) return false
    if (host.category !== "youth") return host.gender === null || c.gender === null || host.gender === c.gender
    if (isGirlsPathway(host.gender) !== isGirlsPathway(c.gender)) return false
    if (mode === "tournament") return true
    const hostBand = ageFixtureBand(host.ageGroup)
    const candidateBand = ageFixtureBand(c.ageGroup)
    return hostBand !== null && hostBand === candidateBand
  })
}

/**
 * The single canonical identity that exactly matches a given age+gender
 * pair, using the SAME pathway normalization eligibleOppositionCanonicalTypes
 * applies (never a raw `gender === gender` equality check, which breaks the
 * moment one side stores gender as null for the ordinary pathway and the
 * other stores it as the explicit 'boys' value -- exactly the bug that left
 * tournament-opposition-entry.tsx's auto-default stuck on "Resolving..."
 * forever for every ordinary-pathway team).
 */
export function findCanonicalTypeForIdentity<T extends { ageGroup: string | null; gender: string | null }>(
  ageGroup: string | null,
  gender: string | null,
  candidates: T[]
): T | undefined {
  return candidates.find((c) => c.ageGroup === ageGroup && isGirlsPathway(c.gender) === isGirlsPathway(gender))
}

export function teamsCanPlayFixture(a: TeamEligibilityFields, b: TeamEligibilityFields): boolean {
  if (a.rugbyCode !== b.rugbyCode || a.category !== b.category) return false
  if (a.category !== "youth") {
    // Senior: gender still has to match (Men's plays Men's, Women's plays
    // Women's -- an implicit rugby fact the brief didn't need to spell
    // out) but team_number never blocks a match (Men's 2nd vs Men's 3rd,
    // Women's 1st vs Women's 2nd are both fine). A team with no gender set
    // is treated as compatible with anything, same reasoning as an unset
    // age_group never blocking a youth match below.
    return a.gender === null || b.gender === null || a.gender === b.gender
  }
  if (a.gender === "girls" && b.gender === "girls") return true // girls youth: deliberately flexible on age
  const bandA = ageFixtureBand(a.ageGroup)
  const bandB = ageFixtureBand(b.ageGroup)
  return bandA !== null && bandA === bandB
}
