#!/usr/bin/env node
/**
 * Permanent guard for the ONE CANONICAL TEAM DIRECTORY invariant.
 *
 * Ovalball must have exactly one authoritative source of what team identities
 * exist: `canonical_team_types`, projected per rugby code through
 * `canonical_team_types_by_code`. A `BOOTSTRAP_TEAM_CATEGORY_GROUPS` constant
 * once mirrored that list in TypeScript "as a fallback" and quietly drifted --
 * it still offered girls single-year grades Rugby Union does not run, and knew
 * nothing of U17, U18, U19 or either Open Age identity. It was removed; this
 * exists so it cannot come back unnoticed.
 *
 * WHAT THIS DELIBERATELY DOES NOT FLAG
 *
 * Not every hardcoded team string is a defect, and a guard that cried wolf
 * would be turned off within a week. Test fixtures, marketing demo data,
 * historical snapshots, display derivation and DB-boundary mirrors are all
 * legitimate. What is NOT legitimate is a module-level array or object that
 * enumerates SELECTABLE team identities -- i.e. a second catalogue a picker
 * could render.
 *
 *   node scripts/verify-one-team-catalogue.mjs
 */

import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const ROOTS = ["app", "lib", "components"]

/** Paths whose team strings are legitimately not a catalogue. */
const EXEMPT = [
  /\.verify\.ts$/,               // pure unit-test fixtures
  /\.test\.tsx?$/,
  /lib\/marketing\//,            // demo/marketing copy, never selectable
  /lib\/teams\/compact-label\.ts$/, // display derivation for historical rows
  /lib\/teams\/age-groups\.ts$/,    // documented mirror of the DB check constraint
]

/**
 * A catalogue looks like a module-level binding whose name says "catalogue"
 * AND whose value enumerates several age-grade identities. Both halves are
 * required: `YOUTH_AGE_GROUPS` in age-groups.ts is a DB-boundary mirror, and a
 * lone "U12" in a default value is not a catalogue.
 */
const CATALOGUE_NAME = /(?:const|let|var)\s+([A-Z0-9_]*(?:TEAM|CATALOG|CATALOGUE|SIGNUP_TEAMS|AGE_GRADES|TEAM_TYPES)[A-Z0-9_]*)\s*(?::[^=]+)?=\s*(\[|\{)/g
const IDENTITY = /["'`](?:U\d{1,2}|Under \d{1,2}|Girls U\d{1,2}|Junior Colts|Senior Colts|Men's Open Age|Women's Open Age|Men's \d(?:st|nd|rd)|Women's \d(?:st|nd|rd))["'`]/g

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry)
    const s = statSync(p)
    if (s.isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue
      walk(p, out)
    } else if (/\.tsx?$/.test(p)) out.push(p)
  }
  return out
}

const findings = []
for (const root of ROOTS) {
  let files
  try {
    files = walk(root)
  } catch {
    continue
  }
  for (const file of files) {
    if (EXEMPT.some((re) => re.test(file))) continue
    const src = readFileSync(file, "utf8")
    for (const m of src.matchAll(CATALOGUE_NAME)) {
      // Take a window from the binding and count distinct identities in it.
      const window = src.slice(m.index, m.index + 4000)
      const ids = new Set([...window.matchAll(IDENTITY)].map((x) => x[0]))
      if (ids.size >= 3) {
        findings.push({ file, name: m[1], count: ids.size, sample: [...ids].slice(0, 4).join(", ") })
      }
    }
  }
}

if (findings.length === 0) {
  console.log("PASS: no competing hardcoded team catalogue found.")
  console.log("      canonical_team_types (via canonical_team_types_by_code) remains the single authority.")
  process.exit(0)
}

console.error("FAIL: a second authoritative team catalogue appears to have been reintroduced.\n")
for (const f of findings) {
  console.error(`  ${f.file}`)
  console.error(`    ${f.name} enumerates ${f.count} team identities (e.g. ${f.sample})`)
}
console.error("\nTeam identities must come from canonical_team_types, projected per rugby code")
console.error("through canonical_team_types_by_code. If this binding is genuinely presentation,")
console.error("a historical snapshot or a test fixture, add its path to EXEMPT in this script")
console.error("with a comment saying why.")
process.exit(1)
