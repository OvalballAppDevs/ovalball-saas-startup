#!/usr/bin/env node
/**
 * EMAIL DELIVERY POLICY STRUCTURAL GUARD
 *
 * 20270125000000 removed email_template_settings.enabled because nothing
 * ever wired it up. This script exists so that mistake cannot happen a
 * third time (the second was email_events.active, wired up by
 * 20270128000000) -- and so the canonical send-boundary check cannot
 * quietly become a UI-only one, or usage aggregates cannot quietly become
 * a query per email type or a client-side count.
 *
 * 20270129000000 corrected a THIRD mistake: an earlier version of
 * set_email_event_active() refused to disable anything but
 * OPTIONAL_OPERATIONAL mail, reusing the recipient-preference
 * classification enum as an ADMIN-AUTHORITY check -- a different question
 * it was never meant to answer. This guard also keeps that correction from
 * quietly regressing, in the database function, in the TypeScript layer
 * (no second hardcoded list of "which events may be toggled"), and in the
 * UI (no wired email may ever be presented as "Always On" again).
 */
import { readFileSync, readdirSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, join } from "node:path"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(join(root, p), "utf8")
const problems = []

// ---------------------------------------------------------------------
// 1. The dead column must not be resurrected.
// ---------------------------------------------------------------------
const templateRegistrySource = read("lib/email/resolve-content.ts")
if (/\benabled\b/.test(templateRegistrySource)) {
  problems.push(
    "lib/email/resolve-content.ts references \"enabled\" -- email_template_settings.enabled was removed as a dead column (20270125000000) and must not reappear on the template registry. The on/off switch belongs on the EVENT (email_events.active), never the template."
  )
}

// ---------------------------------------------------------------------
// 2. The send boundary must check delivery policy BEFORE recipient
//    resolution -- not merely somewhere in the function, and never only
//    in the UI (a hidden/disabled button is not enforcement).
// ---------------------------------------------------------------------
const sendSource = read("lib/email/send.ts")
const policyCheckAt = sendSource.indexOf("email_event_active")
const recipientResolveAt = sendSource.indexOf("resolveRecipients(supabase, recipient)")
if (policyCheckAt === -1) {
  problems.push("lib/email/send.ts no longer calls email_event_active -- the send boundary is not enforcing delivery policy at all.")
} else if (recipientResolveAt === -1) {
  problems.push("lib/email/send.ts no longer calls resolveRecipients -- the guard's own reference point is missing (has the pipeline been restructured?).")
} else if (policyCheckAt > recipientResolveAt) {
  problems.push(
    "lib/email/send.ts checks delivery policy AFTER resolving recipients -- a disabled event must never resolve who it would have mailed. Move the email_event_active check before resolveRecipients()."
  )
}

