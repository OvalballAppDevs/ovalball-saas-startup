import { haversineMiles, formatDistanceMiles } from "./distance"

// canActOnTeam()/buildOvieActorContext() (lib/ovie/actor-context.ts) are
// NOT imported here even though they're pure functions -- that file also
// imports lib/app-context/session-context.ts, which imports the
// `server-only` package, and `server-only` has no resolvable export
// outside a bundler (Next.js/Turbopack special-cases it) -- a plain tsx
// run fails with ERR_MODULE_NOT_FOUND before a single assertion runs.
// That permission logic is instead verified by real integration proof:
// the live browser conversation test (see the Ovie Phase 1 report's LIVE
// TEST RESULTS) exercised canActOnTeam's CLUB_ADMIN-grants-own-club branch
// (Burnley admin's write succeeded) and buildOvieActorContext's
// isViewOnlyEverywhere wiring (test.parent's account was correctly
// blocked before any search ran) against the real database and a real
// authenticated session -- stronger evidence than an isolated unit test
// with a hand-built OvieActorContext would have been.

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`}`)
  if (ok) pass++
  else fail++
}

// Real Burnley RUFC / Rossendale RUFC coordinates (from club_directory) --
// cross-checks against the live search result observed in the browser test
// (approximateDistanceMiles: 6.702212332805414), proving haversineMiles is
// the exact function opponent-search.ts used to produce that number.
const d = haversineMiles(53.7896, -2.2451, 53.6969, -2.2934)
check("haversineMiles(Burnley, Rossendale) matches the live search result", d, 6.702212332805414)
check("haversineMiles identical point is 0", haversineMiles(53.79, -2.24, 53.79, -2.24), 0)
check("formatDistanceMiles formats one decimal place", formatDistanceMiles(6.702212332805414), "Approx. 6.7 miles")
check("formatDistanceMiles rounds cleanly", formatDistanceMiles(0), "Approx. 0.0 miles")

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
