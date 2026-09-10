import assert from "node:assert/strict"
import { test } from "node:test"

import { CONTRACTED_EVENT_KEYS, templateContract } from "@/lib/email/contracts"
import { TEST_MODE_MESSAGE } from "@/lib/email/design/components"
import { PREVIEW_FIXTURES } from "@/lib/email/preview-fixtures"
import { renderEmail } from "@/lib/email/templates"

const SITE = "https://ovalball.co.uk"

/**
 * A TEST SEND MUST DISCLOSE ITSELF IN EVERY PART OF THE MESSAGE, NOT JUST
 * THE PART A HUMAN HAPPENS TO BE LOOKING AT.
 *
 * The HTML banner alone was not enough: a plain-text mail client, a screen
 * reader on a text-only view, or anyone reading the delivery ledger's stored
 * text body previously saw no indication the message was a test. This is
 * centralised in renderEmail() itself (lib/email/templates.ts), so it is
 * pinned once here for every event rather than once per renderer.
 */

test("every event's [TEST] send carries the disclosure in the subject, the HTML, and the plain text", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    const fixture = PREVIEW_FIXTURES[key][0]
    const contract = templateContract(key)

    const real = renderEmail(key, fixture.data as never, SITE, contract.default, undefined, false)
    const test = renderEmail(key, fixture.data as never, SITE, contract.default, undefined, true)

    assert.ok(!real.subject.startsWith("[TEST]"), `"${key}": a real send must never carry the [TEST] marker`)
    assert.ok(test.subject.startsWith("[TEST] "), `"${key}": a test send must carry the [TEST] subject marker`)
    assert.equal(test.subject, `[TEST] ${real.subject}`, `"${key}": the marker must not otherwise change the subject`)

    assert.ok(!real.text.includes(TEST_MODE_MESSAGE), `"${key}": a real send's plain text must never carry the test disclosure`)
    assert.ok(test.text.includes(TEST_MODE_MESSAGE), `"${key}": a test send's plain text must disclose itself`)

    assert.ok(!real.html.includes(TEST_MODE_MESSAGE), `"${key}": a real send's HTML must never carry the test disclosure`)
    assert.ok(test.html.includes(TEST_MODE_MESSAGE), `"${key}": a test send's HTML must disclose itself`)
  }
})

test("the HTML banner and the plain-text disclosure are the same sentence, so the two can never disagree", () => {
  const key = CONTRACTED_EVENT_KEYS[0]
  const fixture = PREVIEW_FIXTURES[key][0]
  const contract = templateContract(key)
  const rendered = renderEmail(key, fixture.data as never, SITE, contract.default, undefined, true)
  assert.ok(rendered.html.includes(TEST_MODE_MESSAGE))
  assert.ok(rendered.text.includes(TEST_MODE_MESSAGE))
})
