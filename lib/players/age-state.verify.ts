import { resolvePlayerAgeState } from "./age-state"

/**
 * Run with `npx tsx lib/players/age-state.verify.ts`. Covers the Master
 * Architecture Pass's scenarios G/H/I plus the general DOB/fallback matrix.
 */

let pass = 0
let fail = 0
function check(name: string, actual: string, expected: string) {
  const ok = actual === expected
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${actual}, expected ${expected}`}`)
  if (ok) pass++
  else fail++
}

const today = new Date("2026-09-03T00:00:00Z")

// G: Senior Colts player under 18 by DOB.
check(
  "G. Senior Colts player, DOB proves under 18",
  resolvePlayerAgeState("2010-01-01", [{ category: "colts", ageGroup: "SeniorColts" }], today),
  "minor"
)

// H: Senior Colts player 18+ by DOB.
check(
  "H. Senior Colts player, DOB proves 18+",
  resolvePlayerAgeState("2005-01-01", [{ category: "colts", ageGroup: "SeniorColts" }], today),
  "adult"
)

// I: U6-Junior Colts player with unknown DOB -> youth-protected fallback.
check(
  "I. U12 player, no DOB on file -> youth-protected fallback",
  resolvePlayerAgeState(null, [{ category: "youth", ageGroup: "U12" }], today),
  "unknown_youth_protected"
)
check(
  "I. Junior Colts player, no DOB on file -> youth-protected fallback",
  resolvePlayerAgeState(null, [{ category: "colts", ageGroup: "JuniorColts" }], today),
  "unknown_youth_protected"
)

// Senior Colts must NEVER infer minority from the team name -- unknown DOB there is "unknown", not protected-minor and not adult.
check(
  "Senior Colts, no DOB on file -> unknown (never inferred from team name)",
  resolvePlayerAgeState(null, [{ category: "colts", ageGroup: "SeniorColts" }], today),
  "unknown"
)

// Senior adult team, no DOB -> unknown, never assumed adult.
check(
  "Senior team, no DOB on file -> unknown (never assumed adult)",
  resolvePlayerAgeState(null, [{ category: "senior", ageGroup: null }], today),
  "unknown"
)

// A player with two active teams (Section 11/14) -- U13 AND Senior Colts (e.g. dual-registered) with no DOB: the youth fallback must win (safeguarding errs toward protection).
check(
  "Dual-registered U13 + Senior Colts, no DOB -> youth fallback wins",
  resolvePlayerAgeState(null, [{ category: "colts", ageGroup: "SeniorColts" }, { category: "youth", ageGroup: "U13" }], today),
  "unknown_youth_protected"
)

// DOB always wins over team category, in both directions.
check(
  "U8 player with a DOB proving adult (e.g. a listed volunteer helper edge case) -> DOB wins",
  resolvePlayerAgeState("2000-01-01", [{ category: "youth", ageGroup: "U8" }], today),
  "adult"
)
check(
  "Senior team with a DOB proving under 18 (e.g. a genuinely young senior-pathway player) -> DOB wins",
  resolvePlayerAgeState("2012-01-01", [{ category: "senior", ageGroup: null }], today),
  "minor"
)

// Effective-date awareness: turning 18 exactly on the effective date counts as adult, the day before does not.
check("Turns 18 exactly on the effective date -> adult", resolvePlayerAgeState("2008-09-03", [], today), "adult")
check("Turns 18 the day after the effective date -> still minor", resolvePlayerAgeState("2008-09-04", [], today), "minor")

// Malformed/garbage DOB must not silently pass as a valid date.
check("Malformed DOB string falls back to team-based resolution, not a crash", resolvePlayerAgeState("not-a-date", [{ category: "youth", ageGroup: "U9" }], today), "unknown_youth_protected")

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
