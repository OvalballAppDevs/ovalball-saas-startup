import { test } from "node:test"
import assert from "node:assert/strict"

import { filledRouteName, pathBeneath } from "./route-path"

/**
 * THE SEASON PLANNER FORGOT THE ADMIN CENTRE (2026-10-07). Admin Centre → Season Planner → a Club Day → Back → Back
 * landed on Fixtures: the club day's Back popped to the planner and then RE-NAVIGATED to "/fixtures/planner", building
 * a fresh planner without its own way home. Back must recognise that the screen beneath already is the place to return
 * to, and simply pop.
 */

test("a route name is filled from its params; index and groups add nothing", () => {
  assert.equal(filledRouteName("planner/club-day/[groupId]", { groupId: "g1" }), "planner/club-day/g1")
  assert.equal(filledRouteName("planner/index", {}), "planner")
  assert.equal(filledRouteName("index", undefined), "")
  assert.equal(filledRouteName("(tabs)/fixtures/[fixtureId]", { fixtureId: "f9" }), "fixtures/f9")
  assert.equal(filledRouteName("[groupId]", {}), null)
})

test("the screen beneath a club day is the Season Planner itself", () => {
  const below = pathBeneath("/fixtures/planner/club-day/g1", { name: "planner/club-day/[groupId]", params: { groupId: "g1", returnTo: "/fixtures/planner" } }, { name: "planner/index", params: { returnTo: "/admin" } })
  assert.equal(below, "/fixtures/planner")
})

test("the screen beneath a request opened from Fixtures is the Fixtures list", () => {
  assert.equal(pathBeneath("/fixtures/request/g2", { name: "request/[groupId]", params: { groupId: "g2" } }, { name: "index" }), "/fixtures")
})

test("a stack root has no base to be confused with another tab", () => {
  assert.equal(pathBeneath("/fixtures", { name: "index" }, { name: "index" }), "/fixtures")
})

test("when the path cannot be explained by the route, nothing is guessed", () => {
  assert.equal(pathBeneath("/somewhere/else", { name: "planner/index" }, { name: "index" }), null)
  assert.equal(pathBeneath("/fixtures/planner/club-day/g1", { name: "planner/club-day/[groupId]", params: {} }, { name: "planner/index" }), null)
})
