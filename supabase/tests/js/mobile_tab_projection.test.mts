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
  // Home, Fixtures, Calendar and Messages is worth more than a perfectly tailored bar.
  //
  // MESSAGES REPLACED RUGBY HUB IN THE BAR AT M3, an owner decision: messaging is a daily operational
  // job and the Hub is something you go and read. The Hub's ROUTE is untouched -- see below.
  const expected = ["index", "fixtures", "calendar", "messages"]
  for (const kind of ["site_admin", "club", "team", "parent", "player", "family", "governing", null] as const) {
    const keys = projectTabs({ kind, canSeeTeamSubscriptions: false }).map((t) => t.key)
    assert.deepEqual(keys.slice(0, 4), expected, `${kind} reordered the everyday destinations`)
  }
})

test("Messages is a first-class destination for every context", () => {
  for (const kind of ["team", "club", "parent", "family", "player", null] as const) {
    const keys = projectTabs({ kind }).map((t) => t.key)
    assert.ok(keys.includes("messages"), `${kind} lost Messages from the bar`)
  }
})

test("and Rugby Hub keeps its route and a place in More", () => {
  // The shortcut moved; the destination did not. A route removed here is a deep link that stops
  // working, which is a different and worse thing than a cell that moved.
  assert.ok(ALL_TABS.includes("hub"), "the Rugby Hub route was removed rather than moved")
  assert.ok(ALL_TABS.includes("subscriptions"), "the Subscriptions route was removed rather than moved")
  const more = readFileSync("apps/mobile/app/(tabs)/more.tsx", "utf8")
  assert.match(more, /label="Rugby Hub"/, "Rugby Hub is not reachable from More")
  assert.match(more, /label="Subscriptions"/, "Subscriptions is not reachable from More")
  // The href carries no "(tabs)" group -- a group is invisible in a URL, and including it is what
  // produces "no route matched with those values" against a typed route table.
  assert.match(more, /router\.push\("\/hub"\)/, "More links Rugby Hub somewhere other than its own route")
  assert.ok(!/\/\(tabs\)\//.test(more), "a navigation target still carries the invisible group segment")
})

test("the bar's shape does not change when the context does", () => {
  // Subscriptions briefly took the fifth cell for a team manager holding the finance capability. A bar
  // that changes shape on a context switch costs more in confusion than a tailored cell saves in taps,
  // so the arrangement is now one arrangement -- and Subscriptions keeps its capability-aware
  // behaviour on its own screen, where the server still decides.
  const shapes = new Set<string>()
  for (const kind of ["team", "club", "parent", "family", "player", "site_admin", "governing", null] as const) {
    for (const canSeeTeamSubscriptions of [true, false]) {
      shapes.add(projectTabs({ kind, canSeeTeamSubscriptions }).map((t) => t.key).join(","))
    }
  }
  assert.equal(shapes.size, 1, `the bar takes ${shapes.size} shapes: ${[...shapes].join(" | ")}`)
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
