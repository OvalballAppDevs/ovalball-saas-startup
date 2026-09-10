#!/usr/bin/env node
/**
 * LIVE PROOF: resolveTrainingEmailContext against a REAL local
 * training_sessions row -- not a synthetic fixture. Read-only, local stack
 * only.
 *
 * There is no "event" mode here: resolveEventEmailContext was removed --
 * it was built against public.club_events, which is Main's in-progress
 * Event Centre work and is not yet part of the committed platform. See
 * docs/EMAIL_DYNAMIC_DATA_CATALOGUE.md for Event's PLANNED / NOT AVAILABLE
 * status, the same treatment as Tournament.
 *
 *   node --import ./scripts/email-test-loader.mjs --experimental-strip-types \
 *     scripts/prove-training-event-context.mjs training <id>
 */
import { createClient } from "@supabase/supabase-js"

const SUPABASE_URL = process.env.SUPABASE_URL ?? "http://127.0.0.1:54321"
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!SERVICE_ROLE_KEY) {
  console.error("Set SUPABASE_SERVICE_ROLE_KEY (local stack only).")
  process.exit(1)
}
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

const [kind, id] = process.argv.slice(2)

if (kind === "training") {
  const { resolveTrainingEmailContext } = await import("../lib/email/context/resolve-training-email-context.ts")
  const { trainingSummaryBlock } = await import("../lib/email/design/components.ts")
  const resolution = await resolveTrainingEmailContext(supabase, id)
  console.log(JSON.stringify(resolution, null, 2))
  if (resolution.status === "available") {
    console.log("\n--- trainingSummaryBlock() output ---")
    console.log(trainingSummaryBlock(resolution.context))
  }
} else {
  console.error("Usage: prove-training-event-context.mjs training <id>")
  process.exit(1)
}
