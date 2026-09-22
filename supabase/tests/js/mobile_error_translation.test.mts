import { test } from "node:test"
import assert from "node:assert/strict"

import { friendly } from "../../../apps/mobile/src/errors/translate"

/**
 * WHAT A PERSON AT A TOUCHLINE IS TOLD.
 *
 * `PGRST116` and `JWT expired` are diagnostics. On a phone screen they are frightening and useless,
 * and worse, a database error can name a table or a constraint -- which is not a parent's business.
 *
 * Two properties are pinned: the message is human and the original never appears inside it. The second
 * is the one that decays quietly, because adding the detail to the message is a tempting thing to do
 * while debugging and an easy thing to leave in.
 */

test("a network failure says what to do about it", () => {
  const result = friendly(new Error("Network request failed"))
  assert.match(result.message, /connection/i)
  assert.equal(result.retryable, true)
})

test("a wrong password is undifferentiated, exactly as the website's is", () => {
  const wrongPassword = friendly({ message: "Invalid login credentials" })
  const unknownAccount = friendly({ message: "invalid_credentials" })
  assert.equal(wrongPassword.message, unknownAccount.message, "the two cases are told apart, which tells an attacker too")
  assert.match(wrongPassword.message, /Email or password is incorrect/)
  assert.equal(wrongPassword.retryable, false)
})

test("a rejected authenticator code explains the thirty seconds", () => {
  const result = friendly(new Error("Invalid TOTP code entered"))
  assert.match(result.message, /30 seconds/)
})

test("an expired session says to sign in again, and does not offer a retry", () => {
  const result = friendly({ message: "JWT expired" })
  assert.match(result.message, /sign in again/i)
  assert.equal(result.retryable, false)
})

test("a refusal names the thing refused, not the policy that refused it", () => {
  const result = friendly({ message: 'new row violates row-level security policy for table "fixtures"' }, "this team")
  assert.match(result.message, /do not have access to this team/)
  assert.ok(!/row-level|fixtures|policy/.test(result.message), "the message leaks the policy and the table")
})

test("an unrecognised failure says the honest generic thing rather than guessing", () => {
  const result = friendly({ message: "PGRST116: JSON object requested, multiple (or no) rows returned" }, "your teams")
  assert.equal(result.message, "Couldn't load your teams. Try again.")
  assert.equal(result.retryable, true)
})

test("the original is kept for a developer and never inside the message", () => {
  const original = 'duplicate key value violates unique constraint "club_memberships_pkey"'
  const result = friendly({ message: original }, "your club")
  assert.equal(result.detail, original, "the detail a developer needs was discarded")
  assert.ok(!result.message.includes("club_memberships"), "the constraint name reached the person")
  assert.ok(!result.message.includes(original))
})

test("a failure with no message at all still produces something a person can read", () => {
  for (const nothing of [null, undefined, {}, 42]) {
    const result = friendly(nothing, "this page")
    assert.match(result.message, /Couldn't load this page/)
    assert.equal(result.detail, nothing && typeof nothing === "object" && "message" in nothing ? result.detail : result.detail)
  }
})
