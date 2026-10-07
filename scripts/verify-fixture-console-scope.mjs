#!/usr/bin/env node
/**
 * ONE GAME, ONE MATCH CENTRE.
 *
 * This guard has protected three architectures in turn. First the all-in-one FixtureConsole; then,
 * after commit f83ddf1, the split into Fixture Detail, Edit Fixture and Match Centre. On 2026-10-03 the
 * owner consolidated that split into ONE Match Centre for every game and every viewer ("Consolidate
 * Fixture, Edit Fixture, Match Centre ... into one surface. Old routes redirect into Match Centre with
 * the right section."). A guard left asserting the split would fail on the approved product and so
 * protect nothing, so it is rewritten again -- and, as before, deliberately no weaker. What it guarded
 * then and still guards:
 *
 *   NO SECOND PLACE TO CHANGE A FIXTURE. The details editor inside the Match Centre is the only caller
 *   of the canonical schedule mutations. The retired console, Fixture Detail and Edit Fixture stay
 *   retired, and a fixture route cannot quietly become a surface of its own again.
 *
 *   THE READ VIEW DOES NOT EDIT FIELDS. Cancelling, and answering a kick-off the other club proposed,
 *   are decisions and belong on the Overview. Changing a venue or a kick-off is a field edit and goes
 *   through the editor, which is drawn only where the server says this viewer may edit.
 *
 *   THE EDITOR USES THE CANONICAL MUTATIONS, states the consequence before the change, and writes
 *   nothing until Save Changes is pressed.
 *
 *   ATTENDANCE IS READ FROM THE SERVER'S PROJECTION. The Match Centre asks
 *   `get_match_centre_attendance`, which decides per viewer whether a side is shown by name, by count
 *   or not at all; it never selects another side's rows itself.
 *
 *   CLUB DOCUMENTS belong to the Club Documents product and reach a fixture through MESSAGING.
 *
 *   DELETE is club-scoped in the capability catalogue and never belongs to the Match Centre.
 *
 * It reads what SHIPS -- the screens' own source and the routes beside them -- not comments.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const ROUTE_DIR = join(ROOT, "apps", "mobile", "app", "(tabs)", "fixtures", "[fixtureId]")
const SRC = join(ROOT, "apps", "mobile", "src", "fixtures")
const MC = join(SRC, "match-centre")
const failures = []
let checks = 0

const check = (ok, label, detail = "") => {
  checks += 1
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
}

/** Source with comments stripped: a check about what RENDERS must not be satisfied by prose about it. */
const stripped = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "")
const read = (path) => (existsSync(path) ? stripped(readFileSync(path, "utf8")) : "")

// ---------------------------------------------------------------- the retired surfaces stay retired
for (const [file, what] of [
  [join(SRC, "fixture-console.tsx"), "the FixtureConsole"],
  [join(SRC, "fixture-detail-screen.tsx"), "Fixture Detail"],
  [join(SRC, "edit-fixture-screen.tsx"), "Edit Fixture"],
  [join(SRC, "match-centre.tsx"), "the single-file participant Match Centre"],
  [join(SRC, "surface.ts"), "the participant/operations surface gate"],
  [join(ROOT, "apps", "mobile", "src", "components", "fixture-hero.tsx"), "Fixture Detail's hero"],
]) {
  check(!existsSync(file), `${what} has not come back`, file.replace(ROOT, ""))
}

// ---------------------------------------------------------------- the one Match Centre, by section
const SECTIONS = [
  "index.tsx", "hero.tsx", "overview-section.tsx", "arena-section.tsx", "result-section.tsx",
  "attendance-section.tsx", "changing-room-section.tsx", "rewards-section.tsx",
  "details-editor.tsx", "arrangements-editor.tsx", "attendance-moment.tsx",
]
for (const file of SECTIONS) check(existsSync(join(MC, file)), `the Match Centre has its ${file}`)
const screen = read(join(MC, "index.tsx"))
const hero = read(join(MC, "hero.tsx"))
const overview = read(join(MC, "overview-section.tsx"))
const editor = read(join(MC, "details-editor.tsx"))
const editorSource = existsSync(join(MC, "details-editor.tsx")) ? readFileSync(join(MC, "details-editor.tsx"), "utf8") : ""
const result = read(join(MC, "result-section.tsx"))
const all = existsSync(MC) ? readdirSync(MC).filter((f) => f.endsWith(".tsx")).map((f) => read(join(MC, f))).join("\n") : ""

