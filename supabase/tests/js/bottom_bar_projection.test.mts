import { test } from "node:test"
import assert from "node:assert/strict"

import { buildBottomBarItems } from "@/lib/app-context/build-nav-items"
import { bottomBarLabel } from "@/lib/app-context/bottom-bar-label"
import type { ActiveContextKind } from "@/lib/app-context/active-context-rules"

/**
 * UX-4 -- THE MOBILE BOTTOM BAR IS A PROJECTION, NEVER A SOURCE.
 *
 * `87-shell-coherence.mjs` measures the rendered bar in a real browser. These are the rules that hold
 * when nobody is looking, and the ones a browser cannot reach: the contexts a UAT persona does not exist
 * for, and the invariant that matters most -- that the bar can only ever show destinations the
 * already-capability-filtered catalogue handed it.
 *
 * Every assertion here is about the CHOOSER, because that is where a bar could become a second
 * navigation source: a literal href typed into this module would appear on a phone whether or not
 * buildNavItems granted it, and no browser test of an authorised persona would notice.
 */

type Item = { href: string; label: string; badge?: number }

/** A plausible catalogue for each context, shaped like the real one in build-nav-items.ts. */
const CATALOGUE: Record<ActiveContextKind, Item[]> = {
  club: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/people", label: "Overview" },
    { href: "/teams", label: "Teams" },
    { href: "/fixtures/management", label: "Fixtures" },
    { href: "/calendar", label: "Calendar" },
    { href: "/messages", label: "Messages", badge: 3 },
    { href: "/club/settings", label: "Club Settings" },
  ],
  team: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/teams/team-1", label: "Under 12 Boys" },
    { href: "/calendar", label: "Calendar" },
    { href: "/fixtures/management", label: "Fixtures" },
    { href: "/messages", label: "Messages" },
  ],
  parent: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/agenda", label: "Fixtures" },
    { href: "/calendar", label: "Calendar" },
    { href: "/rugby-hub", label: "Rugby Hub" },
    { href: "/account", label: "Settings" },
    { href: "/player/payments", label: "Payments & Subscriptions" },
  ],
  player: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/agenda", label: "Fixtures" },
    { href: "/calendar", label: "Calendar" },
    { href: "/rugby-hub", label: "Rugby Hub" },
    { href: "/account", label: "Settings" },
  ],
  family: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/agenda", label: "Fixtures" },
    { href: "/calendar", label: "Calendar" },
    { href: "/rugby-hub", label: "Rugby Hub" },
    { href: "/account", label: "Settings" },
  ],
  site_admin: [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/admin/clubs", label: "Club Management" },
    { href: "/admin/users", label: "User Management" },
    { href: "/admin/fixtures", label: "Fixture Control Centre" },
    { href: "/admin/seasons", label: "Seasons" },
  ],
  governing: [
    { href: "/governing/b-1", label: "Overview" },
    { href: "/governing/b-1/clubs", label: "Clubs" },
    { href: "/governing/b-1/competitions", label: "Competitions" },
    { href: "/governing/b-1/people", label: "People & Access" },
    { href: "/rugby-hub", label: "Rugby Hub" },
    { href: "/account", label: "Settings" },
  ],
}

const KINDS = Object.keys(CATALOGUE) as ActiveContextKind[]

test("1. the bar is a projection: every cell came from the catalogue it was given", () => {
  for (const kind of KINDS) {
    const catalogue = CATALOGUE[kind]
    const bar = buildBottomBarItems(catalogue, kind, "team-1")
    for (const item of bar) {
      assert.ok(
        catalogue.some((c) => c.href === item.href),
        `${kind}: the bar offered ${item.href}, which buildNavItems did not grant`
      )
    }
    // Identity, not just equality: the bar must hand back the SAME objects, so a badge or a label the
    // shell decorated cannot be lost or reshaped on the way through.
    for (const item of bar) assert.ok(catalogue.includes(item), `${kind}: ${item.href} was reshaped`)
  }
})

test("2. an empty catalogue produces no bar at all -- a context is never given destinations to fill it", () => {
  for (const kind of KINDS) {
    assert.deepEqual(buildBottomBarItems([], kind, "team-1"), [], `${kind} invented a cell from nothing`)
  }
})

test("3. a catalogue of one still produces at most that one", () => {
  for (const kind of KINDS) {
    const only = [{ href: "/dashboard", label: "Dashboard" }]
    const bar = buildBottomBarItems(only, kind, "team-1")
    assert.ok(bar.length <= 1, `${kind} produced ${bar.length} cells from a catalogue of one`)
  }
})

test("4. never more than four, because the fifth cell is More", () => {
  for (const kind of KINDS) {
    const bar = buildBottomBarItems(CATALOGUE[kind], kind, "team-1")
    assert.ok(bar.length <= 4, `${kind} produced ${bar.length} cells, leaving no room for More`)
    assert.ok(bar.length >= 1, `${kind} produced an empty bar from a real catalogue`)
  }
})

test("5. no duplicate cells", () => {
  for (const kind of KINDS) {
    const hrefs = buildBottomBarItems(CATALOGUE[kind], kind, "team-1").map((i) => i.href)
    assert.equal(new Set(hrefs).size, hrefs.length, `${kind} repeated a destination`)
  }
})

test("6. a team's own page is on a team's bar -- the destination team staff actually came for", () => {
  const bar = buildBottomBarItems(CATALOGUE.team, "team", "team-1")
  assert.ok(
    bar.some((i) => i.href === "/teams/team-1"),
    `a team context's bar was ${bar.map((i) => i.href).join(", ")} and did not include the team itself`
  )
})

