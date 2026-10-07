import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

const MOBILE = "apps/mobile"
const code = (p: string) => readFileSync(p, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

/**
 * OWNER PHYSICAL REVIEW CORRECTION PASS -- app-wide forest chrome + the Fixture Detail / Edit Fixture
 * split. Permanent structural pins so neither regresses to white-by-default or to the retired
 * tap-to-edit-inline console architecture without a deliberate, visible change here.
 */
test("AppHeader defaults to forest, not chalk -- white is now an opt-out, never the silent default", () => {
  const header = code(`${MOBILE}/src/components/app-header.tsx`)
  assert.match(header, /tone = "forest"/, "forest is the default tone a screen inherits by doing nothing")
  assert.match(header, /StatusBar style=\{onForestGround \? "light" : "dark"\}/, "the status bar joins the header's own ground")
})

test("OvalballDetailHeader exists as the shared detail/flow chrome, forest by default, alongside AppHeader in the same primitive module", () => {
  const header = code(`${MOBILE}/src/components/app-header.tsx`)
  assert.match(header, /export function OvalballDetailHeader/)
  assert.match(header, /tone = "forest"/g)
})

/*
 * MATCH CENTRE CONSOLIDATION (owner brief, 2026-10-03). Fixture Detail and Edit Fixture were folded
 * into the one Match Centre: the overview is the read view, editing is a sheet inside it, and the real
 * decisions (cancel, answering a proposed kick-off) sit where the match is. The pins below carry the
 * same invariants the split used to carry, onto the surface that now holds them.
 */
const MC = `${MOBILE}/src/fixtures/match-centre`

test("the Match Centre's read view edits no field directly: its only writes are the real decisions", () => {
  const screen = code(`${MC}/index.tsx`)
  const overview = code(`${MC}/overview-section.tsx`)
  for (const source of [screen, overview]) {
    assert.doesNotMatch(source, /updateKickoff|updateMeetTime|updateVenue|updatePitch|updateDetails\(/, "the read view edits a field directly")
  }
  assert.match(screen, /cancelFixture\(/, "Cancel Fixture is still a legitimate action here")
  assert.match(screen, /rejectKickoffChange\(/, "responding to a proposed change is still a legitimate action here")
})

test("editing is offered, and the editor drawn, only where the server says this viewer may edit", () => {
  const screen = code(`${MC}/index.tsx`)
  assert.match(screen, /const canEdit = Boolean\(view\?\.canManageFixture && authority\?\.edit\)/)
  assert.match(screen, /\{canEdit && editing === "details" && view && <MatchDetailsEditor/)
  assert.match(screen, /\{canEdit && editing === "arrangements" && view && <ArrangementsEditor/)
})

test("the details editor saves through the canonical writers -- all of them, in one call -- and never before Save Changes is pressed", () => {
  const edit = code(`${MC}/details-editor.tsx`)
  // ONE SAVE, ONE NOTICE (20270734, integration audit). The four governed writers -- details, kick-off, meet
  // time, facilities -- each tell the people their change affects, so calling them one after another from the
  // client sent a family three notices about one decision, and a failure half-way left half a save behind.
  // `save_match_details` runs the SAME four writers, in the same order, in one transaction, and tells each
  // person once. The editor calls it once and never calls a writer beside it.
  assert.equal((edit.match(/\bsaveMatchDetails\(/g) ?? []).length, 1, "one Save is one call")
  for (const fn of ["updateDetails", "updateKickoff", "updateMeetTime", "setFixtureFacilities"]) {
    assert.doesNotMatch(edit, new RegExp(`\\b${fn}\\(`), `${fn} is called beside the one Save -- that change would be announced twice`)
  }
  assert.match(code(`${MOBILE}/src/agenda/mutations.ts`), /rpc\("save_match_details"/, "the one Save is the server's composite writer")
  const composite = readFileSync("supabase/migrations/20270734000000_one_save_one_notice.sql", "utf8")
  for (const writer of ["update_fixture_details", "update_fixture_kickoff", "update_fixture_meet_time", "set_fixture_facilities"]) {
    assert.match(composite, new RegExp(`public\\.${writer}\\(p_fixture_id`), `save_match_details no longer runs the governed writer ${writer}`)
  }
  // 20270728: the ground is the HOST's. Venue and pitch go through the one host-aware facilities write
  // (it carries both), never the older home-only venue write or a second, separate pitch write.
  assert.doesNotMatch(edit, /\bupdatePitch\(|\bupdateVenue\(/, "the ground and pitch have one write, the host-aware facilities RPC")
  assert.match(edit, /from "@ovalball\/contracts\/match-centre\/facilities"/, "the facilities write comes from the shared contract")
  assert.match(edit, /from "\.\.\/\.\.\/agenda\/mutations"/, "mutations come from the one canonical module, never a second copy")
  // Nothing runs until the button itself is pressed.
  assert.match(edit, /onPress=\{\(\) => void save\(\)\}/)
  assert.doesNotMatch(edit, /useEffect\([^)]*save\(/, "no effect fires a save automatically")
})

test("the fixture console, Fixture Detail and Edit Fixture are genuinely retired, not just unrouted", () => {
  const route = readFileSync(`${MOBILE}/app/(tabs)/fixtures/[fixtureId]/index.tsx`, "utf8")
  assert.doesNotMatch(route, /fixture-console|FixtureDetailScreen|EditFixtureScreen/)
  assert.match(route, /export default MatchCentre/)
})

test("a detail screen's back and title are the one shared header, never a hand-copied white bar", () => {
  // CLAUDE.md: detail and flow screens use `OvalballDetailHeader` (forest by default), never bespoke white top
  // chrome without a documented reason. These drew their own chevron on a white bar until the integration audit.
  for (const screen of [
    "club/teams/index.tsx", "club/requests.tsx", "support.tsx", "profile/index.tsx", "family/index.tsx", "family/[playerId].tsx",
    "messages/new.tsx", "messages/participants.tsx", "messages/documents.tsx",
    "clubhouse/partnerships.tsx", "clubhouse/refer.tsx", "clubhouse/opportunities.tsx",
  ]) {
    const src = code(`${MOBILE}/app/(tabs)/${screen}`)
    // A flow screen may take the header through `FlowScreen` (People & Invitations), which renders the same
    // `OvalballDetailHeader` and nothing else above the page: the chrome is still the one shared header.
    const viaFlowScreen = /<FlowScreen\b/.test(src) && /<OvalballDetailHeader title=\{title\} onBack=\{back\} \/>/.test(code(`${MOBILE}/src/people/ui.tsx`))
    assert.ok(/<OvalballDetailHeader\b/.test(src) || viaFlowScreen, `${screen} has no shared header`)
    assert.doesNotMatch(src, /rotate: "180deg"/, `${screen} draws its own back chevron again`)
    assert.doesNotMatch(src, /tone="chalk"/, `${screen} opted out of forest without a documented reason`)
  }
})

test("the team workspace and the Admin Centre share one bar: forest, with the bottom navigation's height reserved", () => {
  // `AdminScreen` made its forest bar "deliberately app-wide ... rather than a light bar on some screens and a
  // dark one on others"; `TeamScreen` -- the same crest-and-section bar for a team's inner screens -- stayed light,
  // and padded its list by the safe area alone, the bug AdminScreen records hiding a screen's last row.
  for (const shell of ["src/admin/screen.tsx", "src/team/screen.tsx"]) {
    const src = code(`${MOBILE}/${shell}`)
    assert.match(src, /backgroundColor: colour\.forest950/, `${shell} is not on the forest bar`)
    assert.match(src, /<StatusBar style="light" \/>/, `${shell} leaves the status bar to whatever came before`)
    assert.match(src, /paddingBottom: tabBarHeight\(insets\.bottom\)/, `${shell} lets the bottom navigation cover its last row`)
  }
})
