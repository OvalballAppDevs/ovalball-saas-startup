import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { resolveClubTheme } from "@/lib/club-theme/theme"

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

test("the club hero states the workspace without printing it", () => {
  // Product correction during UX-3 review: the printed "CLUB" sat between the greeting and the club's
  // own name, above a club crest and a club role, and weakened the hierarchy it existed to explain.
  // Only the DRAWING is suppressed -- the word is still in the heading's accessible name.
  assert.match(DESK, /showWorkspace=\{false\}/, "the club hero prints the workspace word again")
  assert.match(DESK, /workspace=\{workspace\}/, "the club hero stopped passing the workspace at all")
})

test("UX-1 and UX-2 are still standing", () => {
  assert.match(DESK, /<PageIdentity/, "the club header stopped using the page-identity primitive")
  assert.equal((DESK.match(/<h1[\s>]/g) ?? []).length, 0, "the desk hand-rolled a heading again")
  assert.match(PAGE, /workspaceLabel\(dashboardContext\.kind\)/)
})

test("the family panel is still gated by the context, not by the redesign", () => {
  assert.match(PAGE, /isFamilyFacingContext\(dashboardContext\.kind\) && \(/)
})


// ---------------------------------------------------------------------------------------------
// THE CLUB STILL LOOKS LIKE ITSELF
//
// "Operational first" is not "generic". The hierarchy changed; the branding must not have, and the
// way to guarantee that is not to pin a colour -- it is to pin the DERIVATION, so a club with a
// different kit gets a different page and a club with none still gets a readable one.
// ---------------------------------------------------------------------------------------------

test("the club landing consumes the canonical theme scope and resolves nothing itself", () => {
  assert.match(PAGE, /<ClubThemeScope theme=\{desk\.club\.theme\}/, "the desk stopped being wrapped in the club's theme")
  for (const [file, src] of [["dashboard/page.tsx", PAGE], ["club-desk.tsx", DESK]] as const) {
    assert.ok(!/resolveClubTheme|clubThemeVariables/.test(src), `${file} resolves a theme of its own`)
    // A hex anywhere in these files would be a colour decided outside the engine.
    assert.ok(!/#[0-9a-fA-F]{6}\b/.test(src), `${file} hard-codes a colour`)
  }
})

test("the hero paints from the kit-derived variables, not from a palette of its own", () => {
  const header = DESK.slice(DESK.indexOf("export function ClubDeskHeader"), DESK.indexOf("export function NextMatchCard"))
  assert.match(header, /bg-\(--club-hero\)/, "the hero stopped using the club's own background")
  assert.match(header, /text-\(--club-hero-fg\)/, "the hero stopped using the club's own foreground")
  assert.match(header, /<KitField/, "the kit graphic left the hero")
  // Generic surfaces would override the club whatever the variables said.
  assert.ok(!/bg-(white|forest-\d+|ink|chalk)\b/.test(header), "a generic background was painted over the club's")
})

test("two different home kits produce two different themes", () => {
  const a = resolveClubTheme({ pattern: "HOOPS", primaryColour: "#7f1d1d", secondaryColour: "#fde68a" })
  const b = resolveClubTheme({ pattern: "VERTICAL_STRIPES", primaryColour: "#1e3a8a", secondaryColour: "#ffffff" })
  assert.notEqual(a.hero.background, b.hero.background, "two clubs in different kits share a hero colour")
  assert.notEqual(a.pattern, b.pattern)
  assert.equal(a.source, "home-kit")
  assert.equal(b.source, "home-kit")
})

test("a club with no usable kit still gets a safe, readable page", () => {
  const none = resolveClubTheme(null)
  assert.equal(none.source, "ovalball-default", "a club with no kit claims to be themed from one")
  assert.ok(none.hero.background && none.hero.foreground, "the fallback leaves the hero unpainted")
  // The engine's own promise: text on a branded band stays legible whatever the band is -- including
  // the hard case of a club whose kit is white.
  const white = resolveClubTheme({ pattern: "SOLID", primaryColour: "#ffffff" })
  assert.notEqual(white.hero.foreground, white.hero.background, "foreground and background resolved to the same colour")
  assert.equal(white.source, "home-kit", "a white kit was discarded rather than made readable")
})

test("club colour is identity, and never the carrier of urgency", () => {
  // UX-3 established that urgency is structural and textual. A club in red must not make an ordinary
  // notice look urgent, and a club in green must not make an urgent one look ordinary.
  assert.match(DESK, /<AnnouncementItem/, "the notice component left the desk")
  const rail = DESK.slice(DESK.indexOf("export function ClubRail"))
  assert.ok(!/urgent/i.test(rail.slice(0, rail.indexOf("Rugby Hub"))), "the rail decides urgency for itself")
})
