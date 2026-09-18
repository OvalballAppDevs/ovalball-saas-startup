import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/**
 * UX-3 CLUB LANDING HIERARCHY -- the structural half.
 *
 * `67-club-desk-hierarchy.mjs` reads the rendered page back in DOM order and is where the ordering is
 * actually proven. These are the rules that hold when nobody is looking: that the page does not decide
 * authority for itself, that empty sections collapse, and that the next match cannot quietly move back
 * inside the header it was taken out of.
 */

const read = (p: string) => readFileSync(p, "utf8")
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")

const PAGE = code("app/(app)/dashboard/page.tsx")
const DESK = code("components/club-home/club-desk.tsx")

test("the next match is a section in the page, not a child of the branded header", () => {
  const header = DESK.slice(DESK.indexOf("export function ClubDeskHeader"), DESK.indexOf("export function NextMatchCard"))
  assert.ok(!/nextMatch/.test(header), "the header took the next match back")
  assert.match(DESK, /export function NextMatchCard/)
  // Floating it beside the club's name is what produced both the apparent overlap on a phone and the
  // clipped club name, because the two shared one row with a width cap on the name.
  assert.ok(!/sm:ml-auto/.test(DESK), "the next match is floated inside a flex row again")
  assert.ok(!/sm:max-w-\[62%\]/.test(DESK), "the club name is width-capped to share a row again")
})

test("attention precedes the schedule in the page source", () => {
  const work = PAGE.slice(PAGE.indexOf("const work = ("), PAGE.indexOf("if (desk) {"))
  const at = (needle: string) => work.indexOf(needle)
  assert.ok(at("<PinnedNotices") >= 0)
  assert.ok(at("<PinnedNotices") < at("Requests"), "urgent notices no longer lead")
  assert.ok(at("Requests") < at("This Week"), "requests fell below the schedule")
  assert.ok(at("<NextMatchCard") < at("This Week"), "what is next fell below the rest of the week")
})

test("empty club information collapses instead of announcing itself", () => {
  assert.match(DESK, /\{notices\.length > 0 && \(\s*<RailSection id="desk-notices"/,
    "an empty notices section still renders a card saying there are no notices")
  assert.match(DESK, /\{\(news\.length > 0 \|\| manageHref\) && \(/,
    "an empty news section renders for people who cannot act on it")
})

test("the news section survives an empty club only for somebody who can publish", () => {
  // Hiding it outright would hide the only door to publishing the first story, so the condition is the
  // authority to manage news -- which is resolved server-side, not from a role name.
  assert.match(DESK, /news\.length > 0 \|\| manageHref/)
})

test("the page does not authorize anything by role name", () => {
  for (const [file, src] of [["dashboard/page.tsx", PAGE], ["club-desk.tsx", DESK]] as const) {
    for (const roleString of ['"CLUB_ADMIN"', '"COACH"', '"TEAM_MANAGER"', '"FIXTURE_SECRETARY"']) {
      assert.ok(!src.includes(roleString), `${file} branches on the role string ${roleString}`)
    }
  }
})

test("management actions still come from a capability, resolved on the server", () => {
  const loader = code("lib/club-public/club-desk.ts")
  assert.match(loader, /hasCapability\(supabase, "club\.news\.manage"/)
  assert.match(loader, /hasCapability\(supabase, "team\.news\.manage"/)
  // The component is handed a destination or null; it never asks who the viewer is.
  assert.ok(!/hasCapability|clubMemberships|isSiteAdmin/.test(DESK), "the desk component resolves authority itself")
})

test("UX-1 and UX-2 are still standing", () => {
  assert.match(DESK, /<PageIdentity/, "the club header stopped using the page-identity primitive")
  assert.equal((DESK.match(/<h1[\s>]/g) ?? []).length, 0, "the desk hand-rolled a heading again")
  assert.match(PAGE, /workspaceLabel\(dashboardContext\.kind\)/)
})

test("the family panel is still gated by the context, not by the redesign", () => {
  assert.match(PAGE, /isFamilyFacingContext\(dashboardContext\.kind\) && \(/)
})
