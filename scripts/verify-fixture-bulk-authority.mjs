#!/usr/bin/env node
/**
 * TWO FIXTURE AUTHORITIES, ON PURPOSE.
 *
 * A. Single-fixture team authority -- a team's own staff create or request ONE
 *    fixture for a team they run (Calendar, Request a Fixture).
 * B. Club/site bulk planning authority -- the Season Planner, fixture import
 *    and competition-wide generation are club administration.
 *
 * The failure this exists to catch is well-meaning: somebody notices that a
 * Team Manager can create a fixture on Calendar but is turned away from the
 * Planner, calls it an inconsistency, and widens the Planner to team staff.
 * That happened once, and the product owner reversed it. The difference is the
 * rule.
 *
 * It also holds the lookup-speed architecture: the grid and its cells never
 * call a server action, so opening a cell can never become a request again.
 *
 * Structure, not behaviour. Behaviour is proved by
 * supabase/tests/fixture_bulk_planning_authority.sql and the browser suites.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"

const ROOT = process.cwd()
const failures = []

function read(path) {
  try {
    return readFileSync(join(ROOT, path), "utf8")
  } catch {
    failures.push(`${path} is missing`)
    return ""
  }
}

function must(path, test, why) {
  if (!test(read(path))) failures.push(`${path}: ${why}`)
}

const HELPER = "lib/fixtures/fixture-team-authority.ts"
const PLANNER = "app/(app)/fixtures/planner"

// ----- B is read from the database's bulk predicate, never from team authority.
must(HELPER, (s) => s.includes('rpc("can_bulk_plan_fixtures"'), "bulk planning must read public.can_bulk_plan_fixtures")
must(HELPER, (s) => s.includes('rpc("single_fixture_team_ids"'), "single-fixture authority must read public.single_fixture_team_ids")
must(HELPER, (s) => {
  const universe = s.slice(s.indexOf("export async function plannerTeamUniverse"), s.indexOf("export function plannerClubFor"))
  return universe.includes("canBulkPlanFixtures") && !universe.includes("singleFixtureTeamIds")
}, "the Planner's team list must be gated on bulk authority, never on single-fixture team authority")
must(HELPER, (s) => {
  const fn = s.slice(s.indexOf("export function plannerClubFor"), s.indexOf("export function plannerClubCandidates"))
  return !/kind === "team"/.test(fn)
}, "a team context must not be a route into the Planner")
must(HELPER, (s) => {
  const fn = s.slice(s.indexOf("export function plannerClubCandidates"))
  return !/manageableTeams\(/.test(fn)
}, "the Planner's club chooser must not offer clubs reached only through team permissions")

for (const file of ["page.tsx", "actions.ts", "lookup-actions.ts"]) {
  must(`${PLANNER}/${file}`, (s) => s.includes("resolvePlannerScope"), "must resolve its authority through resolvePlannerScope")
}
must(`${PLANNER}/planner-scope.ts`, (s) => s.includes("plannerTeamUniverse") && s.includes("actingBulkAuthority"), "the scope must be bulk authority, narrowed by the active context")
must(`${PLANNER}/page.tsx`, (s) => !/from\("teams"\)/.test(s), "the page must not read teams directly -- Our Team comes from the bulk-gated universe")

// ----- The database boundary itself.
const migrations = readdirSync(join(ROOT, "supabase/migrations")).filter((f) => f.endsWith(".sql")).sort()
const DEFINITION = "create or replace function public.publish_import_row"
const lastPublish = [...migrations].reverse().find((f) => read(`supabase/migrations/${f}`).includes(DEFINITION))
must(`supabase/migrations/${lastPublish}`, (s) => {
  const body = s.slice(s.lastIndexOf(DEFINITION))
  return body.includes("can_bulk_plan_fixtures") && !/can_manage_team|can_create_team_fixture/.test(body.slice(0, body.indexOf("insert into public.fixtures")))
}, "the latest publish_import_row must authorise with bulk planning authority and no team-scoped route")

// ----- A stays where it belongs.
must("lib/calendar/build-lanes.ts", (s) => s.includes("singleFixtureTeamIdsAcrossClubs") && s.includes("actingTeamIds"), "Calendar's create affordance must read single-fixture team authority")
must("lib/calendar/build-lanes.ts", (s) => !/canBulkPlanFixtures|can_bulk_plan_fixtures/.test(s), "Calendar's single-fixture affordance must not be gated on bulk authority")
must("lib/calendar/build-lanes.ts", (s) => s.includes("teamGroupMemberships") && !s.includes('from("scheduling_group_members")'), "group membership must come from the shared helper")
must("app/(app)/fixtures/page.tsx", (s) => !/kind === "team"[\s\S]{0,200}fixtures\/planner/.test(s), "a team context must not be offered a link into the Planner")

// ----- A Mini-Rugby Group is never offered as a team of its own.
must(`${PLANNER}/use-planner-lookups.ts`, (s) => !/scheduling_group/.test(s), "Our Team options must be real teams, never scheduling groups")

// ----- Opening or typing in a cell is never a request.
for (const file of ["planner-grid.tsx", "planner-cells.tsx"]) {
  must(`${PLANNER}/${file}`, (s) => !/from "\.\/(lookup-)?actions"/.test(s), "the grid must not call server actions -- lookups come from the cached hook")
}
must(`${PLANNER}/lookup-actions.ts`, (s) => !/export async function search/.test(s), "per-keystroke search actions must not return -- the catalogue is loaded once")
must("lib/fixtures/club-catalogue.ts", (s) => /\.eq\("rugby_code", rugbyCode\)/.test(s), "the club catalogue must be scoped to one rugby code in the query")
must(`${PLANNER}/lookup-actions.ts`, (s) => /loadClubCatalogue\(supabase, rugbyCode/.test(s), "the planner must read the shared club catalogue")

if (failures.length > 0) {
  console.error("  FAIL  fixture_bulk_authority (structure)")
  for (const f of failures) console.error(`          ${f}`)
  process.exit(1)
}
console.log("  ok    fixture_bulk_authority (structure)")