// ---------------------------------------------------------------- one fixture route group
if (existsSync(ROUTE_DIR)) {
  const routes = readdirSync(ROUTE_DIR).filter((name) => name.endsWith(".tsx")).sort()
  const expected = ["add-result.tsx", "edit.tsx", "index.tsx", "match-centre.tsx", "result.tsx"]
  check(
    routes.length === expected.length && routes.every((r, i) => r === expected[i]),
    "the fixture route group is exactly the Match Centre and its four compatibility addresses",
    routes.join(", ")
  )
  check(!routes.includes("cancel.tsx"), "cancelling is a decision in the Match Centre, not a screen of its own")
  const index = read(join(ROUTE_DIR, "index.tsx"))
  check(/export default MatchCentre/.test(index), "the canonical address renders the one Match Centre")
  check((index.match(/^import /gm) ?? []).length === 1, "and imports nothing else")
  for (const [file, kind] of [["match-centre.tsx", "MATCH_CENTRE"], ["result.tsx", "FIXTURE_RESULT"], ["add-result.tsx", "ADD_RESULT"], ["edit.tsx", "EDIT_FIXTURE"]]) {
    const source = read(join(ROUTE_DIR, file))
    check(new RegExp(`<Redirect href=\\{routeForIntent\\(\\{ kind: "${kind}"`).test(source), `${file} redirects through the one routing table as ${kind}`)
    check(!/src\/fixtures|supabase|mutations|<View|<Text/.test(source), `${file} draws nothing of its own`)
  }
}

// ---------------------------------------------------------------- the hero says what the brief says
check(/YOU'RE HOME/.test(hero) && /YOU'RE AWAY/.test(hero), "the hero says YOU'RE HOME / YOU'RE AWAY")
check(/view\.viewerSide === "home"/.test(hero) && /view\.viewerSide === "away"/.test(hero), "only for a viewer the server places on that side")
check(/label="MEET"[^\n]*"Not set"/.test(hero), "the meet time is always shown, as Not set when there is none")
check(/label="KICK-OFF"/.test(hero) && /label="DATE"/.test(hero) && /label="VENUE"/.test(hero), "with the date, kick-off and venue")
check(/NOT YET ON OVALBALL/.test(hero) && /onOvalball/.test(hero), "opposition presence is shown from the shared contract's own answer")

