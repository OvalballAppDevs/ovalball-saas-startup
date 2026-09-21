#!/usr/bin/env node
// =====================================================================================================
// SQL SUITE GOVERNANCE -- no suite exists silently outside test governance.
//
// Batch A measured 286 SQL suite files and 181 executed by the release gate, and found the runner's
// hand-maintained array listing one suite TWICE -- running it and counting its assertions twice, in the
// very total acceptance rests on. The browser side solved this in Step 7 with a registry and a guard;
// this is the same answer for SQL.
//
// ONE SOURCE OF TRUTH: supabase/tests/suite-registry.json. The runner derives its gate list from it,
// and this guard fails when the declaration and the repository disagree.
//
//   node scripts/verify-sql-suite-registry.mjs
// =====================================================================================================
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const TESTS = path.join(REPO, "supabase", "tests")
const REGISTRY = path.join(TESTS, "suite-registry.json")
const RUNNER = path.join(REPO, "scripts", "run-platform-tests.sh")

const DISPOSITIONS = new Set(["CANONICAL_GATE", "SPECIAL_PURPOSE", "SUPERSEDED", "RETIRED", "UNVERIFIED"])

const failures = []
const fail = (msg) => failures.push(msg)

if (!fs.existsSync(REGISTRY)) {
  console.error("FAIL  sql_suite_registry — supabase/tests/suite-registry.json does not exist")
  process.exit(1)
}

const registry = JSON.parse(fs.readFileSync(REGISTRY, "utf8"))
const declared = registry.suites ?? {}
const onDisk = fs
  .readdirSync(TESTS)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => f.replace(/\.sql$/, ""))
  .sort()

// 1. EVERY SUITE FILE IS DECLARED. This is the invariant the whole registry exists for.
for (const name of onDisk) {
  if (!declared[name]) fail(`undeclared SQL suite: supabase/tests/${name}.sql — add it to suite-registry.json`)
}

// 2. EVERY DECLARATION POINTS AT A FILE THAT EXISTS.
for (const name of Object.keys(declared)) {
  if (!onDisk.includes(name)) fail(`declared suite has no file: ${name} — remove it from the registry or restore the file`)
}

// 3. EVERY DISPOSITION IS ONE OF THE FIVE, AND CARRIES ITS REASON AND OWNER.
for (const [name, entry] of Object.entries(declared)) {
  if (!DISPOSITIONS.has(entry.disposition)) {
    fail(`invalid disposition for ${name}: ${JSON.stringify(entry.disposition)} — expected one of ${[...DISPOSITIONS].join(", ")}`)
  }
  if (!entry.owner || !String(entry.owner).trim()) fail(`${name} has no owner`)
  if (!entry.reason || !String(entry.reason).trim()) fail(`${name} has no reason`)
  if (entry.disposition === "SUPERSEDED" && !entry.successor) fail(`${name} is SUPERSEDED with no successor named`)
  for (const p of entry.prerequisites ?? []) {
    if (!onDisk.includes(p)) fail(`${name} names a prerequisite suite that does not exist: ${p}`)
  }
}

// 4. THE RUNNER EXECUTES EXACTLY THE CANONICAL_GATE SET -- derived, never retyped.
const runner = fs.readFileSync(RUNNER, "utf8")
const derives = /suite-registry\.json/.test(runner)
if (!derives) {
  fail("scripts/run-platform-tests.sh does not derive its suite list from suite-registry.json — a second hand-maintained list is exactly what this guard exists to prevent")
}

// A literal SUITES=( ... ) array of names would be that second list. Allowed only if it is empty or
// populated from the registry.
const literal = runner.match(/^SUITES=\(([^)]*)\)/m)
if (literal) {
  const names = literal[1]
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => /^[a-z0-9_]+$/.test(l))
  if (names.length) {
    fail(`scripts/run-platform-tests.sh still hard-codes ${names.length} suite name(s) in a SUITES=( ) array`)
    const seen = new Set()
    for (const n of names) {
      if (seen.has(n)) fail(`and registers ${n} twice`)
      seen.add(n)
    }
  }
}

const counts = { CANONICAL_GATE: 0, SPECIAL_PURPOSE: 0, SUPERSEDED: 0, RETIRED: 0, UNVERIFIED: 0 }
for (const entry of Object.values(declared)) if (counts[entry.disposition] !== undefined) counts[entry.disposition]++

if (failures.length) {
  console.error(`  FAIL  sql_suite_registry — ${failures.length} problem(s)`)
  for (const f of failures.slice(0, 40)) console.error(`        ${f}`)
  process.exit(1)
}

console.log(
  `PASS  sql suite registry — ${onDisk.length} suite files, all declared: ` +
    `${counts.CANONICAL_GATE} CANONICAL_GATE, ${counts.SPECIAL_PURPOSE} SPECIAL_PURPOSE, ` +
    `${counts.SUPERSEDED} SUPERSEDED, ${counts.RETIRED} RETIRED, ${counts.UNVERIFIED} UNVERIFIED, 0 undeclared`
)
