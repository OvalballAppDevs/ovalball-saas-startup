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

import { existsSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
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

/**
 * WORDING THE PRODUCT OWNER HAS ALREADY REJECTED.
 *
 * A style rule can be satisfied by more than one phrase, and a later pass
 * tidying case or grammar can land on a phrase that reads worse and was
 * specifically turned down before. "Add one fixture" is exactly that: it
 * satisfies every mechanical rule here and was still the wrong words.
 *
 * So the decision is recorded rather than re-argued. Each entry names the
 * phrase, what to use instead, and why -- because a guard that only says
 * "banned" invites somebody to delete the guard.
 */
const REJECTED_COPY = [
  {
    phrase: "Add one fixture",
    use: "Add a Fixture",
    why: "the product wording for single-fixture creation, chosen over the literal-but-clumsy alternative",
  },
  {
    phrase: "Add One Fixture",
    use: "Add a Fixture",
    why: "Title Case does not make this the right phrase; it is still not what the control is called",
  },
  {
    phrase: "Import fixtures",
    use: "Import Fixtures",
    why: "a button label, so Title Case",
  },
  {
    phrase: "Export fixtures",
    use: "Export Fixtures",
    why: "a button label, so Title Case",
  },
]

/**
 * A GUARD THAT CANNOT SEE NEW WORK IS WORSE THAN NO GUARD.
 *
 * This enumeration used plain `git ls-files`, which lists only TRACKED
 * files. Every file is untracked while it is being written, so the guard
 * reported "ok" over hundreds of files while never once looking at the work
 * actually in progress — and only started checking it after it had been
 * committed, which is the point at which a violation is most expensive to
 * find. A green result for content it has not examined is the most
 * misleading answer a check can give.
 *
 * `--cached --others --exclude-standard` lists tracked files AND untracked
 * files that are not ignored. Tracked behaviour is unchanged; what is added
 * is the work in flight. `--exclude-standard` honours .gitignore, so
 * node_modules, .next and build output never appear, and the pathspecs
 * already confine this to app/, components/ and lib/ source.
 *
 * NEVER_SCAN is belt and braces for directories that are NOT gitignored --
 * .claude holds worktrees and job scratch, and a nested worktree contains a
 * whole second copy of the app that must not be linted as if it were this
 * one.
 */
const NEVER_SCAN = [".claude/", "node_modules/", ".next/", "out/", "dist/", "build/", "coverage/"]

// PATHSPECS: `app/*.tsx`, not `app/**/*.tsx`.
//
// In git's default pathspec matching `*` already crosses `/`, so `lib/*.ts`
// matches lib/utils.ts AND lib/app-context/clubs-data.ts. `lib/**/*.ts` does
// NOT match lib/utils.ts — it requires at least one intervening directory.
// That silently excluded every top-level file in app/, components/ and lib/
// for the whole life of this guard. The untracked self-test below is what
// surfaced it, which is the argument for having the self-test at all.
const files = execSync(
  "git ls-files --cached --others --exclude-standard 'app/*.tsx' 'app/*.ts' 'components/*.tsx' 'components/*.ts' 'lib/*.ts' 'lib/*.tsx'",
  { cwd: ROOT, encoding: "utf8" },
)
  .trim()
  .split("\n")
  .filter((f) => f && !NEVER_SCAN.some((d) => f.startsWith(d)))
  .filter((f) => !MARKETING.some((m) => f.startsWith(m)))
  // git ls-files lists what is TRACKED, which still includes a file deleted in
  // the working tree but not yet staged. Reading one threw ENOENT and took the
  // whole guard down with it, so a legitimate deletion looked like a broken
  // check. Skipping what is no longer on disk narrows nothing: a deleted file
  // has no copy left to get wrong.
  .filter((f) => existsSync(path.join(ROOT, f)))

/**
 * THE REGRESSION FOR THE BLIND SPOT ITSELF.
 *
 * The defect this guards against was not a wrong rule — every rule passed.
 * It was that the enumeration silently skipped untracked files, so the
 * guard could report "ok" over work it had never opened. A rule test would
 * not have caught that; only a test of what gets ENUMERATED can.
 *
 * So on every run the guard writes one throwaway source file in an
 * eligible location, asks the enumeration for its file list again, and
 * requires that the new file appears. The file is removed in a finally, so
 * an interrupted run cannot leave it behind, and it lives under a name
 * nothing else could mistake for real source.
 *
 * If somebody reverts the enumeration to tracked-only, this fails loudly
 * instead of going quietly green.
 */
function enumerateForSelfTest() {
  return execSync(
    "git ls-files --cached --others --exclude-standard 'app/*.tsx' 'app/*.ts' 'components/*.tsx' 'components/*.ts' 'lib/*.ts' 'lib/*.tsx'",
    { cwd: ROOT, encoding: "utf8" },
  )
    .trim()
    .split("\n")
}

const PROBE = "lib/__content_guard_untracked_probe__.ts"
{
  const probePath = path.join(ROOT, PROBE)
  let seen = false
  try {
    writeFileSync(probePath, "export const CONTENT_GUARD_PROBE = true\n")
    seen = enumerateForSelfTest().includes(PROBE)
  } finally {
    try {
      unlinkSync(probePath)
    } catch {}
  }
  if (!seen) {
    console.error("  FAIL  content_standard")
    console.error(
      `          self-test: an UNTRACKED eligible file (${PROBE}) was not enumerated.`,
    )
    console.error(
      "          The guard would report ok over work it never opened. Restore",
    )
    console.error(
      "          `git ls-files --cached --others --exclude-standard` in the enumeration.",
    )
    process.exit(1)
  }
}

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
  "components/rugby-hub/nav/hub-nav-groups.ts",
  "app/(app)/club/rollover/handover-nav.tsx",
]
for (const file of NAV_SOURCES) {
  const src = readFileSync(path.join(ROOT, file), "utf8")
  for (const m of src.matchAll(/label:\s*"([^"]+)"/g)) {
    if (toTitleCase(m[1]) !== m[1]) {
      failures.push(`${file}  navigation label "${m[1]}" should be "${toTitleCase(m[1])}"`)
    }
  }
  // Prose keys are body copy, not labels: CLAUDE.md rule 2 puts descriptions
  // and blurbs in sentence case, so title-casing them would be the defect.
  // Every real `label:` is still checked by the pattern above.
  const PROSE_KEYS = new Set(["description", "blurb", "summary", "helpText", "hint"])
  for (const m of src.matchAll(/^\s+(\w+):\s*"([A-Z][^"]+)",?$/gm)) {
    if (PROSE_KEYS.has(m[1])) continue
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

