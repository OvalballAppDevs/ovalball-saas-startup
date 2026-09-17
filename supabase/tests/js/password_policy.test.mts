/**
 * PASSWORD POLICY (Identity/Auth Slice 6, Phase 2 L1 / E)
 *
 * The rule is: at least 12 characters, at most 72 BYTES, at least one capital, at least one special
 * character, and not a known-breached password.
 *
 * These assertions are about the composition rule only. The breach check talks to Have I Been Pwned, so
 * exercising it here would make the suite depend on the network and on somebody else's uptime; it is
 * covered structurally at the end instead.
 */

import assert from "node:assert/strict"
import test from "node:test"

import { checkPasswordComposition, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy"

const ok = (p: string) => checkPasswordComposition(p).ok
const why = (p: string) => {
  const r = checkPasswordComposition(p)
  return r.ok ? "(accepted)" : r.message
}

test("a password that meets every part of the rule is accepted", () => {
  // POSITIVE CONTROL. Everything below is a refusal, and a refusal proves nothing unless something
  // very close to it is accepted.
  assert.equal(ok("Correct-Horse-Battery"), true, why("Correct-Horse-Battery"))
  assert.equal(ok("Tuesday!Training12"), true, why("Tuesday!Training12"))
})

test("too short is refused, and the boundary is exactly 12", () => {
  assert.equal(ok("Short!1"), false)
  assert.equal(ok("Ab!" + "x".repeat(PASSWORD_MIN_LENGTH - 4)), false, "one short is still short")
  assert.equal(ok("Ab!" + "x".repeat(PASSWORD_MIN_LENGTH - 3)), true, "exactly the minimum is enough")
})

test("no capital letter is refused", () => {
  assert.equal(ok("no-capitals-here!"), false)
  assert.match(why("no-capitals-here!"), /capital/i)
})

test("no special character is refused", () => {
  assert.equal(ok("NoSpecialsHere123"), false)
  assert.match(why("NoSpecialsHere123"), /special/i)
})

test("a space does not count as the special character", () => {
  // A password made only of letters and spaces has no special character. Treating a space as one would
  // let "The Quick Brown Fox" through, which is a sentence, not a hardened password.
  assert.equal(ok("The Quick Brown Fox"), false)
})

test("an unusual special character still counts -- the rule is defined by what it is NOT", () => {
  // Defined as "printable, not a letter, not a digit", so somebody using a character the authors did
  // not think of is not told it does not count.
  assert.equal(ok("Passwordpassword£"), true, "a pound sign counts")
  assert.equal(ok("Passwordpassword—"), true, "an em dash counts")
  assert.equal(ok("Passwordpassword✓"), true, "a tick counts")
})

test("length is measured in BYTES, because bcrypt's limit is", () => {
  // 72 ASCII characters is exactly at the limit.
  const atLimit = "A!" + "a".repeat(PASSWORD_MAX_BYTES - 2)
  assert.equal(Buffer.byteLength(atLimit, "utf8"), PASSWORD_MAX_BYTES)
  assert.equal(ok(atLimit), true, why(atLimit))

  // One more byte is over.
  assert.equal(ok(atLimit + "a"), false)
  assert.match(why(atLimit + "a"), /too long/i)

  // And the case that measuring CHARACTERS would have got wrong. Each of these emoji is four BYTES,
  // so 20 of them is 80 bytes -- over the limit -- while JavaScript counts the string as far shorter.
  // A character count would accept it and bcrypt would silently truncate it, so the password the
  // person typed and the password actually protecting the account would differ.
  const emoji = "A!" + "\u{1F600}".repeat(20)
  assert.ok(emoji.length < PASSWORD_MAX_BYTES, `fewer than 72 by .length (was ${emoji.length})`)
  assert.ok(Buffer.byteLength(emoji, "utf8") > PASSWORD_MAX_BYTES, "but more than 72 BYTES")
  assert.equal(ok(emoji), false, "so it is refused rather than truncated")
})

test("empty and non-string input are refused rather than throwing", () => {
  assert.equal(ok(""), false)
  assert.equal(checkPasswordComposition(undefined as unknown as string).ok, false)
  assert.equal(checkPasswordComposition(null as unknown as string).ok, false)
})

test("the validator is server-only, so it cannot become browser-side advice", async () => {
  const source = await import("node:fs").then((fs) =>
    fs.readFileSync(new URL("../../../lib/auth/password-policy.ts", import.meta.url), "utf8"),
  )
  assert.match(source, /^import "server-only"/m,
    "a rule that can be imported into a client bundle is a rule somebody will eventually trust there")
  assert.match(source, /api\.pwnedpasswords\.com\/range\//,
    "the breach check must use the k-anonymity range API, never send the password")
  assert.match(source, /NODE_ENV === "production"/,
    "an unreachable breach service must fail closed in production")
  assert.doesNotMatch(source, /console\.(log|error|warn)\s*\([^)]*password/i,
    "the password is never logged")
})
