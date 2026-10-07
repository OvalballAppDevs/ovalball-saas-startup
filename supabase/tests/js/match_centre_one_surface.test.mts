/**
 * ONE MATCH CENTRE FOR EVERY GAME (owner brief, 2026-10-03).
 *
 * The server half -- the attendance window, privacy, catering, awards, the public team page -- is proved
 * in supabase/tests/match_centre_consolidation.sql. This pins the client half that no SQL can see:
 *
 *   - a fixture and a tournament game are drawn by the SAME hero and the SAME section bar, imported from
 *     the one Match Centre folder, never copied beside a tournament screen
 *   - the sections, the links into them and the attendance moment speak the brief's own words
 *   - the award badges are one family, and the Beast Award is the bear head, not a star
 *   - a person's current award appears on the one PlayerIdentity, at most two at a time
 */

import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs"
import { join } from "node:path"
import { test } from "node:test"

import { attendanceMomentCopy } from "../../../packages/contracts/src/match-centre/attendance"
import { MATCH_CENTRE_SECTIONS, MATCH_CENTRE_SECTION_LABEL, matchCentreHref, parseMatchCentreSection } from "../../../packages/contracts/src/match-centre/sections"

const MOBILE = "apps/mobile"
const MC = `${MOBILE}/src/fixtures/match-centre`
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

function files(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) files(full, acc)
    else if (/\.tsx?$/.test(entry)) acc.push(full)
  }
  return acc
}

test("a tournament game is drawn by the same hero and section bar as a fixture", () => {
  const game = code(`${MOBILE}/app/(tabs)/tournaments/result/[gameId].tsx`)
  assert.match(game, /import \{ MatchHero, type MatchHeroModel \} from "\.\.\/\.\.\/\.\.\/\.\.\/src\/fixtures\/match-centre\/hero"/)
  assert.match(game, /import \{ MatchCentreTabs \} from "\.\.\/\.\.\/\.\.\/\.\.\/src\/fixtures\/match-centre\/tabs"/)
  assert.match(game, /<MatchHero view=\{hero\}/)
  assert.match(game, /<MatchCentreTabs tabs=\{TOURNAMENT_GAME_SECTIONS\}/)
  assert.match(game, /title="Match Centre"/, "the header names the one surface, whichever game it is")
  const fixture = code(`${MC}/index.tsx`)
  assert.match(fixture, /<MatchHero view=\{view\}/)
  assert.match(fixture, /<MatchCentreTabs tabs=\{tabs\}/)
})

test("there is one hero and one section bar in the app, not a copy per kind of game", () => {
  const all = [...files(`${MOBILE}/src`), ...files(`${MOBILE}/app`)]
  const heroes = all.filter((f) => /export function MatchHero\b/.test(readFileSync(f, "utf8")))
  const bars = all.filter((f) => /export function MatchCentreTabs\b/.test(readFileSync(f, "utf8")))
  assert.deepEqual(heroes, [`${MC}/hero.tsx`])
  assert.deepEqual(bars, [`${MC}/tabs.tsx`])
  for (const f of all) {
    assert.doesNotMatch(readFileSync(f, "utf8"), /\b(Parent|Player|Staff|Club|Tournament)(MatchHero|MatchCentreTabs)\b/, `${f} declares a role- or kind-named copy`)
  }
})

test("the sections are the brief's six, in its order, in Title Case", () => {
  assert.deepEqual([...MATCH_CENTRE_SECTIONS], ["overview", "arena", "result", "attendance", "changing-room", "rewards"])
  assert.deepEqual(Object.values(MATCH_CENTRE_SECTION_LABEL), ["Overview", "Arena Details", "Result", "Attendance", "Changing Room", "Rewards"])
  assert.equal(parseMatchCentreSection("attendance"), "attendance")
  assert.equal(parseMatchCentreSection("changing_room"), "changing-room")
  assert.equal(parseMatchCentreSection("awards"), "rewards")
  assert.equal(parseMatchCentreSection("nonsense"), "overview", "an unknown section is Overview, never a dead end")
  assert.equal(parseMatchCentreSection(null), "overview")
  assert.equal(matchCentreHref("fx"), "/fixtures/fx")
  assert.equal(matchCentreHref("fx", "rewards"), "/fixtures/fx?tab=rewards")
})

test("the attendance moment says exactly what the brief says", () => {
  assert.deepEqual(attendanceMomentCopy({ status: "ATTENDING", firstName: "Ava", opponent: "Preston Grasshoppers RFC" }), {
    title: "Ava is attending!",
    body: "Ava is attending against Preston Grasshoppers RFC.",
  })
  assert.deepEqual(attendanceMomentCopy({ status: "CANNOT_ATTEND", firstName: "Ava", opponent: "Preston Grasshoppers RFC" }).body,
    "Ava isn't going to be there against Preston Grasshoppers RFC.")
  assert.deepEqual(attendanceMomentCopy({ status: "UNSURE", firstName: "Ava", opponent: "Preston Grasshoppers RFC" }).title, "Things can happen!")
  assert.match(attendanceMomentCopy({ status: "UNSURE", firstName: "Ava", opponent: null }).body, /^Be sure to update the poll/)
  // An adult answering for themselves is spoken to, not about.
  assert.equal(attendanceMomentCopy({ status: "ATTENDING", firstName: null, opponent: "Preston Grasshoppers RFC" }).body, "You're attending against Preston Grasshoppers RFC.")
})

test("the moment never stands between a family and their answer, and respects reduced motion", () => {
  const moment = code(`${MC}/attendance-moment.tsx`)
  assert.match(moment, /useReduceMotion\(\)/)
  assert.match(moment, /reduceMotion \|\| failed \?/, "a still frame for reduced motion, and when the clip fails")
  assert.match(moment, /setTimeout\(onClose,/, "it leaves on its own")
  const screen = code(`${MC}/index.tsx`)
  // The moment is shown only AFTER the server accepted the answer.
  assert.match(screen, /if \(!result\.ok\) \{[\s\S]*?return false[\s\S]*?attendanceMomentCopy\(/)
  for (const asset of ["attending", "cannot-attend", "unsure"]) {
    assert.ok(existsSync(`${MOBILE}/assets/match-centre/${asset}.mp4`), `${asset}.mp4 is bundled`)
    assert.ok(existsSync(`${MOBILE}/assets/match-centre/${asset}.jpg`), `${asset}.jpg is bundled as the still`)
  }
})

test("the award badges are one family, and the Beast Award is the bear head", () => {
  const identity = code(`${MOBILE}/src/components/player-identity.tsx`)
  for (const [key, file] of [["FAMILY_OR_SELF_PLAYER", "parents-potm"], ["COACHES_PLAYER", "coaches-potm"], ["OPPOSITION_PLAYER", "opposition-potm"], ["WORK_ETHIC", "beast"]]) {
    assert.match(identity, new RegExp(`${key}: require\\("\\.\\./\\.\\./assets/awards/${file}\\.png"\\)`))
    assert.ok(existsSync(`${MOBILE}/assets/awards/${file}.png`), `${file}.png is bundled`)
  }
  assert.doesNotMatch(identity, /star/i, "no star stands in for the Beast Award")
  assert.match(identity, /recognition\.slice\(0, 2\)/, "at most two current awards beside a name")
})
