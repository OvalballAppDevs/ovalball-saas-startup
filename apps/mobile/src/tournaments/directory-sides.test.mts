import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { addDirectoryClubSide, addExternalSide, addSides } from "./teams-selection"
import { buildCreatePayload } from "./create-payload"
import type { DraftAgeGroup, TournamentDraft } from "./create-context"

/**
 * THREE SITUATIONS, KEPT APART.
 *
 *   1. a directory club WITH teams at this grade   -> its real teams are added
 *   2. a directory club with NO team at this grade -> the CLUB is added, keeping its directory id
 *   3. a club Ovalball has never heard of          -> a name is recorded
 *
 * The second used to be treated as the third, which would have invented a second identity for a club
 * already in the directory -- so when Wigan later created its U12 team, nothing would connect the two.
 *
 * THE CREATION WIZARD AND THE MANAGEMENT TAB MUST AGREE. The wizard builds a draft and sends it to
 * `create_tournament_with_teams`; the management tab calls `add_tournament_participant_team` directly.
 * If those two disagree about what a side IS, a tournament's teams depend on when they were added, so
 * the shape the wizard produces is asserted against the arguments the management tab sends.
 */

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url))
const read = (p: string) => readFileSync(here(p), "utf8")

const WIGAN = { directoryId: "dir-wigan", clubName: "Wigan Rugby Union Football Club", crestUrl: null }

function grades(sides: DraftAgeGroup[] = []): DraftAgeGroup[] {
  return sides.length ? sides : [{ ageGroup: "U12", ourTeamIds: [], sides: [] }, { ageGroup: "U13", ourTeamIds: [], sides: [] }]
}

function draftWith(ageGroups: DraftAgeGroup[]): TournamentDraft {
  return {
    name: "Directory Festival",
    startsOn: "2026-10-10",
    endsOn: null,
    startTime: "09:00",
    multiDay: false,
    format: "round_robin",
    swissRounds: null,
    visibility: "private",
    venueId: "venue-1",
    venueName: "Ground",
    venueAddress: null,
    notes: "",
    ageGroups,
  }
}

test("a directory club with no team at the grade is still addable, keeping its directory id", () => {
  const out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: "Spears" })
  const sides = out.find((g) => g.ageGroup === "U12")!.sides
  assert.equal(sides.length, 1)
  assert.equal(sides[0].directoryId, "dir-wigan", "the club's canonical identity must be kept")
  assert.equal(sides[0].teamId, null)
  assert.equal(sides[0].squadLabel, "Spears", "the alias is written as-is")
  assert.equal(sides[0].label, "U12 Spears", "and displayed after the competition")
  assert.equal(sides[0].ageGroupShown ?? "U12", "U12")
})

test("two squad labels for one club at one grade coexist", () => {
  let out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: "Spears" })
  out = addDirectoryClubSide(out, "U12", { ...WIGAN, alias: "U12 B" })
  assert.equal(out.find((g) => g.ageGroup === "U12")!.sides.length, 2)
})

test("the same alias twice is still one side", () => {
  let out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: "Spears" })
  out = addDirectoryClubSide(out, "U12", { ...WIGAN, alias: "Spears" })
  assert.equal(out.find((g) => g.ageGroup === "U12")!.sides.length, 1)
})

test("a side may be added without naming the squad, and no name is invented for the row", () => {
  const out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: null })
  const side = out.find((g) => g.ageGroup === "U12")!.sides[0]
  assert.equal(side.squadLabel, null, "nothing was typed, so nothing is written")
  assert.equal(side.label, "U12", "and it reads as the club at that competition")

  const payload = buildCreatePayload(draftWith(out), "club-1")
  const row = payload.p_participants.find((p) => p.directory_id === "dir-wigan")!
  assert.equal(row.squad_label, null, "the display fallback must never reach squad_label")
})

test("the grade a side was added at is the grade it is in", () => {
  const out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: "Spears" })
  assert.equal(out.find((g) => g.ageGroup === "U13")!.sides.length, 0)
})

test("the payload sends a real directory id, never an invented pending key", () => {
  const out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: "Spears" })
  const payload = buildCreatePayload(draftWith(out), "club-1")
  const row = payload.p_participants.find((p) => p.club_name === WIGAN.clubName)!
  assert.equal(row.directory_id, "dir-wigan")
  assert.equal(row.team_id, null)
  assert.equal(row.age_group, "U12")
  assert.equal(row.squad_label, "Spears")
})

test("a genuinely manual club still has no directory id to send", () => {
  // The manual fallback has no canonical row yet; the server matches the name or creates one. A
  // `pending:` key is the screen keeping its own list unique, and must not be sent as an id.
  const out = addExternalSide(grades(), "U12", { directoryId: null, clubName: "Nowhere RFC", alias: "A" })
  const payload = buildCreatePayload(draftWith(out), "club-1")
  const row = payload.p_participants.find((p) => p.club_name === "Nowhere RFC")!
  assert.equal(row.directory_id, null)
  assert.equal(row.squad_label, "A")
})

