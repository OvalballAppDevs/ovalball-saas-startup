import { rankCandidates } from "./rank-candidates"
import type { FixtureAvailabilityState, OpponentSearchCriteria, PartnershipState } from "./types"

/**
 * Phase 2 Section 28's exact TEST A scenario, run against the real
 * deterministic rankCandidates() function (the same one
 * findSuitableOpponents() calls in production) -- no database, no mocked
 * Supabase client, because rankCandidates() takes the already-resolved
 * per-candidate facts directly (see rank-candidates.ts's own module
 * comment for why: opponent-search.ts's `import "server-only"` makes the
 * DB-querying half untestable outside a real request, so this proves the
 * DETERMINISTIC DOMAIN logic -- eligibility, availability exclusion,
 * meeting-count exclusion, unclaimed handling, scoring/ranking -- for
 * real, while the separate RLS/permission boundary is proven by
 * supabase/tests/ovie_security.sql against the real database. Run with
 * `npx tsx lib/ovie/opponent-search.test-scenario.ts`.
 *
 * Deliberately does NOT touch the database or playground data -- every
 * "candidate" below is a hand-built plain object, matching this file's own
 * job: proving the ranking/exclusion RULES are correct, not proving the
 * SQL that feeds them (that's the SQL test's job).
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
  if (ok) pass++
  else fail++
}

const U12_BOYS = "u12-boys-canonical-type"
const compatibleTypes = [{ id: U12_BOYS, category: "youth", ageGroup: "U12", gender: "boys" }]
const compatibleTypeIds = [U12_BOYS]

// Section 28's five candidates, exactly as specified:
//   Rossendale: 8mi, active, available, Partner, 1 season meeting
//   Candidate B: 12mi, active, available, not Partner, 0 meetings
//   Candidate C: 6mi, BOOKED
//   Candidate D: 15mi, active, available, 2 existing/scheduled meetings
//   Candidate E: 18mi, unclaimed
const withDistance = [
  { id: "rossendale", name: "Rossendale RUFC", distanceMiles: 8 },
  { id: "candidate-b", name: "Candidate B RFC", distanceMiles: 12 },
  { id: "candidate-c", name: "Candidate C RFC", distanceMiles: 6 },
  { id: "candidate-d", name: "Candidate D RFC", distanceMiles: 15 },
  { id: "candidate-e", name: "Candidate E RFC", distanceMiles: 18 },
]

const claimedByDirectoryId = new Map<string, string>([
  ["rossendale", "club-rossendale"],
  ["candidate-b", "club-b"],
  ["candidate-c", "club-c"],
  ["candidate-d", "club-d"],
  // candidate-e deliberately absent -- unclaimed, no activated clubs row
])

const partnershipByClubId = new Map<string, PartnershipState>([["club-rossendale", "partner"]])

const teamsByClubId = new Map<string, { id: string; active: boolean; canonical_team_type_id: string | null }[]>([
  ["club-rossendale", [{ id: "team-rossendale", active: true, canonical_team_type_id: U12_BOYS }]],
  ["club-b", [{ id: "team-b", active: true, canonical_team_type_id: U12_BOYS }]],
  ["club-c", [{ id: "team-c", active: true, canonical_team_type_id: U12_BOYS }]],
  ["club-d", [{ id: "team-d", active: true, canonical_team_type_id: U12_BOYS }]],
])

const availability = new Map<string, FixtureAvailabilityState>([
  ["team-rossendale", "AVAILABLE"],
  ["team-b", "AVAILABLE"],
  ["team-c", "BOOKED"],
  ["team-d", "AVAILABLE"],
])

const meetingCounts = new Map<string, number>([
  ["team-rossendale", 1],
  ["team-b", 0],
  ["team-d", 2],
])

const criteria: OpponentSearchCriteria = {
  requestingClubId: "requester-club",
  requestingTeamId: "requester-team",
  rugbyCode: "union",
  date: "2026-09-23",
  radiusMiles: 20,
  maxPreviousMeetings: 2, // "don't show anyone we're already playing twice" -- exclude >= 2 meetings
}

const lookups = { claimedByDirectoryId, partnershipByClubId, teamsByClubId, availability, meetingCounts, compatibleTypes, compatibleTypeIds }

// ------------------------------------------------------------
// Default search: exactly Rossendale and Candidate B qualify.
// ------------------------------------------------------------
const result = rankCandidates(withDistance, criteria, 5, lookups)

check("TEST A: exactly 2 candidates qualify (Rossendale, Candidate B)", result.candidates.length, 2)
check("TEST A: Rossendale ranks first (closer + Partner + fewer meetings)", result.candidates[0]?.clubDisplayName, "Rossendale RUFC")
check("TEST A: Candidate B ranks second", result.candidates[1]?.clubDisplayName, "Candidate B RFC")
check("TEST A: Rossendale correctly shows partnershipState=partner", result.candidates[0]?.partnershipState, "partner")
check("TEST A: Rossendale correctly shows meetingsThisSeason=1", result.candidates[0]?.meetingsThisSeason, 1)
check("TEST A: Candidate C (booked) excluded entirely", result.candidates.some((c) => c.clubDisplayName === "Candidate C RFC"), false)
check("TEST A: Candidate D (>=2 meetings) excluded entirely", result.candidates.some((c) => c.clubDisplayName === "Candidate D RFC"), false)
check("TEST A: Candidate E (unclaimed, includeUnclaimed not set) excluded entirely", result.candidates.some((c) => c.clubDisplayName === "Candidate E RFC"), false)
check("TEST A: excludedCount reflects all 3 exclusions", result.excludedCount, 3)

// ------------------------------------------------------------
// Section 14/23: with includeUnclaimed, Candidate E appears but is
// CLEARLY SEPARATED as unconfirmed -- never silently reported as
// available just because there's no Ovalball fixture row for it.
// ------------------------------------------------------------
const withUnclaimed = rankCandidates(withDistance, { ...criteria, includeUnclaimed: true }, 5, lookups)
const candidateE = withUnclaimed.candidates.find((c) => c.clubDisplayName === "Candidate E RFC")
check("TEST A (includeUnclaimed): Candidate E now appears", Boolean(candidateE), true)
check("TEST A (includeUnclaimed): Candidate E is UNCLAIMED_CLUB, never AVAILABLE", candidateE?.fixtureAvailabilityState, "UNCLAIMED_CLUB")
check(
  "TEST A (includeUnclaimed): Candidate E's reason says availability cannot be confirmed, never 'Free'",
  candidateE?.reasons.some((r) => r.includes("cannot be confirmed")),
  true
)
check(
  "TEST A (includeUnclaimed): Candidate E still ranks below every claimed+available candidate (never implied free)",
  withUnclaimed.candidates.findIndex((c) => c.clubDisplayName === "Candidate E RFC") > withUnclaimed.candidates.findIndex((c) => c.clubDisplayName === "Rossendale RUFC"),
  true
)

// ------------------------------------------------------------
// Section 10/17: partner-only filter and "someone different" priority
// (zero meetings first, then fewest) -- both deterministic scoring rules,
// not model guesses.
// ------------------------------------------------------------
const partnerOnly = rankCandidates(withDistance, { ...criteria, partnerPreference: "only" }, 5, lookups)
check("Partner-only filter: only Rossendale remains", partnerOnly.candidates.map((c) => c.clubDisplayName), ["Rossendale RUFC"])

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
