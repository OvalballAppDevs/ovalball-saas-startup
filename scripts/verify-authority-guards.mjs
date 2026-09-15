#!/usr/bin/env node
/**
 * Runs the Phase 2 AA.5 structural guards (scripts/security/authority-guards.mjs) for run-platform-tests.sh.
 * `--write-baseline` records the current role-literal counts as the shrink list (only when a count fell).
 */
import { writeFileSync } from "node:fs"
import path from "node:path"

import { ROOT, clientTableWriteViolations, migratedDomainUiViolations, roleLiteralCounts, roleLiteralViolations } from "./security/authority-guards.mjs"

if (process.argv.includes("--write-baseline")) {
  const files = roleLiteralCounts()
  writeFileSync(path.join(ROOT, "supabase/security/role-literal-baseline.json"), JSON.stringify({
    contract: "Phase 2 AA.5 shrink list: authority role literals outside lib/auth/**. A file may only lose entries; reaches zero at Slice 10.",
    files,
  }, null, 2) + "\n")
  console.log(`wrote ${Object.keys(files).length} files`)
  process.exit(0)
}

let failed = false
const roles = roleLiteralViolations()
if (roles.problems.length) {
  failed = true
  console.error("FAIL  role literals")
  for (const p of roles.problems) console.error(`        ${p}`)
}
const migrated = migratedDomainUiViolations()
if (migrated.length) {
  failed = true
  console.error("FAIL  migrated domain interfaces")
  for (const p of migrated) console.error(`        ${p}`)
}
const writes = clientTableWriteViolations()
if (writes.length) {
  failed = true
  console.error("FAIL  client table writes")
  for (const p of writes) console.error(`        ${p}`)
}
if (failed) process.exit(1)
console.log(`  ok    authority_guards                   role literals within the shrink list${roles.shrunk.length ? ` (${roles.shrunk.length} file(s) shrank: lower the list)` : ""}; client table writes all in the manifest; migrated domain interfaces free of legacy authority`)