test("real teams are still added as real teams, with no squad label", () => {
  const out = addSides(grades(), "U12", { directoryId: "dir-preston", name: "Preston", location: null, crestUrl: null, onOvalball: true }, [
    { teamId: "team-a", name: "Under 12 Boys", ageGroup: "U12", canonicalTeamTypeId: null },
    { teamId: "team-b", name: "Under 12 Boys B", ageGroup: "U12", canonicalTeamTypeId: null },
  ])
  const payload = buildCreatePayload(draftWith(out), "club-1")
  const rows = payload.p_participants.filter((p) => p.directory_id === "dir-preston")
  assert.equal(rows.length, 2)
  for (const r of rows) assert.equal(r.squad_label, null, "a real team IS its name")
})

test("the creation wizard and the management tab send the same participant shape", () => {
  // Both must end up with: the club's real directory id, a null team id, the grade, and the label the
  // organiser typed (or null). Asserted against the arguments the management tab actually passes.
  const managementCall = read("./teams-tab.tsx")
  assert.match(managementCall, /p_club_directory_id: club\.directoryId/)
  assert.match(managementCall, /p_squad_label: alias/)
  assert.match(managementCall, /p_age_group: grade/, "the grade is the one chosen, not the tab")
  assert.match(managementCall, /p_age_group: active/)

  const wizard = read("../../app/(tabs)/admin/tournaments/new/teams.tsx")
  assert.match(wizard, /addDirectoryClubSide/, "the wizard must use the directory-club helper, not the external one")
  assert.ok(!/addExternalSide\(.*club\.directoryId/.test(wizard), "a directory club must never be routed through the external path")
})

test("the sheet no longer dead-ends a club with no team at the grade", () => {
  const sheet = read("./add-clubs-sheet.tsx")
  assert.match(sheet, /No \{ageGroup\} teams are currently registered/)
  assert.match(sheet, /Add \{club\.name\} \{ageGroup\} Team/)
  assert.match(sheet, /Not yet claimed on Ovalball/)
  // The disabled "Add 0 Teams" button is gone: the primary action only exists when there is one.
  assert.match(sheet, /\{hasTeams \? \(/)
})

test("the manual fallback is named for what it is, and is not the normal meaning of a non-team club", () => {
  const sheet = read("./add-clubs-sheet.tsx")
  assert.match(sheet, /Can't find the club\?/)
  assert.match(sheet, /Add club manually/)
  assert.ok(!/Add an external club/.test(sheet), "the entry point must not call a directory club external")

  const manual = read("./external-club-sheet.tsx")
  assert.match(manual, /Add Club Manually/)
  assert.match(manual, /Use this only if the club cannot be found in Ovalball/)
  assert.match(manual, /No invitation or email is sent/)
})

test("the club search does not require teams, a claim or users", () => {
  const contract = read("../../../../packages/contracts/src/club/tournament-teams.ts")
  const start = contract.indexOf("export async function searchTournamentClubs")
  assert.ok(start > -1, "searchTournamentClubs must exist")
  const search = contract.slice(start, contract.indexOf("export async function readDirectoryClubTeamsAtGrade"))
  assert.match(search, /\.from\("club_directory"\)/, "the search reads the whole canonical directory")

  // Only the QUERY matters, not the prose around it. The narrowing filters must be rugby code, active
  // and the host exclusion -- nothing about claims, users or teams.
  const filters = [...search.matchAll(/\.(eq|neq|not|in|filter|inner)\(\s*"([^"]+)"/g)].map((m) => `${m[1]}:${m[2]}`)
  assert.deepStrictEqual(filters.sort(), ["eq:active", "eq:rugby_code", "neq:id"].sort())

  // An inner join on `clubs` would silently require a claimed account; the embed must stay optional.
  const select = search.match(/\.select\("([^"]*)"\)/)?.[1] ?? ""
  assert.ok(!select.includes("!inner"), "the clubs embed must not be an inner join")
  assert.ok(!/\bteams\b/.test(select), "the search must not read teams at all")
})

// ---------------------------------------------------------------------------
// AGE GROUP AND ALIAS ARE DIFFERENT FACTS.
//
// One free-text box used to do both jobs, so the grade had to be READ OUT of a name like "U12 A" and
// a club that calls its second side "Spears" had nowhere to say so without inventing a grade-looking
// label. The grade is now structured and chosen; the alias is optional and never implies it.
// ---------------------------------------------------------------------------

test("the alias never determines the age group", () => {
  // An alias that LOOKS like a grade changes nothing about which competition the side is in.
  const out = addDirectoryClubSide(grades(), "U13", { ...WIGAN, alias: "U12 A" })
  assert.equal(out.find((g) => g.ageGroup === "U13")!.sides.length, 1, "the chosen grade decides")
  assert.equal(out.find((g) => g.ageGroup === "U12")!.sides.length, 0, "the alias does not move it")

  const payload = buildCreatePayload(draftWith(out), "club-1")
  const row = payload.p_participants.find((p) => p.directory_id === "dir-wigan")!
  assert.equal(row.age_group, "U13")
  assert.equal(row.squad_label, "U12 A", "the alias is stored verbatim, as a name")
})

test("changing the grade stores the side against that grade, not the one it was opened from", () => {
  // The sheet opens from U12 but the organiser picks U13: the side belongs to U13 structurally, not
  // just visually.
  const out = addDirectoryClubSide(grades(), "U13", { ...WIGAN, alias: "B" })
  assert.equal(out.find((g) => g.ageGroup === "U12")!.sides.length, 0)
  const row = buildCreatePayload(draftWith(out), "club-1").p_participants[0]
  assert.equal(row.age_group, "U13")
})

test("three sides differing only by grade or alias are three distinct sides", () => {
  let out = addDirectoryClubSide(grades(), "U12", { ...WIGAN, alias: "Spears" })
  out = addDirectoryClubSide(out, "U12", { ...WIGAN, alias: "Arrows" })
  out = addDirectoryClubSide(out, "U13", { ...WIGAN, alias: "B" })
  assert.equal(out.find((g) => g.ageGroup === "U12")!.sides.length, 2)
  assert.equal(out.find((g) => g.ageGroup === "U13")!.sides.length, 1)

  const rows = buildCreatePayload(draftWith(out), "club-1").p_participants
  assert.deepStrictEqual(
    rows.map((r) => `${r.age_group}:${r.squad_label}`).sort(),
    ["U12:Arrows", "U12:Spears", "U13:B"],
  )
})

test("the grade selector offers the tournament's own competitions, not every age group", () => {
  const sheet = read("./add-clubs-sheet.tsx")
  assert.match(sheet, /tournamentAgeGroups/, "the sheet is given the tournament's grades")

  const management = read("./teams-tab.tsx")
  assert.match(management, /tournamentAgeGroups=\{detail\.ageGroups\}/)

  const wizard = read("../../app/(tabs)/admin/tournaments/new/teams.tsx")
  assert.match(wizard, /tournamentAgeGroups=\{draft\.ageGroups\.map\(\(g\) => g\.ageGroup\)\}/)

  // No second vocabulary: the control must not import or define its own age-group list.
  const fields = read("./side-identity-fields.tsx")
  assert.ok(!/YOUTH_AGE_GROUPS|TOURNAMENT_AGE_GROUPS|U6|U19/.test(fields), "the control defines no age-group list of its own")
})

test("the form names the two facts the way the product does", () => {
  const fields = read("./side-identity-fields.tsx")
  assert.match(fields, /AGE GROUP/)
  assert.match(fields, /Alias \(optional\)/)
  assert.match(fields, /e\.g\. Spears, Arrows, B, 2nd XV/)
  assert.match(fields, /Use an alias to distinguish multiple sides from the same club\./)
  assert.ok(!/Team \/ Squad Name/.test(fields), "the old conflated label is gone")
})

test("a side without a canonical team is listed as its competition plus its alias", () => {
  // The alias alone does not say which competition the side is in, so "Spears" is never the whole
  // answer on screen even though "Spears" is the whole of what is STORED.
  const detail = readFileSync(
    fileURLToPath(new URL("../../../../packages/contracts/src/club/tournament-detail.ts", import.meta.url)),
    "utf8",
  )
  assert.match(detail, /p\.squad_label \? `\$\{p\.age_group\} \$\{p\.squad_label\}` : p\.age_group/)

  // And the Requests tab must not then append the grade a second time.
  const requests = read("./requests-tab.tsx")
  assert.match(requests, /s\.teamId \? `\$\{s\.label\} · \$\{s\.ageGroup\}` : s\.label/)
})

test("the host's own side is drawn once: tournament_team_entries is a view over the same participant rows", () => {
  const detail = readFileSync(fileURLToPath(new URL("../../../../packages/contracts/src/club/tournament-detail.ts", import.meta.url)), "utf8")
  assert.match(detail, /const oursIds = new Set\(ours\.map\(\(o\) => o\.id\)\)/, "the host's entries are known by id")
  assert.match(detail, /\(row\.tournament_participants \?\? \[\]\)\.filter\(\(x\) => !oursIds\.has\(x\.id\)\)/, "and skipped among the visiting clubs, so a four-team competition is counted as four")
})
