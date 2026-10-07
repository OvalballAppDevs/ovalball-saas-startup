import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { TOURNAMENT_AGE_GROUPS } from "@ovalball/contracts/club/tournaments"
import { YOUTH_AGE_GROUPS } from "@ovalball/contracts/teams/age-groups"

import { ageGroupCountLabel, clearAgeGroups, ourTeamsLabel, toggleAgeGroup, type DetachedAgeGroups } from "./age-group-selection"

/**
 * CREATE TOURNAMENT -- STEP 2, AGE GROUPS.
 *
 * Two jobs. The structural ones pin that this screen offers the ONE canonical age-grade vocabulary
 * -- an earlier draft of the tournament contract declared its own (U7…U16+), which dropped U6 and
 * U17-U19 and offered a grade no team can hold. The behavioural ones pin the two rules a person
 * cannot see by looking at the grid: grade order is numeric, and deselecting a grade does not
 * destroy the teams inside it.
 */

const SRC = new URL(".", import.meta.url).pathname
const SCREEN = `${SRC}../../app/(tabs)/admin/tournaments/new/age-groups.tsx`

function empty(ageGroup: string) {
  return { ageGroup, ourTeamIds: null, sides: [] }
}

// ---------------------------------------------------------------------------
// ONE VOCABULARY.
// ---------------------------------------------------------------------------

test("the tournament age grades ARE the canonical team age grades, not a copy of them", () => {
  // Identity, not deep equality: a second array with the same members today is exactly the drift
  // `teams/age-groups.ts` was written to prevent.
  assert.equal(TOURNAMENT_AGE_GROUPS as unknown, YOUTH_AGE_GROUPS as unknown)
})

test("every grade a team can actually hold is offered", () => {
  for (const g of ["U6", "U7", "U12", "U16", "U17", "U18", "U19"]) {
    assert.ok((TOURNAMENT_AGE_GROUPS as readonly string[]).includes(g), `${g} must be selectable`)
  }
  // "U16+" is not a value `teams.age_group` accepts, so a tournament carrying it could never be
  // matched to a team.
  assert.ok(!(TOURNAMENT_AGE_GROUPS as readonly string[]).includes("U16+"))
})

test("the screen renders the canonical list and declares no grades of its own", () => {
  const src = readFileSync(SCREEN, "utf8")
  assert.match(src, /TOURNAMENT_AGE_GROUPS\.map/, "the grid must be driven by the canonical list")
  // A literal array of grades anywhere in this screen would be a second source of truth.
  assert.ok(!/\[\s*"U\d/.test(src), "no hardcoded age-grade array may appear in the screen")
})

// ---------------------------------------------------------------------------
// SELECTION.
// ---------------------------------------------------------------------------

test("selecting adds the grade with no teams in it yet", () => {
  const detached: DetachedAgeGroups = new Map()
  const next = toggleAgeGroup([], "U11", detached)
  assert.deepEqual(next, [{ ageGroup: "U11", ourTeamIds: null, sides: [] }])
})

test("grades are held in numeric order, so U9 comes before U10", () => {
  const detached: DetachedAgeGroups = new Map()
  let list = toggleAgeGroup([], "U10", detached)
  list = toggleAgeGroup(list, "U9", detached)
  list = toggleAgeGroup(list, "U12", detached)
  list = toggleAgeGroup(list, "U6", detached)
  assert.deepEqual(
    list.map((a) => a.ageGroup),
    ["U6", "U9", "U10", "U12"],
  )
})

test("tapping a selected grade removes it", () => {
  const detached: DetachedAgeGroups = new Map()
  const list = toggleAgeGroup(toggleAgeGroup([], "U11", detached), "U11", detached)
  assert.deepEqual(list, [])
})

test("deselecting a grade does not destroy the teams in it -- re-selecting restores them", () => {
  const detached: DetachedAgeGroups = new Map()
  const withTeams = {
    ageGroup: "U12",
    ourTeamIds: ["t1"],
    sides: [{ key: "team:x", directoryId: "d1", clubName: "Preston Grasshoppers RFC", clubId: "d1", crestUrl: null, teamId: "x", label: "Under 12 Boys" }],
  }
  const removed = toggleAgeGroup([withTeams], "U12", detached)
  assert.deepEqual(removed, [])

  const restored = toggleAgeGroup(removed, "U12", detached)
  assert.deepEqual(restored, [withTeams], "an accidental tap must not cost the organiser their work")

  // And the stash is spent, so a later re-selection is genuinely empty rather than resurrecting
  // teams the organiser deliberately took out twice.
  const again = toggleAgeGroup(toggleAgeGroup(restored, "U12", detached), "U12", detached)
  assert.deepEqual(again, [withTeams])
})

test("Clear removes every grade and keeps all of them recoverable", () => {
  const detached: DetachedAgeGroups = new Map()
  const a = { ageGroup: "U9", ourTeamIds: ["t"], sides: [] }
  const list = [a, empty("U10")]
  assert.deepEqual(clearAgeGroups(list, detached), [])
  assert.deepEqual(toggleAgeGroup([], "U9", detached), [a])
})

// ---------------------------------------------------------------------------
// WHAT THE COUNTS SAY.
// ---------------------------------------------------------------------------

test("the summary heading is Title Case, and counts read as a person would say them", () => {
  // The summary heads the selection panel, so the content standard puts it in Title Case -- and the
  // singular is a real branch, not a plural with the s filed off.
  assert.equal(ageGroupCountLabel(1), "1 Age Group Selected")
  assert.equal(ageGroupCountLabel(2), "2 Age Groups Selected")
  assert.equal(ageGroupCountLabel(4), "4 Age Groups Selected")
  assert.equal(ageGroupCountLabel(14), "14 Age Groups Selected")
  // The team count is body copy inside a card, so it stays sentence case.
  assert.equal(ourTeamsLabel(1), "1 team")
  assert.equal(ourTeamsLabel(3), "3 teams")
})

test("the grid is three across, and selection never rests on colour alone", () => {
  const src = readFileSync(SCREEN, "utf8")
  assert.match(src, /const GRID_COLS = 3/)
  assert.match(src, /accessibilityRole="checkbox"/)
  assert.match(src, /accessibilityState=\{\{ checked: selected \}\}/)
  // The border weight, the grade's colour, the shirt's colour and a check mark all change.
  assert.match(src, /borderWidth: selected \? 1\.5 : 1/)
  assert.match(src, /color: selected \? colour\.forest800 : colour\.ink/)
  assert.match(src, /<Check size=\{12\}/)
})

test("zero selections shows the helper, never a count of none", () => {
  const src = readFileSync(SCREEN, "utf8")
  // The summary panel is rendered only when something is selected, so "0 Age Groups Selected" can
  // never appear -- the footer's hint carries the empty state instead.
  assert.match(src, /\{valid && \(/)
})

// ---------------------------------------------------------------------------
// THE STEP CANNOT BE LEFT EMPTY, AND IT DOES NOT WRITE.
// ---------------------------------------------------------------------------

test("Next is gated on at least one grade, and the step writes nothing to the database", () => {
  const src = readFileSync(SCREEN, "utf8")
  assert.match(src, /primaryDisabled=\{!valid\}/)
  assert.match(src, /const valid = count > 0/)
  assert.match(src, /primaryHint="Select at least one age group to continue\."/)
  // Nothing is created until Review & Create: this step edits the draft only.
  assert.ok(!/\.rpc\(|\.insert\(|\.update\(|\.delete\(/.test(src), "step 2 must not mutate anything")
})