/**
 * Buttons and form labels are Title Case (CLAUDE.md rule 2).
 *
 * Only a PURE TEXT child is checked. Anything containing an expression is
 * skipped, because a label built from data is not something this file can
 * judge, and a guard that guesses gets switched off. Marketing surfaces are
 * exempt for the same reason they are exempt everywhere else: their headlines
 * are editorial sentence case on purpose.
 */
const COPY_EXEMPT = ["app/clubs", "app/game-management", "app/payment-services", "app/public-fixtures", "components/site/", "components/ui/"]
for (const file of files) {
  if (COPY_EXEMPT.some((x) => file.startsWith(x))) continue
  const src = readFileSync(path.join(ROOT, file), "utf8")
  for (const tag of ["Label", "Button", "button", "label"]) {
    const re = new RegExp(`<${tag}(?:\\s[^>]*?)?>([^<>{}]+?)</${tag}>`, "g")
    for (const m of src.matchAll(re)) {
      const text = m[1].trim()
      if (!text || !/[A-Za-z]/.test(text)) continue
      // A full sentence inside a control is body copy that happens to sit
      // there -- a confirmation line, a hint -- and stays sentence case.
      if (/[.!?]$/.test(text)) continue
      // Entities are left to a human: "&apos;" makes the word boundaries
      // ambiguous for a mechanical rule.
      if (/&[a-z]+;/.test(text)) continue
      if (toTitleCase(text) !== text) {
        failures.push(`${file}  <${tag}> "${text}" should be "${toTitleCase(text)}"`)
      }
    }
  }
}

// The rejected-copy sweep runs over the same file set as everything else,
// and deliberately over the RAW source: these phrases must not reappear in
// a label, an aria-label, a tooltip or a comment that a later pass might
// copy back into a label.
for (const file of files) {
  if (COPY_EXEMPT.some((prefix) => file.startsWith(prefix))) continue
  if (file.startsWith("scripts/")) continue
  const source = readFileSync(path.join(ROOT, file), "utf8")
  for (const { phrase, use, why } of REJECTED_COPY) {
    if (source.includes(phrase)) {
      failures.push(`${file}  uses rejected copy "${phrase}" -- use "${use}" (${why})`)
    }
  }
}

if (failures.length > 0) {
  console.error("  FAIL  content_standard")
  for (const f of failures) console.error(`          ${f}`)
  process.exit(1)
}

console.log(
  `  ok    content_standard                   ${files.length} files, ${CANONICAL_DESTINATIONS.length} destinations, ${PROTECTED_ACRONYMS.length} protected terms, ${REJECTED_COPY.length} rejected phrases`,
)
