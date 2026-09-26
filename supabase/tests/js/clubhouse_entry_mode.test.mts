import { test } from "node:test"
import assert from "node:assert/strict"

import { resolveInitialMode } from "../../../apps/mobile/src/clubhouse/entry-mode"

/**
 * PHYSICAL-DEVICE CORRECTION: a real bug where Clubhouse Home's "Explore the Map" landed in List mode
 * on a physical iPhone, indistinguishable from "Find a Club" -- traced to the map screen's own `mode`
 * state being forced to "list" whenever `Constants.appOwnership === "expo"`, with no way back to Map.
 * `resolveInitialMode` is the one function that now decides the entry mode, and it takes only the
 * route param Home actually sends -- never the runtime environment -- so this is pinned directly
 * rather than left to be re-broken by a future "helpful" environment check.
 */
test("Explore the Map (no mode param) opens Map -- the discovery-led entry", () => {
  assert.equal(resolveInitialMode({}), "map")
})

test("Explore the Map with an unrelated/undefined mode param still opens Map", () => {
  assert.equal(resolveInitialMode({ mode: undefined }), "map")
})

test("Find a Club (mode=search) opens List -- the intent-led entry", () => {
  assert.equal(resolveInitialMode({ mode: "search" }), "list")
})

test("an unrecognised mode value is never trusted as search-led", () => {
  assert.equal(resolveInitialMode({ mode: "explore" }), "map")
  assert.equal(resolveInitialMode({ mode: "" }), "map")
})
