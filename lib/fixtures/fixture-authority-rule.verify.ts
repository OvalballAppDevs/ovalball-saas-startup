import { isActiveFixtureAuthority } from "./fixture-authority-rule"

/**
 * Run with `npx tsx lib/fixtures/fixture-authority-rule.verify.ts`.
 * Permanent regression coverage for the security fix found live during
 * Calendar Pitch Allocation's canonical-mutation-service audit: an
 * account that also holds Site Admin must NOT be able to edit an
 * unrelated fixture's kickoff/pitch/venue merely because is_site_admin()
 * (account-held, not active-context-aware) is what the underlying RPCs
 * check -- the application layer must independently require the account
 * be genuinely ACTIVE as Site Admin, or genuinely active as one of the
 * fixture's own two sides.
 */

let pass = 0
let fail = 0
function check(name: string, actual: boolean, expected: boolean) {
  const ok = actual === expected
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- got ${actual}, expected ${expected}`}`)
  if (ok) pass++
  else fail++
}

const fixture = { involvedClubIds: ["burnley-club-id"], involvedTeamIds: ["burnley-u12-team-id"] }

check(
  "1. Dual-role account (Site Admin + Burnley Club Admin), ACTIVE as Burnley, editing Burnley's own fixture -> allowed",
  isActiveFixtureAuthority({ isSiteAdmin: true }, { kind: "club", id: "burnley-club-id" }, fixture),
  true
)

check(
  "2. THE EXACT LIVE-REPRODUCED BUG: dual-role account, ACTIVE as Burnley, editing an UNRELATED club's fixture -> must be rejected",
  isActiveFixtureAuthority({ isSiteAdmin: true }, { kind: "club", id: "burnley-club-id" }, { involvedClubIds: ["some-other-club-id"], involvedTeamIds: ["some-other-team-id"] }),
  false
)

check(
  "3. Same dual-role account, ACTIVE as Site Admin, editing any fixture -> allowed (the legitimate Site Admin path)",
  isActiveFixtureAuthority({ isSiteAdmin: true }, { kind: "site_admin", id: null }, { involvedClubIds: ["some-other-club-id"], involvedTeamIds: ["some-other-team-id"] }),
  true
)

check(
  "4. Non-Site-Admin account, active as the fixture's own club -> allowed",
  isActiveFixtureAuthority({ isSiteAdmin: false }, { kind: "club", id: "burnley-club-id" }, fixture),
  true
)

check(
  "5. Non-Site-Admin account, active as an unrelated club -> rejected",
  isActiveFixtureAuthority({ isSiteAdmin: false }, { kind: "club", id: "unrelated-club-id" }, fixture),
  false
)

check(
  "6. Non-Site-Admin account, active as the fixture's own TEAM (e.g. Coach) -> allowed",
  isActiveFixtureAuthority({ isSiteAdmin: false }, { kind: "team", id: "burnley-u12-team-id" }, fixture),
  true
)

check(
  "7. Parent/Guardian active context never grants fixture-mutation authority, even for the fixture's own team's parent",
  isActiveFixtureAuthority({ isSiteAdmin: false }, { kind: "parent", id: "burnley-u12-team-id" }, fixture),
  false
)

check(
  "8. Player active context never grants fixture-mutation authority",
  isActiveFixtureAuthority({ isSiteAdmin: false }, { kind: "player", id: "burnley-u12-team-id" }, fixture),
  false
)

check(
  "9. A genuine Site Admin who is NOT active as Site Admin, and has no other relationship, is rejected -- 'holds the role' is never enough on its own",
  isActiveFixtureAuthority({ isSiteAdmin: true }, { kind: "club", id: "unrelated-club-id" }, fixture),
  false
)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
