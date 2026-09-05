import { canActOnTeam } from "./team-authorization"
import type { OvieActorContext } from "./types"

/**
 * Real, runnable proof of Section 15's permission-boundary scenarios
 * (A, B, D, E of the required A-H list -- C is a not-Ovie-specific
 * capability distinction, documented instead of tested here; F/G/H need a
 * real database/model and are covered by supabase/tests/ovie_security.sql
 * and the intent.ts architecture note respectively) -- run with
 * `npx tsx lib/ovie/team-authorization.verify.ts`. Closes the exact gap
 * distance.verify.ts's own comment disclosed as untestable in Phase 1:
 * this file, unlike actor-context.ts, imports nothing that pulls in
 * `server-only`, so it runs as a plain script, no request scope needed.
 */

let pass = 0
let fail = 0
function check(name: string, actual: unknown, expected: unknown) {
  const ok = actual === expected
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${ok ? "" : ` -- expected ${expected}, got ${actual}`}`)
  if (ok) pass++
  else fail++
}

const BURNLEY = "11111111-0000-0000-0000-000000000001"
const ROSSENDALE = "22222222-0000-0000-0000-000000000001"
const BURNLEY_U12 = "aaaaaaaa-0000-0000-0000-000000000001"
const BURNLEY_1ST = "aaaaaaaa-0000-0000-0000-000000000002"

// A. Burnley Club Admin: club-wide fixture authority -- can act on ANY
// team at their own club, never another club's.
const clubAdmin: OvieActorContext = {
  userId: "user-club-admin",
  clubs: [{ clubId: BURNLEY, clubName: "Burnley RUFC", canManageClubFixtures: true }],
  teamScopes: [],
  isSiteAdmin: false,
  viewOnly: false,
}
check("A. Club Admin can act on their own club's U12", canActOnTeam(clubAdmin, BURNLEY_U12, BURNLEY), true)
check("A. Club Admin can act on their own club's 1st XV too (club-wide)", canActOnTeam(clubAdmin, BURNLEY_1ST, BURNLEY), true)
check("A. Club Admin CANNOT act on a different club", canActOnTeam(clubAdmin, "some-rossendale-team", ROSSENDALE), false)

// B. Burnley U12 Coach: team-scoped ONLY, no club-wide role -- can act on
// exactly their own team, never a sibling team at the same club.
const u12Coach: OvieActorContext = {
  userId: "user-u12-coach",
  clubs: [{ clubId: BURNLEY, clubName: "Burnley RUFC", canManageClubFixtures: false }],
  teamScopes: [{ teamId: BURNLEY_U12, clubId: BURNLEY, canManageTeam: true }],
  isSiteAdmin: false,
  viewOnly: false,
}
check("B. U12 Coach can act on their own U12", canActOnTeam(u12Coach, BURNLEY_U12, BURNLEY), true)
check("B. U12 Coach CANNOT act on an unrelated Burnley team (1st XV)", canActOnTeam(u12Coach, BURNLEY_1ST, BURNLEY), false)

// D. Parent/Player: genuinely view-only, zero manageable clubs or teams --
// can never act on any team, regardless of which team is asked about.
const parent: OvieActorContext = {
  userId: "user-parent",
  clubs: [{ clubId: BURNLEY, clubName: "Burnley RUFC", canManageClubFixtures: false }],
  teamScopes: [{ teamId: BURNLEY_U12, clubId: BURNLEY, canManageTeam: false }],
  isSiteAdmin: false,
  viewOnly: true,
}
check("D. Parent/Player CANNOT act on their own child's team", canActOnTeam(parent, BURNLEY_U12, BURNLEY), false)
check("D. Parent/Player CANNOT act on any other team either", canActOnTeam(parent, BURNLEY_1ST, BURNLEY), false)

// E. Narrow Site Admin: OvieActorContext.isSiteAdmin mirrors ctx.isSiteAdmin
// exactly (lib/ovie/actor-context.ts's buildOvieActorContext) -- the same
// boolean every other part of the app already grants full fixture-domain
// reach to (e.g. admin/fixtures/add-fixture-dialog.tsx lets any Site Admin
// create a fixture for any club directly, no narrow capability required).
// Ovie does not check, and must never check, any of the separate narrow
// ADMIN-TOOL capabilities (manage_global_lookups, manage_fixture_support,
// etc.) here -- those gate unrelated admin surfaces, not this. A narrow
// Site Admin therefore gets exactly the same Ovie reach as any other Site
// Admin gets everywhere else in the product -- never more, via Ovie or
// otherwise. This is a documentation check, not a live capability lookup:
// proving Ovie introduces no NEW site-admin-only RPC (it has none) is done
// by inspection (see the final report), not a runnable assertion here.
const anySiteAdmin: OvieActorContext = {
  userId: "user-site-admin",
  clubs: [],
  teamScopes: [],
  isSiteAdmin: true,
  viewOnly: false,
}
check("E. Any Site Admin can act on any team (matches product-wide is_site_admin() reach, not a new Ovie grant)", canActOnTeam(anySiteAdmin, BURNLEY_U12, BURNLEY), true)

console.log(`\n${pass} PASS, ${fail} FAIL`)
if (fail > 0) process.exit(1)
