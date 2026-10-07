import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import type { OurTeamOption, TournamentCandidateTeam, TournamentClubResult } from "@ovalball/contracts/club/tournament-teams"

import type { DraftAgeGroup } from "./create-context"
import {
  addExternalSide,
  addOurTeam,
  addSides,
  addTeamsCtaLabel,
  ageGroupEntry,
  alreadyInGrade,
  emptyGrades,
  gradeBreakdown,
  removeOurTeam,
  removeSide,
  seedOurTeams,
  sideKey,
  teamCountForGrade,
  teamsLabel,
  teamsStepHint,
  totalTeamCount,
} from "./teams-selection"

/**
 * CREATE TOURNAMENT -- STEP 3, TEAMS.
 *
 * The rules that cannot be seen by looking at the screen: grades do not leak into one another, our
 * own sides are seeded once rather than re-seeded, a club is not a team, and an added club is added
 * rather than invited.
 */

const SRC = new URL(".", import.meta.url).pathname
const SCREEN = `${SRC}../../app/(tabs)/admin/tournaments/new/teams.tsx`
const SHEET = `${SRC}add-clubs-sheet.tsx`
const CONTRACT = `${SRC}../../../../packages/contracts/src/club/tournament-teams.ts`

function grade(ageGroup: string, over: Partial<DraftAgeGroup> = {}): DraftAgeGroup {
  return { ageGroup, ourTeamIds: null, sides: [], ...over }
}

const BURNLEY: TournamentClubResult = {
  directoryId: "dir-burnley",
  name: "Burnley RUFC",
  location: "Burnley, Lancashire",
  crestUrl: null,
  onOvalball: true,
}

const NOT_ON_OVALBALL: TournamentClubResult = { ...BURNLEY, directoryId: "dir-x", name: "Padiham RUFC", onOvalball: false }

function team(id: string, name: string, ageGroup = "U9"): TournamentCandidateTeam {
  return { teamId: id, name, ageGroup, canonicalTeamTypeId: `ctt-${ageGroup}` }
}

function ourTeam(id: string, name: string, ageGroup = "U9"): OurTeamOption {
  return { ...team(id, name, ageGroup), clubId: "our-club" }
}

// ---------------------------------------------------------------------------
// ONLY THE GRADES STEP 2 CHOSE, AND THEY DO NOT LEAK.
// ---------------------------------------------------------------------------

test("a grade that was never selected is not conjured into existence by being looked at", () => {
  const draft = [grade("U9"), grade("U11")]
  assert.equal(ageGroupEntry(draft, "U10"), undefined)
  // And an operation against it changes nothing rather than creating it.
  assert.deepEqual(addSides(draft, "U10", BURNLEY, [team("t1", "Under 9 A")]), draft)
})

test("adding teams to one grade leaves every other grade alone", () => {
  let draft = [grade("U9", { ourTeamIds: [] }), grade("U11", { ourTeamIds: [] })]
  draft = addSides(draft, "U9", BURNLEY, [team("t1", "Under 9 A"), team("t2", "Under 9 B")])
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U9")), 2)
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U11")), 0, "U11 must not receive U9's teams")
})

// ---------------------------------------------------------------------------
// OUR OWN SIDES.
// ---------------------------------------------------------------------------

test("our own matching teams are included automatically, per grade", () => {
  const draft = seedOurTeams([grade("U9"), grade("U11")], {
    U9: [ourTeam("a", "Under 9 A"), ourTeam("b", "Under 9 B"), ourTeam("c", "Under 9 C")],
    U11: [ourTeam("k", "Under 11 Boys", "U11")],
  })
  assert.deepEqual(ageGroupEntry(draft, "U9")?.ourTeamIds, ["a", "b", "c"])
  assert.deepEqual(ageGroupEntry(draft, "U11")?.ourTeamIds, ["k"])
})

test("a grade the club has no team at is seeded empty, not left unresolved", () => {
  const draft = seedOurTeams([grade("U19")], { U19: [] })
  assert.deepEqual(ageGroupEntry(draft, "U19")?.ourTeamIds, [])
})

