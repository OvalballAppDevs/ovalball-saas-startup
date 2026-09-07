import { test } from "node:test"
import assert from "node:assert/strict"

import { listSwitchableContexts, isFamilyFacingContext } from "@/lib/app-context/active-context-rules"
import { resolveFamilyScope } from "@/lib/parent/family-agenda"
import type { SessionContext } from "@/lib/app-context/session-context"
import type { SwitchableContext } from "@/lib/app-context/active-context-rules"

/**
 * All Children mode decides which players a whole page is about, so the
 * question these tests ask is the safeguarding one: can anything a browser
 * sends widen that set?
 *
 * It cannot, by construction -- resolveFamilyScope reads only
 * ctx.guardianRelationships and ctx.linkedPlayerTeams, both server-derived.
 * These tests pin that, because the tempting "optimisation" is to trust the
 * ids already sitting on the context object, and a context key is the one
 * thing a viewer can edit (it is a cookie).
 */

function guardianOfTwo(): SessionContext {
  return {
    firstName: "Callum",
    isSiteAdmin: false,
    clubMemberships: [],
    teamPermissions: [],
    hasGuardianRelationship: true,
    guardianRelationships: [
      {
        playerId: "player-pippa",
        playerFirstName: "Pippa",
        playerSurname: "Testfamily",
        ageState: "under16",
        avatarStoragePath: null,
        teamId: "team-u9",
        teamDisplayName: "U9",
        clubId: "club-1",
        clubName: "Burnley RUFC",
      },
      {
        playerId: "player-jaxon",
        playerFirstName: "Jaxon",
        playerSurname: "Testfamily",
        ageState: "under16",
        avatarStoragePath: null,
        teamId: "team-u12",
        teamDisplayName: "U12",
        clubId: "club-1",
        clubName: "Burnley RUFC",
      },
    ],
    linkedPlayerTeams: [],
  } as unknown as SessionContext
}

const familyContext = (): SwitchableContext => listSwitchableContexts(guardianOfTwo()).find((c) => c.kind === "family")!

test("All Children only appears when there is more than one child", () => {
  const one = guardianOfTwo()
  one.guardianRelationships = [one.guardianRelationships[0]]
  assert.equal(listSwitchableContexts(one).some((c) => c.kind === "family"), false, "a single-child guardian was offered All Children")
  assert.equal(listSwitchableContexts(guardianOfTwo()).some((c) => c.kind === "family"), true)
})

test("All Children covers exactly the guardian's own children", () => {
  const scope = resolveFamilyScope(guardianOfTwo(), familyContext())
  assert.deepEqual(scope.map((c) => c.playerId).sort(), ["player-jaxon", "player-pippa"])
})

test("a forged player_id cannot widen All Children", () => {
  // The context key is a cookie, so this is the shape of the real attack.
  const forged = { ...familyContext(), playerIds: ["player-pippa", "player-jaxon", "someone-elses-child"] }
  const scope = resolveFamilyScope(guardianOfTwo(), forged)
  assert.equal(scope.length, 2, "a tampered playerIds list changed the scope")
  assert.ok(!scope.some((c) => c.playerId === "someone-elses-child"), "a forged player id entered the family scope")
})

test("a forged team_id resolves to no child at all", () => {
  const forged: SwitchableContext = { ...familyContext(), kind: "parent", id: "team-that-isnt-mine", playerId: "player-pippa" }
  assert.deepEqual(resolveFamilyScope(guardianOfTwo(), forged), [], "a forged team id produced a child")
})

test("selecting one child never pulls in a sibling", () => {
  const ctx = guardianOfTwo()
  const pippa = listSwitchableContexts(ctx).find((c) => c.playerId === "player-pippa")!
  const scope = resolveFamilyScope(ctx, pippa)
  assert.deepEqual(scope.map((c) => c.playerId), ["player-pippa"])
})

test("a child on two teams keeps those teams as separate contexts", () => {
  // Selecting the U9 context must not silently include the U12 fixtures of
  // the same child -- access to one team never implies access to another.
  const ctx = guardianOfTwo()
  ctx.guardianRelationships.push({
    ...ctx.guardianRelationships[0],
    teamId: "team-u10",
    teamDisplayName: "U10",
  })
  const u9 = listSwitchableContexts(ctx).find((c) => c.playerId === "player-pippa" && c.id === "team-u9")!
  const scope = resolveFamilyScope(ctx, u9)
  assert.equal(scope.length, 1)
  assert.equal(scope[0].teamId, "team-u9")
})

test("a club or team context yields no family scope at all", () => {
  for (const kind of ["club", "team", "site_admin"] as const) {
    const ctx: SwitchableContext = { key: "x", kind, id: "club-1", playerId: null, label: "X", switcherLabel: "X", roleLabel: "R", logoUrl: null, clubId: "club-1" }
    assert.deepEqual(resolveFamilyScope(guardianOfTwo(), ctx), [], `${kind} produced a family scope`)
  }
})

test("the family-facing predicate covers every read-only family context", () => {
  // This predicate gates the Calendar's cancelled-fixture rule, the training
  // scheduler, the fixture register's redirect and the dashboard. A kind
  // missing here silently hands All Children an admin affordance.
  assert.equal(isFamilyFacingContext("parent"), true)
  assert.equal(isFamilyFacingContext("player"), true)
  assert.equal(isFamilyFacingContext("family"), true)
  assert.equal(isFamilyFacingContext("club"), false)
  assert.equal(isFamilyFacingContext("team"), false)
  assert.equal(isFamilyFacingContext("site_admin"), false)
})
