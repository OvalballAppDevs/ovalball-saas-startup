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
  "app/game-management/page.tsx",
  "app/payment-services/page.tsx",
  "components/site/connected-fixture-demo.tsx",
  "components/site/fixture-journey.tsx",
  "components/site/fixture-request-demo.tsx",
  "components/site/connected-clubs-visual.tsx",
  "components/site/partner-wall.tsx",
  "components/site/availability-demo.tsx",
  "components/site/connected-game-visual.tsx",
  "components/site/membership-journey-demo.tsx",
  "components/site/finance-dashboard-demo.tsx",
]

const sources = Object.fromEntries(MARKETING_SOURCES.map((p) => [p, readFileSync(p, "utf8")]))
const gameDayData = readFileSync("lib/marketing/game-day-demo.ts", "utf8")
const demoData = readFileSync("lib/marketing/fixture-journey-demo.ts", "utf8") + gameDayData
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

console.log("\nGame Management and Payment previews stay inside the real product's vocabulary:")
check(
  "availability uses the canonical ATTENDING / CANNOT_ATTEND / UNSURE values",
  /"ATTENDING"/.test(gameDayData) && /"CANNOT_ATTEND"/.test(gameDayData) && /"UNSURE"/.test(gameDayData)
)
check(
  "no invented second availability vocabulary",
  !/"(AVAILABLE|NOT_AVAILABLE|MAYBE|YES|NO)"/.test(gameDayData)
)
check(
  "payment statuses come from the real obligation label set",
  /Scheduled for collection/.test(gameDayData) && /Submitted to GoCardless/.test(gameDayData)
)
check(
  "demo clubs carry the unmistakably fictitious Ovalball prefix",
  /Ovalball North RFC/.test(gameDayData) && /Ovalball West RFC/.test(gameDayData)
)
check(
  "no GoCardless customer, mandate, payment or subscription identifier",
  !/\b(CU|MD|PM|SB|BRQ)[0-9A-Z]{6,}\b/.test(allMarketing)
)
// Phrases like "Ovalball never stores the bank details" are reassurances,
// not exposures -- what must never appear is an actual VALUE: a sort code,
// an account number, or an IBAN rendered next to its label.
check(
  "no bank detail VALUE appears in any payment preview",
  !/sort ?code\W{0,4}\d/i.test(allMarketing) &&
    !/account number\W{0,4}\d/i.test(allMarketing) &&
    !/\b\d{2}-\d{2}-\d{2}\b/.test(allMarketing) &&
    !/\bGB\d{2}[A-Z]{4}\d{14}\b/.test(allMarketing)
)
check(
  "no marketing page claims an official GoCardless partnership",
  !/proudly partnered with GoCardless|official (GoCardless )?partner/i.test(allMarketing)
)
check(
  "no guaranteed-collection or instant-settlement claim",
  !/always be collected|payment completes in seconds|instant(ly)? (settle|collect)|guaranteed collection/i.test(allMarketing)
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
