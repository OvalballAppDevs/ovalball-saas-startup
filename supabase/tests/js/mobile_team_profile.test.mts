import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * OWNER BRIEF -- TEAM PROFILES + CLUB ADMIN HOME INTEGRATION. Permanent structural pins so the
 * safeguarding gate and the one-canonical-route convergence cannot regress silently.
 */
test("loadTeamProfile never counts squad/staff before checking authority.view -- an unknown viewer must never see a fabricated zero or a fabricated partial count", () => {
  const src = code("packages/contracts/src/team/profile.ts")
  // The RPC call must be textually inside the `if (authority.view)` branch, not run unconditionally.
  const gateIndex = src.indexOf("if (authority.view)")
  const rpcIndex = src.indexOf('rpc("team_people_counts"')
  assert.ok(gateIndex >= 0, "the authority.view gate is missing")
  assert.ok(rpcIndex > gateIndex, "the people-counts RPC runs before (or without) the authority.view gate")
  assert.match(src, /counts: TeamProfilePeople\["counts"\] = null/, "counts default to null (unknown), never to a computed zero, before authority is checked")
  // A client-side RLS-filtered `.count()` on `player_team_memberships` looks safe but is not: a viewer who
  // holds `team.team.view` without `team.roster.view` (a guardian whose own child plays on the team is a real
  // example) gets RLS-filtered rows for their own child alone, so `.count()` silently returns a fabricated
  // ONE instead of the team's real size -- confirmed against a live UAT persona/team pair. The counts must
  // come from the capability-gated `team_people_counts` RPC (SECURITY DEFINER, re-checks `team.team.view`
  // server-side, returns null on both fields where it is not held), never a direct table count.
  assert.doesNotMatch(src, /from\("player_team_memberships"\)|from\("team_permissions"\)/, "counts must come from the team_people_counts RPC, never a direct RLS-filtered table count")
})

test("TeamProfileScreen never claims an empty squad -- the hidden state says 'not available in this view', never 'no players'", () => {
  const src = code("apps/mobile/src/team/profile-screen.tsx")
  assert.match(src, /Squad details aren(&apos;|')t available in this view/, "the safe hidden-count state is missing its honest copy")
  assert.doesNotMatch(src, /No players/i, "a hidden count must never render as a fabricated empty squad")
})

test("the club Teams list, the Clubhouse cross-club Teams tab and Club Admin Home's Your Teams rail all route to the one canonical /teams/[teamId], never a role-named copy", () => {
  const clubTeamsIndex = code("apps/mobile/app/(tabs)/club/teams/index.tsx")
  const clubhouseProfile = code("apps/mobile/app/(tabs)/clubhouse/club/[directoryId].tsx")
  const clubHome = code("apps/mobile/src/club/home.tsx")
  for (const src of [clubTeamsIndex, clubhouseProfile, clubHome]) {
    assert.match(src, /pathname: "\/teams\/\[teamId\]"/, "a team row does not route to the canonical Team Profile")
  }
  const oldRoute = code("apps/mobile/app/(tabs)/club/teams/[teamId].tsx")
  assert.match(oldRoute, /TeamProfileScreen/, "the legacy club-scoped route no longer converges on the shared screen")
  assert.doesNotMatch(oldRoute, /loadClubOverview/, "the legacy route still carries its own duplicate read instead of converging")
})

test("Club Admin Home has no 'From Here' section and no mobile Fixture Control Centre link -- both retired in favour of the four-tile grid and the Admin Console", () => {
  const src = code("apps/mobile/src/club/home.tsx")
  assert.doesNotMatch(src, /From Here/, "the retired 'From Here' section is still present")
  assert.doesNotMatch(src, /Fixture Control Centre/, "the mobile Fixture Control Centre link-out is still present -- it stays desk-only, reached from the Admin Console")
  for (const tile of ["Clubhouse", "Pitch Allocation", "Rugby Hub", "Admin Console"]) {
    assert.match(src, new RegExp(tile), `the ${tile} tile is missing from the four-tile grid`)
  }
})
