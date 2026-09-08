#!/usr/bin/env node
/**
 * The Ovalball content standard, checked.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *
 * It does not try to understand English. A lint rule that decides whether an
 * arbitrary sentence should have been Title Case is wrong often enough that
 * somebody switches it off within a month, and then nothing is checked at all.
 *
 * What it checks instead is the small set of things that are unambiguous:
 *
 *   1. Canonical destinations are spelled one way. "Match Centre" and "Match
 *      centre" cannot both exist, because they are the same place.
 *   2. Known product title constants -- navigation labels and page metadata --
 *      satisfy Title Case.
 *   3. Protected acronyms keep their official form, so no future casing pass
 *      can produce "Rfu" or "Dob".
 *
 * Marketing surfaces are excluded by path: their editorial headlines are a
 * deliberate treatment, not an accident.
 */

import { readFileSync } from "node:fs"
import { execSync } from "node:child_process"
import path from "node:path"

const ROOT = path.resolve(import.meta.dirname, "..")

/** Deliberate display typography lives here. See CLAUDE.md rule 5. */
const MARKETING = [
  "app/clubs/",
  "app/game-management/",
  "app/payment-services/",
  "app/public-fixtures/",
  "app/about/",
  "app/legal/",
  "components/site/",
]

/**
 * One spelling per destination.
 *
 * Only product proper nouns belong here -- names that are never also ordinary
 * English. "Needs Attention" is a section title AND a perfectly normal phrase
 * ("Nothing needs attention this month."), so banning its lower-case form
 * site-wide would reject correct prose. Section titles like that are covered by
 * the navigation-label check below, where they really are titles.
 */
const CANONICAL_DESTINATIONS = [
  "Match Centre",
  "Rugby Hub",
  "Season Handover",
  "Site Admin",
  "Club Admin",
  "Team Admin",
  "Team Directory",
  "Club Directory",
  // "rugby union" and "rugby league" are the sports, written lower case in
  // ordinary English ("rugby league has no Constituent Bodies"). Only the
  // season label -- Rugby Union 27/28 -- is a proper noun, and that is data.
]

/** Never re-cased by any pass, now or later. */
const PROTECTED_ACRONYMS = ["RFU", "RFL", "DOB", "GoCardless", "Ovalball"]

const files = execSync("git ls-files 'app/**/*.tsx' 'app/**/*.ts' 'components/**/*.tsx' 'lib/**/*.ts'", {
  cwd: ROOT,
  encoding: "utf8",
})
  .trim()
  .split("\n")
  .filter((f) => !MARKETING.some((m) => f.startsWith(m)))

const failures = []

/**
 * Pulls the phrases a person actually reads.
 *
 * A label is prose: it has spaces and ordinary words. An identifier is not,
 * and rule 2 of the standard is explicit that internal keys are never renamed
 * for presentation -- so import paths, route paths, capability keys, header
 * names, CSS classes, SCREAMING_SNAKE enum values and download filenames are
 * all skipped. What is left is copy.
 */
function isIdentifier(s) {
  if (!s.includes(" ")) return true // a single token is never a sentence
  if (/[/_]/.test(s)) return true // path or snake_case
  if (/^[A-Z0-9_ ]+$/.test(s)) return true // SCREAMING_SNAKE
  if (/\$\{|`/.test(s)) return true // template literal
  if (/^[a-z0-9-]+(\s+[a-z0-9-:[\]().%/]+)+$/.test(s)) return true // tailwind
  return false
}

function userFacingStrings(line) {
  if (/^\s*(\/\/|\*|\/\*)/.test(line)) return []
  if (/^\s*import |\bfrom "|require\(|revalidatePath\(|\.download\s*=/.test(line)) return []
  // Server logs are for engineers, not for people using the product.
  if (/console\.(log|warn|error|info)\(/.test(line)) return []
  // A trailing comment is not interface copy.
  line = line.replace(/\/\/.*$/, " ")
  const out = []
  for (const m of line.matchAll(/"([^"\n]{3,})"/g)) {
    if (!isIdentifier(m[1])) out.push(m[1])
  }
  // JSX text: whatever is left once tags, expressions and attributes go.
  const jsx = line
    .replace(/<[^>]*>/g, " ")
    .replace(/\{[^}]*\}/g, " ")
    .replace(/"[^"]*"/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  // Real interface text reads like a sentence: letters, spaces and ordinary
  // punctuation. Anything with brackets, operators or method calls is code
  // that survived the strip, not something a person reads.
  if (jsx.includes(" ") && /^[A-Za-z][A-Za-z0-9 ,.'’\u2014:;?!&%-]*$/.test(jsx)) out.push(jsx)
  return out
}

for (const file of files) {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  src.split("\n").forEach((line, i) => {
    const strings = userFacingStrings(line)
    for (const s of strings) {
      for (const canonical of CANONICAL_DESTINATIONS) {
        // Same words, different casing, anywhere in a user-facing string.
        const re = new RegExp(`\\b${canonical.replace(/[&]/g, "\\&").replace(/\s+/g, "\\s+")}\\b`, "i")
        const m = s.match(re)
        if (m && m[0] !== canonical) {
          failures.push(`${file}:${i + 1}  "${m[0]}" should be "${canonical}"  --  ${s.slice(0, 70)}`)
        }
      }
      for (const acronym of PROTECTED_ACRONYMS) {
        const re = new RegExp(`\\b${acronym}\\b`, "i")
        const m = s.match(re)
        if (m && m[0] !== acronym && m[0].toUpperCase() !== m[0]) {
          failures.push(`${file}:${i + 1}  "${m[0]}" should be "${acronym}"  --  ${s.slice(0, 70)}`)
        }
      }
    }
  })
}

/** Navigation labels are titles by definition, so they are checked directly. */
const { toTitleCase } = await import(path.join(ROOT, "lib/content/title-case.ts"))
const NAV_SOURCES = [
  "lib/app-context/build-nav-items.ts",
  "app/(app)/club/settings/club-settings-nav.tsx",
  "app/(app)/rugby-hub/section-nav.tsx",
  "app/(app)/club/rollover/handover-nav.tsx",
]
for (const file of NAV_SOURCES) {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  for (const m of src.matchAll(/label:\s*"([^"]+)"/g)) {
    if (toTitleCase(m[1]) !== m[1]) {
      failures.push(`${file}  navigation label "${m[1]}" should be "${toTitleCase(m[1])}"`)
    }
  }
  for (const m of src.matchAll(/^\s+(\w+):\s*"([A-Z][^"]+)",?$/gm)) {
    if (toTitleCase(m[2]) !== m[2]) {
      failures.push(`${file}  navigation label "${m[2]}" should be "${toTitleCase(m[2])}"`)
    }
  }
}

/** Page metadata is what a browser tab and a bookmark show. */
for (const file of files) {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  for (const m of src.matchAll(/export const metadata\s*(?::\s*\w+)?\s*=\s*\{[^}]*title:\s*"([^"]+)"/g)) {
    if (toTitleCase(m[1]) !== m[1]) {
      failures.push(`${file}  metadata title "${m[1]}" should be "${toTitleCase(m[1])}"`)
    }
  }
}

if (failures.length > 0) {
  console.error("  FAIL  content_standard")
  for (const f of failures) console.error(`          ${f}`)
  process.exit(1)
}

console.log(`  ok    content_standard                   ${files.length} files, ${CANONICAL_DESTINATIONS.length} destinations, ${PROTECTED_ACRONYMS.length} protected terms`)
