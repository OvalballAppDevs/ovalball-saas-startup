import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { workspaceLabel } from "@/lib/app-context/workspace-label"

/**
 * UX-1 PAGE IDENTITY.
 *
 * UX-0 observed the same `<h1>` -- a club's name -- served to a Club Admin, a player and a team
 * volunteer, so the page said which club and never which workspace or which page. These assertions
 * pin the invariant that fixed it, not the strings that express it: a page names its workspace AND
 * itself, exactly one heading does it, and the label is derived from the already-resolved context
 * rather than from anyone's role.
 */

const read = (p: string) => readFileSync(p, "utf8")

/**
 * Headings are counted in CODE, never in prose. These files explain themselves at length and those
 * explanations mention `<h1>` -- counting those as headings made the primitive look like it emitted
 * four, which is a measurement bug rather than a finding.
 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")
const headings = (src: string) => (src.match(/<h1[\s>]/g) ?? []).length
const PRIMITIVE = read("components/shell/page-identity.tsx")
const PRIMITIVE_CODE = code("components/shell/page-identity.tsx")

const SURFACES: [string, string][] = [
  ["Site Admin workspace", "app/(app)/dashboard/site-admin-dashboard.tsx"],
  ["Club Desk", "components/club-home/club-desk.tsx"],
  ["guardian / family / player dashboard", "app/(app)/dashboard/page.tsx"],
  ["nested operational page (People)", "app/(app)/people/page.tsx"],
  ["team-scoped page", "app/(app)/teams/[teamId]/page.tsx"],
]

test("UX-1: every workspace kind has a word, and it is never a role", () => {
  const kinds = ["site_admin", "club", "team", "parent", "player", "family"] as const
  for (const kind of kinds) {
    const label = workspaceLabel(kind)
    assert.ok(label && label.length > 0, `${kind} has no workspace label`)
  }
  // A role says what you may do; a workspace says where you are. Substituting one for the other is
  // precisely what UX-0 found, so the labels must not be role names.
  const roleNames = ["Club Admin", "Coach", "Team Manager", "Parent/Guardian", "Member", "Fixture Secretary"]
  for (const kind of kinds) {
    assert.ok(!roleNames.includes(workspaceLabel(kind)), `${kind} is labelled with a role name`)
  }
  // A parent is one child inside a family, so the two deliberately share a word; the heading beside
  // it is the child's name, which is what distinguishes them.
  assert.equal(workspaceLabel("parent"), workspaceLabel("family"))
  assert.equal(workspaceLabel("site_admin"), "Site Admin")
})

test("UX-1: the workspace is announced even where it is not printed", () => {
  // UX-3 stopped drawing the word on the club hero, where a crest, a club name and a club role already
  // said it three times. Hiding it visually must never hide it from assistive technology -- which is
  // exactly why the word was put inside the heading rather than left beside it.
  assert.match(PRIMITIVE, /showWorkspace \?\?|showWorkspace = true/, "the primitive cannot suppress the printed workspace")
  const heading = PRIMITIVE.slice(PRIMITIVE.indexOf("<h1"), PRIMITIVE.indexOf("</h1>"))
  assert.match(heading, /sr-only">\{workspace\}: <\/span>/, "the heading stopped carrying the workspace")
  // The suppression is a prop on the printed row only; the heading is outside that conditional.
  const printed = PRIMITIVE.slice(PRIMITIVE.indexOf("{showWorkspace &&"), PRIMITIVE.indexOf("<h1"))
  assert.ok(!/sr-only/.test(printed), "the accessible workspace was put inside the hideable row")
})

test("UX-1: the workspace reaches assistive technology through the heading, not beside it", () => {
  assert.match(PRIMITIVE, /aria-hidden="true"/, "the visible eyebrow must be hidden from AT")
  assert.match(
    PRIMITIVE,
    /<h1[\s\S]*?<span className="sr-only">\{workspace\}: <\/span>/,
    "the heading's accessible name must carry the workspace, so heading-by-heading navigation is not " +
      "left with a bare page name",
  )
})

test("UX-1: the eyebrow is not a heading, so the document outline is not inverted", () => {
  const eyebrowBlock = PRIMITIVE.slice(PRIMITIVE.indexOf('aria-hidden="true"'), PRIMITIVE.indexOf("<h1"))
  assert.ok(!/<h[1-6]/.test(eyebrowBlock), "the eyebrow must not be a heading element")
  assert.ok(!/role="heading"/.test(eyebrowBlock), "the eyebrow must not claim to be a heading")
})

test("UX-1: the primitive emits exactly one h1", () => {
  assert.equal(headings(PRIMITIVE_CODE), 1)
})

for (const [name, file] of SURFACES) {
  test(`UX-1: ${name} states its identity through the one primitive`, () => {
    const src = read(file)
    assert.match(src, /PageIdentity/, `${file} does not use the shared page-identity primitive`)
  })

  test(`UX-1: ${name} has no second page heading`, () => {
    // The primitive owns the h1. A surface that also hand-rolls one produces two page headings on the
    // same page, which is the defect this slice exists to remove -- not a new one to introduce.
    assert.equal(
      headings(code(file)),
      0,
      `${file} still emits its own <h1> alongside PageIdentity`,
    )
  })
}

test("UX-1: page identity is presentation -- it reads no authority of its own", () => {
  const label = read("lib/app-context/workspace-label.ts")
  for (const forbidden of ["supabase", "createClient", "can(", "hasCapability", "rpc(", "session"]) {
    assert.ok(
      !label.toLowerCase().includes(forbidden.toLowerCase()),
      `workspace-label.ts references "${forbidden}" -- a label must describe a resolved context, never resolve one`,
    )
  }
  for (const forbidden of ["supabase", "createClient", "rpc(", "auth."]) {
    assert.ok(
      !PRIMITIVE.includes(forbidden),
      `page-identity.tsx references "${forbidden}" -- the primitive must not reach for data or authority`,
    )
  }
})

test("UX-1: the workspace word comes from the resolved context, not from a literal", () => {
  // The dashboard serves six different workspaces from one route, so hard-coding a word there would
  // reintroduce exactly the "every persona sees the same thing" defect in a new place.
  const dash = read("app/(app)/dashboard/page.tsx")
  assert.match(dash, /workspaceLabel\(dashboardContext\.kind\)/)
  const deskCalls = dash.match(/<ClubDeskHeader[^/]*\/>/)
  assert.ok(deskCalls, "the club desk header call was not found")
  assert.match(deskCalls[0], /workspace=\{workspaceLabel\(dashboardContext\.kind\)\}/)
})