test("removing one of our own sides removes it from THIS tournament only", () => {
  let draft = seedOurTeams([grade("U9")], { U9: [ourTeam("a", "Under 9 A"), ourTeam("b", "Under 9 B")] })
  draft = removeOurTeam(draft, "U9", "a")
  assert.deepEqual(ageGroupEntry(draft, "U9")?.ourTeamIds, ["b"])
  // Nothing in the draft refers to the team record itself -- removal is an absence from a list.
  assert.ok(!JSON.stringify(draft).includes("deleted"))
})

test("a removed side can be added back, in the club's canonical team order", () => {
  const order = [ourTeam("a", "Under 9 A"), ourTeam("b", "Under 9 B"), ourTeam("c", "Under 9 C")]
  let draft = seedOurTeams([grade("U9")], { U9: order })
  draft = removeOurTeam(draft, "U9", "b")
  draft = addOurTeam(draft, "U9", "b", order)
  assert.deepEqual(ageGroupEntry(draft, "U9")?.ourTeamIds, ["a", "b", "c"], "it returns to its place, not to the end")
})

test("SEEDING NEVER UNDOES A DELIBERATE REMOVAL -- an emptied grade stays empty", () => {
  const byGrade = { U9: [ourTeam("a", "Under 9 A")] }
  let draft = seedOurTeams([grade("U9")], byGrade)
  draft = removeOurTeam(draft, "U9", "a")
  assert.deepEqual(ageGroupEntry(draft, "U9")?.ourTeamIds, [])
  // The organiser switches to U11 and back, which re-runs the seed.
  draft = seedOurTeams(draft, byGrade)
  assert.deepEqual(ageGroupEntry(draft, "U9")?.ourTeamIds, [], "switching tabs must not put a removed team back")
})

// ---------------------------------------------------------------------------
// ANOTHER CLUB'S SIDES.
// ---------------------------------------------------------------------------

test("one club may bring one, several or all of its sides at a grade", () => {
  const all = [team("t1", "Under 9 A"), team("t2", "Under 9 B"), team("t3", "Under 9 C")]
  assert.equal(teamCountForGrade(ageGroupEntry(addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, [all[0]]), "U9")), 1)
  assert.equal(teamCountForGrade(ageGroupEntry(addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, all.slice(0, 2)), "U9")), 2)
  assert.equal(teamCountForGrade(ageGroupEntry(addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, all), "U9")), 3)
})

test("THE SAME SIDE CANNOT BE ADDED TWICE", () => {
  const t = team("t1", "Under 9 A")
  let draft = addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, [t])
  draft = addSides(draft, "U9", BURNLEY, [t])
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U9")), 1)

  // Nor by re-opening the club and confirming a mix of new and already-added sides.
  draft = addSides(draft, "U9", BURNLEY, [t, team("t2", "Under 9 B")])
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U9")), 2)
})

test("a side already in the grade is reported back so the sheet can show it as added", () => {
  const all = [team("t1", "Under 9 A"), team("t2", "Under 9 B")]
  const draft = addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, [all[0]])
  const already = alreadyInGrade(ageGroupEntry(draft, "U9"), all, BURNLEY.directoryId)
  assert.deepEqual([...already], ["t1"])
})

test("removing another club's side takes out that side and no other", () => {
  let draft = addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, [team("t1", "Under 9 A"), team("t2", "Under 9 B")])
  const key = sideKey({ teamId: "t1", directoryId: BURNLEY.directoryId, label: "Under 9 A" })
  draft = removeSide(draft, "U9", key)
  assert.deepEqual(ageGroupEntry(draft, "U9")?.sides.map((s) => s.teamId), ["t2"])
})

// ---------------------------------------------------------------------------
// ADDED IS NOT INVITED.
// ---------------------------------------------------------------------------

test("an Ovalball club the organiser adds carries NO invitation state", () => {
  const draft = addSides([grade("U9", { ourTeamIds: [] })], "U9", BURNLEY, [team("t1", "Under 9 A")])
  const side = ageGroupEntry(draft, "U9")!.sides[0]
  const serialised = JSON.stringify(side).toLowerCase()
  for (const word of ["pending", "accepted", "declined", "rejected", "invite", "email"]) {
    assert.ok(!serialised.includes(word), `a side must not carry "${word}"`)
  }
  assert.equal(side.clubId, BURNLEY.directoryId, "an Ovalball side records the club it belongs to")
})

