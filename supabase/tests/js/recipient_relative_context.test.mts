import assert from "node:assert/strict"
import { test } from "node:test"

import {
  resolveRecipientPlayerContext,
  resolveScalarPlayerVariable,
} from "@/lib/email/audience/recipient-relative-context"

/**
 * "IF ONE RECIPIENT RELATES TO MULTIPLE PLAYERS... DO NOT ARBITRARILY CHOOSE
 * THE FIRST PLAYER." -- the exact rule these tests pin.
 */

test("a recipient with exactly one related player resolves to that player", () => {
  const context = resolveRecipientPlayerContext([{ playerId: "player-1", relationship: "guardian" }])
  assert.deepEqual(context, { kind: "single", playerId: "player-1", relationship: "guardian" })
})

test("a recipient with no related player rows resolves to none", () => {
  assert.deepEqual(resolveRecipientPlayerContext([]), { kind: "none" })
})

test("a guardian of multiple relevant players resolves to ambiguous, never the first one", () => {
  const context = resolveRecipientPlayerContext([
    { playerId: "player-1", relationship: "guardian" },
    { playerId: "player-2", relationship: "guardian" },
  ])
  assert.equal(context.kind, "ambiguous")
  if (context.kind === "ambiguous") {
    assert.deepEqual(new Set(context.playerIds), new Set(["player-1", "player-2"]))
  }
})

test("the same player appearing twice (e.g. reachable through two component teams) is not ambiguous", () => {
  const context = resolveRecipientPlayerContext([
    { playerId: "player-1", relationship: "guardian" },
    { playerId: "player-1", relationship: "guardian" },
  ])
  assert.deepEqual(context, { kind: "single", playerId: "player-1", relationship: "guardian" })
})

test("a scalar player variable resolves only for a single context", () => {
  const single = resolveRecipientPlayerContext([{ playerId: "player-1", relationship: "self" }])
  assert.equal(resolveScalarPlayerVariable(single, (id) => `resolved:${id}`), "resolved:player-1")
})

test("a scalar player variable is null (unavailable), never a guess, for ambiguous or absent context", () => {
  const ambiguous = resolveRecipientPlayerContext([
    { playerId: "player-1", relationship: "guardian" },
    { playerId: "player-2", relationship: "guardian" },
  ])
  const none = resolveRecipientPlayerContext([])
  const resolve = (id: string) => `resolved:${id}`
  assert.equal(resolveScalarPlayerVariable(ambiguous, resolve), null)
  assert.equal(resolveScalarPlayerVariable(none, resolve), null)
})
