import assert from "node:assert/strict"
import { test } from "node:test"

import { CONTRACTED_EVENT_KEYS, allowedVariables } from "@/lib/email/contracts"
import { DYNAMIC_DATA_CATALOGUE } from "@/lib/email/dynamic-data/catalogue"

/**
 * WHAT THE DYNAMIC DATA CATALOGUE MUST NEVER BE ABLE TO EXPOSE.
 *
 * "Extensive" is not "unrestricted" -- see the catalogue's own header. This
 * is the negative-space test: a scan of every registered key's name AND its
 * own metadata text for the specific protected-data shapes this task
 * enumerated, so a future addition to the catalogue is checked the same way
 * automatically, without anyone having to remember to write a new test for
 * it.
 */

const FORBIDDEN_IN_KEY_OR_LABEL =
  /(date_of_birth|\bdob\b|password|api_key|auth_id|user_id|player_id|guardian_id|capability|service_role|latitude|longitude|\blat\b|\blng\b|\blon\b)/i

test("no catalogue key or label names a forbidden protected-data shape", () => {
  for (const [key, meta] of Object.entries(DYNAMIC_DATA_CATALOGUE)) {
    assert.ok(!FORBIDDEN_IN_KEY_OR_LABEL.test(key), `catalogue key "${key}" names protected data`)
    assert.ok(!FORBIDDEN_IN_KEY_OR_LABEL.test(meta.label), `catalogue key "${key}" has a label naming protected data: "${meta.label}"`)
  }
})

test("no catalogue key is a bare email address token -- recipient_first_name/full_name only, never recipient_email", () => {
  assert.ok(!("recipient_email" in DYNAMIC_DATA_CATALOGUE))
  assert.ok(!("email" in DYNAMIC_DATA_CATALOGUE))
  for (const key of Object.keys(DYNAMIC_DATA_CATALOGUE)) {
    assert.ok(!/email_address|_email\b/i.test(key), `"${key}" looks like a raw email-address token`)
  }
})

test("no catalogue key names a raw internal id", () => {
  for (const key of Object.keys(DYNAMIC_DATA_CATALOGUE)) {
    assert.ok(!/^id$|_id$/i.test(key), `"${key}" looks like a raw database id`)
  }
})

test("every event's allowed variables resolve to real catalogue entries -- no drift between contracts.ts and the catalogue", () => {
  for (const key of CONTRACTED_EVENT_KEYS) {
    for (const variable of allowedVariables(key)) {
      assert.ok(variable.name in DYNAMIC_DATA_CATALOGUE, `"${key}" declares "${variable.name}", which is not a registered catalogue key`)
    }
  }
})

test("only fixture/training venue-address items may mention a postcode, and none of them is a person's address", () => {
  const postcodeKeys = Object.keys(DYNAMIC_DATA_CATALOGUE).filter((k) => /postcode/i.test(k))
  for (const key of postcodeKeys) {
    assert.match(key, /^(fixture|training|event)_/, `"${key}" is a postcode field outside the venue/location domains`)
  }
})

test("search operates purely on catalogue metadata text, never on a database schema or query", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("../../../lib/email/dynamic-data/catalogue.ts", import.meta.url), "utf8")
  )
  assert.ok(!/from\s+["']@\/lib\/supabase/.test(source), "the catalogue module must never import a Supabase client")
  assert.ok(!/\.from\(/.test(source), "the catalogue module must never build a database query")
})
