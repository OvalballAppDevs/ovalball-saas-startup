import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

import { projectTabs, ALL_TABS } from "../../../apps/mobile/src/context/tab-projection"

/**
 * WHICH FIVE DESTINATIONS EACH CONTEXT GETS.
 *
 * The bottom bar holds five cells before labels stop being readable, and Ovalball has more than five
 * jobs -- so the projection is a product decision, and a product decision that changes silently is one
 * nobody notices going wrong. It lives in a pure function precisely so it can be asserted here rather
 * than inspected in a screenshot.
 */

test("every context gets exactly five destinations", () => {
  for (const kind of ["site_admin", "club", "team", "parent", "player", "family", "governing", null] as const) {
    for (const canSeeTeamSubscriptions of [true, false]) {
      const tabs = projectTabs({ kind, canSeeTeamSubscriptions })
      assert.equal(tabs.length, 5, `${kind} with subs=${canSeeTeamSubscriptions} got ${tabs.length}`)
      assert.equal(new Set(tabs.map((t) => t.key)).size, 5, `${kind} repeated a destination`)
    }
  }
})

test("the four everyday destinations are in the same place for everybody", () => {
  // The owner's rule: switching context must not feel like opening a different app. Muscle memory for
  // Home, Fixtures, Calendar and Rugby Hub is worth more than a perfectly tailored bar.
  const expected = ["index", "fixtures", "calendar", "hub"]
  for (const kind of ["site_admin", "club", "team", "parent", "player", "family", "governing", null] as const) {
    const keys = projectTabs({ kind, canSeeTeamSubscriptions: false }).map((t) => t.key)
    assert.deepEqual(keys.slice(0, 4), expected, `${kind} reordered the everyday destinations`)
  }
})

test("Rugby Hub is a first-class destination, never buried under More", () => {
  for (const kind of ["team", "club", "parent", "family", "player", null] as const) {
    const keys = projectTabs({ kind, canSeeTeamSubscriptions: false }).map((t) => t.key)
    assert.ok(keys.includes("hub"), `${kind} lost Rugby Hub from the bar`)
  }
})

test("Subscriptions takes the fifth cell only where the SERVER says it may be opened", () => {
  // Not from the context kind. A coach standing in a team does not necessarily hold
  // finance.subscription.view, and giving them the cell would be a capability decided on a handset.
  const withCapability = projectTabs({ kind: "team", canSeeTeamSubscriptions: true }).map((t) => t.key)
  const without = projectTabs({ kind: "team", canSeeTeamSubscriptions: false }).map((t) => t.key)
  assert.ok(withCapability.includes("subscriptions"))
  assert.ok(!without.includes("subscriptions"))
  assert.ok(without.includes("more"), "without the capability the fifth cell is not More")
})

test("and holding the capability elsewhere does not put it in a club or family bar", () => {
  // The capability is asked at TEAM scope for the team being viewed; a club context is a different
  // question that this shell does not ask, so it must not act as though it had.
  for (const kind of ["club", "parent", "family", "player", "site_admin", "governing"] as const) {
    const keys = projectTabs({ kind, canSeeTeamSubscriptions: true }).map((t) => t.key)
    assert.ok(!keys.includes("subscriptions"), `${kind} was given the Subscriptions cell`)
  }
})

test("every projected destination is a route that exists", () => {
  for (const kind of ["team", "club", "parent", null] as const) {
    for (const canSee of [true, false]) {
      for (const tab of projectTabs({ kind, canSeeTeamSubscriptions: canSee })) {
        assert.ok(ALL_TABS.includes(tab.key), `${tab.key} is projected but is not a declared route`)
      }
    }
  }
})

test("the router declares every route, including the ones a bar may hide", () => {
  // A destination that is projected away must stay ADDRESSABLE -- `href: null` removes the cell, not
  // the route -- or a deep link to it breaks for exactly the people who cannot see the shortcut.
  const layout = readFileSync("apps/mobile/app/(tabs)/_layout.tsx", "utf8")
  for (const key of ALL_TABS) {
    assert.ok(new RegExp(`key: "${key}"`).test(layout), `${key} is not declared in the tab router`)
  }
  assert.match(layout, /href: shown\.has\(key\) \? undefined : null/, "a hidden tab removes its route rather than its cell")
})

test("the bar is drawn by Ovalball, with a label on every cell", () => {
  const layout = readFileSync("apps/mobile/app/(tabs)/_layout.tsx", "utf8")
  // The library's own label slot clipped the word on a bar this height, so the cell is drawn here.
  assert.match(layout, /tabBarShowLabel: false/)
  assert.match(layout, /<Text/, "the cell no longer draws its own label")
  // And the touch target is a number this file states, because 39pt was measured once already.
  assert.match(layout, /minHeight: 46/, "the tab cell lost its measured minimum height")
  assert.ok(!/emoji|⌂|◍|▤|▥|⋯/.test(layout), "an emoji or a placeholder glyph is back in the bar")
})
