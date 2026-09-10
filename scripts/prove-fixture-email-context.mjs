#!/usr/bin/env node
/**
 * LIVE PROOF: a fixture email's data comes from the SAME canonical fixture
 * Match Centre reads, not a copy.
 *
 * Resolves lib/email/context/resolve-fixture-email-context.ts against a real
 * local fixture row and renders the Match Summary block
 * (lib/email/design/components.ts). Run once before changing a canonical
 * fixture field (e.g. via psql) and once after, to see the email output
 * change automatically with zero email-specific code touched.
 *
 *   node --import ./scripts/email-test-loader.mjs --experimental-strip-types \
 *     scripts/prove-fixture-email-context.mjs <fixtureId>
 */
import { createClient } from "@supabase/supabase-js"

import { resolveFixtureEmailContext } from "../lib/email/context/resolve-fixture-email-context.ts"
import { matchSummaryBlock } from "../lib/email/design/components.ts"

const SITE_URL = "http://localhost:3111"
const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY (local stack only) to run this proof.")
  process.exit(1)
}

const fixtureId = process.argv[2]
if (!fixtureId) {
  console.error("Usage: prove-fixture-email-context.mjs <fixtureId>")
  process.exit(1)
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const resolution = await resolveFixtureEmailContext(supabase, fixtureId)
if (resolution.status === "not_found") {
  console.error(`FAIL  fixture ${fixtureId} not found`)
  process.exit(1)
}
const context = resolution.context
console.log(JSON.stringify(context, null, 2))
console.log("\n--- rendered Match Summary block ---")
console.log(matchSummaryBlock(context, SITE_URL))