test("neither the screen nor the sheet offers an invitation, an acceptance or an email", () => {
  for (const file of [SCREEN, SHEET]) {
    const src = readFileSync(file, "utf8")
    // Comments legitimately explain WHY there is no invitation, so only real code is checked.
    const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
    for (const word of ["Pending", "Accept", "Decline", "invite_tournament_participant"]) {
      assert.ok(!code.includes(word), `${file} must not contain "${word}"`)
    }
  }
})

// ---------------------------------------------------------------------------
// EXTERNAL CLUBS.
// ---------------------------------------------------------------------------

test("an external club is recorded without an account, an email or a team row", () => {
  const draft = addExternalSide([grade("U9", { ourTeamIds: [] })], "U9", { directoryId: null, clubName: "Ribblesdale Wanderers RUFC", alias: "A" })
  const side = ageGroupEntry(draft, "U9")!.sides[0]
  assert.equal(side.clubId, null, "external means no Ovalball club")
  assert.equal(side.teamId, null, "external means no team row")
  assert.equal(side.clubName, "Ribblesdale Wanderers RUFC")
  // THE GRADE AND THE ALIAS ARE DIFFERENT FACTS. The alias is what the club calls the side; the grade
  // is which competition it is in. Only the alias is written.
  assert.equal(side.squadLabel, "A")
  assert.equal(side.label, "U9 A", "displayed as the competition plus the alias")
})

test("an external club with no alias is still a real side", () => {
  const draft = addExternalSide([grade("U9", { ourTeamIds: [] })], "U9", { directoryId: null, clubName: "Ribblesdale Wanderers RUFC", alias: null })
  const side = ageGroupEntry(draft, "U9")!.sides[0]
  assert.equal(side.squadLabel, null, "nothing was typed, so nothing is written")
  assert.equal(side.label, "U9", "and it reads as the club at that competition")
})

test("an external club may bring more than one side, but not the same one twice", () => {
  let draft = addExternalSide([grade("U9", { ourTeamIds: [] })], "U9", { directoryId: null, clubName: "Ribblesdale Wanderers RUFC", alias: "A" })
  draft = addExternalSide(draft, "U9", { directoryId: null, clubName: "Ribblesdale Wanderers RUFC", alias: "B" })
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U9")), 2)
  draft = addExternalSide(draft, "U9", { directoryId: null, clubName: "Ribblesdale Wanderers RUFC", alias: "A" })
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U9")), 2, "the same external side twice is one side")
})

test("a club without an Ovalball account added from search is marked external", () => {
  const draft = addSides([grade("U9", { ourTeamIds: [] })], "U9", NOT_ON_OVALBALL, [team("t9", "Under 9 A")])
  assert.equal(ageGroupEntry(draft, "U9")!.sides[0].clubId, null)
})

test("an empty club name records nothing, but an empty alias is allowed", () => {
  const draft = [grade("U9", { ourTeamIds: [] })]
  assert.deepEqual(addExternalSide(draft, "U9", { directoryId: null, clubName: "   ", alias: "A" }), draft, "a club needs a name")
  // A BLANK ALIAS IS NOT A BLANK SIDE. The club is coming; it simply has not named the squad.
  const noAlias = addExternalSide(draft, "U9", { directoryId: null, clubName: "Real RUFC", alias: "  " })
  assert.equal(ageGroupEntry(noAlias, "U9")!.sides.length, 1)
  assert.equal(ageGroupEntry(noAlias, "U9")!.sides[0].squadLabel, null)
})

// ---------------------------------------------------------------------------
// COUNTS SAY TEAMS, AND MEAN TEAMS.
// ---------------------------------------------------------------------------

test("a club with three sides contributes three teams, not one club", () => {
  let draft = seedOurTeams([grade("U9"), grade("U11")], { U9: [ourTeam("a", "Under 9 A")], U11: [] })
  draft = addSides(draft, "U9", BURNLEY, [team("t1", "Under 9 A"), team("t2", "Under 9 B"), team("t3", "Under 9 C")])
  draft = addExternalSide(draft, "U11", { directoryId: null, clubName: "Ribblesdale Wanderers RUFC", alias: null })
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U9")), 4, "our one side plus Burnley's three")
  assert.equal(teamCountForGrade(ageGroupEntry(draft, "U11")), 1, "an external side is a team too")
  assert.equal(totalTeamCount(draft), 5)
  assert.equal(gradeBreakdown(draft), "U9: 4  ·  U11: 1")
})

