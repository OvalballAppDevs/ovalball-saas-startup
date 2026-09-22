import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { GROUPS, TEAM_GROUPS } from "@/app/(app)/club/permissions/groups"

/**
 * DELEGATING FIXTURE AUTHORITY FOR ONE TEAM.
 *
 * The owner's requirement is that a Club Admin can let a team staff member run THEIR team's fixtures
 * without making them Club Admin, Fixture Secretary, or club-wide fixture staff. The capability engine
 * always supported that -- set_capability_override has accepted a team scope since Identity/Auth Slice
 * 3 -- but the club's permissions screen could only ask the club-scope question, so the only decision
 * a club could take was club-wide.
 *
 * These are the structural halves of the fix: the screen has a scope, it writes through the canonical
 * RPC, and the club-wide fixture powers are not in the team list. Whether the DATABASE agrees is
 * asserted where it can be executed -- supabase/tests/team_fixture_authority.sql, sections H and I.
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * Club-scope capabilities, from the capability catalogue. A team grant must not be able to name one:
 * they are how a club runs every team's fixtures at once, and §2 of the correction lists them by name
 * as the things a team grant must NOT confer.
 */
const CLUB_ONLY = [
  "fixture.planner.use",
  "fixture.import.run",
  "fixture.fixture.bulk_edit",
  "fixture.fixture.delete",
]

test("a team permission cannot confer a club-wide fixture power", () => {
  const teamKeys = TEAM_GROUPS.flatMap((g) => g.items.map((i) => i.key))
  for (const key of CLUB_ONLY) {
    assert.ok(!teamKeys.includes(key), `${key} is offered as a team decision`)
  }
})

test("and the team list is the team's recurring fixture work, named in the team's language", () => {
  const teamKeys = TEAM_GROUPS.flatMap((g) => g.items.map((i) => i.key))
  for (const key of [
    "fixture.fixture.view",
    "fixture.fixture.create",
    "fixture.fixture.edit",
    "fixture.fixture.cancel",
    "fixture.request.create",
  ]) {
    assert.ok(teamKeys.includes(key), `${key} cannot be decided for a team`)
  }
  // Every row says what it does in words a club officer uses, and names the team rather than the club.
  for (const item of TEAM_GROUPS.flatMap((g) => g.items)) {
    assert.ok(!/\./.test(item.label), `a capability key leaked into a label: ${item.label}`)
    assert.ok(item.description.length > 10, `${item.key} has no description a club officer could act on`)
  }
  assert.ok(
    TEAM_GROUPS.every((g) => g.items.every((i) => /this team/i.test(i.description))),
    "a team permission is described without saying it applies to this team"
  )
})

test("the club list keeps the club-wide powers, because club context is unchanged", () => {
  // The correction removed club-wide fixture administration from TEAM navigation. It did not remove it
  // from the club, and a club officer must still be able to delegate it.
  const clubKeys = GROUPS.flatMap((g) => g.items.map((i) => i.key))
  assert.ok(clubKeys.includes("fixture.import.run"))
  assert.ok(clubKeys.includes("fixture.fixture.bulk_edit"))
})

test("a team decision goes through the canonical override RPC, never a second authority", () => {
  const actions = code("app/(app)/club/permissions/actions.ts")
  assert.match(actions, /p_scope_type: "team"/, "the team action does not record a team-scope decision")
  assert.match(actions, /set_capability_override/, "the team action does not use the canonical RPC")
  // A parallel permission system is the failure mode the owner named: no boolean on a membership, no
  // team-specific grant table, no second RPC.
  assert.ok(
    !/team_permissions|allow_fixtures|team_capability/.test(actions),
    "the permissions screen writes team authority somewhere other than the capability engine"
  )
})

test("the screen reads team answers from the one resolver, not by assembling its own", () => {
  const page = code("app/(app)/club/permissions/page.tsx")
  assert.match(page, /club_team_capabilities/, "the team scope does not use the team-scope reader")
  // The reader is the club reader's twin, so the page must not decide effectiveness itself.
  assert.ok(
    !/capability_overrides|bundle_capabilities/.test(page),
    "the permissions page reads raw grant tables instead of the resolver"
  )
})

test("the scope is in the URL, so what is shown and what is written cannot disagree", () => {
  const page = code("app/(app)/club/permissions/page.tsx")
  assert.match(page, /searchParams/, "the team scope is not addressable")
  assert.match(page, /teamId=\{activeTeam\.id\}/, "the panel is not told which team it is writing for")
  const switcher = code("app/(app)/club/permissions/scope-switcher.tsx")
  assert.match(switcher, /\/club\/permissions\?team=/, "the switcher does not link a team scope")
  assert.ok(!/useState/.test(switcher), "the scope is component state, which the server cannot read")
})

test("one panel serves both scopes, so a team decision looks like the decision it is", () => {
  // Two panels would drift: the source of each answer, the lock reasons and Reset are the parts people
  // rely on to understand what they are changing, and a copy would lose one of them quietly.
  const panel = code("app/(app)/club/permissions/permissions-panel.tsx")
  assert.match(panel, /setTeamCapability/)
  assert.match(panel, /setClubCapability/)
  assert.ok(!/TeamPermissionsPanel/.test(panel), "a second panel was built for team scope")
})
