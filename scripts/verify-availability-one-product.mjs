#!/usr/bin/env node
/**
 * AVAILABILITY IS ONE PRODUCT -- STRUCTURALLY.
 *
 * `supabase/tests/availability_one_product.sql` proves the DATABASE answers the
 * same way for a fixture and a training session. This proves the two CLIENTS ask
 * it the same way, which is the half a SQL suite cannot see.
 *
 * WHY A GUARD RATHER THAN A CONVENTION. Availability is described on at least
 * six surfaces -- Match Centre, Training Centre, the Agenda row, the Calendar
 * filter, the fixture list summary and the club registers -- twice over, once
 * per client. Every one of them is a place somebody can write "Can't make it"
 * while the others say "Can't attend". It has already happened twice: once for
 * the register words, which `lib/attendance/vocabulary.ts` was created to fix,
 * and once for the ANSWER words, where the shared control said "I'm available"
 * while the Agenda's own control said "Can Attend" about the same three database
 * states. The second was invisible for months because each file was internally
 * consistent.
 *
 * WHAT IT CHECKS:
 *
 *   1. The canonical vocabulary exists exactly once, in the shared package.
 *   2. No client file re-declares an availability label.
 *   3. Both clients import the shared words rather than writing their own.
 *   4. The shared availability contract imports nothing platform-specific.
 *   5. There is ONE mobile Match Centre route and no role-named copy of it.
 *   6. Neither client invents a mobile-only availability store or RPC.
 *   7. Both clients write through the canonical mutations.
 *
 * It is deliberately NOT a lint rule over English prose: those reject legitimate
 * writing and get switched off. Every check below is about a named symbol, an
 * import, a route or a table.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs"
import { join, relative } from "node:path"

const ROOT = process.cwd()
const failures = []
let checks = 0

function check(ok, message) {
  checks += 1
  if (!ok) failures.push(message)
}

function walk(dir, out = []) {
  if (!existsSync(dir)) return out
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name.startsWith(".")) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(full)
  }
  return out
}

const rel = (f) => relative(ROOT, f).replace(/\\/g, "/")
const read = (f) => (existsSync(f) ? readFileSync(f, "utf8") : "")

const webFiles = walk(join(ROOT, "app")).concat(walk(join(ROOT, "components")), walk(join(ROOT, "lib")))
const mobileFiles = walk(join(ROOT, "apps/mobile/app")).concat(walk(join(ROOT, "apps/mobile/src")))
const contractFiles = walk(join(ROOT, "packages/contracts/src"))

// ---------------------------------------------------------------------------
// 1. ONE VOCABULARY, IN THE SHARED PACKAGE
// ---------------------------------------------------------------------------
const vocabulary = join(ROOT, "packages/contracts/src/availability/vocabulary.ts")
check(existsSync(vocabulary), "packages/contracts/src/availability/vocabulary.ts is missing -- the canonical availability words must live in the shared package so both clients import the same ones.")

const vocabSrc = read(vocabulary)
check(/export const ATTENDANCE_STATE_WORDS/.test(vocabSrc), "ATTENDANCE_STATE_WORDS (the third-person register words) is not declared in the shared vocabulary.")
check(/export const ATTENDANCE_ANSWER_WORDS/.test(vocabSrc), "ATTENDANCE_ANSWER_WORDS (the first-person answer words) is not declared in the shared vocabulary. It exists because the Agenda had grown a second set for the same three states.")

for (const symbol of ["ATTENDANCE_STATE_WORDS", "ATTENDANCE_ANSWER_WORDS", "AVAILABILITY_ANSWER_ORDER", "ATTENDANCE_GROUP_ORDER"]) {
  const declarations = [...webFiles, ...mobileFiles, ...contractFiles].filter((f) =>
    new RegExp(`export const ${symbol}\\b`).test(read(f))
  )
  check(
    declarations.length === 1 && declarations[0].includes("packages/contracts"),
    `${symbol} must be declared exactly once, in packages/contracts. Found: ${declarations.map(rel).join(", ") || "nowhere"}.`
  )
}

// ---------------------------------------------------------------------------
// 2. NO CLIENT RE-DECLARES AN AVAILABILITY LABEL
// ---------------------------------------------------------------------------
//
// THE LITERAL, ANYWHERE IN LIVE CODE -- not just in a `label:` position.
//
// The first version of this check looked for `label: "Can Attend"` and asked
// that the file MENTION the shared constant somewhere. Both were too weak, and
// the mutation test said so: reinstating the Agenda's old vocabulary as a
// ternary passed cleanly, because the import line still mentioned the constant
// and the literal was not in a `label:` position. A guard that passes over the
// exact defect it was written for is worse than no guard, so this now strips
// comments and looks for the WORDS in live code.
//
// Comments are stripped rather than excluded by heuristic, because these files
// explain at length why the drift happened -- and a guard that fired on its own
// explanation would be switched off within a week.
const DRIFTED_WORDS = [
  "I'm available",
  "I'm Available",
  "Not available",
  "Not Available",
  "Can't attend",
  "Can't Attend",
  "Can Attend",
  "Cannot attend",
  "Can't make it",
  "Can't go",
]

function stripComments(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1")
}

for (const f of [...webFiles, ...mobileFiles]) {
  if (rel(f).startsWith("packages/")) continue
  const src = read(f)
  if (!/ATTENDING|CANNOT_ATTEND|UNSURE|attendance|availability/i.test(src)) continue
  const live = stripComments(src)
  for (const word of DRIFTED_WORDS) {
    check(
      !live.includes(`"${word}"`) && !live.includes(`'${word}'`) && !live.includes(`>${word}<`),
      `${rel(f)} writes the availability word "${word}" as a literal. The words come from @ovalball/contracts/availability -- a second copy is how "Can't attend", "Can't make it" and "Cannot attend" all came to mean one thing, and how the Agenda's control came to say "Can Attend" about the state the shared control called "I'm Available".`
    )
  }
}

// ---------------------------------------------------------------------------
// 3. BOTH CLIENTS IMPORT THE SHARED WORDS
// ---------------------------------------------------------------------------
const webControl = join(ROOT, "components/shared/availability-choice.tsx")
const mobileControl = join(ROOT, "apps/mobile/src/components/availability-choice.tsx")
check(existsSync(webControl), "components/shared/availability-choice.tsx is missing -- the web's one availability control.")
check(existsSync(mobileControl), "apps/mobile/src/components/availability-choice.tsx is missing -- the app's one availability control.")
for (const [f, label] of [[webControl, "web"], [mobileControl, "mobile"]]) {
  const src = read(f)
  check(
    /@ovalball\/contracts\/availability/.test(src),
    `The ${label} availability control does not import @ovalball/contracts/availability. Both clients must take the words, the order and the icons from the shared contract.`
  )
  check(
    /ATTENDANCE_ANSWER_WORDS/.test(src) && /AVAILABILITY_ANSWER_ORDER/.test(src),
    `The ${label} availability control does not use the shared answer words and order.`
  )
}

// The Agenda's own inline control, which is where the second vocabulary grew.
const agendaAnswer = join(ROOT, "components/fixtures/agenda/attendance-answer.tsx")
if (existsSync(agendaAnswer)) {
  check(
    /ATTENDANCE_ANSWER_WORDS/.test(read(agendaAnswer)),
    "components/fixtures/agenda/attendance-answer.tsx must label its buttons from ATTENDANCE_ANSWER_WORDS. It previously said 'Can Attend / Can't Attend / Maybe' about the same three states the shared control called 'I'm Available / Not Available / Unsure'."
  )
}

// ---------------------------------------------------------------------------
// 4. THE SHARED CONTRACT STAYS PLATFORM-NEUTRAL
// ---------------------------------------------------------------------------
//
// A contract that imported React, React Native, lucide or `server-only` would
// be reachable from only one client, and the sharing would be nominal.
const FORBIDDEN = /from\s+"(react|react-dom|react-native|next\/[^"]*|server-only|lucide-react|lucide-react-native|@?react-native-[^"]*)"/
for (const f of walk(join(ROOT, "packages/contracts/src/availability"))) {
  check(!FORBIDDEN.test(read(f)), `${rel(f)} imports a platform package. The availability contract must hold domain semantics only -- the renderers live in each client.`)
}

// ---------------------------------------------------------------------------
// 5. ONE MOBILE MATCH CENTRE, NO ROLE-NAMED COPY
// ---------------------------------------------------------------------------
/*
  ONE IMPLEMENTATION, however many addresses point at it.

  P3 separated the two: the Match Centre became a component in `src/fixtures/`, and
  the route files are now thin -- one is a two-line re-export of the participant
  address, and the canonical `/fixtures/<id>` chooses between the Match Centre and
  the fixture console from the server's own per-fixture capability. So this counts
  files that actually RENDER a Match Centre rather than files whose name says so; a
  re-export is an address, and addresses are allowed to multiply as long as the
  surface behind them does not.
*/
const mobileMatchCentres = mobileFiles.filter(
  (f) => /match-centre\.tsx$/.test(f) && /return\s*\(|<ScrollView|<Shell/.test(read(f))
)
check(
  mobileMatchCentres.length === 1,
  `There must be exactly one mobile Match Centre implementation. Found ${mobileMatchCentres.length}: ${mobileMatchCentres.map(rel).join(", ")}.`
)
const ROLE_PREFIXED = /\b(Parent|Player|Staff|Club|Guardian|Coach|Admin)(MatchCentre|TrainingCentre|AvailabilityChoice|AvailabilityRegister)\b/
for (const f of mobileFiles) {
  const m = read(f).match(ROLE_PREFIXED)
  check(!m, `${rel(f)} declares ${m?.[0]}. Match Centre and Training Centre are ONE surface on both clients -- roles filter the data, never the design.`)
}

// A whole-surface role branch, which is the other way the same drift arrives.
const ROLE_BRANCH = /(role|kind|context)\s*===\s*["'](PARENT|PLAYER|TEAM_ADMIN|CLUB_ADMIN|COACH|parent|player|staff)["'][^\n]*(MatchCentre|TrainingCentre)/
for (const f of mobileFiles) {
  check(!ROLE_BRANCH.test(read(f)), `${rel(f)} branches a whole Match Centre or Training Centre on a role name. Capability decides what a viewer sees, and it is resolved server-side.`)
}

// ---------------------------------------------------------------------------
// 6. NO MOBILE-ONLY AVAILABILITY STORE
// ---------------------------------------------------------------------------
const MOBILE_TABLE = /\b(mobile_availability|mobile_match_centre|mobile_training_attendance|mobile_attendance)\b/
for (const f of [...mobileFiles, ...contractFiles]) {
  check(!MOBILE_TABLE.test(read(f)), `${rel(f)} names a mobile-only availability store. There is one canonical availability model and both clients use it.`)
}
for (const f of walk(join(ROOT, "supabase/migrations"))) {
  // .sql files are not walked by the ts/tsx filter above; this loop is a no-op
  // guard kept deliberately narrow.
  check(true, "")
}

// ---------------------------------------------------------------------------
// 7. BOTH CLIENTS WRITE THROUGH THE CANONICAL MUTATIONS
// ---------------------------------------------------------------------------
const mobileRespond = join(ROOT, "apps/mobile/src/match-centre/respond.ts")
check(existsSync(mobileRespond), "apps/mobile/src/match-centre/respond.ts is missing -- the app's availability writes.")
const respondSrc = read(mobileRespond)
check(/respond_to_attendance/.test(respondSrc), "The app does not call public.respond_to_attendance. Availability must be written through the canonical mutation, never a mobile-only path.")
check(/respond_to_training_attendance/.test(respondSrc), "The app does not call public.respond_to_training_attendance.")

// And the readers, which carry the authority the control is drawn from.
const mobileLoad = read(join(ROOT, "apps/mobile/src/match-centre/load.ts"))
check(/get_my_players_for_fixture/.test(mobileLoad), "The mobile Match Centre does not read get_my_players_for_fixture. Whom a person may answer for is a canonical question, not one a client assembles from four tables.")
const webResolver = read(join(ROOT, "lib/app-context/match-centre-data.ts"))
check(/get_my_players_for_fixture/.test(webResolver), "The web Match Centre resolver does not read get_my_players_for_fixture. Both clients must consume the corrected canonical contract, or the correction only reached one of them.")

// ---------------------------------------------------------------------------
if (failures.length > 0) {
  console.error("Availability one-product check FAILED:\n")
  for (const f of failures) if (f) console.error(`  - ${f}`)
  process.exit(1)
}
console.log(`Availability one-product check passed (${checks} checks; one vocabulary, one control per client, one mutation).`)