test("7. and a team context with no team id still produces a usable bar", () => {
  const bar = buildBottomBarItems(CATALOGUE.team, "team", null)
  assert.ok(bar.length >= 2, `fell back to ${bar.length} cell(s)`)
  for (const item of bar) assert.ok(CATALOGUE.team.includes(item))
})

test("8. the governing workspace does not spend a cell on a redirect", () => {
  // /dashboard sends a governing context straight to its own Overview (Step 15), so carrying both would
  // waste one of four slots. This context's catalogue has no /dashboard at all; the rule is asserted on a
  // catalogue that does.
  const withDashboard = [{ href: "/dashboard", label: "Dashboard" }, ...CATALOGUE.governing]
  const bar = buildBottomBarItems(withDashboard, "governing", null)
  assert.ok(!bar.some((i) => i.href === "/dashboard"), "a governing bar carried the dashboard redirect")
  assert.equal(bar[0].href, "/governing/b-1", "the governing bar should lead with its own Overview")
})

test("9. where Dashboard IS the landing page it stays first", () => {
  for (const kind of ["club", "team", "parent", "player", "family", "site_admin"] as ActiveContextKind[]) {
    const bar = buildBottomBarItems(CATALOGUE[kind], kind, "team-1")
    assert.equal(bar[0].href, "/dashboard", `${kind} buried the page people arrive on`)
  }
})

test("10. the selection is deterministic", () => {
  for (const kind of KINDS) {
    const a = buildBottomBarItems(CATALOGUE[kind], kind, "team-1").map((i) => i.href)
    const b = buildBottomBarItems(CATALOGUE[kind], kind, "team-1").map((i) => i.href)
    assert.deepEqual(a, b, `${kind} is not deterministic`)
  }
})

test("11. an unknown future context still gets a working bar", () => {
  // The fallback is what makes a new context work on a phone the day it is added rather than the day
  // somebody remembers to extend the map.
  const future = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/somewhere", label: "Somewhere" },
    { href: "/else", label: "Else" },
  ]
  const bar = buildBottomBarItems(future, "an-unmapped-kind" as ActiveContextKind, null)
  assert.ok(bar.length >= 1 && bar.length <= 4)
  for (const item of bar) assert.ok(future.includes(item))
})

test("12. bar labels only ever shorten a label, never invent a destination", () => {
  for (const kind of KINDS) {
    for (const item of buildBottomBarItems(CATALOGUE[kind], kind, "team-1")) {
      const label = bottomBarLabel(item)
      assert.ok(label.length > 0, `${item.href} lost its label`)
      // A label override is a presentation choice; it must never become the thing navigated to.
      assert.ok(!label.startsWith("/"), `${item.href}'s label looks like an href`)
    }
  }
})

test("12b. a team name arriving as the calendar label is still short on the bar", () => {
  // build-nav-items gives a VIEW-ONLY person with exactly one team their team's display name as the
  // calendar label -- in a sidebar that is more use than the word "Calendar". On a bar it is unbounded
  // club-entered data in a 64px cell, so the bar overrides it.
  const viewOnly: Item[] = [
    { href: "/dashboard", label: "Dashboard" },
    { href: "/calendar", label: "Under 14 Girls B" },
    { href: "/rugby-hub", label: "Rugby Hub" },
  ]
  const bar = buildBottomBarItems(viewOnly, "parent", null)
  const calendar = bar.find((i) => i.href === "/calendar")
  assert.ok(calendar, "the calendar fell off the bar")
  assert.equal(bottomBarLabel(calendar), "Calendar")
})

test("13. every bar label fits a 320px cell, with one documented exception", () => {
  // MEASURED, not estimated. At 320px a cell is 64px and the label box is the whole cell, because the
  // cell carries no horizontal padding; at 11px that is about 11 characters. The implementation pass
  // guessed 16, then 12, and the hardening pass measured three labels clipping in a real browser before
  // this number was written down.
  const BUDGET = 11

  // "Competitions" is 12 characters and needs exactly 70px. It is the product's own word for a first-class
  // destination of a governing body, and abbreviating it into jargon would be worse than the truncation.
  // MEASURED: it fits at 390px (78px box) and at 360px (72px), the two widths most phones use, and
  // truncates VISUALLY at 320px (64px) alone. The full word stays in the DOM there, so the link's
  // accessible name is complete and assistive technology reads it in full. The browser suite asserts each
  // of those claims separately, per width.
  const ACCEPTED = new Map([["Competitions", "the canonical word for a governing body's competitions; truncates visually at 320px only, accessible name intact"]])

  for (const kind of KINDS) {
    for (const item of buildBottomBarItems(CATALOGUE[kind], kind, "team-1")) {
      const label = bottomBarLabel(item)
      if (label.length <= BUDGET) continue
      assert.ok(
        ACCEPTED.has(label),
        `${kind}: "${label}" (${label.length} chars) exceeds the measured ${BUDGET}-character budget for a 320px cell and is not a documented exception`
      )
    }
  }
})

test("14. and the accepted exceptions are still needed -- the list may only shrink", () => {
  const used = new Set<string>()
  for (const kind of KINDS) {
    for (const item of buildBottomBarItems(CATALOGUE[kind], kind, "team-1")) {
      const label = bottomBarLabel(item)
      if (label.length > 11) used.add(label)
    }
  }
  assert.deepEqual([...used].sort(), ["Competitions"],
    "the set of over-budget labels changed; add it deliberately with a reason, or shorten it")
})
