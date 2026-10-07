import { test } from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { fileURLToPath } from "node:url"

import { TAB_BAR_CONTENT_HEIGHT, tabBarHeight } from "./tab-bar-height"

/**
 * NOTHING SITS UNDER THE BOTTOM NAVIGATION.
 *
 * The bar is drawn over the screen, so a scrolling screen has to reserve its height. Reserving the
 * safe-area inset alone -- the home indicator -- comes up a whole bar short, and the symptom is that
 * the LAST thing on the screen is the thing nobody can see. On Tournaments that last thing was
 * "Create New Tournament": the screen's primary action, completely covered and impossible to tap.
 *
 * A rendering test cannot catch this (the view renders perfectly; it is simply underneath something
 * else), so this asserts the structure instead: one authority for the height, and the screens that
 * sit inside the tab navigator actually using it.
 */

const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), "utf8")

test("the bar's height is its content plus the home indicator", () => {
  assert.equal(tabBarHeight(0), TAB_BAR_CONTENT_HEIGHT)
  assert.equal(tabBarHeight(34), TAB_BAR_CONTENT_HEIGHT + 34)
})

test("the bar itself is drawn at the height this module states", () => {
  const layout = read("../../app/(tabs)/_layout.tsx")
  assert.match(layout, /height: tabBarHeight\(insets\.bottom\)/)
  // A literal would be a second copy of the number, free to drift from the padding that clears it.
  assert.ok(!/height: 58 \+ insets\.bottom/.test(layout), "the bar must not restate its own height")
})

test("every screen that scrolls under the bar reserves the bar, not just the home indicator", () => {
  const screens = [
    "../admin/screen.tsx",
    "../tournaments/teams-tab.tsx",
    "../tournaments/requests-tab.tsx",
    "../../app/(tabs)/admin/tournaments/[tournamentId].tsx",
  ]
  for (const path of screens) {
    const src = read(path)
    assert.match(src, /navigation\/(use-)?tab-bar-height/, `${path} must take the height from the one authority`)
    assert.ok(
      !/paddingBottom: insets\.bottom \+/.test(src),
      `${path} pads by the home indicator alone, which leaves its last row under the navigation`
    )
  }
})
