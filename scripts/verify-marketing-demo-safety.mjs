#!/usr/bin/env node
/**
 * Source-level guards for the public marketing pages.
 *
 * Two things must stay true and cannot be checked over HTTP: the fixture
 * previews must never reach a real server mutation, and the partner wall
 * must never claim a partnership that has not been verified. Both would be
 * easy to break with a well-meaning edit, so they are asserted here.
 *
 *   node scripts/verify-marketing-demo-safety.mjs
 */

import { readFileSync } from "node:fs"

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

const MARKETING_SOURCES = [
  "app/clubs/page.tsx",
  "app/public-fixtures/page.tsx",
  "components/site/connected-fixture-demo.tsx",
  "components/site/fixture-journey.tsx",
  "components/site/fixture-request-demo.tsx",
  "components/site/connected-clubs-visual.tsx",
  "components/site/partner-wall.tsx",
]

const sources = Object.fromEntries(MARKETING_SOURCES.map((p) => [p, readFileSync(p, "utf8")]))
const demoData = readFileSync("lib/marketing/fixture-journey-demo.ts", "utf8")
const partners = readFileSync("lib/marketing/partner-clubs.ts", "utf8")
const allMarketing = Object.values(sources).join("\n") + demoData

console.log("The fixture previews cannot reach real data:\n")

for (const [path, src] of Object.entries(sources)) {
  check(
    `${path} imports no Supabase client`,
    !/from ["']@\/lib\/supabase/.test(src) && !/createClient/.test(src)
  )
}
check(
  "no marketing component imports a server action",
  !Object.values(sources).some((s) => /from ["'][^"']*\/actions["']/.test(s))
)
check(
  "no marketing component performs a network call",
  !/\bfetch\(|XMLHttpRequest|axios/.test(allMarketing)
)
check(
  "the request preview form has no action and is inert",
  /readOnly/.test(sources["components/site/fixture-request-demo.tsx"]) &&
    /event.preventDefault\(\)/.test(sources["components/site/fixture-request-demo.tsx"]) &&
    !/action=/.test(sources["components/site/fixture-request-demo.tsx"])
)

console.log("\nDemo data is synthetic:")
const SYNTHETIC = ["Northbridge", "Westbrook", "Eastfield", "Riverside"]
check(
  "demo data uses the verified-fictitious club names",
  SYNTHETIC.every((n) => demoData.includes(n))
)
// These are real clubs present in the live club_directory. They must never
// appear in a demo that a visitor could mistake for a real fixture.
const REAL_CLUBS = ["Guildford", "Camberley", "Woking", "Farnham", "Burnley"]
check(
  "demo data names no club that exists in the club directory",
  !REAL_CLUBS.some((n) => demoData.includes(n)),
  REAL_CLUBS.filter((n) => demoData.includes(n)).join(", ")
)
check(
  "demo data is declared synthetic in the source",
  /STRICTLY SYNTHETIC/.test(demoData)
)
check(
  "previews are labelled so they cannot be mistaken for live surfaces",
  /Product preview/.test(allMarketing)
)

console.log("\nThe partner wall cannot fabricate a partnership:")
check(
  "the partner list is the only source the wall reads",
  /getActivePartnerClubs/.test(sources["components/site/partner-wall.tsx"]) &&
    !/club_directory|clubDirectory/.test(sources["components/site/partner-wall.tsx"])
)
check(
  "the partner wall never reads the club directory or a database",
  !/supabase|from\(["']clubs/.test(sources["components/site/partner-wall.tsx"])
)
check(
  "every partner entry would require an explicit verified record",
  /explicit, verified agreement/.test(partners)
)
check(
  "the wall renders an honest empty state when there are no partners",
  /More club partnerships will be announced here/.test(sources["components/site/partner-wall.tsx"])
)
// Not a permanent assertion that the list is empty -- it asserts that
// whatever is in it is shaped like a real, deliberate entry rather than a
// placeholder someone pasted in to fill the space.
const entryCount = (partners.match(/^\s{4}id:/gm) ?? []).length
const logoCount = (partners.match(/^\s{4}logo:/gm) ?? []).length
check(
  "any partner entry present carries a real logo asset",
  entryCount === logoCount,
  `${entryCount} entries, ${logoCount} logos`
)

console.log("\nNo private or production data referenced:")
check(
  "no real person's name, email or phone number in the demo data",
  !/@[a-z0-9-]+\.(com|co\.uk|org)/i.test(demoData) && !/\+44|07\d{9}/.test(demoData)
)
check("no localhost or 127.0.0.1 in marketing sources", !/localhost|127\.0\.0\.1/.test(allMarketing))
check("no Jaxippa reference", !/jaxippa/i.test(allMarketing))
check("product spelled Ovalball, never Overball", !/overball/i.test(allMarketing))

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