// A UI-only disable is not enforcement. Confirm the switch component always
// calls the server action rather than only flipping local state.
const switchSource = read("app/(app)/admin/email/email-enabled-switch.tsx")
if (!/setEmailEnabled\(/.test(switchSource)) {
  problems.push("email-enabled-switch.tsx no longer calls setEmailEnabled -- a switch that only changes browser state is not a delivery policy change.")
}

// ---------------------------------------------------------------------
// 3. Usage must be set-based, from the ledger, never counted client-side
//    or fetched once per email type.
// ---------------------------------------------------------------------
const usageSource = read("lib/email/usage.ts")
if (!/\.rpc\(\s*["']email_usage_summary["']/.test(usageSource)) {
  problems.push("lib/email/usage.ts no longer calls the email_usage_summary aggregate RPC -- usage must be computed by the database, not counted in TypeScript.")
}
if (/for\s*\(.*CONTRACTED_EVENT_KEYS/.test(usageSource) || /\.map\([^)]*=>\s*.*\.rpc\(/.test(usageSource)) {
  problems.push("lib/email/usage.ts appears to call an RPC once per event key -- usage must be ONE query for every event, not a query per email type.")
}
if (!/recipient_kind\s*<>\s*['"]site_admin_test['"]|status\s*=\s*['"]site_admin_test['"]|recipientKind\s*===?\s*['"]site_admin_test['"]/.test(
  usageSource + read("supabase/migrations/20270128000000_email_delivery_policy_and_usage.sql")
)) {
  problems.push("Neither lib/email/usage.ts nor the usage migration distinguish site_admin_test rows -- test and operational sends must remain distinguishable.")
}

// ---------------------------------------------------------------------
// 4. The inventory must derive from the canonical event catalogue, so
//    every registered event appears even with zero sends -- not only from
//    delivery rows that happen to exist.
// ---------------------------------------------------------------------
const pageSource = read("app/(app)/admin/email/page.tsx")
if (!/CONTRACTED_EVENT_KEYS\.map/.test(pageSource)) {
  problems.push("app/(app)/admin/email/page.tsx no longer maps over CONTRACTED_EVENT_KEYS -- the inventory must derive from the code catalogue, not only from delivery rows that happen to exist.")
}

// ---------------------------------------------------------------------
// 5. Classification must never gate the ADMIN toggle. Checked against the
//    LATEST migration that (re)defines set_email_event_active -- Postgres
//    functions are replaceable, so an earlier migration's superseded body
//    (kept for history) must not trip this, only whichever definition
//    actually governs the database today.
// ---------------------------------------------------------------------
const migrationsDir = "supabase/migrations"
const migrationFiles = readdirSync(join(root, migrationsDir))
  .filter((f) => f.endsWith(".sql"))
  .sort() // filenames are timestamp-prefixed, so lexical sort is chronological.

let latestDefinition = null
let latestDefinitionFile = null
for (const file of migrationFiles) {
  const source = read(join(migrationsDir, file))
  const marker = "create or replace function public.set_email_event_active"
  const at = source.indexOf(marker)
  if (at === -1) continue
  const end = source.indexOf("$$;", at)
  latestDefinition = source.slice(at, end === -1 ? undefined : end + 3)
  latestDefinitionFile = file
}
if (!latestDefinition) {
  problems.push("No migration defines public.set_email_event_active -- the on/off switch's write side does not exist.")
} else if (/classification/i.test(latestDefinition)) {
  problems.push(
    `${latestDefinitionFile}'s definition of set_email_event_active still references "classification" -- the switch must not gate on it. Classification governs recipient preference, never Full Site Admin's channel authority (see 20270129000000).`
  )
}

// ---------------------------------------------------------------------
// 6. No second, hardcoded list of "which events may be toggled". The one
//    legitimate source is WIRED_EVENT_KEYS (lib/email/wiring.ts), already
//    guarded by verify-email-wiring.mjs against drifting from real call
//    sites -- delivery-policy.ts must read THAT, not invent its own.
// ---------------------------------------------------------------------
const policySource = read("lib/email/delivery-policy.ts")
// A genuine import, not merely the name mentioned in a comment -- a comment
// can say "derives from WIRED_EVENT_KEYS" while the code next to it quietly
// stops doing so, which is exactly the drift this check exists to catch.
if (!/import\s*\{[^}]*\bWIRED_EVENT_KEYS\b[^}]*\}\s*from\s*["']\.\/wiring["']/.test(policySource)) {
  problems.push('lib/email/delivery-policy.ts no longer imports WIRED_EVENT_KEYS from "./wiring" -- "which events can be toggled" must come from the one canonical wiring registry, not a second list.')
}
// At least one `wired:` occurrence must be the field ASSIGNMENT computed
// from that import (a Set/array built from WIRED_EVENT_KEYS, tested with
// .has(/.includes()) -- not the interface's own `wired: boolean` type
// declaration, and not a bare hardcoded array of key strings standing in
// for the real registry.
const wiredFieldOccurrences = [...policySource.matchAll(/wired:\s*[^,\n]+/g)].map((m) => m[0])
if (!wiredFieldOccurrences.some((line) => /wiredKeys|WIRED_EVENT_KEYS/.test(line))) {
  problems.push(`lib/email/delivery-policy.ts's "wired:" assignment does not reference WIRED_EVENT_KEYS (found: ${wiredFieldOccurrences.join(" | ")}) -- it may have been replaced with a second, hardcoded list of toggleable events.`)
}
if (/wired:\s*\[\s*["']/.test(policySource)) {
  problems.push('lib/email/delivery-policy.ts appears to assign "wired:" from a hardcoded array literal of event key strings -- this must be derived from WIRED_EVENT_KEYS, never a second list.')
}
if (/classification\s*===?\s*["']OPTIONAL_OPERATIONAL["']/.test(policySource)) {
  problems.push("lib/email/delivery-policy.ts still gates toggleability on classification === OPTIONAL_OPERATIONAL -- this was the corrected mistake (20270129000000) and must not return.")
}

// ---------------------------------------------------------------------
// 7. No wired email may ever be presented as "Always On" -- that string is
//    reserved for a genuinely un-toggleable concept this product no longer
//    has for any WIRED event.
// ---------------------------------------------------------------------
if (/Always On/.test(switchSource)) {
  problems.push('email-enabled-switch.tsx still contains the string "Always On" -- no wired email may be shown as permanently on; a "Not Wired" event gets that label instead.')
}

if (problems.length > 0) {
  console.error("FAIL  email delivery policy")
  for (const p of problems) console.error(`        ${p}`)
  process.exit(1)
}

console.log("ok    email_delivery_policy               send boundary, usage aggregation, inventory and channel-not-classification authority all structurally sound")
