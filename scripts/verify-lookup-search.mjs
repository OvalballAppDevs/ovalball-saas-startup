#!/usr/bin/env node
/**
 * Permanent guards for Ovalball's type-ahead search behaviour.
 *
 * Two of these were reported as broken, and they were broken differently
 * because they were three separate implementations: the venue address field
 * required clicking a Search button, and Site Admin's Lookup Administration
 * was a `<form method="get">` that needed Enter and a full page navigation.
 *
 * What matters and cannot be seen from a screenshot:
 *
 *   * no search surface requires a button press or Enter to START searching;
 *   * they all go through ONE primitive, so accessibility and
 *     race-condition handling exist once rather than three times;
 *   * the primitive really does debounce, discard superseded responses, and
 *     expose combobox semantics;
 *   * club lookup reads the source its field semantics require, and says so.
 *
 *   node scripts/verify-lookup-search.mjs
 */

import { readFileSync, existsSync } from "node:fs"

let pass = 0
let fail = 0

function check(name, ok, detail = "") {
  if (ok) {
    pass++
    console.log(`  PASS  ${name}`)
  } else {
    fail++
    console.log(`  FAIL  ${name}${detail ? ` -- ${detail}` : ""}`)
  }
}

const read = (p) => (existsSync(p) ? readFileSync(p, "utf8") : "")
/** Comments quote the old broken behaviour on purpose; checks read code only. */
const code = (p) =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")

const auto = read("components/ui/autocomplete.tsx")
const autoCode = code("components/ui/autocomplete.tsx")
const address = code("components/address/address-lookup-field.tsx")
const clubSearch = code("app/(app)/admin/lookups/club-search.tsx")
const lookupPage = code("app/(app)/admin/lookups/page.tsx")
const teamSearch = code("app/(app)/admin/fixtures/team-search-input.tsx")
const lookupActions = read("app/(app)/admin/lookups/actions.ts")

console.log("\nShared autocomplete primitive\n")

check("the primitive exists", auto.length > 0)
check("it debounces rather than firing per keystroke", /setTimeout\(/.test(autoCode) && /debounceMs/.test(autoCode))
check(
  "superseded responses are discarded (no last-write-wins race)",
  /seq\.current/.test(autoCode) && /mine !== seq\.current/.test(autoCode)
)
check("it exposes combobox semantics", /role="combobox"/.test(autoCode) && /aria-expanded=/.test(autoCode))
check("options are a labelled listbox", /role="listbox"/.test(autoCode) && /role="option"/.test(autoCode))
check("the active option is announced", /aria-activedescendant=/.test(autoCode))
check("arrow keys move the highlight", /ArrowDown/.test(autoCode) && /ArrowUp/.test(autoCode))
check("Enter selects the highlighted option", /e\.key === "Enter"/.test(autoCode) && /choose\(options\[active\]\)/.test(autoCode))
check("Escape closes the list", /e\.key === "Escape"/.test(autoCode))
check("there is a clear control", /aria-label="Clear search"/.test(autoCode))
check("loading, empty and error states are distinct", /emptyMessage/.test(autoCode) && /Searching/.test(autoCode) && /setError/.test(autoCode))
check("state changes are announced politely", /aria-live="polite"/.test(autoCode))

console.log("\nNo surface requires a button or Enter to start searching\n")

check(
  "the venue address field no longer has a Search button",
  address.length > 0 && !/onClick=\{handleSearch\}/.test(address) && !/>\s*Search\s*</.test(address)
)
check("the venue address field uses the shared primitive", /<Autocomplete/.test(address))
check(
  "Lookup Administration no longer submits a GET form to search",
  lookupPage.length > 0 && !/<form method="get"/.test(lookupPage)
)
check("Lookup Administration uses the shared primitive", /<ClubSearch/.test(lookupPage) && /<Autocomplete/.test(clubSearch))
check("the fixture team search uses the shared primitive", /<Autocomplete/.test(teamSearch))

// Any future search surface should reuse the primitive rather than rolling
// its own debounce; this catches the obvious regression.
check(
  "no surface re-implements its own debounce",
  ![address, clubSearch, teamSearch].some((s) => /setTimeout\(/.test(s))
)

console.log("\nClub lookup semantics\n")

check(
  "club lookup re-derives Site Admin authority (a server action is a public endpoint)",
  /requireActiveSiteAdmin/.test(lookupActions)
)
check(
  "club lookup reads activated Ovalball clubs, and the choice is documented",
  /clubs!inner/.test(lookupActions) && /club_directory/.test(lookupActions)
)
check(
  "LIKE wildcards in user input are escaped",
  /replace\(\/\[%_\\\\\]\/g/.test(lookupActions) || /\[%_\\\\\]/.test(lookupActions)
)
check("club suggestions carry identity beyond the name", /town/.test(lookupActions) && /teamCount/.test(lookupActions))
check(
  "team counts are batched, never a query per suggestion",
  /\.in\("club_id", ids\)/.test(lookupActions)
)

console.log("\nTeam lookup is club-aware\n")

check("each team suggestion shows its owning club", /clubName/.test(teamSearch))
check("teams are selected by stable id, never by name", /optionKey=\{\(t\) => t\.teamId\}/.test(teamSearch))

console.log(`\n${pass} passed, ${fail} failed\n`)
process.exit(fail > 0 ? 1 : 0)
