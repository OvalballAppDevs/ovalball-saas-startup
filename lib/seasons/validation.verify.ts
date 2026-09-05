import { validateSeasonDates } from "./validation"

/**
 * Runs the exact valid/invalid examples from the consolidation brief's
 * Section J/K against validateSeasonDates() -- run with
 * `npx tsx lib/seasons/validation.verify.ts`.
 */

let pass = 0
let fail = 0
function check(name: string, actual: string | null, expectValid: boolean) {
  const ok = expectValid ? actual === null : actual !== null
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${JSON.stringify(actual)}`}`)
  if (ok) pass++
  else fail++
}

// Section J: the one fully valid example for 2026/2027 Rugby Union.
check(
  "J. Valid 2026/2027 Union season (1 Jun pre-season, 1 Sep start, 31 May end)",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: "2026-06-01", startsOn: "2026-09-01", endsOn: "2027-05-31" }),
  true
)

// Section K: every listed invalid example, for the same season.
check(
  "K. Reject pre-season start in 2027 for a 2026/2027 season",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: "2027-01-01", startsOn: "2026-09-01", endsOn: "2027-05-31" }),
  false
)
check(
  "K. Reject main season start in March 2027 for a 2026/2027 season",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: "2026-06-01", startsOn: "2027-03-01", endsOn: "2027-05-31" }),
  false
)
check(
  "K. Reject main season end on 1 Jan 2028 for a 2026/2027 season",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: "2026-06-01", startsOn: "2026-09-01", endsOn: "2028-01-01" }),
  false
)
check(
  "K. Reject main season start before pre-season start",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: "2026-09-15", startsOn: "2026-09-01", endsOn: "2027-05-31" }),
  false
)
check(
  "K. Reject main season end before main season start",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: "2026-06-01", startsOn: "2027-05-31", endsOn: "2026-09-01" }),
  false
)

// Section G/N/L: Rugby League's own, deliberately different single-year window.
check(
  "League: valid single-calendar-year season (pre-season prior Nov, main Mar-Oct 2026)",
  validateSeasonDates({ rugbyCode: "league", seasonYearStart: 2026, preSeasonStartsOn: "2025-11-01", startsOn: "2026-03-01", endsOn: "2026-10-31" }),
  true
)
check(
  "League: reject main season end spilling into the following year",
  validateSeasonDates({ rugbyCode: "league", seasonYearStart: 2026, preSeasonStartsOn: "2025-11-01", startsOn: "2026-03-01", endsOn: "2027-02-01" }),
  false
)
check(
  "League: reject pre-season more than one year back",
  validateSeasonDates({ rugbyCode: "league", seasonYearStart: 2026, preSeasonStartsOn: "2024-11-01", startsOn: "2026-03-01", endsOn: "2026-10-31" }),
  false
)

// Section L: the two codes' rules are genuinely different, not the same
// logic reused -- a Union main-season-start in the following year is
// rejected (must stay within seasonYearStart), even though a League
// season legitimately spans into its start year only.
check(
  "Union rejects a main season start that has drifted into the following year",
  validateSeasonDates({ rugbyCode: "union", seasonYearStart: 2026, preSeasonStartsOn: null, startsOn: "2027-01-15", endsOn: "2027-05-31" }),
  false
)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
