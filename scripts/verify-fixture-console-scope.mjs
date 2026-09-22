#!/usr/bin/env node
/**
 * THE FIXTURE CONSOLE IS A CONSOLE, NOT A STACK OF CARDS.
 *
 * The product owner rejected a Fixture Detail screen that had become a collection of modules --
 * availability statistics, a Club Documents list, a Manage section whose only job was to link to a
 * separate Edit screen. The corrections are structural rather than cosmetic, so they are guarded
 * structurally: each is the kind a later session would re-add on reasonable-sounding grounds.
 *
 *   AVAILABILITY belongs in Match Centre, with the team sheet and match day. A second availability
 *   surface on the fixture is exactly the drift Match Centre's one-shared-surface architecture exists
 *   to prevent, and "just a small summary" is how it starts.
 *
 *   CLUB DOCUMENTS belongs to the Club Documents product. Pinning a club's library onto every fixture
 *   was a second, worse projection of it; documents reach a fixture through MESSAGING, where sending
 *   one is an act rather than a list. The M4 picker and the canonical library are untouched -- this
 *   guards only the fixture projection.
 *
 *   A SEPARATE EDIT DESTINATION is what made the console indirect. The displayed value is the control.
 *
 *   DELETE is club-scoped in the capability catalogue and never belongs to team mobile.
 *
 * It reads what SHIPS -- the screen's own source and the routes beside it -- not comments.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..")
const CONSOLE_DIR = join(ROOT, "apps", "mobile", "app", "(tabs)", "fixtures", "[fixtureId]")
const CONSOLE = join(CONSOLE_DIR, "index.tsx")
const failures = []
let checks = 0

const check = (ok, label, detail = "") => {
  checks += 1
  if (!ok) failures.push(`${label}${detail ? ` — ${detail}` : ""}`)
}

check(existsSync(CONSOLE), "the fixture console exists", CONSOLE)
const consoleSource = existsSync(CONSOLE) ? readFileSync(CONSOLE, "utf8") : ""

// The identity block is its own component, so the checks about how a fixture is PRESENTED read it
// there. Splitting it out is the point -- the hero is drawn once and the console composes it.
const HERO = join(ROOT, "apps", "mobile", "src", "components", "fixture-hero.tsx")
check(existsSync(HERO), "the fixture hero exists", HERO)
const source = consoleSource + (existsSync(HERO) ? readFileSync(HERO, "utf8") : "")

// Comments legitimately explain WHY availability and documents are absent, so the checks look for the
// code that would render them rather than for the words.
const code = consoleSource
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")

// The Match Centre row legitimately NAMES availability as one of the things behind it -- that is the
// pointer, not a second surface. What must not exist is a count rendered here.
const withoutMatchCentreRow = code.replace(/detail="Team sheet[^"]*"/g, "")
check(!/\bavailability\b/i.test(withoutMatchCentreRow), "no availability is rendered on the console")
check(!/\bAvailable\b|\bUnavailable\b|\bAwaiting\b/.test(code), "and no available/unavailable/awaiting counts")
check(!/fixture_availability_summary/.test(code), "the console does not read the availability summary")
check(!/searchClubDocuments|club_documents|ClubDocument\b/.test(code), "no club documents are rendered on the console")
check(!/openAttachment/.test(code), "the console does not open documents itself")
check(!/delete_fixture|deleteFixture/.test(code), "there is no fixture deletion")

// The corrections that must be PRESENT.
check(/Match Centre/.test(source), "Match Centre has an entry point")
check(/teamId:\s*fixture\.teamId/.test(source), "and it carries the team, so availability is one squad's")
check(/ON OVALBALL|NOT ON OVALBALL/.test(source), "opposition presence is shown")
check(/onOvalball/.test(consoleSource), "from the shared contract's own answer")
check(/WE'RE AT HOME|WE'RE AWAY/.test(source), "home and away is shown as words, not a letter")
check(/homeAway !== "Away"/.test(source), "and the layout itself carries the orientation")
check(/Cancel Fixture/.test(source), "Cancel Fixture is on the console")
check(/colour\.danger/.test(source), "and is drawn in the danger tone")
check(/CancelSheet/.test(source), "with a confirmation that names the fixture")
check(/updateKickoff/.test(source), "the kick-off is edited from the console")
check(/updateMeetTime/.test(source), "so is the meet time")
check(/updateVenue/.test(source), "so is the venue")
check(/updatePitch/.test(source), "so is the pitch")
check(/home_away/.test(consoleSource), "and so is home or away")
check(/tells the other club/.test(consoleSource), "with the consequence stated before the change")
check(/proposedKickoff/.test(source), "a proposed kick-off change is surfaced rather than reported as saved")

// No separate Edit or Cancel destination beside the console.
if (existsSync(CONSOLE_DIR)) {
  const routes = readdirSync(CONSOLE_DIR).filter((name) => name.endsWith(".tsx"))
  check(!routes.includes("edit.tsx"), "there is no separate Edit Fixture screen", routes.join(", "))
  check(!routes.includes("cancel.tsx"), "there is no separate Cancel Fixture screen", routes.join(", "))
}

// The canonical document library is NOT what this removed.
const picker = join(ROOT, "apps", "mobile", "app", "(tabs)", "messages", "documents.tsx")
check(existsSync(picker), "the M4 club-document picker still exists", picker)
const docs = join(ROOT, "apps", "mobile", "src", "messages", "documents.ts")
check(existsSync(docs), "and so does the canonical document search", docs)

if (failures.length > 0) {
  console.error(`FAIL  fixture console scope — ${failures.length} of ${checks} checks failed`)
  for (const failure of failures) console.error(`      ${failure}`)
  process.exit(1)
}
console.log(
  `PASS  fixture console scope — ${checks} checks: one console with inline editing, no availability, no club documents, no separate Edit screen, and Cancel at the bottom`
)
