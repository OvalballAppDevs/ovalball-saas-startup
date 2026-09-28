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

test("Fixture Detail is genuinely read-only: it renders no mutation call of its own except cancel and rejecting a proposed kick-off, both real decisions rather than field edits", () => {
  const detail = code(`${MOBILE}/src/fixtures/fixture-detail-screen.tsx`)
  assert.doesNotMatch(detail, /updateKickoff|updateMeetTime|updateVenue|updatePitch|updateDetails\(/, "Fixture Detail edits a field directly")
  assert.match(detail, /cancelFixture\(/, "Cancel Fixture is still a legitimate action here")
  assert.match(detail, /rejectKickoffChange\(/, "responding to a proposed change is still a legitimate action here")
})

test("Fixture Detail offers Match Centre and Edit Fixture through the one canonical routing table, Edit Fixture only where fixture.fixture.edit is held", () => {
  const detail = code(`${MOBILE}/src/fixtures/fixture-detail-screen.tsx`)
  assert.match(detail, /routeForIntent\(\{ kind: "MATCH_CENTRE"/)
  assert.match(detail, /authority\?\.edit && \(/)
  assert.match(detail, /routeForIntent\(\{ kind: "EDIT_FIXTURE"/)
})

test("Edit Fixture reuses the exact canonical mutations, never invents a new one, and never mutates before Save Changes is pressed", () => {
  const edit = code(`${MOBILE}/src/fixtures/edit-fixture-screen.tsx`)
  for (const fn of ["updateDetails", "updateKickoff", "updateMeetTime", "updateVenue"]) {
    assert.match(edit, new RegExp(`${fn}\\(`), `${fn} is not called`)
  }
  // A pitch-only change goes through updateVenue too (it carries the pitch in the same write) -- never
  // a second, separate updatePitch call racing it.
  assert.doesNotMatch(edit, /\bupdatePitch\(/, "updatePitch would be a second write for the same fact updateVenue already carries")
  assert.match(edit, /from "\.\.\/agenda\/mutations"/, "mutations come from the one canonical module, never a second copy")
  // Nothing runs until the button itself is pressed.
  assert.match(edit, /onPress=\{\(\) => void save\(\)\}/)
  assert.doesNotMatch(edit, /useEffect\([^)]*save\(/, "no effect fires a save automatically")
})

test("the fixture-console module is genuinely retired, not just unrouted", () => {
  const files = readFileSync(`${MOBILE}/app/(tabs)/fixtures/[fixtureId]/index.tsx`, "utf8")
  assert.doesNotMatch(files, /fixture-console/)
  assert.match(files, /FixtureDetailScreen/)
})