// ---------------------------------------------------------------- the Overview reads; decisions stay
for (const [pattern, what] of [
  [/\bupdateVenue\b/, "the venue"],
  [/\bupdatePitch\b/, "the pitch"],
  [/\bupdateMeetTime\b/, "the meet time"],
  [/\bupdateKickoff\b/, "the kick-off"],
  [/\bupdateDetails\b/, "the match details"],
]) {
  check(!pattern.test(overview) && !pattern.test(screen), `the read view does not edit ${what} -- that is the editor's job`)
}
check(/Cancel Fixture/.test(overview), "Cancel Fixture is on the Overview")
check(/colour\.danger/.test(overview), "and is drawn in the danger tone")
check(/<CancelSheet/.test(screen) && /cancelFixture\(/.test(screen), "with a confirmation before the canonical cancel")
check(/proposedKickoff/.test(overview), "a proposed kick-off change is surfaced rather than reported as saved")
check(/rejectKickoffChange\(/.test(screen) && /acceptKickoffChange\(/.test(screen), "and answered through the canonical mutations")
check(/const canEdit = Boolean\(view\?\.canManageFixture && authority\?\.edit\)/.test(screen), "editing is offered only on the server's answer")
check(/\{canEdit && editing === "details"/.test(screen), "and the editor is drawn only for whoever may edit")

// ---------------------------------------------------------------- the editor does the writing
// ONE SAVE, ONE NOTICE (20270734, integration audit). The four governed writers each tell the people their
// change affects, so calling them one after another sent a family a notice per writer for one decision and
// could leave half a save behind. The editor makes ONE call, `saveMatchDetails`, and the server runs the SAME
// governed writers in one transaction -- so every field below still goes through its canonical writer.
check((editor.match(/\bsaveMatchDetails\(/g) ?? []).length === 1, "the editor saves once, through the one composite write")
for (const [pattern, what] of [
  [/\bkickoff:\s/, "the kick-off"],
  [/\bmeetTime:\s/, "the meet time"],
  // 20270728: the ground is the HOST's, so the venue and pitch go through the host-aware facilities write.
  [/\bfacilities:\s/, "the venue and pitch"],
  [/home_away/, "home or away"],
]) {
  check(pattern.test(editor), `the editor writes ${what} through the canonical mutation`)
}
{
  const composite = readFileSync(join(ROOT, "supabase", "migrations", "20270734000000_one_save_one_notice.sql"), "utf8")
  for (const writer of ["update_fixture_details", "update_fixture_kickoff", "update_fixture_meet_time", "set_fixture_facilities"]) {
    check(new RegExp(`public\\.${writer}\\(p_fixture_id`).test(composite), `and the one Save runs the governed writer ${writer}`)
  }
}
check(!/\bupdateKickoff\(|\bupdateMeetTime\(|\bsetFixtureFacilities\(|\bupdateDetails\(/.test(editor), "and never calls a writer beside it -- that change would be announced twice")
check(/readFixtureFacilityOptions\(supabase, id, next\)/.test(editor), "and re-reads the host's grounds when home or away changes, before saving")
check(/from "\.\.\/\.\.\/agenda\/mutations"/.test(editor), "from the one canonical mutations module")
check(/tells the other club/.test(editorSource), "with the consequence stated before the change")
check(/Save Changes/.test(editor) && /onPress=\{\(\) => void save\(\)\}/.test(editor), "and nothing is written until Save Changes is pressed")

// ---------------------------------------------------------------- the canonical Match Result, lifted
check(/supabase\.rpc\("submit_fixture_result"/.test(result), "the Result section uses the one result state machine")
check(/fixtureResultMode\(/.test(result), "and the one shared rule for which result actions to offer")

// ---------------------------------------------------------------- attendance from the projection
check(/readMatchCentreAttendance\(/.test(screen), "attendance is read from the server's per-viewer projection")
check(!/from\("player_fixture_attendance"\)/.test(all), "the Match Centre never selects attendance rows itself")

// ---------------------------------------------------------------- nothing that belongs elsewhere
check(!/searchClubDocuments|club_documents|ClubDocument\b/.test(all), "no club documents are rendered in the Match Centre")
check(!/delete_fixture|deleteFixture/.test(all), "there is no fixture deletion")

// NO SECOND PLACE TO CHANGE A FIXTURE. Anything else under the mobile app that calls the canonical
// schedule mutations is a second editor by definition.
const EDITORS = []
const walk = (dir) => {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    if (name.name === "node_modules" || name.name.startsWith(".")) continue
    const full = join(dir, name.name)
    if (name.isDirectory()) walk(full)
    else if (/\.tsx?$/.test(name.name)) {
      const text = stripped(readFileSync(full, "utf8"))
      if (/\bupdateKickoff\(|\bupdateMeetTime\(|\bupdateVenue\(|\bsetFixtureFacilities\(|\bsaveMatchDetails\(/.test(text)) EDITORS.push(full)
    }
  }
}
walk(join(ROOT, "apps", "mobile"))
const allowed = EDITORS.filter(
  (f) => !f.endsWith(join("src", "fixtures", "match-centre", "details-editor.tsx")) &&
         // Changing rooms and catering: the same facilities write, from the Arena's own editor.
         !f.endsWith(join("src", "fixtures", "match-centre", "arrangements-editor.tsx")) &&
         !f.endsWith(join("src", "agenda", "mutations.ts")) &&
         !f.endsWith(join("src", "training", "training-operations.tsx")) &&
         !/\.test\.mts$/.test(f)
)
check(allowed.length === 0, "only the Match Centre's own editors call the fixture schedule and facilities mutations", allowed.map((f) => f.replace(ROOT, "")).join(", "))

// ---------------------------------------------------------------- the canonical document library stands
const picker = join(ROOT, "apps", "mobile", "app", "(tabs)", "messages", "documents.tsx")
check(existsSync(picker), "the M4 club-document picker still exists", picker)
const docs = join(ROOT, "apps", "mobile", "src", "messages", "documents.ts")
check(existsSync(docs), "and so does the canonical document search", docs)

if (failures.length > 0) {
  console.error(`FAIL  fixture scope — ${failures.length} of ${checks} checks failed`)
  for (const failure of failures) console.error(`      ${failure}`)
  process.exit(1)
}
console.log(
  `PASS  fixture scope — ${checks} checks: one Match Centre, older addresses redirect, the read view decides but never edits, one editor through the canonical mutations, attendance from the server's projection`
)
