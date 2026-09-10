import assert from "node:assert/strict"
import { test } from "node:test"

import { validateTestEmailDestination } from "@/lib/email/test-send-validation"

/**
 * SEND TEST EMAIL'S DESTINATION FIELD REACHES A MAIL PROVIDER REQUEST
 * MORE OR LESS DIRECTLY.
 *
 * These are the shapes that turn "one test address" into something else:
 * a second address smuggled in, a header injected into the provider
 * request, or a value that is not really an email address at all. Every
 * one of these must be refused before the value ever reaches
 * lib/email/send.ts#sendTestEmail.
 */

test("a single well-formed address is accepted", () => {
  const result = validateTestEmailDestination("callumkrizz@gmail.com")
  assert.equal(result.ok, true)
})

test("a newline is refused -- the header-injection vector", () => {
  const result = validateTestEmailDestination("callumkrizz@gmail.com\r\nBcc: everyone@ovalball.test")
  assert.equal(result.ok, false)
})

test("a bare newline mid-string is refused, not just at the ends", () => {
  const result = validateTestEmailDestination("callum\n@gmail.com")
  assert.equal(result.ok, false)
})

test("a comma-separated list is refused, not treated as multiple sends", () => {
  const result = validateTestEmailDestination("callumkrizz@gmail.com,attacker@example.com")
  assert.equal(result.ok, false)
})

test("a semicolon-separated list is refused", () => {
  const result = validateTestEmailDestination("callumkrizz@gmail.com;attacker@example.com")
  assert.equal(result.ok, false)
})

test("a space-separated pair is refused", () => {
  const result = validateTestEmailDestination("callumkrizz@gmail.com attacker@example.com")
  assert.equal(result.ok, false)
})

test("more than one @ is refused", () => {
  const result = validateTestEmailDestination("callum@krizz@gmail.com")
  assert.equal(result.ok, false)
})

test("no @ at all is refused", () => {
  const result = validateTestEmailDestination("not-an-email")
  assert.equal(result.ok, false)
})

test("an address over 254 characters is refused", () => {
  const local = "a".repeat(250)
  const result = validateTestEmailDestination(`${local}@example.com`)
  assert.equal(result.ok, false)
})

test("an empty or whitespace-only value is refused", () => {
  assert.equal(validateTestEmailDestination("").ok, false)
  assert.equal(validateTestEmailDestination("   ").ok, false)
})

test("a non-string value is refused rather than coerced", () => {
  // @ts-expect-error -- deliberately passing the wrong type, as an untrusted caller might
  const result = validateTestEmailDestination(123)
  assert.equal(result.ok, false)
})

test("surrounding whitespace is trimmed for an otherwise valid address", () => {
  const result = validateTestEmailDestination("  callumkrizz@gmail.com  ")
  assert.equal(result.ok, true)
  if (result.ok) assert.equal(result.email, "callumkrizz@gmail.com")
})