test("counts and the add button read as a person would say them", () => {
  assert.equal(teamsLabel(1), "1 team")
  assert.equal(teamsLabel(6), "6 teams")
  assert.equal(addTeamsCtaLabel(1), "Add 1 Team")
  assert.equal(addTeamsCtaLabel(2), "Add 2 Teams")
  assert.equal(addTeamsCtaLabel(3), "Add 3 Teams")
})

// ---------------------------------------------------------------------------
// THE STEP SAYS WHY IT CANNOT BE FINISHED.
// ---------------------------------------------------------------------------

test("an empty competition is named, not silently greyed out", () => {
  const draft = seedOurTeams([grade("U9"), grade("U11"), grade("U12")], { U9: [ourTeam("a", "Under 9 A")], U11: [], U12: [] })
  assert.deepEqual(emptyGrades(draft), ["U11", "U12"])
  assert.equal(teamsStepHint(draft), "U11 and U12 have no teams yet. Add at least one team to each to continue.")
  assert.equal(teamsStepHint(seedOurTeams([grade("U11")], { U11: [] })), "U11 has no teams yet. Add at least one team to continue.")
  assert.equal(teamsStepHint(seedOurTeams([grade("U9")], { U9: [ourTeam("a", "Under 9 A")] })), null)
})

// ---------------------------------------------------------------------------
// STRUCTURAL PINS.
// ---------------------------------------------------------------------------

test("the step writes nothing: the tournament is created once, at Review", () => {
  const src = readFileSync(SCREEN, "utf8")
  assert.ok(!/\.rpc\(|\.insert\(|\.upsert\(|\.delete\(/.test(src), "step 3 must not mutate anything")
})

test("only the grades chosen on Step 2 are offered as tabs", () => {
  const src = readFileSync(SCREEN, "utf8")
  assert.match(src, /draft\.ageGroups\.map\(\(g\) =>/, "the tabs must come from the draft, never the canonical list")
  assert.ok(!src.includes("TOURNAMENT_AGE_GROUPS"), "step 3 must not offer grades the tournament does not run")
})

test("club search is scoped by rugby code in the QUERY, and excludes the host", () => {
  const src = readFileSync(CONTRACT, "utf8")
  assert.match(src, /\.eq\("rugby_code", options\.rugbyCode\)/, "code isolation must be a where clause, not a filter in the browser")
  assert.match(src, /\.neq\("id", options\.excludeDirectoryId\)/)
})

test("a club's teams are filtered to the grade in the QUERY", () => {
  const src = readFileSync(CONTRACT, "utf8")
  assert.match(src, /\.eq\("age_group", ageGroup\)/, "an U10 side must never be offered to the U9 competition")
})

test("playing colours come from club_kits and are never invented", () => {
  const src = readFileSync(CONTRACT, "utf8")
  assert.match(src, /from\("club_kits"\)/)
  // No hex literal may appear in the contract: a colour here would be a colour Ovalball does not hold.
  assert.ok(!/#[0-9a-fA-F]{6}/.test(src), "no invented colour may appear in the team contract")
})

// ---------------------------------------------------------------------------
// A REMOVED GRADE DOES NOT COME BACK CARRYING ITS OLD TEAMS.
// ---------------------------------------------------------------------------

test("the Age Groups undo stash expires when the organiser leaves the step", () => {
  const src = readFileSync(`${SRC}../../app/(tabs)/admin/tournaments/new/age-groups.tsx`, "utf8")
  // Found in the Simulator: expo-router keeps the screen MOUNTED when Teams is pushed, so a ref-held
  // stash outlived the visit and a re-added grade reappeared with the clubs that used to be in it.
  assert.match(src, /useFocusEffect/, "the stash must be cleared when the screen loses focus")
  assert.match(src, /detached\.current\.clear\(\)/)
})
